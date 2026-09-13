import express from 'express';
import { z } from 'zod';
import { stampNew, updateRow, softDeleteRow } from '../services/write.js';
import { parseBody } from '../utils/validate.js';

const router = express.Router();

const TillCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  account_number: z.string().trim().max(100).nullable().optional(),
  is_bank: z.boolean().optional(),
});
const TillUpdateSchema = TillCreateSchema.partial();

router.get('/', async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const result = await db.query(`
      SELECT
        tl.id,
        tl.name,
        tl.account_number,
        tl.is_bank,
        COALESCE(SUM(
          CASE
            WHEN t.type = 'ingreso' THEN t.amount
            WHEN t.type = 'egreso' THEN -t.amount
            WHEN t.type = 'transferencia' THEN t.amount
            ELSE 0
          END
        ), 0) AS balance
      FROM tills tl
      LEFT JOIN transactions t
        ON t.till_id = tl.id
        AND COALESCE(t.affects_balance, 1) = 1
        AND t.deleted_at IS NULL
      WHERE tl.deleted_at IS NULL
      GROUP BY tl.id
      ORDER BY tl.name ASC
    `);

    res.json(
      result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        account_number: row.account_number,
        is_bank: row.is_bank ?? false,
        balance: parseFloat(row.balance),
      })),
    );
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  const data = parseBody(TillCreateSchema, req, res);
  if (!data) return;

  try {
    const db = req.app.locals.db;
    const row = stampNew({
      name: data.name,
      account_number: data.account_number ?? null,
      is_bank: data.is_bank ?? Boolean(String(data.account_number ?? '').trim()),
    });

    const result = await db.query(
      `INSERT INTO tills (name, account_number, is_bank, uuid, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [row.name, row.account_number, row.is_bank, row.uuid, row.updated_at],
    );

    res.status(201).json({ id: result.rows[0].id, ...row });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  const data = parseBody(TillUpdateSchema, req, res);
  if (!data) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const changes = {};
    if (data.name !== undefined) changes.name = data.name;
    if (data.account_number !== undefined) changes.account_number = data.account_number;
    if (data.is_bank !== undefined) changes.is_bank = data.is_bank;

    const updated = await updateRow(req.app.locals.db, 'tills', id, changes);
    if (updated === 0) return res.status(404).json({ error: 'Till not found' });
    res.json({ id });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const deleted = await softDeleteRow(req.app.locals.db, 'tills', id);
    if (deleted === 0) return res.status(404).json({ error: 'Till not found' });
    res.json({ id, deleted: true });
  } catch (error) {
    next(error);
  }
});

export default router;
