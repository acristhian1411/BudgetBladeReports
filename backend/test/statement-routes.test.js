import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { migrateDatabase } from '../src/db/migrate.js';
import statementRouter from '../src/routes/statement.js';
import {
  resetTestDatabase,
  createPool,
  seedTestCategories,
  withTestUser,
  TEST_USER_ID,
} from '../test-utils/db.js';

let pool;
let server;
let baseUrl;
let expenseCategoryId;
let incomeCategoryId;
let tillId;

before(async () => {
  await resetTestDatabase();
  pool = createPool();
  await migrateDatabase(pool);
  await seedTestCategories(pool);

  const till = await pool.query(
    `INSERT INTO tills (name, account_number, is_bank, user_id, uuid, updated_at)
     VALUES ('Banco', '001-234', true, $1, $2, now()) RETURNING id`,
    [TEST_USER_ID, randomUUID()],
  );
  tillId = till.rows[0].id;

  expenseCategoryId = (await pool.query(
    `SELECT id FROM categories WHERE name = 'Alimentación' AND type = 'expense' AND user_id = $1`,
    [TEST_USER_ID],
  )).rows[0].id;
  incomeCategoryId = (await pool.query(
    `SELECT id FROM categories WHERE name = 'Salario' AND type = 'income' AND user_id = $1`,
    [TEST_USER_ID],
  )).rows[0].id;

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.locals.db = pool;
  app.use(withTestUser);
  app.use('/api/statement', statementRouter);
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

const CSV =
  'Fecha Operación;Fecha Proceso;Descripción;Referencia;Importe;Saldo\n' +
  '9/11/2026;09/11/2026;Transf. SPI ACOSTA ESCALAN;0911267780;5.000;20.769\n' +
  '09/11/2026;09/11/2026;Transf. Recibida ACOSTA ESC;3132600010;20.000;15.769\n' +
  '09/11/2026;09/11/2026;Compra Negocio PIK*EUROSU;5855175948;-130.000;-4.231\n';

const MAPPING = {
  header_row: 0,
  date: { column: 0, format: 'DD/MM/YYYY' },
  description: { columns: [2] },
  amount: { mode: 'signed', column: 4 },
};

const upload = (content, till = tillId) => {
  const formData = new FormData();
  formData.append('file', new Blob([content], { type: 'text/csv' }), 'extracto.csv');
  formData.append('till_id', String(till));
  return fetch(`${baseUrl}/api/statement/parse`, { method: 'POST', body: formData });
};

const json = (method, path, body) =>
  fetch(`${baseUrl}/api/statement${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test('POST /parse proposes a mapping when the till has no template', async () => {
  const res = await upload(CSV);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.import_id);
  assert.equal(body.needs_mapping, true);
  assert.equal(body.columns.length, 6);
  assert.equal(body.detected.amount.column, 4);

  const txns = await pool.query('SELECT COUNT(*)::int AS n FROM transactions');
  assert.equal(txns.rows[0].n, 0, 'parse must not insert into transactions');
});

test('POST /imports/:id/map applies the mapping and saves the template', async () => {
  const imp = (await upload(CSV).then((r) => r.json()));
  const res = await json('POST', `/imports/${imp.import_id}/map`, {
    mapping: MAPPING,
    save_template: true,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rows.length, 3);
  assert.equal(body.rows[2].type, 'egreso');
  assert.equal(body.rows[2].amount, 130000);
});

test('GET /templates/:tillId returns the saved mapping', async () => {
  const res = await json('GET', `/templates/${tillId}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mapping.amount.mode, 'signed');
  assert.equal(body.mapping.amount.column, 4);
});

test('POST /parse applies the template automatically on the next upload', async () => {
  const res = await upload(CSV);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.needs_mapping, false);
  assert.equal(body.rows.length, 3);
});

test('POST /imports/:id/map rejects a statement spanning more than one month', async () => {
  const wide = 'Fecha;Descripcion;Importe\n01/01/2024;A;1000\n28/02/2024;B;2000\n';
  const imp = await upload(wide).then((r) => r.json());
  const res = await json('POST', `/imports/${imp.import_id}/map`, {
    mapping: {
      header_row: 0,
      date: { column: 0, format: 'DD/MM/YYYY' },
      description: { columns: [1] },
      amount: { mode: 'signed', column: 2 },
    },
  });
  assert.equal(res.status, 400);
});

test('PATCH /imports/:id/rows validates category type and assigns', async () => {
  const imp = await upload(CSV).then((r) => r.json());
  const rows = imp.rows;
  const egreso = rows.find((r) => r.type === 'egreso');
  const ingreso = rows.find((r) => r.type === 'ingreso');

  const bad = await json('PATCH', `/imports/${imp.import_id}/rows`, {
    assignments: [{ id: egreso.id, category_id: incomeCategoryId }],
  });
  assert.equal(bad.status, 400);

  const ok = await json('PATCH', `/imports/${imp.import_id}/rows`, {
    assignments: [
      { id: egreso.id, category_id: expenseCategoryId },
      { id: ingreso.id, category_id: incomeCategoryId },
    ],
  });
  assert.equal(ok.status, 200);
});

test('POST /imports/:id/import inserts under the import till and reports pending', async () => {
  const imp = await upload(CSV).then((r) => r.json());
  const rows = imp.rows;
  const egreso = rows.find((r) => r.type === 'egreso');
  // Categorize only the egreso row; the rest stay staged.
  await json('PATCH', `/imports/${imp.import_id}/rows`, {
    assignments: [{ id: egreso.id, category_id: expenseCategoryId }],
  });

  const res = await json('POST', `/imports/${imp.import_id}/import`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.imported, 1);
  assert.equal(body.pending, 2);

  const txns = await pool.query(
    `SELECT till_id, type, amount FROM transactions WHERE user_id = $1`,
    [TEST_USER_ID],
  );
  assert.equal(txns.rows.length, 1);
  assert.equal(txns.rows[0].till_id, tillId);
  assert.equal(txns.rows[0].type, 'egreso');
});

test('DELETE /imports/:id removes a staged import', async () => {
  const imp = await upload(CSV).then((r) => r.json());
  const del = await json('DELETE', `/imports/${imp.import_id}`);
  assert.equal(del.status, 200);
  const gone = await json('GET', `/imports/${imp.import_id}`);
  assert.equal(gone.status, 404);
});
