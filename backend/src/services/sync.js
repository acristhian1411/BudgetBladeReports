import { z } from 'zod';
import {
  SYNC_TABLES,
  INSERT_ORDER,
  DELETE_ORDER,
  BUSINESS_COLUMNS,
  FK_UUID_MAP,
} from '../db/tables.js';

const SyncOperationSchema = z.object({
  uuid: z.string().min(1),
  entity: z.enum(SYNC_TABLES),
  operation: z.enum(['create', 'update', 'delete']),
  data: z.object({ uuid: z.string().min(1) }).passthrough(),
  updated_at: z.string().min(1),
  device_id: z.string().nullable().optional(),
});

const SyncBatchSchema = z.object({
  changes: z.array(SyncOperationSchema).max(500),
  lastSyncedAt: z.string().optional(),
});

const EPOCH = '1970-01-01T00:00:00.000Z';

// Managed columns, always written separately from the business data.
const SYNC_COLUMNS = ['updated_at', 'deleted_at', 'device_id'];

const normalizeSince = (since) => {
  if (!since || since === '0') return EPOCH;
  const parsed = new Date(since);
  return Number.isNaN(parsed.getTime()) ? EPOCH : parsed.toISOString();
};

const serializeRow = (row) => {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
};

const normalizeData = (entity, data) => {
  const row = { ...data };
  // The mobile app infers bank status from the account number; replicate that
  // so reports keep working when the field is absent.
  if (entity === 'tills' && row.is_bank === undefined) {
    row.is_bank = Boolean(String(row.account_number ?? '').trim());
  }
  return row;
};

const isAlreadyProcessed = async (client, uuid) => {
  const res = await client.query(
    'SELECT 1 FROM sync_operations WHERE uuid = $1',
    [uuid],
  );
  return res.rowCount > 0;
};

const recordOperation = async (client, change, entityId) => {
  await client.query(
    `INSERT INTO sync_operations (uuid, entity, operation, entity_id, device_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (uuid) DO NOTHING`,
    [
      change.uuid,
      change.entity,
      change.operation,
      entityId,
      change.device_id ?? null,
    ],
  );
};

/**
 * Resolves each `*_uuid` FK reference in the incoming row to its internal
 * integer id via a lookup against the referenced table. Returns a new row with
 * the `*_id` columns populated (null when the reference is null or unknown).
 */
const resolveFkIds = async (client, entity, row) => {
  const fkMap = FK_UUID_MAP[entity] ?? [];
  const resolved = { ...row };

  for (const { id: idCol, uuid: uuidCol, ref } of fkMap) {
    const uuidValue = resolved[uuidCol];
    if (uuidValue == null || uuidValue === '') {
      resolved[idCol] = null;
      continue;
    }
    const res = await client.query(`SELECT id FROM ${ref} WHERE uuid = $1`, [
      uuidValue,
    ]);
    resolved[idCol] = res.rows[0]?.id ?? null;
  }

  return resolved;
};

/**
 * Applies a single create/update/delete, identified by the entity `uuid`
 * (not the server's integer id). Returns 'applied' | 'conflict' and the
 * internal id of the affected row (or null).
 */
const applyChange = async (client, change) => {
  const { entity, operation, data, updated_at, device_id } = change;
  const row = normalizeData(entity, data);
  const entityUuid = row.uuid;

  if (operation === 'delete') {
    const existing = await client.query(
      `SELECT id FROM ${entity} WHERE uuid = $1`,
      [entityUuid],
    );
    const id = existing.rows[0]?.id ?? null;
    if (id == null) {
      // Nothing to delete; idempotent tombstone for a missing row.
      return { result: 'applied', entityId: null };
    }
    await client.query(
      `UPDATE ${entity}
          SET deleted_at = $1, updated_at = $1, device_id = $2
        WHERE id = $3`,
      [updated_at, device_id ?? null, id],
    );
    return { result: 'applied', entityId: id };
  }

  // Last-write-wins: a stale create/update must not overwrite a newer record.
  const existing = await client.query(
    `SELECT id, updated_at FROM ${entity} WHERE uuid = $1`,
    [entityUuid],
  );
  const existingRow = existing.rows[0];
  if (
    existingRow?.updated_at &&
    new Date(existingRow.updated_at).getTime() > new Date(updated_at).getTime()
  ) {
    return { result: 'conflict', entityId: existingRow.id ?? null };
  }

  const resolved = await resolveFkIds(client, entity, row);

  // Only business columns actually present in the payload are written (an
  // omitted optional field must not be cleared to NULL on update).
  const businessCols = (BUSINESS_COLUMNS[entity] ?? []).filter(
    (c) => resolved[c] !== undefined,
  );
  const fkIdCols = (FK_UUID_MAP[entity] ?? []).map((fk) => fk.id);

  const insertCols = ['uuid', ...businessCols, ...fkIdCols, ...SYNC_COLUMNS];
  const values = [
    entityUuid,
    ...businessCols.map((c) => resolved[c]),
    ...fkIdCols.map((c) => resolved[c]),
    updated_at,
    null, // deleted_at
    device_id ?? null,
  ];
  const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(', ');
  const updates = [
    ...businessCols.map((c) => `${c} = EXCLUDED.${c}`),
    ...fkIdCols.map((c) => `${c} = EXCLUDED.${c}`),
    'updated_at = EXCLUDED.updated_at',
    'deleted_at = EXCLUDED.deleted_at',
    'device_id = EXCLUDED.device_id',
  ].join(', ');

  const result = await client.query(
    `INSERT INTO ${entity} (${insertCols.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (uuid) DO UPDATE SET ${updates}
     RETURNING id`,
    values,
  );

  return { result: 'applied', entityId: result.rows[0]?.id ?? null };
};

const orderFor = (change) => {
  const order = change.operation === 'delete' ? DELETE_ORDER : INSERT_ORDER;
  return order.indexOf(change.entity);
};

const sortChanges = (changes) =>
  [...changes].sort((a, b) => {
    const aDelete = a.operation === 'delete' ? 1 : 0;
    const bDelete = b.operation === 'delete' ? 1 : 0;
    if (aDelete !== bDelete) return aDelete - bDelete;
    return orderFor(a) - orderFor(b);
  });

/**
 * Returns all records changed since `since` (including soft-deleted
 * tombstones), grouped by entity. Rows carry `uuid`, business columns, `*_uuid`
 * FK references, and sync columns — but no server-internal `id`/`*_id`.
 */
export const getChangesSince = async (db, since) => {
  const sinceTs = normalizeSince(since);
  const serverChanges = {};

  for (const entity of SYNC_TABLES) {
    const businessCols = BUSINESS_COLUMNS[entity] ?? [];
    const fkMap = FK_UUID_MAP[entity] ?? [];

    const selects = ['t.uuid', ...businessCols.map((c) => `t.${c}`)];
    const joins = [];
    for (const { id, uuid, ref } of fkMap) {
      const alias = `j_${uuid}`;
      selects.push(`${alias}.uuid AS ${uuid}`);
      joins.push(`LEFT JOIN ${ref} AS ${alias} ON ${alias}.id = t.${id}`);
    }
    selects.push('t.updated_at', 't.deleted_at', 't.device_id');

    const sql = `SELECT ${selects.join(', ')}
      FROM ${entity} AS t
      ${joins.join(' ')}
      WHERE t.updated_at > $1::timestamptz`;

    const res = await db.query(sql, [sinceTs]);
    serverChanges[entity] = res.rows.map(serializeRow);
  }

  return serverChanges;
};

/**
 * Applies a batch of sync operations (outbox push from the mobile app).
 * Returns { accepted, conflicts, serverChanges, syncedAt }.
 */
export const applyChanges = async (db, input) => {
  const parsed = SyncBatchSchema.parse(input);
  const changes = sortChanges(parsed.changes);

  const accepted = [];
  const conflicts = [];

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    for (const change of changes) {
      if (await isAlreadyProcessed(client, change.uuid)) {
        accepted.push(change.uuid);
        continue;
      }

      try {
        const { result, entityId } = await applyChange(client, change);
        if (result === 'conflict') {
          conflicts.push(change.uuid);
        } else {
          accepted.push(change.uuid);
        }
        await recordOperation(client, change, entityId);
      } catch {
        // Not recorded in the ledger so the client can safely retry.
        conflicts.push(change.uuid);
      }
    }

    const serverChanges = await getChangesSince(client, parsed.lastSyncedAt);
    const syncedAt = new Date().toISOString();

    await client.query('COMMIT');
    return { accepted, conflicts, serverChanges, syncedAt };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export { SyncBatchSchema };
