import express from 'express';
import { z } from 'zod';
import { stampNew, updateRow, softDeleteRow } from '../services/write.js';
import { parseBody } from '../utils/validate.js';

const router = express.Router();

const EntityCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(['client', 'provider', 'both']),
  contact: z.string().trim().max(200).nullable().optional(),
});
const EntityUpdateSchema = EntityCreateSchema.partial();

/**
 * GET /api/entities
 * Returns list of all entities (clients/providers)
 */
router.get('/', async (req, res, next) => {
  try {
    const db = req.app.locals.db;

    const entities = await db.query(`
      SELECT id, name, type, contact
      FROM entities
      WHERE deleted_at IS NULL
      ORDER BY name ASC
    `);

    res.json(entities.rows);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/entities
 */
router.post('/', async (req, res, next) => {
  const data = parseBody(EntityCreateSchema, req, res);
  if (!data) return;

  try {
    const db = req.app.locals.db;
    const row = stampNew({
      name: data.name,
      type: data.type,
      contact: data.contact ?? null,
    });

    const result = await db.query(
      `INSERT INTO entities (name, type, contact, uuid, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [row.name, row.type, row.contact, row.uuid, row.updated_at],
    );

    res.status(201).json({ id: result.rows[0].id, ...row });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/entities/:id
 */
router.put('/:id', async (req, res, next) => {
  const data = parseBody(EntityUpdateSchema, req, res);
  if (!data) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const changes = {};
    if (data.name !== undefined) changes.name = data.name;
    if (data.type !== undefined) changes.type = data.type;
    if (data.contact !== undefined) changes.contact = data.contact;

    const updated = await updateRow(req.app.locals.db, 'entities', id, changes);
    if (updated === 0) return res.status(404).json({ error: 'Entity not found' });
    res.json({ id });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/entities/:id
 */
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const deleted = await softDeleteRow(req.app.locals.db, 'entities', id);
    if (deleted === 0) return res.status(404).json({ error: 'Entity not found' });
    res.json({ id, deleted: true });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/entities
 */
router.post('/', async (req, res, next) => {
  const data = parseBody(EntityCreateSchema, req, res);
  if (!data) return;

  try {
    const db = req.app.locals.db;
    const row = stampNew({
      name: data.name,
      type: data.type,
      contact: data.contact ?? null,
    });

    const result = await db.query(
      `INSERT INTO entities (name, type, contact, uuid, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [row.name, row.type, row.contact, row.uuid, row.updated_at],
    );

    res.status(201).json({ id: result.rows[0].id, ...row });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/entities/:id
 */
router.put('/:id', async (req, res, next) => {
  const data = parseBody(EntityUpdateSchema, req, res);
  if (!data) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const changes = {};
    if (data.name !== undefined) changes.name = data.name;
    if (data.type !== undefined) changes.type = data.type;
    if (data.contact !== undefined) changes.contact = data.contact;

    const updated = await updateRow(req.app.locals.db, 'entities', id, changes);
    if (updated === 0) return res.status(404).json({ error: 'Entity not found' });
    res.json({ id });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/entities/:id
 */
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const deleted = await softDeleteRow(req.app.locals.db, 'entities', id);
    if (deleted === 0) return res.status(404).json({ error: 'Entity not found' });
    res.json({ id, deleted: true });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/entities
 */
router.post('/', async (req, res, next) => {
  const data = parseBody(EntityCreateSchema, req, res);
  if (!data) return;

  try {
    const db = req.app.locals.db;
    const row = stampNew({
      name: data.name,
      type: data.type,
      contact: data.contact ?? null,
    });

    const result = await db.query(
      `INSERT INTO entities (name, type, contact, uuid, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [row.name, row.type, row.contact, row.uuid, row.updated_at],
    );

    res.status(201).json({ id: result.rows[0].id, ...row });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/entities/:id
 */
router.put('/:id', async (req, res, next) => {
  const data = parseBody(EntityUpdateSchema, req, res);
  if (!data) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const changes = {};
    if (data.name !== undefined) changes.name = data.name;
    if (data.type !== undefined) changes.type = data.type;
    if (data.contact !== undefined) changes.contact = data.contact;

    const updated = await updateRow(req.app.locals.db, 'entities', id, changes);
    if (updated === 0) return res.status(404).json({ error: 'Entity not found' });
    res.json({ id });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/entities/:id
 */
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const deleted = await softDeleteRow(req.app.locals.db, 'entities', id);
    if (deleted === 0) return res.status(404).json({ error: 'Entity not found' });
    res.json({ id, deleted: true });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/entities/:id/ledger
 * Returns transaction ledger for a specific entity
 */
router.get('/:id/ledger', async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const { id } = req.params;

    const entity = await db.query(
      'SELECT * FROM entities WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );

    if (entity.rows.length === 0) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    const transactions = await db.query(`
      SELECT
        t.id,
        t.amount,
        t.type,
        t.description,
        t.transaction_date,
        c.name as category,
        tl.name as till_name
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN tills tl ON t.till_id = tl.id
      WHERE t.deleted_at IS NULL
        AND t.id IN (
          SELECT transaction_id FROM scheduled_occurrences so
          JOIN scheduled_plans sp ON so.plan_id = sp.id
          WHERE sp.entity_id = $1
            AND sp.deleted_at IS NULL
            AND so.deleted_at IS NULL
        )
      ORDER BY t.transaction_date DESC
    `, [id]);

    const reminders = await db.query(`
      SELECT
        sp.id,
        sp.title,
        sp.start_date,
        sp.base_amount,
        sp.total_installments,
        c.name as category_name,
        tl.name as till_name
      FROM scheduled_plans sp
      LEFT JOIN categories c ON sp.category_id = c.id
      LEFT JOIN tills tl ON sp.till_id = tl.id
      WHERE sp.entity_id = $1
        AND sp.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM scheduled_occurrences so
          WHERE so.plan_id = sp.id
            AND so.deleted_at IS NULL
        )
      ORDER BY sp.start_date ASC, sp.id ASC
    `, [id]);

    // Calculate totals
    const totals = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN t.type = 'egreso' THEN t.amount ELSE 0 END), 0) as total_payable,
        COALESCE(SUM(CASE WHEN t.type IN ('ingreso', 'transferencia') THEN t.amount ELSE 0 END), 0) as total_received
      FROM transactions t
      WHERE t.deleted_at IS NULL
        AND t.id IN (
          SELECT transaction_id FROM scheduled_occurrences so
          JOIN scheduled_plans sp ON so.plan_id = sp.id
          WHERE sp.entity_id = $1
            AND sp.deleted_at IS NULL
            AND so.deleted_at IS NULL
        )
    `, [id]);

    res.json({
      entity: entity.rows[0],
      transactions: transactions.rows.map(row => ({
        ...row,
        amount: parseFloat(row.amount),
      })),
      reminders: reminders.rows.map(row => ({
        ...row,
        base_amount: row.base_amount === null ? null : parseFloat(row.base_amount),
      })),
      totals: {
        total_payable: parseFloat(totals.rows[0]?.total_payable || 0),
        total_received: parseFloat(totals.rows[0]?.total_received || 0),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
