import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrateDatabase } from '../src/db/migrate.js';
import { applyChanges, getChangesSince } from '../src/services/sync.js';
import { resetTestDatabase, createPool } from '../test-utils/db.js';

let pool;

before(async () => {
  await resetTestDatabase();
  pool = createPool();
  await migrateDatabase(pool);
});

after(async () => {
  await pool.end();
});

const tx = (id, amount, overrides = {}) => ({
  id,
  till_id: null,
  amount,
  type: 'ingreso',
  description: 'test',
  transaction_date: '2026-09-13',
  ...overrides,
});

test('create operation inserts a row and records the ledger entry', async () => {
  const result = await applyChanges(pool, {
    changes: [
      {
        uuid: 'op-create-1',
        entity: 'transactions',
        operation: 'create',
        data: tx(1, 100),
        updated_at: '2026-09-13T10:00:00Z',
      },
    ],
  });

  assert.deepEqual(result.accepted, ['op-create-1']);
  assert.deepEqual(result.conflicts, []);

  const row = await pool.query(
    'SELECT amount, description, uuid, updated_at FROM transactions WHERE id = $1',
    [1],
  );
  assert.equal(row.rowCount, 1);
  assert.equal(parseFloat(row.rows[0].amount), 100);
  assert.equal(row.rows[0].description, 'test');
  assert.ok(row.rows[0].uuid);
  assert.ok(row.rows[0].updated_at);

  const ledger = await pool.query(
    'SELECT operation, entity_id FROM sync_operations WHERE uuid = $1',
    ['op-create-1'],
  );
  assert.equal(ledger.rowCount, 1);
  assert.equal(ledger.rows[0].operation, 'create');
  assert.equal(ledger.rows[0].entity_id, 1);
});

test('re-applying the same operation uuid is idempotent', async () => {
  const first = await applyChanges(pool, {
    changes: [
      {
        uuid: 'op-idem-1',
        entity: 'transactions',
        operation: 'create',
        data: tx(10, 50),
        updated_at: '2026-09-13T10:00:00Z',
      },
    ],
  });
  assert.deepEqual(first.accepted, ['op-idem-1']);

  const second = await applyChanges(pool, {
    changes: [
      {
        uuid: 'op-idem-1',
        entity: 'transactions',
        operation: 'create',
        data: tx(10, 50),
        updated_at: '2026-09-13T10:00:00Z',
      },
    ],
  });
  assert.deepEqual(second.accepted, ['op-idem-1']);

  const count = await pool.query(
    'SELECT COUNT(*)::int AS c FROM transactions WHERE id = $1',
    [10],
  );
  assert.equal(count.rows[0].c, 1);
});

test('update operation upserts changed fields', async () => {
  await applyChanges(pool, {
    changes: [
      {
        uuid: 'op-upd-1',
        entity: 'transactions',
        operation: 'update',
        data: tx(2, 200, { description: 'updated' }),
        updated_at: '2026-09-13T11:00:00Z',
      },
    ],
  });

  const row = await pool.query(
    'SELECT amount, description FROM transactions WHERE id = $1',
    [2],
  );
  assert.equal(parseFloat(row.rows[0].amount), 200);
  assert.equal(row.rows[0].description, 'updated');
});

test('stale update loses to last-write-wins and is reported as conflict', async () => {
  const result = await applyChanges(pool, {
    changes: [
      {
        uuid: 'op-lww-1',
        entity: 'transactions',
        operation: 'update',
        data: tx(2, 999),
        updated_at: '2026-09-13T09:00:00Z', // older than the 11:00 update
      },
    ],
  });

  assert.deepEqual(result.accepted, []);
  assert.deepEqual(result.conflicts, ['op-lww-1']);

  const row = await pool.query(
    'SELECT amount FROM transactions WHERE id = $1',
    [2],
  );
  assert.equal(parseFloat(row.rows[0].amount), 200);
});

test('delete operation soft-deletes the row (tombstone)', async () => {
  await applyChanges(pool, {
    changes: [
      {
        uuid: 'op-del-1',
        entity: 'transactions',
        operation: 'delete',
        data: { id: 2 },
        updated_at: '2026-09-13T12:00:00Z',
      },
    ],
  });

  const row = await pool.query(
    'SELECT deleted_at, updated_at FROM transactions WHERE id = $1',
    [2],
  );
  assert.equal(row.rowCount, 1);
  assert.ok(row.rows[0].deleted_at, 'deleted_at should be set');
  assert.ok(row.rows[0].updated_at);
});

test('getChangesSince returns only rows changed after the cursor, including tombstones', async () => {
  const all = await getChangesSince(pool, '0');
  assert.ok(all.transactions.some((r) => r.id === 1), 'created row present');
  assert.ok(
    all.transactions.some((r) => r.id === 2 && r.deleted_at),
    'soft-deleted tombstone present',
  );

  const afterDelete = await getChangesSince(pool, '2026-09-13T11:30:00Z');
  assert.ok(
    afterDelete.transactions.some((r) => r.id === 2 && r.deleted_at),
    'tombstone present in incremental pull',
  );
  assert.ok(
    !afterDelete.transactions.some((r) => r.id === 1),
    'unchanged row excluded from incremental pull',
  );
});

test('seeded categories are syncable (have uuid and updated_at)', async () => {
  const changes = await getChangesSince(pool, '0');
  assert.ok(
    changes.categories.length > 0,
    'seeded categories should be returned on full pull',
  );
  assert.ok(changes.categories.every((c) => c.uuid && c.updated_at));
});
