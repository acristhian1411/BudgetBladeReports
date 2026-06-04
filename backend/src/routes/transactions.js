import express from 'express';

const router = express.Router();

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
          'LEFT JOIN tills ON transactions.till_id = tills.id WHERE 1=1';
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
    console.log('Executing query:', query)
    console.log('with params:', params);
    const transactions = await db.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM transactions WHERE 1=1';
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

export default router;
