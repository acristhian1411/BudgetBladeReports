import { z } from 'zod';
import { SYNC_TABLES, TABLE_COLUMNS, INSERT_ORDER, DELETE_ORDER } from '../db/tables.js';

const SyncOperationSchema = z.object({
  uuid: z.string().min(1),
  entity: z.enum(SYNC_TABLES),
  operation: z.enum(['create', 'update', 'delete']),
  data: z.object({ id: z.number().int().nonnegative() }).passthrough(),
  updated_at: z.string().min(1),
  device_id: z.string().nullable().optional(),
});

const SyncBatchSchema = z.object({
  changes: z.array(SyncOperationSchema).max(500),
  lastSyncedAt: z.string().optional(),
});

const EPOCH = '1970-01-01T00:00:00.000Z';

// Managed columns, always written separately from the business data.
const SYNC_COLUMNS = ['uuid', 'updated_at', 'deleted_at', 'device_id'];

const normalizeSince = (since) => {
  if (!since || since === '0') return EPOCH;
  const parsed = new Date(since);
  return Number.isNaN(parsed.getTime()) ? EPOCH : parsed.toISOString();
};

const businessColumns = (entity) => TABLE_COLUMNS[entity] ?? [];

const dataColumns = (entity) => businessColumns(entity).filter((c) => c !== 'id');

const normalizeData = (entity, data) => {
  const row = { ...data };
  // The mobile app infers bank status from the account number; replicate that
  // so reports keep working when the field is absent.
  if (entity === 'tills' && row.is_bank === undefined) {
    row.is_bank = Boolean(String(row.account_number ?? '').trim());
  }
  return row;
};

const serializeRow = (row) => {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
};

const isAlreadyProcessed = async (client, uuid) => {
  const res = await client.query(
    'SELECT 1 FROM sync_operations WHERE uuid = $1',
    [uuid],
  );
  return res.rowCount > 0;
};

const recordOperation = async (client, change) => {
  await client.query(
    `INSERT INTO sync_operations (uuid, entity, operation, entity_id, device_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (uuid) DO NOTHING`,
    [
      change.uuid,
      change.entity,
      change.operation,
      change.data?.id ?? null,
      change.device_id ?? null,
    ],
  );
};

/**
 * Applies a single create/update/delete. Returns 'applied' or 'conflict'
 * (last-write-wins skip).
 */
const applyChange = async (client, change) => {
  const { uuid, entity, operation, data, updated_at, device_id } = change;
  const row = normalizeData(entity, data);
  const id = row.id;

  if (operation === 'delete') {
    await client.query(
      `UPDATE ${entity}
          SET deleted_at = $1, updated_at = $1, device_id = $2
        WHERE id = $3`,
      [updated_at, device_id ?? null, id],
    );
    return 'applied';
  }

  // Last-write-wins: a stale create/update must not overwrite a newer record.
  const existing = await client.query(
    `SELECT updated_at FROM ${entity} WHERE id = $1`,
    [id],
  );
  const existingUpdatedAt = existing.rows[0]?.updated_at;
  if (
    existingUpdatedAt &&
    new Date(existingUpdatedAt).getTime() > new Date(updated_at).getTime()
  ) {
    return 'conflict';
  }

  const entityUuid = row.uuid ?? uuid;
  const cols = dataColumns(entity).filter(
    (c) => Object.prototype.hasOwnProperty.call(row, c) && row[c] !== undefined,
  );

  const insertCols = ['id', ...cols, ...SYNC_COLUMNS];
  const values = [
    id,
    ...cols.map((c) => row[c]),
    entityUuid,
    updated_at,
    null,
    device_id ?? null,
  ];
  const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(', ');
  const updates = [
    ...cols.map((c) => `${c} = EXCLUDED.${c}`),
    'uuid = EXCLUDED.uuid',
    'updated_at = EXCLUDED.updated_at',
    'deleted_at = EXCLUDED.deleted_at',
    'device_id = EXCLUDED.device_id',
  ].join(', ');

  await client.query(
    `INSERT INTO ${entity} (${insertCols.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updates}`,
    values,
  );
  return 'applied';
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
 * tombstones), grouped by entity. Used by both GET and POST /api/sync.
 */
export const getChangesSince = async (db, since) => {
  const sinceTs = normalizeSince(since);
  const serverChanges = {};

  for (const entity of SYNC_TABLES) {
    const cols = [...businessColumns(entity), ...SYNC_COLUMNS];
    const res = await db.query(
      `SELECT ${cols.join(', ')} FROM ${entity} WHERE updated_at > $1::timestamptz`,
      [sinceTs],
    );
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
        const result = await applyChange(client, change);
        if (result === 'conflict') {
          conflicts.push(change.uuid);
        } else {
          accepted.push(change.uuid);
        }
        await recordOperation(client, change);
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
