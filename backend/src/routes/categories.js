import express from 'express';
import { z } from 'zod';
import { stampNew, updateRow, softDeleteRow } from '../services/write.js';
import { parseBody } from '../utils/validate.js';

const router = express.Router();

const CategoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(['income', 'expense']),
});
const CategoryUpdateSchema = CategoryCreateSchema.partial();

router.get('/', async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const { type } = req.query;

    let query = 'SELECT id, name, type FROM categories WHERE deleted_at IS NULL';
    const params = [];
    if (type === 'income' || type === 'expense') {
      params.push(type);
      query += ` AND type = $${params.length}`;
    }
    query += ' ORDER BY type, name ASC';

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  const data = parseBody(CategoryCreateSchema, req, res);
  if (!data) return;

  try {
    const db = req.app.locals.db;
    const row = stampNew({ name: data.name, type: data.type });

    const result = await db.query(
      `INSERT INTO categories (name, type, uuid, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name, type) DO NOTHING
       RETURNING id`,
      [row.name, row.type, row.uuid, row.updated_at],
    );

    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'Category already exists' });
    }

    res.status(201).json({ id: result.rows[0].id, ...row });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  const data = parseBody(CategoryUpdateSchema, req, res);
  if (!data) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const changes = {};
    if (data.name !== undefined) changes.name = data.name;
    if (data.type !== undefined) changes.type = data.type;

    const updated = await updateRow(req.app.locals.db, 'categories', id, changes);
    if (updated === 0) return res.status(404).json({ error: 'Category not found' });
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
    const deleted = await softDeleteRow(req.app.locals.db, 'categories', id);
    if (deleted === 0) return res.status(404).json({ error: 'Category not found' });
    res.json({ id, deleted: true });
  } catch (error) {
    next(error);
  }
});

export default router;
