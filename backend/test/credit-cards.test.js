import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { migrateDatabase } from '../src/db/migrate.js';
import transactionsRouter from '../src/routes/transactions.js';
import creditCardsRouter from '../src/routes/credit-cards.js';
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
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/credit-cards', creditCardsRouter);
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

test('credit card CRUD', async () => {
  const create = await json('POST', '/api/credit-cards', {
    till_id: 1,
    name: 'Visa',
    credit_limit: 5000,
  });
  assert.equal(create.status, 201);
  const card = await create.json();
  assert.equal(card.credit_limit, 5000);

  const update = await json('PUT', `/api/credit-cards/${card.id}`, { name: 'Visa Gold' });
  assert.equal(update.status, 200);

  const list = await (await json('GET', '/api/credit-cards')).json();
  const found = list.find((c) => c.id === card.id);
  assert.ok(found);
  assert.equal(found.name, 'Visa Gold');
  assert.equal(found.pending_debt, 0);

  const del = await json('DELETE', `/api/credit-cards/${card.id}`);
  assert.equal(del.status, 200);

  const afterDelete = await (await json('GET', '/api/credit-cards')).json();
  assert.ok(!afterDelete.some((c) => c.id === card.id));
});

test('card charge appears as pending purchase', async () => {
  const card = await (await json('POST', '/api/credit-cards', {
    till_id: 1,
    name: 'Mastercard',
    credit_limit: 3000,
  })).json();

  const charge = await json('POST', '/api/transactions', {
    till_id: 1,
    amount: 100,
    type: 'egreso',
    description: 'Compra online',
    date: '2026-09-13',
    payment_method: 'credit_card',
    credit_card_id: card.id,
    affects_balance: 0,
  });
  assert.equal(charge.status, 201);
  const chargeBody = await charge.json();

  const purchases = await (await json('GET', `/api/credit-cards/${card.id}/purchases`)).json();
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].id, chargeBody.id);
  assert.equal(purchases[0].pending_amount, 100);
});

test('credit-card-payment creates capital + interest + payment items', async () => {
  const card = await (await json('POST', '/api/credit-cards', {
    till_id: 1,
    name: 'Amex',
    credit_limit: 2000,
  })).json();

  const charge = await (await json('POST', '/api/transactions', {
    till_id: 1,
    amount: 100,
    type: 'egreso',
    date: '2026-09-13',
    payment_method: 'credit_card',
    credit_card_id: card.id,
    affects_balance: 0,
  })).json();

  const payment = await json('POST', '/api/transactions/credit-card-payment', {
    till_id: 1,
    credit_card_id: card.id,
    capital_amount: 60,
    interest_amount: 5,
    date: '2026-09-14',
    payment_items: [{ purchase_transaction_id: charge.id, amount_paid: 60 }],
  });
  assert.equal(payment.status, 201);
  const paymentBody = await payment.json();
  assert.ok(paymentBody.capital_transaction_id);
  assert.ok(paymentBody.interest_transaction_id);

  // capital + interest transactions categories
  const capitalRow = await pool.query(
    `SELECT t.amount, c.name AS category
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.id = $1`,
    [paymentBody.capital_transaction_id],
  );
  assert.equal(parseFloat(capitalRow.rows[0].amount), 60);
  assert.equal(capitalRow.rows[0].category, 'Pago de tarjetas');

  const interestRow = await pool.query(
    `SELECT t.amount, c.name AS category, t.parent_transaction_id
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.id = $1`,
    [paymentBody.interest_transaction_id],
  );
  assert.equal(parseFloat(interestRow.rows[0].amount), 5);
  assert.equal(interestRow.rows[0].category, 'Intereses de tarjeta');
  assert.equal(interestRow.rows[0].parent_transaction_id, paymentBody.capital_transaction_id);

  // pending purchase reduced
  const purchases = await (await json('GET', `/api/credit-cards/${card.id}/purchases`)).json();
  assert.equal(purchases[0].pending_amount, 40);

  // card pending debt = charged(100) - paid(60) = 40
  const list = await (await json('GET', '/api/credit-cards')).json();
  const found = list.find((c) => c.id === card.id);
  assert.equal(found.pending_debt, 40);
});
