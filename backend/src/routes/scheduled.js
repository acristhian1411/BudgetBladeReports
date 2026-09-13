import express from 'express';
import { z } from 'zod';
import { stampNew, withTransaction, updateRow } from '../services/write.js';
import { parseBody } from '../utils/validate.js';

const router = express.Router();

const PlanCreateSchema = z.object({
  category_id: z.number().int().nullable().optional(),
  entity_id: z.number().int().nullable().optional(),
  till_id: z.number().int().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  base_amount: z.number().nonnegative().nullable().optional(),
  total_installments: z.number().int().positive().nullable().optional(),
  start_date: z.string().min(1),
  type: z.enum(['ingreso', 'egreso']),
});

const OccurrenceUpdateSchema = z.object({
  due_date: z.string().optional(),
  type: z.enum(['ingreso', 'egreso']).optional(),
  amount: z.number().nonnegative().nullable().optional(),
  remaining_amount: z.number().nonnegative().nullable().optional(),
  status: z.enum(['pending', 'partially_paid', 'processed', 'overdue']).optional(),
});

const OccurrencePaymentSchema = z.object({
  till_id: z.number().int(),
  amount: z.number().positive(),
  date: z.string().min(1),
  category_id: z.number().int().nullable().optional(),
  description: z.string().trim().max(500).optional(),
});

const EFFECTIVE_STATUS = `
  CASE
    WHEN so.status IN ('pending', 'partially_paid') AND so.due_date::date < CURRENT_DATE
      THEN 'overdue'
    ELSE so.status
  END`;

const addMonths = (dateStr, months) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const totalMonths = year * 12 + (month - 1) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = totalMonths % 12;
  const daysInMonth = new Date(Date.UTC(newYear, newMonth + 1, 0)).getUTCDate();
  const newDay = Math.min(day, daysInMonth);
  return `${newYear}-${String(newMonth + 1).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`;
};

/**
 * GET /api/scheduled/plans
 * Lists all plans with occurrence counts.
 */
router.get('/plans', async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const result = await db.query(`
      SELECT
        sp.id,
        sp.title,
        sp.category_id,
        sp.entity_id,
        sp.till_id,
        sp.base_amount,
        sp.total_installments,
        sp.start_date,
        sp.type,
        e.name AS entity_name,
        c.name AS category_name,
        tl.name AS till_name,
        COUNT(so.id) AS total_occurrences,
        COALESCE(SUM(CASE WHEN so.status IN ('pending', 'partially_paid', 'overdue') THEN 1 ELSE 0 END), 0) AS pending_count,
        COALESCE(SUM(CASE WHEN so.status = 'processed' THEN 1 ELSE 0 END), 0) AS processed_count,
        COALESCE(SUM(CASE
          WHEN so.status = 'overdue' THEN 1
          WHEN so.status IN ('pending', 'partially_paid') AND so.due_date::date < CURRENT_DATE THEN 1
          ELSE 0
        END), 0) AS overdue_count
      FROM scheduled_plans sp
      LEFT JOIN entities e ON e.id = sp.entity_id
      LEFT JOIN categories c ON c.id = sp.category_id
      LEFT JOIN tills tl ON tl.id = sp.till_id
      LEFT JOIN scheduled_occurrences so ON so.plan_id = sp.id AND so.deleted_at IS NULL
      WHERE sp.deleted_at IS NULL
      GROUP BY sp.id, e.name, c.name, tl.name
      ORDER BY sp.start_date DESC
    `);

    res.json(
      result.rows.map((row) => ({
        ...row,
        base_amount: row.base_amount === null ? null : parseFloat(row.base_amount),
        pending_count: Number(row.pending_count),
        processed_count: Number(row.processed_count),
        overdue_count: Number(row.overdue_count),
        total_occurrences: Number(row.total_occurrences),
      })),
    );
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/scheduled/plans/:id
 * Returns a plan with its occurrences (effective overdue status).
 */
router.get('/plans/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const db = req.app.locals.db;
    const plan = await db.query(
      `SELECT sp.*, e.name AS entity_name, c.name AS category_name, tl.name AS till_name
         FROM scheduled_plans sp
         LEFT JOIN entities e ON e.id = sp.entity_id
         LEFT JOIN categories c ON c.id = sp.category_id
         LEFT JOIN tills tl ON tl.id = sp.till_id
        WHERE sp.id = $1 AND sp.deleted_at IS NULL`,
      [id],
    );
    if (plan.rowCount === 0) return res.status(404).json({ error: 'Plan not found' });

    const occurrences = await db.query(
      `SELECT
         so.id,
         so.plan_id,
         so.installment_number,
         so.due_date,
         so.type,
         so.amount,
         COALESCE(so.remaining_amount, so.amount, 0) AS remaining_amount,
         so.status,
         so.transaction_id,
         ${EFFECTIVE_STATUS} AS effective_status
       FROM scheduled_occurrences so
       WHERE so.plan_id = $1 AND so.deleted_at IS NULL
       ORDER BY so.installment_number ASC, so.due_date ASC`,
      [id],
    );

    res.json({
      plan: {
        ...plan.rows[0],
        base_amount: plan.rows[0].base_amount === null ? null : parseFloat(plan.rows[0].base_amount),
      },
      occurrences: occurrences.rows.map((row) => ({
        ...row,
        amount: row.amount === null ? null : parseFloat(row.amount),
        remaining_amount: parseFloat(row.remaining_amount),
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/scheduled/plans
 * Creates a plan and generates its monthly installments.
 */
router.post('/plans', async (req, res, next) => {
  const data = parseBody(PlanCreateSchema, req, res);
  if (!data) return;

  const normalizedType = data.type === 'ingreso' ? 'ingreso' : 'egreso';
  const totalInstallments = data.total_installments ?? null;
  const baseAmount = data.base_amount ?? null;

  try {
    const db = req.app.locals.db;

    const result = await withTransaction(db, async (client) => {
      const planRow = stampNew({
        category_id: data.category_id ?? null,
        entity_id: data.entity_id ?? null,
        till_id: data.till_id ?? null,
        title: data.title,
        base_amount: baseAmount,
        total_installments: totalInstallments,
        start_date: data.start_date,
        type: normalizedType,
      });

      const planResult = await client.query(
        `INSERT INTO scheduled_plans
           (category_id, entity_id, till_id, title, base_amount,
            total_installments, start_date, type, uuid, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          planRow.category_id,
          planRow.entity_id,
          planRow.till_id,
          planRow.title,
          planRow.base_amount,
          planRow.total_installments,
          planRow.start_date,
          planRow.type,
          planRow.uuid,
          planRow.updated_at,
        ],
      );
      const planId = planResult.rows[0].id;
      let generated = 0;

      if (totalInstallments && totalInstallments > 0) {
        for (let i = 1; i <= totalInstallments; i += 1) {
          const dueDate = addMonths(data.start_date, i - 1);
          const occ = stampNew({
            plan_id: planId,
            installment_number: i,
            due_date: dueDate,
            type: normalizedType,
            amount: baseAmount,
            remaining_amount: baseAmount,
            status: 'pending',
          });
          await client.query(
            `INSERT INTO scheduled_occurrences
               (plan_id, installment_number, due_date, type, amount,
                remaining_amount, status, uuid, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              occ.plan_id,
              occ.installment_number,
              occ.due_date,
              occ.type,
              occ.amount,
              occ.remaining_amount,
              occ.status,
              occ.uuid,
              occ.updated_at,
            ],
          );
          generated += 1;
        }
      }

      return { id: planId, generated };
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/scheduled/plans/:id
 */
router.delete('/plans/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const db = req.app.locals.db;
    const deleted = await withTransaction(db, async (client) => {
      await client.query(
        `UPDATE scheduled_occurrences SET deleted_at = now(), updated_at = now()
          WHERE plan_id = $1 AND deleted_at IS NULL`,
        [id],
      );
      const res = await client.query(
        `UPDATE scheduled_plans SET deleted_at = now(), updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      return res.rowCount;
    });

    if (deleted === 0) return res.status(404).json({ error: 'Plan not found' });
    res.json({ id, deleted: true });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/scheduled/occurrences/:id
 */
router.patch('/occurrences/:id', async (req, res, next) => {
  const data = parseBody(OccurrenceUpdateSchema, req, res);
  if (!data) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  const changes = {};
  if (Object.prototype.hasOwnProperty.call(data, 'due_date') && data.due_date !== undefined) changes.due_date = data.due_date;
  if (Object.prototype.hasOwnProperty.call(data, 'type') && data.type !== undefined) changes.type = data.type;
  if (Object.prototype.hasOwnProperty.call(data, 'amount')) changes.amount = data.amount ?? null;
  if (Object.prototype.hasOwnProperty.call(data, 'remaining_amount')) changes.remaining_amount = data.remaining_amount ?? null;
  if (Object.prototype.hasOwnProperty.call(data, 'status') && data.status !== undefined) changes.status = data.status;

  try {
    const updated = await updateRow(req.app.locals.db, 'scheduled_occurrences', id, changes);
    if (updated === 0) return res.status(404).json({ error: 'Occurrence not found' });
    res.json({ id });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/scheduled/occurrences/:id/payment
 * Registers a payment (abono) against an occurrence: creates the linked
 * transaction, records the mapping, and updates remaining/status.
 */
router.post('/occurrences/:id/payment', async (req, res, next) => {
  const data = parseBody(OccurrencePaymentSchema, req, res);
  if (!data) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  const paid = Number(data.amount);

  try {
    const db = req.app.locals.db;
    const occurrence = await db.query(
      `SELECT so.*, sp.title
         FROM scheduled_occurrences so
         JOIN scheduled_plans sp ON sp.id = so.plan_id
        WHERE so.id = $1 AND so.deleted_at IS NULL AND sp.deleted_at IS NULL`,
      [id],
    );
    if (occurrence.rowCount === 0) return res.status(404).json({ error: 'Occurrence not found' });

    const occ = occurrence.rows[0];
    const currentRemaining = Number(occ.remaining_amount ?? occ.amount ?? 0);
    const isVariable = occ.amount == null && occ.remaining_amount == null;

    if (!isVariable && currentRemaining > 0 && paid > currentRemaining) {
      return res.status(400).json({ error: 'El abono no puede ser mayor al saldo pendiente.' });
    }
    if (!isVariable && currentRemaining <= 0) {
      return res.status(400).json({ error: 'La cuota ya no tiene saldo pendiente.' });
    }

    const nextRemainingRaw = isVariable ? 0 : currentRemaining - paid;
    const nextRemaining = Math.abs(nextRemainingRaw) < 0.000001 ? 0 : nextRemainingRaw;
    const nextStatus = isVariable || nextRemaining === 0 ? 'processed' : 'partially_paid';
    const txType = occ.type === 'ingreso' ? 'ingreso' : 'egreso';

    const result = await withTransaction(db, async (client) => {
      const txn = stampNew({
        till_id: data.till_id,
        amount: paid,
        type: txType,
        description: data.description ?? `Pago de ${occ.title}`,
        transaction_date: data.date,
        category_id: data.category_id ?? null,
        affects_balance: 1,
      });
      const txnResult = await client.query(
        `INSERT INTO transactions
           (till_id, amount, type, description, transaction_date, category_id,
            affects_balance, uuid, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          txn.till_id,
          txn.amount,
          txn.type,
          txn.description,
          txn.transaction_date,
          txn.category_id,
          txn.affects_balance,
          txn.uuid,
          txn.updated_at,
        ],
      );
      const transactionId = txnResult.rows[0].id;

      const mapping = stampNew({
        occurrence_id: id,
        transaction_id: transactionId,
        amount_paid: paid,
        payment_date: data.date,
      });
      await client.query(
        `INSERT INTO scheduled_payments_mapping
           (occurrence_id, transaction_id, amount_paid, payment_date, uuid, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          mapping.occurrence_id,
          mapping.transaction_id,
          mapping.amount_paid,
          mapping.payment_date,
          mapping.uuid,
          mapping.updated_at,
        ],
      );

      await client.query(
        `UPDATE scheduled_occurrences
            SET remaining_amount = $1,
                status = $2,
                transaction_id = CASE WHEN transaction_id IS NULL THEN $3 ELSE transaction_id END,
                updated_at = now()
          WHERE id = $4`,
        [nextRemaining, nextStatus, transactionId, id],
      );

      return { transaction_id: transactionId, remaining_amount: nextRemaining, status: nextStatus };
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/scheduled/occurrences/:id/payments
 */
router.get('/occurrences/:id/payments', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const db = req.app.locals.db;
    const result = await db.query(
      `SELECT
         spm.id,
         spm.occurrence_id,
         spm.transaction_id,
         spm.amount_paid,
         spm.payment_date,
         t.description,
         t.type,
         t.till_id
       FROM scheduled_payments_mapping spm
       JOIN transactions t ON t.id = spm.transaction_id
       WHERE spm.occurrence_id = $1
         AND spm.deleted_at IS NULL
         AND t.deleted_at IS NULL
       ORDER BY spm.payment_date ASC, spm.id ASC`,
      [id],
    );

    res.json(
      result.rows.map((row) => ({ ...row, amount_paid: parseFloat(row.amount_paid) })),
    );
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/scheduled/occurrences
 * Lists pending/overdue occurrences (effective status).
 */
router.get('/occurrences', async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const result = await db.query(`
      SELECT
        so.id,
        so.plan_id,
        so.installment_number,
        so.due_date,
        so.type,
        so.amount,
        COALESCE(so.remaining_amount, so.amount, 0) AS remaining_amount,
        so.status,
        ${EFFECTIVE_STATUS} AS effective_status,
        sp.title,
        sp.till_id,
        e.name AS entity_name,
        c.name AS category_name
      FROM scheduled_occurrences so
      JOIN scheduled_plans sp ON sp.id = so.plan_id
      LEFT JOIN entities e ON e.id = sp.entity_id
      LEFT JOIN categories c ON c.id = sp.category_id
      WHERE so.status IN ('pending', 'partially_paid', 'overdue')
        AND so.deleted_at IS NULL
        AND sp.deleted_at IS NULL
      ORDER BY so.due_date ASC
    `);

    res.json(
      result.rows.map((row) => ({
        ...row,
        amount: row.amount === null ? null : parseFloat(row.amount),
        remaining_amount: parseFloat(row.remaining_amount),
      })),
    );
  } catch (error) {
    next(error);
  }
});

export default router;
