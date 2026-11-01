import express from 'express';

const router = express.Router();

/**
 * GET /api/dashboard/summary
 * Returns aggregated data for dashboard KPIs
 */
router.get('/summary', async (req, res, next) => {
  try {
    const db = req.app.locals.db;

    // Total balance across all tills and transactions.
    // Exclude credit card charges (affects_balance = 0): those reduce the card
    // balance, not the till directly. The till is only debited when the card is paid.
    const totalBalance = await db.query(`
      SELECT COALESCE(SUM(
        CASE 
          WHEN type = 'ingreso' THEN amount
          WHEN type = 'egreso' THEN -amount
          WHEN type = 'transferencia' THEN amount
          ELSE 0
        END
      ), 0) as total
      FROM transactions
      WHERE COALESCE(affects_balance, 1) = 1
        AND deleted_at IS NULL
        AND user_id = $1
    `, [req.userId]);

    // Spending by category
    const byCategory = await db.query(`
      SELECT c.name, c.type, SUM(t.amount) as total, COUNT(t.id) as count
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.type = 'egreso'
        AND t.deleted_at IS NULL
        AND t.user_id = $1
      GROUP BY c.id, c.name, c.type
      ORDER BY total DESC
    `, [req.userId]);

    // Income by category
    const incomeByCategory = await db.query(`
      SELECT c.name, c.type, SUM(t.amount) as total
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE (t.type = 'ingreso' or t.type = 'transferencia') 
        AND t.deleted_at IS NULL
        AND t.user_id = $1
      GROUP BY c.id, c.name, c.type
      ORDER BY total DESC
      LIMIT 10
    `, [req.userId]);

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
      WHERE t.deleted_at IS NULL
        AND t.user_id = $1
      ORDER BY t.transaction_date DESC
      LIMIT 10
    `, [req.userId]);

    // Upcoming commitments
    const upcomingCommitments = await db.query(`
      SELECT 
        so.id,
        sp.title,
        so.due_date,
        so.amount,
        so.remaining_amount,
        so.status,
        e.name as entity_name
      FROM scheduled_occurrences so
      JOIN scheduled_plans sp ON so.plan_id = sp.id
      LEFT JOIN entities e ON sp.entity_id = e.id
      WHERE so.status IN ('pending', 'partially_paid', 'overdue')
        AND so.deleted_at IS NULL
        AND so.user_id = $1
        AND sp.deleted_at IS NULL
        AND sp.user_id = $1
      ORDER BY so.due_date ASC
      LIMIT 5
    `, [req.userId]);

    // Balance per till (excludes credit card charges, affects_balance = 0)
    const tillBalances = await db.query(`
      SELECT
        tl.id,
        tl.name,
        tl.is_bank,
        COALESCE(SUM(
          CASE
            WHEN t.type = 'ingreso' THEN t.amount
            WHEN t.type = 'egreso' THEN -t.amount
            WHEN t.type = 'transferencia' THEN t.amount
            ELSE 0
          END
        ), 0) as balance
      FROM tills tl
      LEFT JOIN transactions t
        ON t.till_id = tl.id
        AND t.user_id = $1
        AND COALESCE(t.affects_balance, 1) = 1
        AND t.deleted_at IS NULL
      WHERE tl.deleted_at IS NULL
        AND tl.user_id = $1
      GROUP BY tl.id, tl.name, tl.account_number, tl.is_bank
      ORDER BY tl.name ASC
    `, [req.userId]);

    // Available cash (non-bank tills, excludes credit card charges)
    const availableCash = await db.query(`
      SELECT COALESCE(SUM(
        CASE
          WHEN t.type = 'ingreso' THEN t.amount
          WHEN t.type = 'egreso' THEN -t.amount
          WHEN t.type = 'transferencia' THEN t.amount
          ELSE 0
        END
      ), 0) as total
      FROM tills tl
      LEFT JOIN transactions t
        ON t.till_id = tl.id
        AND t.user_id = $1
        AND COALESCE(t.affects_balance, 1) = 1
        AND t.deleted_at IS NULL
      WHERE COALESCE(tl.is_bank, false) = false
        AND tl.deleted_at IS NULL
        AND tl.user_id = $1
    `, [req.userId]);

    // Income and expense totals (transfers move balances, they are not income)
    const totals = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'ingreso' THEN amount END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'egreso' THEN amount END), 0) AS expense
      FROM transactions
      WHERE deleted_at IS NULL
        AND user_id = $1
    `, [req.userId]);

    res.json({
      totalBalance: parseFloat(totalBalance.rows[0]?.total || 0),
      availableCash: parseFloat(availableCash.rows[0]?.total || 0),
      totalIncome: parseFloat(totals.rows[0]?.income || 0),
      totalExpense: parseFloat(totals.rows[0]?.expense || 0),
      byCategory: byCategory.rows.map(row => ({
        name: row.name,
        type: row.type,
        total: parseFloat(row.total),
        count: parseInt(row.count, 10),
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
        remaining_amount: row.remaining_amount != null ? parseFloat(row.remaining_amount) : null,
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

/**
 * GET /api/dashboard/credit-cards
 * Returns all credit cards grouped by their associated till,
 * including the current outstanding balance (sum of card charges
 * not yet offset by a payment, i.e. affects_balance = 0).
 */
router.get('/credit-cards', async (req, res, next) => {
  try {
    const db = req.app.locals.db;

    // All credit cards with their till info
    const cards = await db.query(`
      SELECT
        cc.id,
        cc.name,
        cc.credit_limit,
        cc.till_id,
        tl.name AS till_name,
        tl.is_bank,
        COALESCE(
          (
            SELECT SUM(t.amount)
            FROM transactions t
            WHERE t.credit_card_id = cc.id
              AND t.affects_balance = 0
              AND t.type = 'egreso'
              AND t.deleted_at IS NULL
              AND t.user_id = $1
          ), 0
        ) AS total_charged,
        COALESCE(
          (
            SELECT SUM(ccpi.amount_paid)
            FROM credit_card_payment_items ccpi
            WHERE ccpi.credit_card_id = cc.id
              AND ccpi.deleted_at IS NULL
              AND ccpi.user_id = $1
          ), 0
        ) AS total_paid
      FROM credit_cards cc
      JOIN tills tl ON cc.till_id = tl.id
      WHERE cc.deleted_at IS NULL
        AND cc.user_id = $1
        AND tl.deleted_at IS NULL
        AND tl.user_id = $1
      ORDER BY tl.name ASC, cc.name ASC
    `, [req.userId]);

    // Group by till
    const tillMap = new Map();
    for (const row of cards.rows) {
      if (!tillMap.has(row.till_id)) {
        tillMap.set(row.till_id, {
          till_id: row.till_id,
          till_name: row.till_name,
          is_bank: row.is_bank ?? false,
          credit_cards: [],
        });
      }
      const charged = parseFloat(row.total_charged);
      const paid = parseFloat(row.total_paid);
      tillMap.get(row.till_id).credit_cards.push({
        id: row.id,
        name: row.name,
        credit_limit: parseFloat(row.credit_limit),
        outstanding_balance: Math.max(0, charged - paid),
        total_charged: charged,
        total_paid: paid,
      });
    }

    res.json({ tills: Array.from(tillMap.values()) });
  } catch (error) {
    next(error);
  }
});

export default router;
