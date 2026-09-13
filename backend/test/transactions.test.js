import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { migrateDatabase } from '../src/db/migrate.js';
import transactionsRouter from '../src/routes/transactions.js';
import { resetTestDatabase, createPool } from '../test-utils/db.js';

let pool;
let server;
let baseUrl;

const json = (method, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

before(async () => {
  await resetTestDatabase();
  pool = createPool();
  await migrateDatabase(pool);

  await pool.query(`INSERT INTO tills (name, uuid, updated_at) VALUES
    ('Efectivo', gen_random_uuid(), now()),
    ('Banco', gen_random_uuid(), now())`);

  const app = express();
  app.use(express.json());
  app.locals.db = pool;
  app.use('/api/transactions', transactionsRouter);
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

test('create ingreso stores a positive amount', async () => {
  const res = await json('POST', '/api/transactions', {
    till_id: 1,
    amount: 100,
    type: 'ingreso',
    description: 'Sueldo',
    date: '2026-09-13',
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.amount, 100);
  assert.equal(body.type, 'ingreso');
  assert.ok(body.uuid);
});

test('create egreso stores a positive amount', async () => {
  const res = await json('POST', '/api/transactions', {
    till_id: 1,
    amount: 25,
    type: 'egreso',
    date: '2026-09-13',
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.amount, 25);
  assert.equal(body.type, 'egreso');
});

test('transfer creates two linked legs with opposite signs', async () => {
  const res = await json('POST', '/api/transactions/transfer', {
    from_till_id: 1,
    to_till_id: 2,
    amount: 50,
    date: '2026-09-13',
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.transfer_id);

  const legs = await pool.query(
    'SELECT till_id, amount, type FROM transactions WHERE transfer_id = $1 ORDER BY amount ASC',
    [body.transfer_id],
  );
  assert.equal(legs.rowCount, 2);
  assert.equal(parseFloat(legs.rows[0].amount), -50);
  assert.equal(parseFloat(legs.rows[1].amount), 50);
  assert.equal(legs.rows[0].type, 'transferencia');
});

test('reject transfer between the same till', async () => {
  const res = await json('POST', '/api/transactions/transfer', {
    from_till_id: 1,
    to_till_id: 1,
    amount: 10,
    date: '2026-09-13',
  });
  assert.equal(res.status, 400);
});

test('reject invalid amount', async () => {
  const res = await json('POST', '/api/transactions', {
    till_id: 1,
    amount: -5,
    type: 'ingreso',
    date: '2026-09-13',
  });
  assert.equal(res.status, 400);
});

test('delete soft-deletes a single transaction', async () => {
  const created = await json('POST', '/api/transactions', {
    till_id: 1,
    amount: 10,
    type: 'egreso',
    date: '2026-09-13',
  });
  const { id } = await created.json();

  const del = await json('DELETE', `/api/transactions/${id}`);
  assert.equal(del.status, 200);

  const list = await (await json('GET', '/api/transactions?limit=100')).json();
  assert.ok(!list.data.some((t) => t.id === id), 'soft-deleted hidden');
});

test('deleting a transfer leg deletes both legs', async () => {
  const created = await json('POST', '/api/transactions/transfer', {
    from_till_id: 1,
    to_till_id: 2,
    amount: 30,
    date: '2026-09-13',
  });
  const { transfer_id, from_id } = await created.json();

  const del = await json('DELETE', `/api/transactions/${from_id}`);
  assert.equal(del.status, 200);

  const legs = await pool.query(
    'SELECT COUNT(*)::int AS c FROM transactions WHERE transfer_id = $1 AND deleted_at IS NULL',
    [transfer_id],
  );
  assert.equal(legs.rows[0].c, 0);
});
