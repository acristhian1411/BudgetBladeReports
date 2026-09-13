import express from 'express';

const router = express.Router();

/**
 * GET /api/analysis
 * Returns consolidated analysis of debt capacity, liquidity projection, and risk metrics
 *
 * Query parameters:
 * - horizon_days: 30|60|90|180 (default 90)
 * - till_types: effective|bank|both (default both)
 * - include_credit_cards: true|false (default true)
 * - safety_cushion_pct: 0-50 (default 20)
 * - commitment_status: pending|partial|overdue|all (default all)
 */
router.get('/', async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    const horizonDays = Math.min(180, parseInt(req.query.horizon_days || 90));
    const tillTypes = req.query.till_types || 'both';
    const includeCreditCards = req.query.include_credit_cards !== 'false';
    const safetyCushionPct = Math.max(0, Math.min(50, parseInt(req.query.safety_cushion_pct || 20)));
    const commitmentStatus = req.query.commitment_status || 'all';

    // 1. Get current liquidity by till
    const tillsResult = await db.query(`
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
        AND COALESCE(t.affects_balance, 1) = 1
        AND t.deleted_at IS NULL
      WHERE tl.deleted_at IS NULL
      GROUP BY tl.id, tl.name, tl.is_bank
      ORDER BY tl.name ASC
    `);

    // Filter by till_types
    let filteredTills = tillsResult.rows;
    if (tillTypes === 'effective') {
      filteredTills = filteredTills.filter(t => !t.is_bank);
    } else if (tillTypes === 'bank') {
      filteredTills = filteredTills.filter(t => t.is_bank);
    }

    const liquidityImmediate = filteredTills.reduce((sum, t) => sum + parseFloat(t.balance || 0), 0);

    // 2. Get credit cards outstanding balance and limits
    let creditCardsOutstanding = 0;
    let creditCardsLimitsTotal = 0;
    let creditCardsData = [];
    
    if (includeCreditCards) {
      const cardsResult = await db.query(`
        SELECT
          cc.id,
          cc.name,
          cc.credit_limit,
          cc.till_id,
          COALESCE(
            (
              SELECT SUM(t.amount)
              FROM transactions t
              WHERE t.credit_card_id = cc.id
                AND t.affects_balance = 0
                AND t.type = 'egreso'
                AND t.deleted_at IS NULL
            ), 0
          ) AS total_charged,
          COALESCE(
            (
              SELECT SUM(ccpi.amount_paid)
              FROM credit_card_payment_items ccpi
              WHERE ccpi.credit_card_id = cc.id
                AND ccpi.deleted_at IS NULL
            ), 0
          ) AS total_paid
        FROM credit_cards cc
        WHERE cc.till_id IN (${filteredTills.map(t => t.id).join(',')})
          AND cc.deleted_at IS NULL
      `);

      creditCardsData = cardsResult.rows.map(row => ({
        card_id: row.id,
        card_name: row.name,
        credit_limit: parseFloat(row.credit_limit),
        outstanding_balance: Math.max(0, parseFloat(row.total_charged) - parseFloat(row.total_paid)),
      }));

      creditCardsOutstanding = creditCardsData.reduce((sum, c) => sum + c.outstanding_balance, 0);
      creditCardsLimitsTotal = creditCardsData.reduce((sum, c) => sum + c.credit_limit, 0);
    }

    // 3. Get scheduled commitments filtered by status and horizon
    let statusFilter = '';
    if (commitmentStatus === 'pending') {
      statusFilter = "AND so.status = 'pending'";
    } else if (commitmentStatus === 'partial') {
      statusFilter = "AND so.status = 'partially_paid'";
    } else if (commitmentStatus === 'overdue') {
      statusFilter = "AND so.status = 'overdue'";
    }

    const commitmentsResult = await db.query(`
      SELECT 
        so.id,
        so.due_date,
        so.amount,
        so.remaining_amount,
        so.status,
        sp.id as plan_id,
        sp.title,
        sp.type as plan_type,
        sp.base_amount as plan_base_amount,
        e.name as entity_name
      FROM scheduled_occurrences so
      JOIN scheduled_plans sp ON so.plan_id = sp.id
      LEFT JOIN entities e ON sp.entity_id = e.id
      WHERE (
        -- Future occurrences within horizon
        (so.due_date::date >= CURRENT_DATE AND so.due_date::date <= CURRENT_DATE + INTERVAL '${horizonDays} days')
        OR
        -- Past unpaid occurrences
        (so.due_date::date < CURRENT_DATE AND so.status IN ('pending', 'partially_paid', 'overdue'))
      )
      AND so.deleted_at IS NULL
      AND sp.deleted_at IS NULL
      ${statusFilter}
      ORDER BY so.due_date ASC
    `);

    const commitments = commitmentsResult.rows.map(row => ({
      ...row,
      amount: parseFloat(row.amount),
      remaining_amount: row.remaining_amount != null ? parseFloat(row.remaining_amount) : null,
      plan_base_amount: row.plan_base_amount != null ? parseFloat(row.plan_base_amount) : null,
    }));

    // 4. Build timeline projection (180 days)
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const timeline = [];
    let cumulativeExpenses = 0;
    let cumulativeIncomes = 0;

    // Separate past unpaid occurrences
    const pastUnpaid = commitments.filter(c => c.due_date < todayStr);
    const futureCommitments = commitments.filter(c => c.due_date >= todayStr);

    const getOwed = (c) =>
      c.status === 'partially_paid' && c.remaining_amount != null
        ? c.remaining_amount
        : c.amount;

    const pastUnpaidExpenses = pastUnpaid
      .filter(c => c.plan_type === 'egreso')
      .reduce((sum, c) => sum + getOwed(c), 0);

    const pastUnpaidIncomes = pastUnpaid
      .filter(c => c.plan_type === 'ingreso')
      .reduce((sum, c) => sum + getOwed(c), 0);

    for (let i = 0; i <= 180; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];

      const dayOccurrences = futureCommitments.filter(c => c.due_date === dateStr);
      
      let dayExpenses = dayOccurrences
        .filter(c => c.plan_type === 'egreso')
        .reduce((sum, c) => sum + getOwed(c), 0);

      let dayIncomes = dayOccurrences
        .filter(c => c.plan_type === 'ingreso')
        .reduce((sum, c) => sum + getOwed(c), 0);

      // Accumulate past unpaid amounts on Day 0 (today)
      if (i === 0) {
        dayExpenses += pastUnpaidExpenses;
        dayIncomes += pastUnpaidIncomes;
      }

      cumulativeExpenses += dayExpenses;
      cumulativeIncomes += dayIncomes;
      const projectedBalance = liquidityImmediate + cumulativeIncomes - cumulativeExpenses;

      timeline.push({
        date: dateStr,
        projected_balance: projectedBalance,
        commitments_day: dayExpenses, // Keep this name for frontend compatibility (expenses)
        incomes_day: dayIncomes,
        count: dayOccurrences.length + (i === 0 ? pastUnpaid.length : 0),
        net_flow: dayIncomes - dayExpenses,
      });
    }

    // 5. Calculate metrics
    const getDaysFromNow = (c) =>
      Math.floor((new Date(c.due_date) - today) / (1000 * 60 * 60 * 24));

    const computeRangeBreakdown = (rangeFilter) => {
      const items = commitments.filter(c => c.plan_type === 'egreso' && rangeFilter(c));
      return {
        total_amount: items.reduce((s, c) => s + getOwed(c), 0),
        pending_amount: items
          .filter(c => c.status === 'pending' || c.status === 'partially_paid')
          .reduce((s, c) => s + getOwed(c), 0),
        overdue_amount: items
          .filter(c => c.status === 'overdue')
          .reduce((s, c) => s + getOwed(c), 0),
        count: items.length,
        entities: [...new Set(items.map(c => c.entity_name).filter(Boolean))],
      };
    };

    const shortTermCommitments = commitments
      .filter(c => c.plan_type === 'egreso' && getDaysFromNow(c) <= 30)
      .reduce((sum, c) => sum + getOwed(c), 0);

    const mediumTermCommitments = commitments
      .filter(c => { const d = getDaysFromNow(c); return c.plan_type === 'egreso' && d > 30 && d <= 90; })
      .reduce((sum, c) => sum + getOwed(c), 0);

    const breakdown030  = computeRangeBreakdown(c => getDaysFromNow(c) <= 30);
    const breakdown3160 = computeRangeBreakdown(c => { const d = getDaysFromNow(c); return d > 30 && d <= 60; });
    const breakdown6190 = computeRangeBreakdown(c => { const d = getDaysFromNow(c); return d > 60 && d <= 90; });

    const overdueAmount = commitments
      .filter(c => c.plan_type === 'egreso' && c.status === 'overdue')
      .reduce((s, c) => s + getOwed(c), 0);
    const overdueCount = commitments.filter(c => c.plan_type === 'egreso' && c.status === 'overdue').length;

    // Find valley
    let valleyIndex = 0;
    let minBalance = liquidityImmediate;
    timeline.slice(0, Math.min(horizonDays + 1, 181)).forEach((day, idx) => {
      if (day.projected_balance < minBalance) {
        minBalance = day.projected_balance;
        valleyIndex = idx;
      }
    });

    const valleyDate = timeline[valleyIndex]?.date || null;
    const valleyBalance = minBalance;

    // Calculate runway (days without income)
    let runwayDays = 180;
    const totalExpenses180 = timeline.reduce((sum, day) => sum + day.commitments_day, 0);
    const avgDailySpending = totalExpenses180 / Math.max(1, 181);
    if (avgDailySpending > 0) {
      runwayDays = Math.floor(liquidityImmediate / avgDailySpending);
    }

    // Calculate capacity for new debt
    const safetyAmount = liquidityImmediate * (safetyCushionPct / 100);
    const capacityNewDebt = Math.max(0, liquidityImmediate - shortTermCommitments - safetyAmount);

    // Calculate risk level
    let riskLevel = 'low';
    const creditCardUtilization = creditCardsLimitsTotal > 0
      ? (creditCardsOutstanding / creditCardsLimitsTotal) * 100
      : 0;

    if (valleyBalance < 0 && valleyIndex <= 15) {
      riskLevel = 'critical';
    } else if (creditCardUtilization > 80 || runwayDays < 30) {
      riskLevel = 'high';
    } else if (runwayDays < 60 || valleyBalance < liquidityImmediate * 0.2) {
      riskLevel = 'medium';
    }

    // Query Variable Commitments (Reminders of type egreso with base_amount = 0 and no occurrences in horizon)
    const variablePlansResult = await db.query(`
      SELECT 
        sp.id, 
        sp.title, 
        sp.type as plan_type,
        sp.base_amount,
        COALESCE(
          (
            SELECT spm.amount_paid
            FROM scheduled_payments_mapping spm
            JOIN scheduled_occurrences so ON spm.occurrence_id = so.id
            WHERE so.plan_id = sp.id
              AND spm.deleted_at IS NULL
              AND so.deleted_at IS NULL
            ORDER BY spm.payment_date DESC, spm.id DESC
            LIMIT 1
          ), 0
        ) as last_payment_amount
      FROM scheduled_plans sp
      WHERE NOT EXISTS (
        SELECT 1 
        FROM scheduled_occurrences so 
        WHERE so.plan_id = sp.id 
          AND so.deleted_at IS NULL
          AND so.due_date::date >= CURRENT_DATE
          AND so.due_date::date <= CURRENT_DATE + INTERVAL '${horizonDays} days'
      )
      AND sp.base_amount = 0
      AND sp.type = 'egreso'
      AND sp.deleted_at IS NULL
    `);

    const variableCommitments = variablePlansResult.rows.map(row => ({
      ...row,
      base_amount: parseFloat(row.base_amount),
      last_payment_amount: parseFloat(row.last_payment_amount),
    }));

    // 6. Build response
    res.json({
      summary: {
        liquidity_immediate: liquidityImmediate,
        credit_cards_outstanding: creditCardsOutstanding,
        credit_cards_total_limit: creditCardsLimitsTotal,
        total_limit_available: Math.max(0, creditCardsLimitsTotal - creditCardsOutstanding),
        commitments_short_term: shortTermCommitments,
        commitments_medium_term: mediumTermCommitments,
        liquidity_at_horizon: timeline[Math.min(horizonDays, 180)]?.projected_balance || liquidityImmediate,
        capacity_new_debt: capacityNewDebt,
        overdue_amount: overdueAmount,
        overdue_count: overdueCount,
        risk_level: riskLevel,
        runway_days: runwayDays,
        valley_date: valleyDate,
        valley_balance: valleyBalance,
        horizon_days: horizonDays,
        safety_cushion_pct: safetyCushionPct,
      },
      timeline: timeline.slice(0, Math.min(horizonDays + 1, 181)),
      metrics_by_till: filteredTills.map(till => ({
        till_id: till.id,
        till_name: till.name,
        is_bank: till.is_bank,
        current_balance: parseFloat(till.balance),
        projected_balance_at_horizon: timeline[Math.min(horizonDays, 180)]?.projected_balance || liquidityImmediate,
        risk_factor: Math.max(0, 1 - (parseFloat(till.balance) / (liquidityImmediate || 1))),
      })),
      credit_cards_breakdown: creditCardsData.map(card => ({
        ...card,
        utilization_pct: card.credit_limit > 0 ? (card.outstanding_balance / card.credit_limit) * 100 : 0,
      })),
      commitments_breakdown: [
        {
          days_range: '0-30',
          ...breakdown030,
          risk_color: breakdown030.total_amount > liquidityImmediate * 0.5 ? 'red' : 'yellow',
        },
        {
          days_range: '31-60',
          ...breakdown3160,
          risk_color: 'yellow',
        },
        {
          days_range: '61-90',
          ...breakdown6190,
          risk_color: 'yellow',
        },
      ],
      variable_commitments: variableCommitments,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
