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

  // Mount the sync router without auth (auth is exercised in phase 5 tests).
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

test('POST /api/sync applies a create and returns accepted + serverChanges', async () => {
  const res = await fetch(`${baseUrl}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      batch([
        {
          uuid: 'route-create-1',
          entity: 'transactions',
          operation: 'create',
          data: {
            id: 1,
            amount: 100,
            type: 'ingreso',
            description: 'via route',
            transaction_date: '2026-09-13',
          },
          updated_at: '2026-09-13T10:00:00Z',
        },
      ]),
    ),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.accepted, ['route-create-1']);
  assert.deepEqual(body.conflicts, []);
  assert.ok(body.syncedAt);
  assert.ok(body.serverChanges);
});

test('GET /api/sync?since=0 returns the created row', async () => {
  const res = await fetch(`${baseUrl}/api/sync?since=0`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(
    body.serverChanges.transactions.some((r) => r.id === 1),
    'created transaction should be returned on full pull',
  );
});

test('POST /api/sync rejects a batch over the size limit with 400', async () => {
  const changes = Array.from({ length: 501 }, (_, i) => ({
    uuid: `too-many-${i}`,
    entity: 'transactions',
    operation: 'create',
    data: { id: 1000 + i, amount: 1, type: 'ingreso', transaction_date: '2026-09-13' },
    updated_at: '2026-09-13T10:00:00Z',
  }));

  const res = await fetch(`${baseUrl}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch(changes)),
  });
  assert.equal(res.status, 400);
});

test('POST /api/sync rejects an unknown entity with 400', async () => {
  const res = await fetch(`${baseUrl}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      batch([
        {
          uuid: 'bad-entity',
          entity: 'not_a_table',
          operation: 'create',
          data: { id: 1 },
          updated_at: '2026-09-13T10:00:00Z',
        },
      ]),
    ),
  });
  assert.equal(res.status, 400);
});

test('GET /api/sync with a future cursor returns no changes', async () => {
  const res = await fetch(`${baseUrl}/api/sync?since=2099-01-01T00:00:00Z`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.serverChanges.transactions.length, 0);
});
