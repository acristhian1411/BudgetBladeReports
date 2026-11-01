import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { migrateDatabase } from '../src/db/migrate.js';
import tillsRouter from '../src/routes/tills.js';
import transactionsRouter from '../src/routes/transactions.js';
import categoriesRouter from '../src/routes/categories.js';
import dashboardRouter from '../src/routes/dashboard.js';
import syncRouter from '../src/routes/sync.js';
import { resetTestDatabase, createPool, seedTestCategories } from '../test-utils/db.js';

let pool;
let server;
let baseUrl;

before(async () => {
  await resetTestDatabase();
  pool = createPool();
  await migrateDatabase(pool);
  await seedTestCategories(pool, 'alice');
  await seedTestCategories(pool, 'bob');

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.locals.db = pool;
  app.use((req, _res, next) => {
    req.userId = req.headers['x-test-user'];
    next();
  });
  app.use('/api/tills', tillsRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/dashboard', dashboardRouter);
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

const json = (user, method, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-test-user': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test('lists, reads, updates and deletes are scoped to the owner', async () => {
  const created = await (await json('alice', 'POST', '/api/tills', { name: 'Caja Alice' })).json();
  assert.ok(created.id);

  const aliceList = await (await json('alice', 'GET', '/api/tills')).json();
  assert.ok(aliceList.some((t) => t.id === created.id));

  const bobList = await (await json('bob', 'GET', '/api/tills')).json();
  assert.deepEqual(bobList, []);

  const bobUpdate = await json('bob', 'PUT', `/api/tills/${created.id}`, { name: 'Hackeada' });
  assert.equal(bobUpdate.status, 404);

  const bobDelete = await json('bob', 'DELETE', `/api/tills/${created.id}`);
  assert.equal(bobDelete.status, 404);

  const aliceStillThere = await (await json('alice', 'GET', '/api/tills')).json();
  assert.equal(aliceStillThere.find((t) => t.id === created.id).name, 'Caja Alice');
});

test('a user cannot book a transaction against another user till', async () => {
  const aliceTill = await (await json('alice', 'POST', '/api/tills', { name: 'Banco Alice' })).json();

  const res = await json('bob', 'POST', '/api/transactions', {
    till_id: aliceTill.id,
    amount: 10,
    type: 'ingreso',
    date: '2026-01-01',
  });
  assert.equal(res.status, 404);
});

test('dashboard only aggregates the current user', async () => {
  const summary = await (await json('bob', 'GET', '/api/dashboard/summary')).json();
  assert.equal(summary.totalIncome, 0);
  assert.equal(summary.totalBalance, 0);
  assert.deepEqual(summary.tillBalances, []);
});

test('categories are per user and copy the same defaults', async () => {
  const aliceCats = await (await json('alice', 'GET', '/api/categories')).json();
  const bobCats = await (await json('bob', 'GET', '/api/categories')).json();
  assert.equal(aliceCats.length, 22);
  assert.equal(bobCats.length, 22);

  await json('alice', 'POST', '/api/categories', { name: 'Solo Alice', type: 'expense' });
  const bobAfter = await (await json('bob', 'GET', '/api/categories')).json();
  assert.ok(!bobAfter.some((c) => c.name === 'Solo Alice'));
});

test('sync pull/push is isolated and cannot claim another user row', async () => {
  const push = (user, body) => json(user, 'POST', '/api/sync', body);

  const created = await push('alice', {
    changes: [{
      uuid: 'op-alice-1',
      entity: 'transactions',
      operation: 'create',
      data: { uuid: 'tx-alice', amount: 42, type: 'ingreso', transaction_date: '2026-01-01' },
      updated_at: '2026-01-01T10:00:00Z',
    }],
  });
  assert.equal(created.status, 200);
  assert.deepEqual((await created.json()).accepted, ['op-alice-1']);

  const bobPull = await (await json('bob', 'GET', '/api/sync?since=0')).json();
  assert.ok(!bobPull.serverChanges.transactions.some((r) => r.uuid === 'tx-alice'));

  const stolen = await push('bob', {
    changes: [{
      uuid: 'op-bob-steal',
      entity: 'transactions',
      operation: 'update',
      data: { uuid: 'tx-alice', amount: 1 },
      updated_at: '2026-01-02T10:00:00Z',
    }],
  });
  assert.deepEqual((await stolen.json()).conflicts, ['op-bob-steal']);

  const row = await pool.query(
    `SELECT amount, user_id FROM transactions WHERE uuid = 'tx-alice'`,
  );
  assert.equal(parseFloat(row.rows[0].amount), 42);
  assert.equal(row.rows[0].user_id, 'alice');
});

// --- .nbb import -----------------------------------------------------------

const AAD = 'NativeBudgetBlade:MEK:wrap:v1';

const encrypt = (key, plaintext) => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(AAD));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    nonce: nonce.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
};

const buildBackup = (password) => {
  const salt = randomBytes(16);
  const iterations = 5000;
  const kek = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const masterKey = randomBytes(32);

  const payload = {
    tables: {
      tills: [{ id: 1, name: 'Caja 1' }, { id: 2, name: 'Caja 2' }],
      categories: [{ id: 1, name: 'Comida', type: 'expense' }],
      credit_cards: [{ id: 1, till_id: 1, name: 'Visa', credit_limit: 1000 }],
      transactions: [
        { id: 1, till_id: 1, amount: 10, type: 'ingreso', transaction_date: '2026-01-01' },
        {
          id: 2,
          till_id: 2,
          amount: 5,
          type: 'egreso',
          transaction_date: '2026-01-02',
          credit_card_id: 1,
          parent_transaction_id: 1,
        },
      ],
    },
  };

  return JSON.stringify({
    version: 1,
    algorithm: 'AES-256-GCM',
    ...encrypt(masterKey, Buffer.from(JSON.stringify(payload))),
    wrappedMasterKey: {
      version: 1,
      algorithm: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations,
      salt: salt.toString('hex'),
      ...encrypt(kek, masterKey),
    },
  });
};

const importBackup = async (user, password) => {
  const form = new FormData();
  form.append('file', new Blob([buildBackup(password)], { type: 'application/json' }), 'backup.nbb');
  form.append('password', password);
  return fetch(`${baseUrl}/api/sync/import`, {
    method: 'POST',
    headers: { 'x-test-user': user },
    body: form,
  });
};

test('import remaps mobile ids per user without collisions or cross-wipes', async () => {
  await pool.query(
    `INSERT INTO users (id, password) VALUES ('local-mobile-user', 'hash')`,
  );

  const password = 'secret';
  const aliceImport = await importBackup('alice', password);
  assert.equal(aliceImport.status, 200);

  const bobImport = await importBackup('bob', password);
  assert.equal(bobImport.status, 200);

  const aliceTills = await pool.query(
    `SELECT id, name FROM tills WHERE user_id = 'alice' ORDER BY name`,
  );
  const bobTills = await pool.query(
    `SELECT id, name FROM tills WHERE user_id = 'bob' ORDER BY name`,
  );
  assert.deepEqual(aliceTills.rows.map((r) => r.name), ['Caja 1', 'Caja 2']);
  assert.deepEqual(bobTills.rows.map((r) => r.name), ['Caja 1', 'Caja 2']);
  assert.notDeepEqual(
    aliceTills.rows.map((r) => r.id),
    bobTills.rows.map((r) => r.id),
    'each user must get its own server ids',
  );

  // Every row points at the importer's own parent rows.
  const fkCheck = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM transactions t JOIN tills tl ON tl.id = t.till_id
        WHERE t.user_id = 'alice' AND tl.user_id <> 'alice') AS alice_bad_till,
      (SELECT COUNT(*) FROM transactions t JOIN tills tl ON tl.id = t.till_id
        WHERE t.user_id = 'bob' AND tl.user_id <> 'bob') AS bob_bad_till
  `);
  assert.equal(Number(fkCheck.rows[0].alice_bad_till), 0);
  assert.equal(Number(fkCheck.rows[0].bob_bad_till), 0);

  const parents = await pool.query(
    `SELECT t.id, t.parent_transaction_id, p.user_id AS parent_user
       FROM transactions t
       LEFT JOIN transactions p ON p.id = t.parent_transaction_id
      WHERE t.user_id = 'alice' AND t.parent_transaction_id IS NOT NULL`,
  );
  assert.equal(parents.rowCount, 1);
  assert.equal(parents.rows[0].parent_user, 'alice');

  // Importing does not touch the shared `users` table.
  const users = await pool.query(`SELECT id FROM users WHERE id = 'local-mobile-user'`);
  assert.equal(users.rowCount, 1);
});
