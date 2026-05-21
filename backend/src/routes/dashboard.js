import express from 'express';

const router = express.Router();

/**
 * GET /api/dashboard/summary
 * Returns aggregated data for dashboard KPIs
 */
router.get('/summary', async (req, res, next) => {
  try {
    const db = req.app.locals.db;

    // Total balance across all tills and transactions
    const totalBalance = await db.query(`
      SELECT COALESCE(SUM(
        CASE 
          WHEN type = 'ingreso' THEN amount
          WHEN type = 'egreso' THEN -amount
          ELSE 0
        END
      ), 0) as total
      FROM transactions
    `);

    // Spending by category
    const byCategory = await db.query(`
      SELECT c.name, c.type, SUM(t.amount) as total
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.type = 'egreso'
      GROUP BY c.id, c.name, c.type
      ORDER BY total DESC
      LIMIT 10
    `);

    // Income by category
    const incomeByCategory = await db.query(`
      SELECT c.name, c.type, SUM(t.amount) as total
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.type = 'ingreso'
      GROUP BY c.id, c.name, c.type
      ORDER BY total DESC
      LIMIT 10
    `);

    // Recent transactions
    const recentTransactions = await db.query(`
      SELECT 
        t.id, 
        t.description, 
        t.amount, 
        t.type, 
        t.transaction_date, 
        c.name as category,
        tl.name as till_name
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN tills tl ON t.till_id = tl.id
      ORDER BY t.transaction_date DESC
      LIMIT 10
    `);

    // Upcoming commitments
    const upcomingCommitments = await db.query(`
      SELECT 
        so.id,
        sp.title,
        so.due_date,
        so.amount,
        so.status,
        e.name as entity_name
      FROM scheduled_occurrences so
      JOIN scheduled_plans sp ON so.plan_id = sp.id
      LEFT JOIN entities e ON sp.entity_id = e.id
      WHERE so.status IN ('pending', 'overdue')
      ORDER BY so.due_date ASC
      LIMIT 5
    `);

    // Balance per till
    const tillBalances = await db.query(`
      SELECT
        tl.id,
        tl.name,
        tl.is_bank,
        COALESCE(SUM(
          CASE
            WHEN t.type = 'ingreso' THEN t.amount
            WHEN t.type = 'egreso' THEN -t.amount
            ELSE 0
          END
        ), 0) as balance
      FROM tills tl
      LEFT JOIN transactions t ON t.till_id = tl.id
      GROUP BY tl.id, tl.name, tl.account_number, tl.is_bank
      ORDER BY tl.name ASC
    `);

    // Available cash (non-bank tills)
    const availableCash = await db.query(`
      SELECT COALESCE(SUM(
        CASE
          WHEN t.type = 'ingreso' THEN t.amount
          WHEN t.type = 'egreso' THEN -t.amount
          ELSE 0
        END
      ), 0) as total
      FROM tills tl
      LEFT JOIN transactions t ON t.till_id = tl.id
      WHERE COALESCE(tl.is_bank, false) = false
    `);

    res.json({
      totalBalance: parseFloat(totalBalance.rows[0]?.total || 0),
      availableCash: parseFloat(availableCash.rows[0]?.total || 0),
      byCategory: byCategory.rows.map(row => ({
        name: row.name,
        type: row.type,
        total: parseFloat(row.total),
      })),
      incomeByCategory: incomeByCategory.rows.map(row => ({
        name: row.name,
        type: row.type,
        total: parseFloat(row.total),
      })),
      recentTransactions: recentTransactions.rows.map(row => ({
        ...row,
        amount: parseFloat(row.amount),
      })),
      upcomingCommitments: upcomingCommitments.rows.map(row => ({
        ...row,
        amount: parseFloat(row.amount),
      })),
      tillBalances: tillBalances.rows.map(row => ({
        id: row.id,
        name: row.name,
        account_number: row.account_number,
        is_bank: row.is_bank ?? false,
        balance: parseFloat(row.balance),
      })),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
