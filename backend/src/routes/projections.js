import express from 'express';

const router = express.Router();

/**
 * GET /api/projections
 * Returns commitment timeline and liquidity forecast
 */
router.get('/', async (req, res, next) => {
  try {
    const db = req.app.locals.db;

    // Get all scheduled occurrences
    const occurrences = await db.query(`
      SELECT 
        so.id,
        so.plan_id,
        so.due_date,
        so.amount,
        so.status,
        sp.title,
        sp.total_installments,
        e.name as entity_name
      FROM scheduled_occurrences so
      JOIN scheduled_plans sp ON so.plan_id = sp.id
      LEFT JOIN entities e ON sp.entity_id = e.id
      ORDER BY so.due_date ASC
    `);

    // Scheduled plans that work as reminders and still have no occurrences
    const reminders = await db.query(`
      SELECT
        sp.id,
        sp.title,
        sp.start_date,
        sp.base_amount,
        sp.total_installments,
        e.name as entity_name,
        c.name as category_name,
        tl.name as till_name
      FROM scheduled_plans sp
      LEFT JOIN entities e ON sp.entity_id = e.id
      LEFT JOIN categories c ON sp.category_id = c.id
      LEFT JOIN tills tl ON sp.till_id = tl.id
      WHERE NOT EXISTS (
        SELECT 1
        FROM scheduled_occurrences so
        WHERE so.plan_id = sp.id
      )
      ORDER BY sp.start_date ASC, sp.id ASC
    `);

    // Calculate liquidity forecast (180 days)
    const today = new Date();
    const forecastDays = [];

    for (let i = 0; i <= 180; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];

      const dayOccurrences = occurrences.rows.filter(
        (o) => o.due_date === dateStr,
      );

      const dailyAmount = dayOccurrences.reduce((sum, o) => {
        return sum + (parseFloat(o.amount) || 0);
      }, 0);

      forecastDays.push({
        date: dateStr,
        amount: dailyAmount,
        count: dayOccurrences.length,
      });
    }

    // Calculate cumulative balance
    let cumulativeBalance = 0;
    const forecastWithCumulative = forecastDays.map((day) => {
      cumulativeBalance += day.amount;
      return {
        ...day,
        cumulativeBalance,
      };
    });

    res.json({
      occurrences: occurrences.rows.map(row => ({
        ...row,
        amount: parseFloat(row.amount),
      })),
      reminders: reminders.rows.map(row => ({
        ...row,
        base_amount: row.base_amount === null ? null : parseFloat(row.base_amount),
      })),
      forecast: forecastWithCumulative,
      summary: {
        total_amount: occurrences.rows.reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0),
        pending_count: occurrences.rows.filter(o => o.status === 'pending').length,
        overdue_count: occurrences.rows.filter(o => o.status === 'overdue').length,
        reminders_count: reminders.rows.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
