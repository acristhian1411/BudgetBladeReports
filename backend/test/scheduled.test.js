import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { migrateDatabase } from '../src/db/migrate.js';
import scheduledRouter from '../src/routes/scheduled.js';
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
    ('Efectivo', gen_random_uuid(), now())`);

  const app = express();
  app.use(express.json());
  app.locals.db = pool;
  app.use('/api/scheduled', scheduledRouter);
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

test('create plan generates monthly installments', async () => {
  const res = await json('POST', '/api/scheduled/plans', {
    title: 'Alquiler',
    type: 'egreso',
    base_amount: 1000,
    total_installments: 3,
    start_date: '2026-09-01',
    till_id: 1,
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.generated, 3);

  const detail = await (await json('GET', `/api/scheduled/plans/${body.id}`)).json();
  assert.equal(detail.occurrences.length, 3);
  assert.equal(detail.occurrences[0].due_date, '2026-09-01');
  assert.equal(detail.occurrences[1].due_date, '2026-10-01');
  assert.equal(detail.occurrences[2].due_date, '2026-11-01');
  assert.equal(detail.occurrences[0].remaining_amount, 1000);
  assert.equal(detail.occurrences[0].status, 'pending');
});

test('plans list includes counts', async () => {
  const list = await (await json('GET', '/api/scheduled/plans')).json();
  const plan = list.find((p) => p.title === 'Alquiler');
  assert.ok(plan);
  assert.equal(plan.total_occurrences, 3);
  assert.equal(plan.pending_count, 3);
});

test('partial payment updates remaining and status', async () => {
  const created = await (await json('POST', '/api/scheduled/plans', {
    title: 'Cuota parcial',
    type: 'egreso',
    base_amount: 100,
    total_installments: 1,
    start_date: '2026-09-01',
    till_id: 1,
  })).json();

  const detail = await (await json('GET', `/api/scheduled/plans/${created.id}`)).json();
  const occ = detail.occurrences[0];

  const payment = await json('POST', `/api/scheduled/occurrences/${occ.id}/payment`, {
    till_id: 1,
    amount: 60,
    date: '2026-09-10',
  });
  assert.equal(payment.status, 201);
  const payBody = await payment.json();
  assert.equal(payBody.remaining_amount, 40);
  assert.equal(payBody.status, 'partially_paid');
  assert.ok(payBody.transaction_id);

  // history
  const history = await (await json('GET', `/api/scheduled/occurrences/${occ.id}/payments`)).json();
  assert.equal(history.length, 1);
  assert.equal(history[0].amount_paid, 60);
});

test('full payment marks processed', async () => {
  const created = await (await json('POST', '/api/scheduled/plans', {
    title: 'Cuota total',
    type: 'egreso',
    base_amount: 50,
    total_installments: 1,
    start_date: '2026-09-01',
    till_id: 1,
  })).json();

  const detail = await (await json('GET', `/api/scheduled/plans/${created.id}`)).json();
  const occ = detail.occurrences[0];

  const payment = await json('POST', `/api/scheduled/occurrences/${occ.id}/payment`, {
    till_id: 1,
    amount: 50,
    date: '2026-09-10',
  });
  const payBody = await payment.json();
  assert.equal(payBody.remaining_amount, 0);
  assert.equal(payBody.status, 'processed');
});

test('over-payment is rejected', async () => {
  const created = await (await json('POST', '/api/scheduled/plans', {
    title: 'Cuota over',
    type: 'egreso',
    base_amount: 50,
    total_installments: 1,
    start_date: '2026-09-01',
    till_id: 1,
  })).json();

  const detail = await (await json('GET', `/api/scheduled/plans/${created.id}`)).json();
  const occ = detail.occurrences[0];

  const payment = await json('POST', `/api/scheduled/occurrences/${occ.id}/payment`, {
    till_id: 1,
    amount: 100,
    date: '2026-09-10',
  });
  assert.equal(payment.status, 400);
});

test('edit occurrence updates due date and amount', async () => {
  const created = await (await json('POST', '/api/scheduled/plans', {
    title: 'Editable',
    type: 'egreso',
    base_amount: 100,
    total_installments: 1,
    start_date: '2026-09-01',
    till_id: 1,
  })).json();

  const detail = await (await json('GET', `/api/scheduled/plans/${created.id}`)).json();
  const occ = detail.occurrences[0];

  const patch = await json('PATCH', `/api/scheduled/occurrences/${occ.id}`, {
    due_date: '2026-12-15',
    amount: 120,
  });
  assert.equal(patch.status, 200);

  const updated = await (await json('GET', `/api/scheduled/plans/${created.id}`)).json();
  assert.equal(updated.occurrences[0].due_date, '2026-12-15');
  assert.equal(updated.occurrences[0].amount, 120);
});

test('past-due occurrence reports effective status overdue', async () => {
  const created = await (await json('POST', '/api/scheduled/plans', {
    title: 'Vencida',
    type: 'egreso',
    base_amount: 100,
    total_installments: 1,
    start_date: '2020-01-01',
    till_id: 1,
  })).json();

  const detail = await (await json('GET', `/api/scheduled/plans/${created.id}`)).json();
  assert.equal(detail.occurrences[0].effective_status, 'overdue');

  const list = await (await json('GET', '/api/scheduled/occurrences')).json();
  const found = list.find((o) => o.id === detail.occurrences[0].id);
  assert.equal(found.effective_status, 'overdue');
});

test('delete plan soft-deletes plan and occurrences', async () => {
  const created = await (await json('POST', '/api/scheduled/plans', {
    title: 'Para borrar',
    type: 'egreso',
    base_amount: 100,
    total_installments: 2,
    start_date: '2026-09-01',
    till_id: 1,
  })).json();

  const del = await json('DELETE', `/api/scheduled/plans/${created.id}`);
  assert.equal(del.status, 200);

  const detail = await json('GET', `/api/scheduled/plans/${created.id}`);
  assert.equal(detail.status, 404);
});
