import express from 'express';

const router = express.Router();

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
      ORDER BY name ASC
    `);

    res.json(entities.rows);
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
      'SELECT * FROM entities WHERE id = $1',
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
      WHERE t.id IN (
        SELECT transaction_id FROM scheduled_occurrences so
        JOIN scheduled_plans sp ON so.plan_id = sp.id
        WHERE sp.entity_id = $1
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
      AND NOT EXISTS (
        SELECT 1
        FROM scheduled_occurrences so
        WHERE so.plan_id = sp.id
      )
      ORDER BY sp.start_date ASC, sp.id ASC
    `, [id]);

    // Calculate totals
    const totals = await db.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN t.type = 'egreso' THEN t.amount ELSE 0 END), 0) as total_payable,
        COALESCE(SUM(CASE WHEN t.type IN ('ingreso', 'transferencia') THEN t.amount ELSE 0 END), 0) as total_received
      FROM transactions t
      WHERE t.id IN (
        SELECT transaction_id FROM scheduled_occurrences so
        JOIN scheduled_plans sp ON so.plan_id = sp.id
        WHERE sp.entity_id = $1
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
