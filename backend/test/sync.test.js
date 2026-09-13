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

const change = (uuid, entity, operation, data, updated_at, device_id = null) => ({
  uuid,
  entity,
  operation,
  data,
  updated_at,
  device_id,
});

const tx = (uuid, amount, overrides = {}) => ({
  uuid,
  amount,
  type: 'ingreso',
  description: 'test',
  transaction_date: '2026-09-13',
  ...overrides,
});

test('create operation inserts a row by uuid and records the ledger entry', async () => {
  const result = await applyChanges(pool, {
    changes: [
      change('op-create-1', 'transactions', 'create', tx('tx-1', 100), '2026-09-13T10:00:00Z'),
    ],
  });

  assert.deepEqual(result.accepted, ['op-create-1']);
  assert.deepEqual(result.conflicts, []);

  const row = await pool.query(
    'SELECT uuid, amount, description, updated_at FROM transactions WHERE uuid = $1',
    ['tx-1'],
  );
  assert.equal(row.rowCount, 1);
  assert.equal(parseFloat(row.rows[0].amount), 100);
  assert.equal(row.rows[0].description, 'test');
  assert.ok(row.rows[0].updated_at);

  const ledger = await pool.query(
    'SELECT operation FROM sync_operations WHERE uuid = $1',
    ['op-create-1'],
  );
  assert.equal(ledger.rowCount, 1);
  assert.equal(ledger.rows[0].operation, 'create');
});

test('re-applying the same operation uuid is idempotent', async () => {
  const payload = {
    changes: [change('op-idem-1', 'transactions', 'create', tx('tx-idem', 50), '2026-09-13T10:00:00Z')],
  };
  const first = await applyChanges(pool, payload);
  assert.deepEqual(first.accepted, ['op-idem-1']);

  const second = await applyChanges(pool, payload);
  assert.deepEqual(second.accepted, ['op-idem-1']);

  const count = await pool.query(
    'SELECT COUNT(*)::int AS c FROM transactions WHERE uuid = $1',
    ['tx-idem'],
  );
  assert.equal(count.rows[0].c, 1);
});

test('update operation upserts changed fields by uuid', async () => {
  await applyChanges(pool, {
    changes: [change('op-upd-1', 'transactions', 'create', tx('tx-upd', 200), '2026-09-13T11:00:00Z')],
  });

  await applyChanges(pool, {
    changes: [
      change(
        'op-upd-2',
        'transactions',
        'update',
        { uuid: 'tx-upd', amount: 300, description: 'updated', type: 'egreso', transaction_date: '2026-09-14' },
        '2026-09-13T12:00:00Z',
      ),
    ],
  });

  const row = await pool.query(
    'SELECT amount, description, type FROM transactions WHERE uuid = $1',
    ['tx-upd'],
  );
  assert.equal(parseFloat(row.rows[0].amount), 300);
  assert.equal(row.rows[0].description, 'updated');
  assert.equal(row.rows[0].type, 'egreso');
});

test('stale update loses to last-write-wins and is reported as conflict', async () => {
  const result = await applyChanges(pool, {
    changes: [
      change('op-lww-1', 'transactions', 'update', tx('tx-upd', 999), '2026-09-13T09:00:00Z'),
    ],
  });

  assert.deepEqual(result.accepted, []);
  assert.deepEqual(result.conflicts, ['op-lww-1']);

  const row = await pool.query('SELECT amount FROM transactions WHERE uuid = $1', ['tx-upd']);
  assert.equal(parseFloat(row.rows[0].amount), 300);
});

test('delete operation soft-deletes the row by uuid (tombstone)', async () => {
  await applyChanges(pool, {
    changes: [
      change('op-del-1', 'transactions', 'delete', { uuid: 'tx-upd' }, '2026-09-13T13:00:00Z'),
    ],
  });

  const row = await pool.query(
    'SELECT deleted_at, updated_at FROM transactions WHERE uuid = $1',
    ['tx-upd'],
  );
  assert.equal(row.rowCount, 1);
  assert.ok(row.rows[0].deleted_at, 'deleted_at should be set');
});

test('resolves *_uuid FK references to internal integer ids', async () => {
  await applyChanges(pool, {
    changes: [
      change('op-till-1', 'tills', 'create', { uuid: 'till-1', name: 'Efectivo' }, '2026-09-13T10:00:00Z'),
      change(
        'op-tx-fk-1',
        'transactions',
        'create',
        tx('tx-fk', 100, { till_uuid: 'till-1' }),
        '2026-09-13T10:00:00Z',
      ),
    ],
  });

  const till = await pool.query('SELECT id FROM tills WHERE uuid = $1', ['till-1']);
  const txRow = await pool.query('SELECT till_id FROM transactions WHERE uuid = $1', ['tx-fk']);
  assert.equal(txRow.rows[0].till_id, till.rows[0].id);
});

test('applies a batch in dependency order (parents before children)', async () => {
  const result = await applyChanges(pool, {
    changes: [
      change('op-child-first', 'transactions', 'create', tx('tx-order', 10, { till_uuid: 'till-order' }), '2026-09-13T10:00:00Z'),
      change('op-parent-last', 'tills', 'create', { uuid: 'till-order', name: 'Nueva' }, '2026-09-13T10:00:00Z'),
    ],
  });

  assert.deepEqual(result.conflicts, []);
  const txRow = await pool.query('SELECT till_id FROM transactions WHERE uuid = $1', ['tx-order']);
  assert.ok(txRow.rows[0].till_id != null);
});

test('persists device_id on the row', async () => {
  await applyChanges(pool, {
    changes: [
      change('op-device', 'tills', 'create', { uuid: 'till-dev', name: 'Dev' }, '2026-09-13T10:00:00Z', 'device-123'),
    ],
  });

  const row = await pool.query('SELECT device_id FROM tills WHERE uuid = $1', ['till-dev']);
  assert.equal(row.rows[0].device_id, 'device-123');
});

test('tills: is_bank is inferred from account_number when absent', async () => {
  await applyChanges(pool, {
    changes: [
      change('op-bank', 'tills', 'create', { uuid: 'till-bank', name: 'Banco', account_number: '1234' }, '2026-09-13T10:00:00Z'),
      change('op-cash', 'tills', 'create', { uuid: 'till-cash', name: 'Efectivo' }, '2026-09-13T10:00:00Z'),
    ],
  });

  const bank = await pool.query('SELECT is_bank FROM tills WHERE uuid = $1', ['till-bank']);
  const cash = await pool.query('SELECT is_bank FROM tills WHERE uuid = $1', ['till-cash']);
  assert.equal(bank.rows[0].is_bank, true);
  assert.equal(cash.rows[0].is_bank, false);
});

test('getChangesSince emits uuid, business columns, *_uuid FKs and no integer ids', async () => {
  const changes = await getChangesSince(pool, '0');

  const txRow = changes.transactions.find((r) => r.uuid === 'tx-fk');
  assert.ok(txRow, 'transaction row present');

  assert.equal(txRow.till_uuid, 'till-1', 'FK is exposed as till_uuid');
  assert.equal(parseFloat(txRow.amount), 100);
  assert.equal(txRow.type, 'ingreso');

  for (const key of ['uuid', 'updated_at', 'deleted_at', 'device_id']) {
    assert.ok(key in txRow, `row should include ${key}`);
  }
  assert.ok(!('id' in txRow), 'row should not expose server id');
  assert.ok(!('till_id' in txRow), 'row should not expose till_id');
});

test('getChangesSince includes soft-deleted tombstones and respects the cursor', async () => {
  const all = await getChangesSince(pool, '0');
  assert.ok(all.transactions.some((r) => r.uuid === 'tx-upd' && r.deleted_at), 'tombstone present on full pull');

  const afterDelete = await getChangesSince(pool, '2026-09-13T12:30:00Z');
  assert.ok(afterDelete.transactions.some((r) => r.uuid === 'tx-upd' && r.deleted_at), 'tombstone in incremental pull');
});

test('seeded categories are syncable (have uuid and updated_at)', async () => {
  const changes = await getChangesSince(pool, '0');
  assert.ok(changes.categories.length > 0);
  assert.ok(changes.categories.every((c) => c.uuid && c.updated_at));
});

test('rejects a change whose data has no entity uuid', async () => {
  await assert.rejects(
    () =>
      applyChanges(pool, {
        changes: [
          { uuid: 'op-no-entity-uuid', entity: 'transactions', operation: 'create', data: { amount: 1 }, updated_at: '2026-09-13T10:00:00Z' },
        ],
      }),
  );
});
