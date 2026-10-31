import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { resetTestDatabase, createPool } from '../test-utils/db.js';
import { seedDemoDatabase } from '../src/db/seed.js';
import dashboardRouter from '../src/routes/dashboard.js';
import projectionsRouter from '../src/routes/projections.js';
import creditCardsRouter from '../src/routes/credit-cards.js';

const TODAY = new Date(2026, 9, 31, 12);

let pool;
let server;
let baseUrl;
let counts;

before(async () => {
  await resetTestDatabase();
  pool = createPool();
  counts = await seedDemoDatabase(pool, { today: TODAY });

  const app = express();
  app.locals.db = pool;
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/projections', projectionsRouter);
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

test('seeds a complete demo dataset', () => {
  assert.equal(counts.tills, 4);
  assert.equal(counts.entities, 6);
  assert.equal(counts.credit_cards, 2);
  assert.ok(counts.transactions > 100, 'expected a few months of movements');
  assert.ok(counts.scheduled_plans >= 8);
  assert.ok(counts.scheduled_occurrences > 20);
  assert.ok(counts.scheduled_payments_mapping >= 1);
  assert.ok(counts.credit_card_payment_items >= 1);
});

test('dashboard summary renders seeded data', async () => {
  const res = await fetch(`${baseUrl}/api/dashboard/summary`);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.ok(body.totalIncome > 0);
  assert.ok(body.totalExpense > 0);
  assert.equal(body.tillBalances.length, 4);
  assert.ok(body.byCategory.length > 0);
  assert.ok(body.byCategory.every((category) => category.count > 0));
  assert.ok(body.upcomingCommitments.length > 0);
  assert.ok(
    body.upcomingCommitments.some((commitment) => commitment.status === 'overdue'),
    'demo should include an overdue commitment',
  );
});

test('credit cards expose pending debt below their limits', async () => {
  const res = await fetch(`${baseUrl}/api/credit-cards`);
  assert.equal(res.status, 200);

  const cards = await res.json();
  assert.equal(cards.length, 2);
  for (const card of cards) {
    assert.ok(card.total_charged > 0);
    assert.ok(card.pending_debt > 0);
    assert.ok(card.pending_debt < card.credit_limit);
  }
});

test('projections include occurrences, forecast and reminders', async () => {
  const res = await fetch(`${baseUrl}/api/projections`);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.ok(body.occurrences.length > 0);
  assert.equal(body.forecast.length, 181);
  assert.ok(body.summary.pending_count > 0);
  assert.ok(body.summary.overdue_count > 0);
  assert.ok(body.reminders.length >= 2);
});

test('foreign keys stay consistent after seeding', async () => {
  const checks = [
    `SELECT COUNT(*)::int AS count FROM transactions t
       LEFT JOIN tills tl ON tl.id = t.till_id
      WHERE t.till_id IS NOT NULL AND tl.id IS NULL`,
    `SELECT COUNT(*)::int AS count FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.category_id IS NOT NULL AND c.id IS NULL`,
    `SELECT COUNT(*)::int AS count FROM scheduled_occurrences so
       LEFT JOIN scheduled_plans sp ON sp.id = so.plan_id
      WHERE sp.id IS NULL`,
    `SELECT COUNT(*)::int AS count FROM scheduled_payments_mapping spm
       LEFT JOIN scheduled_occurrences so ON so.id = spm.occurrence_id
       LEFT JOIN transactions t ON t.id = spm.transaction_id
      WHERE so.id IS NULL OR t.id IS NULL`,
    `SELECT COUNT(*)::int AS count FROM credit_card_payment_items ccpi
       LEFT JOIN transactions purchase ON purchase.id = ccpi.purchase_transaction_id
       LEFT JOIN transactions payment ON payment.id = ccpi.payment_transaction_id
      WHERE purchase.id IS NULL OR payment.id IS NULL`,
  ];

  for (const query of checks) {
    const result = await pool.query(query);
    assert.equal(result.rows[0].count, 0);
  }
});
