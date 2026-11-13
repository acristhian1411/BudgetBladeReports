import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { extractGrid, detectMapping, applyMapping, detectFormat } from '../services/statementParser.js';
import { stampNew, withTransaction, isOwnedRow } from '../services/write.js';
import { parseBody } from '../utils/validate.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const MAX_RANGE_DAYS = 31;

const CATEGORY_TYPE_BY_ROW = { ingreso: 'income', egreso: 'expense' };

const mappingSchema = z.object({
  header_row: z.number().int().min(0),
  date: z.object({ column: z.number().int().min(0), format: z.string().optional() }),
  description: z.object({ columns: z.array(z.number().int().min(0)) }).optional(),
  amount: z.union([
    z.object({ mode: z.literal('signed'), column: z.number().int().min(0) }),
    z.object({
      mode: z.literal('split'),
      egreso: z.number().int().min(0),
      ingreso: z.number().int().min(0),
    }),
  ]),
});

const assignSchema = z.object({
  assignments: z
    .array(
      z.object({
        id: z.number().int().positive(),
        category_id: z.number().int().positive().nullable(),
      }),
    )
    .min(1)
    .max(5000),
});

const getImport = async (db, id, userId) => {
  const res = await db.query(
    'SELECT * FROM statement_imports WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  return res.rows[0] ?? null;
};

const getRows = async (db, importId) => {
  const res = await db.query(
    `SELECT id, transaction_date, description, amount, type, category_id, imported
       FROM statement_rows
      WHERE import_id = $1
      ORDER BY row_order ASC, id ASC`,
    [importId],
  );
  return res.rows.map((r) => ({ ...r, amount: Number(r.amount) }));
};

const serializeImport = (row) => ({
  id: row.id,
  till_id: row.till_id,
  source_filename: row.source_filename,
  source_format: row.source_format,
  detected_bank: row.detected_bank,
  status: row.status,
  created_at: row.created_at,
});

const assertWithinMonth = (rows) => {
  if (rows.length === 0) return;
  const dates = rows.map((r) => new Date(r.date).getTime());
  const spanDays = (Math.max(...dates) - Math.min(...dates)) / 86400000;
  if (spanDays > MAX_RANGE_DAYS) {
    const err = new Error(
      `El extracto abarca ${Math.round(spanDays)} días (máximo ${MAX_RANGE_DAYS})`,
    );
    err.status = 400;
    throw err;
  }
};

const getTemplate = async (db, tillId, userId) => {
  const res = await db.query(
    'SELECT mapping, source_format FROM statement_templates WHERE till_id = $1 AND user_id = $2',
    [tillId, userId],
  );
  return res.rows[0] ?? null;
};

const replaceRows = async (client, importId, rows) => {
  await client.query('DELETE FROM statement_rows WHERE import_id = $1', [importId]);
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    await client.query(
      `INSERT INTO statement_rows
         (import_id, transaction_date, description, amount, type, row_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [importId, r.date, r.description, r.amount, r.type, i],
    );
  }
};

/**
 * POST /parse — multipart `file` + `till_id`. Extracts the grid, applies the
 * till's template when present (otherwise proposes a column mapping), and
 * stages the result. Nothing is inserted into `transactions`.
 */
router.post('/parse', upload.single('file'), async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const file = req.file;
    const tillId = Number(req.body?.till_id);
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    if (!Number.isInteger(tillId)) return res.status(400).json({ error: 'till_id is required' });
    if (!(await isOwnedRow(db, 'tills', tillId, req.userId))) {
      return res.status(404).json({ error: 'Till not found' });
    }

    const format = detectFormat(file.originalname, file.mimetype);
    if (!format) {
      return res.status(400).json({ error: 'Formato no soportado (usa PDF, CSV o XLSX)' });
    }

    const grid = await extractGrid(file.buffer, format);
    if (!grid.length) {
      return res.status(400).json({ error: 'No se pudo extraer contenido del archivo' });
    }

    // Debug aid: log a preview so a mis-parsed layout can be diagnosed.
    console.log(
      `[STATEMENT] parse ${format} (${file.originalname}): ${grid.length} filas, preview:`,
      JSON.stringify(grid.slice(0, 4)),
    );

    const template = await getTemplate(db, tillId, req.userId);

    const created = await withTransaction(db, async (client) => {
      const imp = await client.query(
        `INSERT INTO statement_imports
           (user_id, till_id, source_filename, source_format, status, raw_grid)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [req.userId, tillId, file.originalname, format, template ? 'review' : 'mapping', JSON.stringify(grid)],
      );
      const importId = imp.rows[0].id;

      if (template) {
        const rows = applyMapping(grid, template.mapping);
        assertWithinMonth(rows);
        await replaceRows(client, importId, rows);
      }
      return importId;
    });

    if (template) {
      return res.status(201).json({
        import_id: created,
        source_format: format,
        needs_mapping: false,
        rows: await getRows(db, created),
      });
    }

    const detected = detectMapping(grid);
    if (!detected) {
      await db.query('DELETE FROM statement_imports WHERE id = $1', [created]);
      return res.status(400).json({
        error: 'No se pudo detectar la estructura del extracto',
        format,
        preview: grid.slice(0, 4),
      });
    }

    const headerRow = detected.header_row;
    res.status(201).json({
      import_id: created,
      source_format: format,
      needs_mapping: true,
      columns: (grid[headerRow] ?? []).map((cell, index) => ({ index, header: cell })),
      preview: grid.slice(headerRow + 1, headerRow + 9),
      detected,
    });
  } catch (error) {
    next(error);
  }
});

/** GET /templates/:tillId — the till's saved column mapping, or null. */
router.get('/templates/:tillId', async (req, res, next) => {
  const tillId = Number(req.params.tillId);
  if (!Number.isInteger(tillId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const template = await getTemplate(req.app.locals.db, tillId, req.userId);
    res.json(template ? { mapping: template.mapping, source_format: template.source_format } : null);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /imports/:id/map — applies a column mapping to the stored grid,
 * regenerating the rows. Optionally saves it as the till's template.
 */
router.post('/imports/:id/map', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  const parsed = mappingSchema.safeParse(req.body?.mapping);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid mapping', details: parsed.error.issues });
  }
  const mapping = parsed.data;
  const saveTemplate = Boolean(req.body?.save_template);

  try {
    const db = req.app.locals.db;
    const imp = await getImport(db, id, req.userId);
    if (!imp) return res.status(404).json({ error: 'Import not found' });

    const grid = Array.isArray(imp.raw_grid) ? imp.raw_grid : [];
    const rows = applyMapping(grid, mapping);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No se detectaron transacciones con ese mapeo' });
    }
    assertWithinMonth(rows);

    await withTransaction(db, async (client) => {
      await replaceRows(client, id, rows);
      await client.query(
        `UPDATE statement_imports SET status = 'review', updated_at = now() WHERE id = $1`,
        [id],
      );
      if (saveTemplate) {
        await client.query(
          `INSERT INTO statement_templates (user_id, till_id, source_format, mapping)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (till_id) DO UPDATE SET source_format = EXCLUDED.source_format, mapping = EXCLUDED.mapping, updated_at = now()`,
          [req.userId, imp.till_id, imp.source_format, JSON.stringify(mapping)],
        );
      }
    });

    res.json({ import_id: id, rows: await getRows(db, id) });
  } catch (error) {
    next(error);
  }
});

/** GET /imports — lists this user's pending (unfinished) imports. */
router.get('/imports', async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const params = [req.userId];
    let filter = "i.status IN ('mapping', 'review')";
    if (req.query.till_id) {
      params.push(Number(req.query.till_id));
      filter += ` AND i.till_id = $${params.length}`;
    }
    const result = await db.query(
      `SELECT i.*,
              COUNT(r.id) AS row_count,
              COUNT(r.category_id) AS categorized_count,
              COUNT(r.id) FILTER (WHERE r.imported) AS imported_count
         FROM statement_imports i
         LEFT JOIN statement_rows r ON r.import_id = i.id
        WHERE i.user_id = $1 AND ${filter}
        GROUP BY i.id
        ORDER BY i.created_at DESC`,
      params,
    );
    res.json(result.rows.map((r) => ({
      ...serializeImport(r),
      row_count: Number(r.row_count),
      categorized_count: Number(r.categorized_count),
      imported_count: Number(r.imported_count),
    })));
  } catch (error) {
    next(error);
  }
});

/** GET /imports/:id — one import with its rows (and grid for re-mapping). */
router.get('/imports/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const db = req.app.locals.db;
    const imp = await getImport(db, id, req.userId);
    if (!imp) return res.status(404).json({ error: 'Import not found' });
    const grid = Array.isArray(imp.raw_grid) ? imp.raw_grid : [];
    res.json({
      ...serializeImport(imp),
      rows: await getRows(db, id),
      raw_grid: grid,
      detected: detectMapping(grid),
    });
  } catch (error) {
    next(error);
  }
});

/** PATCH /imports/:id/rows — assigns categories (individually or by group). */
router.patch('/imports/:id/rows', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  const data = parseBody(assignSchema, req, res);
  if (!data) return;

  try {
    const db = req.app.locals.db;
    const imp = await getImport(db, id, req.userId);
    if (!imp) return res.status(404).json({ error: 'Import not found' });

    const rowIds = data.assignments.map((a) => a.id);
    const owned = await db.query(
      `SELECT r.id, r.type
         FROM statement_rows r
         JOIN statement_imports i ON i.id = r.import_id
        WHERE r.id = ANY($1::int[]) AND i.user_id = $2`,
      [rowIds, req.userId],
    );
    if (owned.rowCount !== new Set(rowIds).size) {
      return res.status(404).json({ error: 'One or more rows not found' });
    }
    const typeById = new Map(owned.rows.map((r) => [r.id, r.type]));

    for (const assignment of data.assignments) {
      if (assignment.category_id == null) continue;
      const cat = await db.query(
        'SELECT id, type FROM categories WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [assignment.category_id, req.userId],
      );
      if (cat.rowCount === 0) return res.status(404).json({ error: 'Category not found' });
      if (cat.rows[0].type !== CATEGORY_TYPE_BY_ROW[typeById.get(assignment.id)]) {
        return res.status(400).json({
          error: `Categoría de tipo incorrecto para la fila ${assignment.id}`,
        });
      }
    }

    await withTransaction(db, async (client) => {
      for (const assignment of data.assignments) {
        await client.query(
          'UPDATE statement_rows SET category_id = $1 WHERE id = $2',
          [assignment.category_id, assignment.id],
        );
      }
    });

    res.json({ import_id: id, rows: await getRows(db, id) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /imports/:id/import — inserts every categorized row into `transactions`
 * under the import's till. Rows without a category stay staged.
 */
router.post('/imports/:id/import', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const db = req.app.locals.db;
    const imp = await getImport(db, id, req.userId);
    if (!imp) return res.status(404).json({ error: 'Import not found' });

    const pending = await db.query(
      `SELECT id, transaction_date, description, amount, type, category_id
         FROM statement_rows
        WHERE import_id = $1 AND imported = FALSE AND category_id IS NOT NULL`,
      [id],
    );

    await withTransaction(db, async (client) => {
      for (const row of pending.rows) {
        const txn = stampNew(
          {
            till_id: imp.till_id,
            amount: Number(row.amount),
            type: row.type,
            description: row.description ?? '',
            transaction_date: row.transaction_date,
            category_id: row.category_id,
            payment_method: null,
            credit_card_id: null,
            affects_balance: 1,
          },
          req.userId,
        );
        await client.query(
          `INSERT INTO transactions
             (till_id, amount, type, description, transfer_id, transaction_date,
              category_id, payment_method, credit_card_id, affects_balance,
              parent_transaction_id, user_id, uuid, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            txn.till_id,
            txn.amount,
            txn.type,
            txn.description,
            null,
            txn.transaction_date,
            txn.category_id,
            txn.payment_method,
            txn.credit_card_id,
            txn.affects_balance,
            null,
            txn.user_id,
            txn.uuid,
            txn.updated_at,
          ],
        );
        await client.query(
          'UPDATE statement_rows SET imported = TRUE WHERE id = $1',
          [row.id],
        );
      }
    });

    const remaining = await db.query(
      `SELECT COUNT(*)::int AS n FROM statement_rows
        WHERE import_id = $1 AND imported = FALSE`,
      [id],
    );
    await db.query(
      `UPDATE statement_imports SET status = $1, updated_at = now() WHERE id = $2`,
      [remaining.rows[0].n === 0 ? 'imported' : 'review', id],
    );

    res.json({ imported: pending.rowCount, pending: remaining.rows[0].n });
  } catch (error) {
    next(error);
  }
});

/** DELETE /imports/:id — cancels/removes a staged import. */
router.delete('/imports/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const db = req.app.locals.db;
    const imp = await getImport(db, id, req.userId);
    if (!imp) return res.status(404).json({ error: 'Import not found' });
    await db.query('DELETE FROM statement_imports WHERE id = $1 AND user_id = $2', [
      id,
      req.userId,
    ]);
    res.json({ id, deleted: true });
  } catch (error) {
    next(error);
  }
});

export default router;
