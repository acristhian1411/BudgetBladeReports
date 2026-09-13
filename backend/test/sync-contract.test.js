import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrateDatabase } from '../src/db/migrate.js';
import { applyChanges, getChangesSince } from '../src/services/sync.js';
import { resetTestDatabase, createPool } from '../test-utils/db.js';

/**
 * Contract tests for the uuid-based sync wire. Exercise the full FK_UUID_MAP:
 * every `*_uuid` reference must resolve to an internal `*_id` on write and be
 * emitted (not the integer id) on read.
 */

const TS = '2026-09-13T10:00:00Z';

let pool;

before(async () => {
  await resetTestDatabase();
  pool = createPool();
  await migrateDatabase(pool);
});

after(async () => {
  await pool.end();
});

const change = (uuid, entity, operation, data, updated_at = TS) => ({
  uuid,
  entity,
  operation,
  data,
  updated_at,
});

const push = (changes) => applyChanges(pool, { changes });

test('FK map: credit_cards.till_uuid -> tills', async () => {
  await push([
    change('op-till-cc', 'tills', 'create', { uuid: 't-cc', name: 'Banco' }),
    change('op-cc', 'credit_cards', 'create', { uuid: 'cc-1', till_uuid: 't-cc', name: 'Visa', credit_limit: 1000 }),
  ]);

  const till = await pool.query('SELECT id FROM tills WHERE uuid = $1', ['t-cc']);
  const cc = await pool.query('SELECT till_id FROM credit_cards WHERE uuid = $1', ['cc-1']);
  assert.equal(cc.rows[0].till_id, till.rows[0].id);

  const changes = await getChangesSince(pool, '0');
  const row = changes.credit_cards.find((r) => r.uuid === 'cc-1');
  assert.equal(row.till_uuid, 't-cc');
  assert.ok(!('till_id' in row));
});

test('FK map: scheduled_plans -> categories/entities/tills', async () => {
  await push([
    change('op-cat', 'categories', 'create', { uuid: 'cat-1', name: 'CatContrato', type: 'expense' }),
    change('op-ent', 'entities', 'create', { uuid: 'ent-1', name: 'Proveedor', type: 'provider' }),
    change('op-till', 'tills', 'create', { uuid: 't-plan', name: 'Banco' }),
    change('op-plan', 'scheduled_plans', 'create', {
      uuid: 'plan-1',
      category_uuid: 'cat-1',
      entity_uuid: 'ent-1',
      till_uuid: 't-plan',
      title: 'Plan',
      base_amount: 100,
      total_installments: 2,
      start_date: '2026-09-01',
      type: 'egreso',
    }),
  ]);

  const ids = await pool.query(
    `SELECT sp.category_id, sp.entity_id, sp.till_id
     FROM scheduled_plans sp WHERE sp.uuid = $1`,
    ['plan-1'],
  );
  assert.ok(ids.rows[0].category_id != null);
  assert.ok(ids.rows[0].entity_id != null);
  assert.ok(ids.rows[0].till_id != null);

  const changes = await getChangesSince(pool, '0');
  const row = changes.scheduled_plans.find((r) => r.uuid === 'plan-1');
  assert.equal(row.category_uuid, 'cat-1');
  assert.equal(row.entity_uuid, 'ent-1');
  assert.equal(row.till_uuid, 't-plan');
  assert.ok(!('category_id' in row));
});

test('FK map: scheduled_occurrences -> plan/transaction', async () => {
  await push([
    change('op-till-occ', 'tills', 'create', { uuid: 't-occ', name: 'Banco' }),
    change('op-plan-occ', 'scheduled_plans', 'create', {
      uuid: 'plan-occ', till_uuid: 't-occ', title: 'Plan', base_amount: 100,
      total_installments: 1, start_date: '2026-09-01', type: 'egreso',
    }),
    change('op-tx-occ', 'transactions', 'create', { uuid: 'tx-occ', till_uuid: 't-occ', amount: 100, type: 'egreso', transaction_date: '2026-09-13' }),
    change('op-occ', 'scheduled_occurrences', 'create', {
      uuid: 'occ-1',
      plan_uuid: 'plan-occ',
      transaction_uuid: 'tx-occ',
      installment_number: 1,
      due_date: '2026-09-13',
      type: 'egreso',
      amount: 100,
      remaining_amount: 100,
      status: 'pending',
    }),
  ]);

  const occ = await pool.query('SELECT plan_id, transaction_id FROM scheduled_occurrences WHERE uuid = $1', ['occ-1']);
  assert.ok(occ.rows[0].plan_id != null);
  assert.ok(occ.rows[0].transaction_id != null);

  const changes = await getChangesSince(pool, '0');
  const row = changes.scheduled_occurrences.find((r) => r.uuid === 'occ-1');
  assert.equal(row.plan_uuid, 'plan-occ');
  assert.equal(row.transaction_uuid, 'tx-occ');
  assert.ok(!('plan_id' in row));
});

test('FK map: credit_card_payment_items -> card/purchase/payment', async () => {
  await push([
    change('op-till-cpi', 'tills', 'create', { uuid: 't-cpi', name: 'Banco' }),
    change('op-cc-cpi', 'credit_cards', 'create', { uuid: 'cc-cpi', till_uuid: 't-cpi', name: 'Visa', credit_limit: 1000 }),
    change('op-purchase', 'transactions', 'create', { uuid: 'tx-purchase', till_uuid: 't-cpi', amount: 500, type: 'egreso', transaction_date: '2026-09-13' }),
    change('op-payment', 'transactions', 'create', { uuid: 'tx-payment', till_uuid: 't-cpi', amount: 200, type: 'egreso', transaction_date: '2026-09-14' }),
    change('op-cpi', 'credit_card_payment_items', 'create', {
      uuid: 'cpi-1',
      credit_card_uuid: 'cc-cpi',
      purchase_transaction_uuid: 'tx-purchase',
      payment_transaction_uuid: 'tx-payment',
      amount_paid: 200,
    }),
  ]);

  const cpi = await pool.query(
    'SELECT credit_card_id, purchase_transaction_id, payment_transaction_id FROM credit_card_payment_items WHERE uuid = $1',
    ['cpi-1'],
  );
  assert.ok(cpi.rows[0].credit_card_id != null);
  assert.ok(cpi.rows[0].purchase_transaction_id != null);
  assert.ok(cpi.rows[0].payment_transaction_id != null);

  const changes = await getChangesSince(pool, '0');
  const row = changes.credit_card_payment_items.find((r) => r.uuid === 'cpi-1');
  assert.equal(row.credit_card_uuid, 'cc-cpi');
  assert.equal(row.purchase_transaction_uuid, 'tx-purchase');
  assert.equal(row.payment_transaction_uuid, 'tx-payment');
});

test('FK map: scheduled_payments_mapping -> occurrence/transaction', async () => {
  await push([
    change('op-till-spm', 'tills', 'create', { uuid: 't-spm', name: 'Banco' }),
    change('op-plan-spm', 'scheduled_plans', 'create', {
      uuid: 'plan-spm', till_uuid: 't-spm', title: 'Plan', base_amount: 100,
      total_installments: 1, start_date: '2026-09-01', type: 'egreso',
    }),
    change('op-occ-spm', 'scheduled_occurrences', 'create', {
      uuid: 'occ-spm', plan_uuid: 'plan-spm', installment_number: 1,
      due_date: '2026-09-13', type: 'egreso', amount: 100, remaining_amount: 100, status: 'pending',
    }),
    change('op-tx-spm', 'transactions', 'create', { uuid: 'tx-spm', till_uuid: 't-spm', amount: 40, type: 'egreso', transaction_date: '2026-09-13' }),
    change('op-spm', 'scheduled_payments_mapping', 'create', {
      uuid: 'spm-1',
      occurrence_uuid: 'occ-spm',
      transaction_uuid: 'tx-spm',
      amount_paid: 40,
      payment_date: '2026-09-13',
    }),
  ]);

  const spm = await pool.query('SELECT occurrence_id, transaction_id FROM scheduled_payments_mapping WHERE uuid = $1', ['spm-1']);
  assert.ok(spm.rows[0].occurrence_id != null);
  assert.ok(spm.rows[0].transaction_id != null);

  const changes = await getChangesSince(pool, '0');
  const row = changes.scheduled_payments_mapping.find((r) => r.uuid === 'spm-1');
  assert.equal(row.occurrence_uuid, 'occ-spm');
  assert.equal(row.transaction_uuid, 'tx-spm');
});

test('FK map: transactions self-reference parent_transaction_uuid', async () => {
  await push([
    change('op-till-self', 'tills', 'create', { uuid: 't-self', name: 'Banco' }),
    change('op-parent-tx', 'transactions', 'create', { uuid: 'tx-parent', till_uuid: 't-self', amount: 500, type: 'egreso', transaction_date: '2026-09-13' }),
    change('op-child-tx', 'transactions', 'create', {
      uuid: 'tx-child', till_uuid: 't-self', parent_transaction_uuid: 'tx-parent',
      amount: 20, type: 'egreso', transaction_date: '2026-09-13',
    }),
  ]);

  const child = await pool.query('SELECT parent_transaction_id FROM transactions WHERE uuid = $1', ['tx-child']);
  assert.ok(child.rows[0].parent_transaction_id != null);

  const changes = await getChangesSince(pool, '0');
  const row = changes.transactions.find((r) => r.uuid === 'tx-child');
  assert.equal(row.parent_transaction_uuid, 'tx-parent');
  assert.ok(!('parent_transaction_id' in row));
});
