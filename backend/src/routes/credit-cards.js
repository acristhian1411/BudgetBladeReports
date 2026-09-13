import express from 'express';
import { z } from 'zod';
import { stampNew, updateRow, softDeleteRow, withTransaction } from '../services/write.js';
import { parseBody } from '../utils/validate.js';

const router = express.Router();

const CreditCardCreateSchema = z.object({
  till_id: z.number().int(),
  name: z.string().trim().min(1).max(200),
  credit_limit: z.number().nonnegative().optional(),
});
const CreditCardUpdateSchema = CreditCardCreateSchema.partial();

/**
 * GET /api/credit-cards
 * Lists all credit cards with their pending debt (charged - paid).
 */
router.get('/', async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const result = await db.query(`
      SELECT
        cc.id,
        cc.name,
        cc.credit_limit,
        cc.till_id,
        tl.name AS till_name,
        COALESCE((
          SELECT SUM(t.amount)
          FROM transactions t
          WHERE t.credit_card_id = cc.id
            AND t.type = 'egreso'
            AND t.payment_method = 'credit_card'
            AND t.deleted_at IS NULL
        ), 0) AS total_charged,
        COALESCE((
          SELECT SUM(ccpi.amount_paid)
          FROM credit_card_payment_items ccpi
          WHERE ccpi.credit_card_id = cc.id
            AND ccpi.deleted_at IS NULL
        ), 0) AS total_paid
      FROM credit_cards cc
      LEFT JOIN tills tl ON tl.id = cc.till_id
      WHERE cc.deleted_at IS NULL
      ORDER BY tl.name ASC, cc.name ASC
    `);

    res.json(
      result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        credit_limit: parseFloat(row.credit_limit),
        till_id: row.till_id,
        till_name: row.till_name,
        total_charged: parseFloat(row.total_charged),
        total_paid: parseFloat(row.total_paid),
        pending_debt: Math.max(0, parseFloat(row.total_charged) - parseFloat(row.total_paid)),
      })),
    );
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/credit-cards/:id/purchases
 * Lists purchases still pending payment for a credit card.
 */
router.get('/:id/purchases', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const db = req.app.locals.db;
    const result = await db.query(`
      SELECT
        t.id,
        t.transaction_date,
        t.description,
        t.amount,
        COALESCE(p.paid, 0) AS paid,
        (t.amount - COALESCE(p.paid, 0)) AS pending_amount
      FROM transactions t
      LEFT JOIN (
        SELECT purchase_transaction_id, SUM(amount_paid) AS paid
        FROM credit_card_payment_items
        WHERE deleted_at IS NULL
        GROUP BY purchase_transaction_id
      ) p ON p.purchase_transaction_id = t.id
      WHERE t.credit_card_id = $1
        AND t.type = 'egreso'
        AND t.payment_method = 'credit_card'
        AND t.deleted_at IS NULL
        AND (t.amount - COALESCE(p.paid, 0)) > 0
      ORDER BY t.transaction_date ASC, t.id ASC
    `, [id]);

    res.json(
      result.rows.map((row) => ({
        id: row.id,
        transaction_date: row.transaction_date,
        description: row.description,
        amount: parseFloat(row.amount),
        paid: parseFloat(row.paid),
        pending_amount: parseFloat(row.pending_amount),
      })),
    );
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/credit-cards
 */
router.post('/', async (req, res, next) => {
  const data = parseBody(CreditCardCreateSchema, req, res);
  if (!data) return;

  try {
    const db = req.app.locals.db;
    const row = stampNew({
      till_id: data.till_id,
      name: data.name,
      credit_limit: data.credit_limit ?? 0,
    });

    const result = await db.query(
      `INSERT INTO credit_cards (till_id, name, credit_limit, uuid, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [row.till_id, row.name, row.credit_limit, row.uuid, row.updated_at],
    );

    res.status(201).json({ id: result.rows[0].id, ...row });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/credit-cards/:id
 */
router.put('/:id', async (req, res, next) => {
  const data = parseBody(CreditCardUpdateSchema, req, res);
  if (!data) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const changes = {};
    if (data.till_id !== undefined) changes.till_id = data.till_id;
    if (data.name !== undefined) changes.name = data.name;
    if (data.credit_limit !== undefined) changes.credit_limit = data.credit_limit;

    const updated = await updateRow(req.app.locals.db, 'credit_cards', id, changes);
    if (updated === 0) return res.status(404).json({ error: 'Credit card not found' });
    res.json({ id });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/credit-cards/:id
 */
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const db = req.app.locals.db;

    const deleted = await withTransaction(db, async (client) => {
      await client.query(
        `UPDATE credit_card_payment_items
            SET deleted_at = now(), updated_at = now()
          WHERE credit_card_id = $1 AND deleted_at IS NULL`,
        [id],
      );
      return softDeleteRow(client, 'credit_cards', id);
    });

    if (deleted === 0) return res.status(404).json({ error: 'Credit card not found' });
    res.json({ id, deleted: true });
  } catch (error) {
    next(error);
  }
});

export default router;
