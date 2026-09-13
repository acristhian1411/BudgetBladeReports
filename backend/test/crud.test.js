import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { migrateDatabase } from '../src/db/migrate.js';
import tillsRouter from '../src/routes/tills.js';
import categoriesRouter from '../src/routes/categories.js';
import entitiesRouter from '../src/routes/entities.js';
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

  const app = express();
  app.use(express.json());
  app.locals.db = pool;
  app.use('/api/tills', tillsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/entities', entitiesRouter);
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

test('categories seed has 22 entries including duplicate names across types', async () => {
  const res = await json('GET', '/api/categories');
  assert.equal(res.status, 200);
  const categories = await res.json();

  assert.equal(categories.length, 22);
  const ajustes = categories.filter((c) => c.name === 'Ajustes');
  assert.equal(ajustes.length, 2);
  const intereses = categories.filter((c) => c.name === 'Intereses');
  assert.equal(intereses.length, 2);
});

test('tills full CRUD with soft delete', async () => {
  const create = await json('POST', '/api/tills', {
    name: 'Caja Test',
    account_number: '1234',
  });
  assert.equal(create.status, 201);
  const created = await create.json();
  assert.equal(created.is_bank, true, 'is_bank inferred from account_number');
  assert.ok(created.uuid);

  const list = await (await json('GET', '/api/tills')).json();
  assert.ok(list.some((t) => t.id === created.id));

  const update = await json('PUT', `/api/tills/${created.id}`, { name: 'Renombrada' });
  assert.equal(update.status, 200);

  const del = await json('DELETE', `/api/tills/${created.id}`);
  assert.equal(del.status, 200);

  const afterDelete = await (await json('GET', '/api/tills')).json();
  assert.ok(!afterDelete.some((t) => t.id === created.id), 'soft-deleted till hidden');
});

test('categories create + duplicate 409 + soft delete', async () => {
  const create = await json('POST', '/api/categories', {
    name: 'Categoría Test',
    type: 'expense',
  });
  assert.equal(create.status, 201);
  const created = await create.json();

  const dup = await json('POST', '/api/categories', {
    name: 'Categoría Test',
    type: 'expense',
  });
  assert.equal(dup.status, 409);

  const del = await json('DELETE', `/api/categories/${created.id}`);
  assert.equal(del.status, 200);

  const list = await (await json('GET', '/api/categories')).json();
  assert.ok(!list.some((c) => c.id === created.id));
});

test('categories rejects invalid type', async () => {
  const res = await json('POST', '/api/categories', { name: 'X', type: 'bogus' });
  assert.equal(res.status, 400);
});

test('entities full CRUD with soft delete', async () => {
  const create = await json('POST', '/api/entities', {
    name: 'Proveedor Test',
    type: 'provider',
    contact: '555-1234',
  });
  assert.equal(create.status, 201);
  const created = await create.json();

  const update = await json('PUT', `/api/entities/${created.id}`, { name: 'Proveedor Editado' });
  assert.equal(update.status, 200);

  const del = await json('DELETE', `/api/entities/${created.id}`);
  assert.equal(del.status, 200);

  const list = await (await json('GET', '/api/entities')).json();
  assert.ok(!list.some((e) => e.id === created.id));
});

test('deleting a non-existent entity returns 404', async () => {
  const res = await json('DELETE', '/api/entities/999999');
  assert.equal(res.status, 404);
});
