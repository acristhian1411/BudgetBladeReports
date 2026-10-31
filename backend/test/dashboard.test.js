import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { migrateDatabase } from '../src/db/migrate.js';
import dashboardRouter from '../src/routes/dashboard.js';
import { resetTestDatabase, createPool } from '../test-utils/db.js';

let pool;
let server;
let baseUrl;

before(async () => {
  await resetTestDatabase();
  pool = createPool();
  await migrateDatabase(pool);

  await pool.query(`INSERT INTO tills (name, uuid, updated_at) VALUES
    ('Efectivo', gen_random_uuid(), now()),
    ('Banco', gen_random_uuid(), now())`);

  await pool.query(`INSERT INTO transactions
    (till_id, amount, type, description, transaction_date, category_id,
     affects_balance, uuid, updated_at)
    VALUES
      (1, 1000, 'ingreso', 'Sueldo', '2026-09-01', NULL, 1, gen_random_uuid(), now()),
      (1, 250, 'egreso', 'Super', '2026-09-02',
        (SELECT id FROM categories WHERE name = 'Alimentación' AND type = 'expense'),
        1, gen_random_uuid(), now()),
      (2, 100, 'egreso', 'Tarjeta', '2026-09-03',
        (SELECT id FROM categories WHERE name = 'Alimentación' AND type = 'expense'),
        0, gen_random_uuid(), now()),
      (1, -300, 'transferencia', 'Retiro', '2026-09-04', NULL, 1, gen_random_uuid(), now()),
      (2, 300, 'transferencia', 'Retiro', '2026-09-04', NULL, 1, gen_random_uuid(), now()),
      (1, 50, 'egreso', 'Borrado', '2026-09-05', NULL, 1, gen_random_uuid(), now())`);
  await pool.query(
    `UPDATE transactions SET deleted_at = now() WHERE description = 'Borrado'`,
  );

  const app = express();
  app.locals.db = pool;
  app.use('/api/dashboard', dashboardRouter);
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

test('summary totals exclude transfers and soft-deleted rows', async () => {
  const res = await fetch(`${baseUrl}/api/dashboard/summary`);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.totalIncome, 1000);
  // 250 cash + 100 credit card charge; transfers and deleted rows do not count
  assert.equal(body.totalExpense, 350);
  // affects_balance rows only: 1000 - 250 - 300 + 300
  assert.equal(body.totalBalance, 750);

  assert.equal(body.byCategory.length, 1);
  assert.equal(body.byCategory[0].name, 'Alimentación');
  assert.equal(body.byCategory[0].total, 350);
  assert.equal(body.byCategory[0].count, 2);
});
