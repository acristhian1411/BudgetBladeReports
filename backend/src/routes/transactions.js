import express from 'express';
import { z } from 'zod';
import { stampNew, withTransaction } from '../services/write.js';
import { parseBody } from '../utils/validate.js';

const router = express.Router();

const TransactionCreateSchema = z.object({
  till_id: z.number().int(),
  amount: z.number().positive(),
  type: z.enum(['ingreso', 'egreso']),
  description: z.string().trim().max(500).optional(),
  date: z.string().min(1),
  category_id: z.number().int().nullable().optional(),
  payment_method: z.string().trim().max(50).nullable().optional(),
  credit_card_id: z.number().int().nullable().optional(),
  affects_balance: z.number().int().min(0).max(1).optional(),
});

const TransferSchema = z.object({
  from_till_id: z.number().int(),
  to_till_id: z.number().int(),
  amount: z.number().positive(),
  description: z.string().trim().max(500).optional(),
  date: z.string().min(1),
});

const insertTxn = (queryable, row) =>
  queryable.query(
    `INSERT INTO transactions
       (till_id, amount, type, description, transfer_id, transaction_date,
        category_id, payment_method, credit_card_id, affects_balance,
        parent_transaction_id, uuid, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      row.till_id,
      row.amount,
      row.type,
      row.description ?? '',
      row.transfer_id ?? null,
      row.transaction_date,
      row.category_id ?? null,
      row.payment_method ?? null,
      row.credit_card_id ?? null,
      row.affects_balance ?? 1,
      row.parent_transaction_id ?? null,
      row.uuid,
      row.updated_at,
    ],
  );

/**
 * GET /api/transactions
 * Returns paginated transaction list with filtering
 */
router.get('/', async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const { page = 1, limit = 20, type, start_date, end_date, category_id, till_id } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = 'SELECT transactions.*, categories.name as category_name, tills.name as till_name FROM transactions ' +
          'LEFT JOIN categories ON transactions.category_id = categories.id ' +
          'LEFT JOIN tills ON transactions.till_id = tills.id WHERE transactions.deleted_at IS NULL';
    const params = [];
    let from_date = start_date ? new Date(start_date).toISOString() : null;
    if (start_date) {
      query += ` AND transactions.transaction_date >= $${params.length + 1}::date`;
      params.push(from_date);
    }

    let to_date = end_date ? new Date(end_date).toISOString() : null;
    if (end_date) {
      query += ` AND transactions.transaction_date <= $${params.length + 1}::date`;
      params.push(to_date);
    }

    if (type) {
      query += ` AND transactions.type = $${params.length + 1}`;
      params.push(type);
    }

    if (category_id) {
      query += ` AND transactions.category_id = $${params.length + 1}`;
      params.push(parseInt(category_id));
    }

    if (till_id) {
      query += ` AND transactions.till_id = $${params.length + 1}`;
      params.push(parseInt(till_id));
    }

    query += ' ORDER BY transactions.transaction_date DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), offset);
    const transactions = await db.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM transactions WHERE deleted_at IS NULL';
    const countParams = [];
    if (start_date) {
      countQuery += ` AND transaction_date >= $${countParams.length + 1}::date`;
      countParams.push(from_date);
    }
    if (end_date) {
      countQuery += ` AND transaction_date <= $${countParams.length + 1}::date`;
      countParams.push(to_date);
    }
    if (type) {
      countQuery += ` AND type = $${countParams.length + 1}`;
      countParams.push(type);
    }
    if (category_id) {
      countQuery += ` AND category_id = $${countParams.length + 1}`;
      countParams.push(parseInt(category_id));
    }
    if (till_id) {
      countQuery += ` AND till_id = $${countParams.length + 1}`;
      countParams.push(parseInt(till_id));
    }

    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0]?.total || 0);

    res.json({
      data: transactions.rows.map(row => ({
        ...row,
        amount: parseFloat(row.amount),
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/transactions
 * Creates an ingreso/egreso transaction (amount stored positive).
 */
router.post('/', async (req, res, next) => {
  const data = parseBody(TransactionCreateSchema, req, res);
  if (!data) return;

  try {
    const db = req.app.locals.db;
    const row = stampNew({
      till_id: data.till_id,
      amount: Math.abs(data.amount),
      type: data.type,
      description: data.description ?? '',
      transaction_date: data.date,
      category_id: data.category_id ?? null,
      payment_method: data.payment_method ?? null,
      credit_card_id: data.credit_card_id ?? null,
      affects_balance: data.affects_balance ?? 1,
    });

    const result = await insertTxn(db, row);
    res.status(201).json({ id: result.rows[0].id, ...row });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/transactions/transfer
 * Creates a transfer as two linked rows (source negative, dest positive).
 */
router.post('/transfer', async (req, res, next) => {
  const data = parseBody(TransferSchema, req, res);
  if (!data) return;

  if (data.from_till_id === data.to_till_id) {
    return res.status(400).json({ error: 'from_till_id and to_till_id must differ' });
  }

  try {
    const db = req.app.locals.db;
    const transferId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const amount = Math.abs(data.amount);
    const description = data.description ?? '';

    const ids = await withTransaction(db, async (client) => {
      const source = await insertTxn(client, stampNew({
        till_id: data.from_till_id,
        amount: -amount,
        type: 'transferencia',
        description,
        transfer_id: transferId,
        transaction_date: data.date,
        payment_method: 'transfer',
        affects_balance: 1,
      }));
      const dest = await insertTxn(client, stampNew({
        till_id: data.to_till_id,
        amount,
        type: 'transferencia',
        description,
        transfer_id: transferId,
        transaction_date: data.date,
        payment_method: 'transfer',
        affects_balance: 1,
      }));
      return { from_id: source.rows[0].id, to_id: dest.rows[0].id };
    });

    res.status(201).json({ transfer_id: transferId, ...ids });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/transactions/:id
 * Soft-deletes a transaction. Transfer legs and linked credit-card payment
 * items are soft-deleted too (mirrors the mobile deleteTransaction).
 */
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const db = req.app.locals.db;

    const result = await withTransaction(db, async (client) => {
      const row = await client.query(
        'SELECT transfer_id FROM transactions WHERE id = $1 AND deleted_at IS NULL',
        [id],
      );
      if (row.rowCount === 0) return { deleted: 0 };

      const transferId = row.rows[0].transfer_id;

      if (transferId) {
        await client.query(
          `UPDATE credit_card_payment_items
              SET deleted_at = now(), updated_at = now()
            WHERE deleted_at IS NULL
              AND (purchase_transaction_id IN (SELECT id FROM transactions WHERE transfer_id = $1)
                   OR payment_transaction_id IN (SELECT id FROM transactions WHERE transfer_id = $1))`,
          [transferId],
        );
        const res = await client.query(
          `UPDATE transactions SET deleted_at = now(), updated_at = now()
            WHERE transfer_id = $1 AND deleted_at IS NULL`,
          [transferId],
        );
        return { deleted: res.rowCount };
      }

      await client.query(
        `UPDATE credit_card_payment_items
            SET deleted_at = now(), updated_at = now()
          WHERE deleted_at IS NULL
            AND (purchase_transaction_id = $1 OR payment_transaction_id = $1)`,
        [id],
      );
      const res = await client.query(
        `UPDATE transactions SET deleted_at = now(), updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      return { deleted: res.rowCount };
    });

    if (result.deleted === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ id, deleted: true, count: result.deleted });
  } catch (error) {
    next(error);
  }
});

export default router;
