import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { migrateDatabase } from '../src/db/migrate.js';
import syncRouter from '../src/routes/sync.js';
import { resetTestDatabase, createPool } from '../test-utils/db.js';

let pool;
let server;
let baseUrl;

before(async () => {
  await resetTestDatabase();
  pool = createPool();
  await migrateDatabase(pool);

  // Mount the sync router without auth (auth is exercised in its own tests).
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.locals.db = pool;
  app.use('/api/sync', syncRouter);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message });
  });

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

const batch = (changes, lastSyncedAt) => ({ changes, lastSyncedAt });

const post = (body) =>
  fetch(`${baseUrl}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('POST /api/sync applies a create and returns accepted + serverChanges', async () => {
  const res = await post(
    batch([
      {
        uuid: 'route-create-1',
        entity: 'transactions',
        operation: 'create',
        data: { uuid: 'tx-route-1', amount: 100, type: 'ingreso', description: 'via route', transaction_date: '2026-09-13' },
        updated_at: '2026-09-13T10:00:00Z',
      },
    ]),
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.accepted, ['route-create-1']);
  assert.deepEqual(body.conflicts, []);
  assert.ok(body.syncedAt);
  assert.ok(body.serverChanges);
});

test('GET /api/sync?since=0 returns the created row by uuid', async () => {
  const res = await fetch(`${baseUrl}/api/sync?since=0`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const row = body.serverChanges.transactions.find((r) => r.uuid === 'tx-route-1');
  assert.ok(row, 'created transaction should be returned on full pull');
  assert.ok(!('id' in row), 'response should not expose server id');
});

test('POST /api/sync rejects a batch over the size limit with 400', async () => {
  const changes = Array.from({ length: 501 }, (_, i) => ({
    uuid: `too-many-${i}`,
    entity: 'transactions',
    operation: 'create',
    data: { uuid: `tx-too-many-${i}`, amount: 1, type: 'ingreso', transaction_date: '2026-09-13' },
    updated_at: '2026-09-13T10:00:00Z',
  }));

  const res = await post(batch(changes));
  assert.equal(res.status, 400);
});

test('POST /api/sync rejects an unknown entity with 400', async () => {
  const res = await post(
    batch([
      {
        uuid: 'bad-entity',
        entity: 'not_a_table',
        operation: 'create',
        data: { uuid: 'x' },
        updated_at: '2026-09-13T10:00:00Z',
      },
    ]),
  );
  assert.equal(res.status, 400);
});

test('GET /api/sync with a future cursor returns no changes', async () => {
  const res = await fetch(`${baseUrl}/api/sync?since=2099-01-01T00:00:00Z`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.serverChanges.transactions.length, 0);
});

test('POST /api/sync with lastSyncedAt returns serverChanges since that cursor', async () => {
  const res = await post(
    batch(
      [
        {
          uuid: 'route-last-sync-1',
          entity: 'transactions',
          operation: 'create',
          data: { uuid: 'tx-last-sync', amount: 7, type: 'ingreso', transaction_date: '2026-09-13' },
          updated_at: '2026-09-13T20:00:00Z',
        },
      ],
      '2026-09-13T19:59:59Z',
    ),
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(
    body.serverChanges.transactions.some((r) => r.uuid === 'tx-last-sync'),
    'serverChanges should include the just-applied row after the lastSyncedAt cursor',
  );
});

test('POST /api/sync rejects a payload missing the operation uuid with 400', async () => {
  const res = await post(
    batch([
      {
        entity: 'transactions',
        operation: 'create',
        data: { uuid: 'tx-no-op-uuid' },
        updated_at: '2026-09-13T10:00:00Z',
      },
    ]),
  );
  assert.equal(res.status, 400);
});

test('POST /api/sync rejects a payload missing the entity uuid with 400', async () => {
  const res = await post(
    batch([
      {
        uuid: 'route-no-entity-uuid',
        entity: 'transactions',
        operation: 'create',
        data: { amount: 1 },
        updated_at: '2026-09-13T10:00:00Z',
      },
    ]),
  );
  assert.equal(res.status, 400);
});
