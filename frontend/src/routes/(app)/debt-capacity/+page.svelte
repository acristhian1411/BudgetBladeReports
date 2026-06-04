<script>
  import { onDestroy, onMount, tick } from "svelte";
  import { apiGet } from "$lib/api";
  import { formatCurrency, formatDateDisplay } from "$lib/formatting";

  let analysis = null;
  let loading = true;
  let error = null;
  let debtChart = null;
  let debtCanvas = null;

  // Filter state
  let horizonDays = 90;
  let tillTypes = "both";
  let includeCreditCards = true;
  let safetyCushion = 20;
  let commitmentStatus = "all";
  let newDebtAmount = "";
  let newDebtInstallments = "";
  let extraIncome = "";
  let incomeFrequency = "once";
  let stressScenario = "conservative";

  const horizonOptions = [30, 60, 90, 180];
  const tillTypeOptions = [
    { value: "both", label: "Ambas" },
    { value: "effective", label: "Efectivo" },
    { value: "bank", label: "Banco" },
  ];
  const statusOptions = [
    { value: "all", label: "Todas" },
    { value: "pending", label: "Pendientes" },
    { value: "partial", label: "Parciales" },
    { value: "overdue", label: "Vencidas" },
  ];

  onMount(() => {
    loadAnalysis();
  });

  onDestroy(() => {
    if (debtChart) {
      debtChart.destroy();
    }
  });

  async function loadAnalysis() {
    try {
      loading = true;
      const params = new URLSearchParams({
        horizon_days: horizonDays,
        till_types: tillTypes,
        include_credit_cards: includeCreditCards,
        safety_cushion_pct: safetyCushion,
        commitment_status: commitmentStatus,
      });

      analysis = await apiGet(`/analysis?${params}`);

      await tick();
      renderChart();
    } catch (err) {
      error = err.message;
      analysis = null;
    } finally {
      loading = false;
    }
  }

  const STRESS_SCENARIOS = {
    optimistic: { incomeMult: 1.0, delayDays: 0 },
    conservative: { incomeMult: 0.8, delayDays: 0 },
    pessimistic: { incomeMult: 0.6, delayDays: 15 },
  };

  function buildScenarioSimulation(
    timeline,
    horizon,
    debtAmount,
    installments,
    extraIncomeAmt,
    incomeFreq,
    scenario,
  ) {
    const total = Number(debtAmount) || 0;
    const cuotas = Math.max(0, Number(installments) || 0);
    const income = Number(extraIncomeAmt) || 0;
    const hasDebt = total > 0 && cuotas > 0;
    const hasIncome = income > 0;

    if (!timeline?.length || (!hasDebt && !hasIncome)) return null;

    const { incomeMult, delayDays } =
      STRESS_SCENARIOS[scenario] ?? STRESS_SCENARIOS.conservative;

    // Build debt schedule: distribute installments over horizon
    const debtSchedule = Array(timeline.length).fill(0);
    if (hasDebt) {
      const perInstallment = total / cuotas;
      const spacing = Math.max(1, Math.floor(horizon / cuotas));
      for (let i = 0; i < cuotas; i += 1) {
        const idx = Math.min(timeline.length - 1, i * spacing);
        debtSchedule[idx] += perInstallment;
      }
    }

    // Build income schedule with delay and frequency
    const incomeSchedule = Array(timeline.length).fill(0);
    if (hasIncome) {
      const effectiveIncome = income * incomeMult;
      if (incomeFreq === "once") {
        incomeSchedule[Math.min(timeline.length - 1, delayDays)] =
          effectiveIncome;
      } else if (incomeFreq === "monthly") {
        for (let d = delayDays; d < timeline.length; d += 30) {
          incomeSchedule[Math.min(timeline.length - 1, d)] += effectiveIncome;
        }
      }
    }

    // Project: base balance + cumulative income - cumulative debt
    let cumulativeDebt = 0;
    let cumulativeIncome = 0;
    const simulated = timeline.map((day, idx) => {
      cumulativeDebt += debtSchedule[idx];
      cumulativeIncome += incomeSchedule[idx];
      return day.projected_balance + cumulativeIncome - cumulativeDebt;
    });

    const valleyBalance = Math.min(...simulated);
    const valleyDayIndex = simulated.indexOf(valleyBalance);

    return { simulated, valleyBalance, valleyDayIndex };
  }

  async function renderChart() {
    if (!debtCanvas || !analysis?.timeline) {
      return;
    }

    const { Chart, registerables } = await import("chart.js");
    Chart.register(...registerables);

    if (debtChart) {
      debtChart.destroy();
    }

    const timeline = analysis.timeline;
    const labels = timeline.map((d) => formatDateDisplay(d.date));
    const balances = timeline.map((d) => d.projected_balance);
    // Find data for valley marker
    const valleyPointData = balances.map((val, idx) =>
      analysis.summary.valley_date === timeline[idx].date ? val : null,
    );

    // Use reactive simulationResult (updated by $: declaration)
    const simulatedBalances = simulationResult?.simulated ?? null;
    const simulatedIndex = simulatedBalances ? 1 : -1;
    const valleyIndex = simulatedBalances ? 2 : 1;
    const lineIndex = simulatedBalances ? 3 : 2;

    debtChart = new Chart(debtCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Saldo proyectado",
            data: balances,
            borderColor: "#06b6d4",
            backgroundColor: "rgba(6, 182, 212, 0.15)",
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 6,
            tension: 0.3,
            fill: true,
            segment: {
              borderColor: (ctx) => {
                const value = ctx.p1DataIndex
                  ? balances[ctx.p1DataIndex]
                  : balances[0];
                return value < 0 ? "#f43f5e" : "#06b6d4";
              },
            },
          },
          ...(simulatedBalances
            ? [
                {
                  label: "Saldo con nueva deuda",
                  data: simulatedBalances,
                  borderColor: "#f59e0b",
                  backgroundColor: "rgba(245, 158, 11, 0.12)",
                  borderWidth: 2,
                  pointRadius: 0,
                  pointHoverRadius: 6,
                  tension: 0.3,
                  fill: false,
                  borderDash: [6, 4],
                },
              ]
            : []),
          {
            label: "Valle",
            data: valleyPointData,
            borderColor: "#f43f5e",
            backgroundColor: "#f43f5e",
            borderWidth: 0,
            showLine: false,
            pointRadius: 8,
            pointHoverRadius: 10,
          },
          {
            label: "Línea de equilibrio",
            data: Array(balances.length).fill(0),
            borderColor: "rgba(148, 163, 184, 0.3)",
            borderWidth: 1,
            borderDash: [5, 5],
            showLine: true,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            labels: {
              color: "#e2e8f0",
            },
          },
          tooltip: {
            callbacks: {
              title(items) {
                const idx = items?.[0]?.dataIndex ?? 0;
                return formatDateDisplay(timeline[idx].date);
              },
              label(context) {
                if (context.datasetIndex === valleyIndex) {
                  return `Valle: ${formatCurrency(context.parsed.y || 0)}`;
                }
                if (context.datasetIndex === lineIndex) {
                  return null;
                }
                if (context.datasetIndex === simulatedIndex) {
                  return `Saldo con deuda: ${formatCurrency(
                    context.parsed.y || 0,
                  )}`;
                }
                return `Saldo: ${formatCurrency(context.parsed.y || 0)}`;
              },
              afterBody(items) {
                const idx = items?.[0]?.dataIndex ?? 0;
                const day = timeline[idx];
                return [
                  `Compromisos: ${formatCurrency(day.commitments_day || 0)}`,
                  `Cantidad: ${day.count || 0}`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: "#94a3b8",
              maxTicksLimit: 8,
            },
            grid: {
              color: "rgba(148, 163, 184, 0.15)",
            },
          },
          y: {
            ticks: {
              color: "#94a3b8",
              callback(value) {
                return formatCurrency(Number(value) || 0);
              },
            },
            grid: {
              color: "rgba(148, 163, 184, 0.15)",
            },
          },
        },
      },
    });
  }

  function getRiskColor(level) {
    switch (level) {
      case "critical":
        return "bg-brand-rose";
      case "high":
        return "bg-yellow-500";
      case "medium":
        return "bg-yellow-400";
      default:
        return "bg-brand-emerald";
    }
  }

  function getRiskLabel(level) {
    const labels = {
      critical: "🔴 CRÍTICO",
      high: "🔴 ALTO",
      medium: "🟡 MEDIO",
      low: "🟢 BAJO",
    };
    return labels[level] || level;
  }

  function getDebtCapacityColor(capacity, liquidity) {
    const ratio = liquidity > 0 ? capacity / liquidity : 0;
    if (ratio > 0.5) return "text-brand-emerald";
    if (ratio > 0.2) return "text-yellow-400";
    return "text-brand-rose";
  }

  async function applyFilters() {
    await loadAnalysis();
  }

  function applySimulation() {
    renderChart();
  }

  function computeSemaphore(simResult, floor) {
    if (!simResult) return null;
    const min = simResult.valleyBalance;
    if (min <= 0) {
      return {
        state: "red",
        label: "🔴 Riesgo de quiebra técnica",
        message: `Déficit de ${formatCurrency(Math.abs(min))} en el día ${simResult.valleyDayIndex}`,
        colorClass: "bg-brand-rose",
        textClass: "text-white",
      };
    }
    if (min <= floor) {
      return {
        state: "yellow",
        label: "🟡 Precaución",
        message: "El saldo proyectado roza el colchón de seguridad.",
        colorClass: "bg-yellow-400",
        textClass: "text-brand-deep",
      };
    }
    return {
      state: "green",
      label: "🟢 Capacidad óptima",
      message: "El saldo proyectado mantiene el colchón de seguridad.",
      colorClass: "bg-brand-emerald",
      textClass: "text-brand-deep",
    };
  }

  $: simulationResult = analysis?.timeline
    ? buildScenarioSimulation(
        analysis.timeline,
        horizonDays,
        newDebtAmount,
        newDebtInstallments,
        extraIncome,
        incomeFrequency,
        stressScenario,
      )
    : null;

  $: safetyFloor =
    (analysis?.summary?.liquidity_immediate ?? 0) * (safetyCushion / 100);

  $: semaphoreState = computeSemaphore(simulationResult, safetyFloor);
</script>

<div class="p-8 space-y-6">
  <!-- Header -->
  <div>
    <h1 class="text-4xl font-bold">Análisis de Deuda y Capacidad</h1>
    <p class="text-brand-surface-2 mt-2">
      Visualiza tu capacidad de endeudamiento y proyección de liquidez
    </p>
  </div>

  {#if error}
    <div
      class="bg-brand-rose/20 border border-brand-rose rounded-lg p-4 text-brand-rose"
    >
      Error: {error}
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12">
      <p class="text-brand-surface-2">Cargando análisis...</p>
    </div>
  {:else if analysis}
    <!-- Filtros (Collapsible) -->
    <details class="card group cursor-pointer">
      <summary class="flex items-center justify-between font-semibold text-lg">
        <span>🔧 Filtros</span>
        <span class="group-open:rotate-180 transition-transform">▼</span>
      </summary>

      <div class="mt-4 space-y-4 pt-4 border-t border-brand-surface-2">
        <!-- Horizonte -->
        <div>
          <label class="text-sm font-semibold text-brand-surface-2">
            Horizonte (días)
          </label>
          <div class="flex gap-2 mt-2">
            {#each horizonOptions as h}
              <button
                on:click={() => {
                  horizonDays = h;
                }}
                class="px-4 py-2 rounded text-sm font-medium transition-colors"
                class:bg-brand-cyan={horizonDays === h}
                class:bg-brand-surface-2={horizonDays !== h}
              >
                {h}d
              </button>
            {/each}
          </div>
        </div>

        <!-- Tipo de Caja -->
        <div>
          <label
            for="till-types"
            class="text-sm font-semibold text-brand-surface-2"
          >
            Tipo de caja
          </label>
          <select
            id="till-types"
            bind:value={tillTypes}
            class="w-full mt-2 px-3 py-2 bg-brand-surface-2 rounded border border-brand-surface-2 text-white"
          >
            {#each tillTypeOptions as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </div>

        <!-- Incluir Tarjetas -->
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="credit-cards"
            bind:checked={includeCreditCards}
            class="w-4 h-4 cursor-pointer"
          />
          <label for="credit-cards" class="text-sm cursor-pointer">
            Incluir deuda de tarjetas
          </label>
        </div>

        <!-- Colchón de Seguridad -->
        <div>
          <label
            for="safety-cushion"
            class="text-sm font-semibold text-brand-surface-2"
          >
            Colchón de seguridad: {safetyCushion}%
          </label>
          <input
            id="safety-cushion"
            type="range"
            min="0"
            max="50"
            step="5"
            bind:value={safetyCushion}
            class="w-full mt-2"
          />
        </div>

        <!-- Estado de Compromisos -->
        <div>
          <label
            for="commitment-status"
            class="text-sm font-semibold text-brand-surface-2"
          >
            Estado de compromisos
          </label>
          <select
            id="commitment-status"
            bind:value={commitmentStatus}
            class="w-full mt-2 px-3 py-2 bg-brand-surface-2 rounded border border-brand-surface-2 text-white"
          >
            {#each statusOptions as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </div>

        <button
          on:click={applyFilters}
          class="w-full px-4 py-2 bg-brand-cyan text-brand-deep font-semibold rounded hover:opacity-90 transition-opacity"
        >
          Aplicar filtros
        </button>

        <!-- Simulación de Escenario -->
        <div class="pt-2 border-t border-brand-surface-2">
          <div class="text-sm font-bold mb-3">Simulador de Escenario</div>

          <!-- Escenario de confianza -->
          <div class="mb-3">
            <label
              for="stress-scenario"
              class="text-xs font-semibold text-brand-surface-2"
            >
              Nivel de confianza
            </label>
            <select
              id="stress-scenario"
              bind:value={stressScenario}
              class="w-full mt-1 px-3 py-2 bg-brand-surface-2 rounded border border-brand-surface-2 text-white text-sm"
            >
              <option value="optimistic"
                >Optimista — 100% de ingresos esperados</option
              >
              <option value="conservative"
                >Conservador — 80% de ingresos, +5% compromisos</option
              >
              <option value="pessimistic"
                >Pesimista — 60% de ingresos con 15 días de retraso</option
              >
            </select>
          </div>

          <!-- Nueva deuda -->
          <div class="text-xs font-semibold text-brand-surface-2 mb-2">
            Nueva deuda (opcional)
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="new-debt-amount" class="text-xs text-brand-surface-2">
                Monto total
              </label>
              <input
                id="new-debt-amount"
                type="number"
                min="0"
                step="100"
                bind:value={newDebtAmount}
                placeholder="Ej: 150000"
                class="w-full mt-1 px-3 py-2 bg-brand-surface-2 rounded border border-brand-surface-2 text-white text-sm"
              />
            </div>
            <div>
              <label
                for="new-debt-installments"
                class="text-xs text-brand-surface-2"
              >
                Cuotas
              </label>
              <input
                id="new-debt-installments"
                type="number"
                min="1"
                step="1"
                bind:value={newDebtInstallments}
                placeholder="Ej: 6"
                class="w-full mt-1 px-3 py-2 bg-brand-surface-2 rounded border border-brand-surface-2 text-white text-sm"
              />
            </div>
          </div>

          <!-- Ingresos esperados -->
          <div class="text-xs font-semibold text-brand-surface-2 mt-3 mb-2">
            Ingresos esperados (opcional)
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="extra-income" class="text-xs text-brand-surface-2">
                Monto
              </label>
              <input
                id="extra-income"
                type="number"
                min="0"
                step="100"
                bind:value={extraIncome}
                placeholder="Ej: 80000"
                class="w-full mt-1 px-3 py-2 bg-brand-surface-2 rounded border border-brand-surface-2 text-white text-sm"
              />
            </div>
            <div>
              <label
                for="income-frequency"
                class="text-xs text-brand-surface-2"
              >
                Frecuencia
              </label>
              <select
                id="income-frequency"
                bind:value={incomeFrequency}
                class="w-full mt-1 px-3 py-2 bg-brand-surface-2 rounded border border-brand-surface-2 text-white text-sm"
              >
                <option value="once">Pago único</option>
                <option value="monthly">Mensual recurrente</option>
              </select>
            </div>
          </div>

          <button
            on:click={applySimulation}
            class="mt-4 w-full px-4 py-2 bg-amber-400 text-brand-deep font-semibold rounded hover:opacity-90 transition-opacity"
          >
            Proyectar escenario en gráfico
          </button>
          <p class="text-xs text-brand-surface-2 mt-2">
            El semáforo se actualiza en tiempo real. El gráfico se actualiza al
            presionar el botón.
          </p>
        </div>
      </div>
    </details>

    <!-- Semáforo de Viabilidad (reactivo, se muestra solo si hay simulación activa) -->
    {#if semaphoreState}
      <div
        class="card flex items-center gap-4 {semaphoreState.colorClass} {semaphoreState.textClass}"
      >
        <div class="text-3xl font-bold shrink-0 leading-none">
          {semaphoreState.label}
        </div>
        <div class="text-sm">{semaphoreState.message}</div>
        {#if semaphoreState.state !== "green"}
          <div class="ml-auto text-xs font-semibold shrink-0 opacity-80">
            {stressScenario === "optimistic"
              ? "Escenario optimista"
              : stressScenario === "pessimistic"
                ? "Escenario pesimista"
                : "Escenario conservador"}
          </div>
        {/if}
      </div>
    {/if}

    <!-- KPI Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <!-- Liquidez Inmediata -->
      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Liquidez inmediata
        </div>
        <div class="text-3xl font-bold text-brand-emerald">
          {formatCurrency(analysis.summary.liquidity_immediate)}
        </div>
        <div class="text-xs text-brand-surface-2 mt-2">Efectivo + bancos</div>
      </div>

      <!-- Deuda de Tarjetas -->
      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Deuda de tarjetas
        </div>
        <div class="text-3xl font-bold text-brand-rose">
          {formatCurrency(analysis.summary.credit_cards_outstanding)}
        </div>
        <div class="text-xs text-brand-surface-2 mt-2">Saldo pendiente</div>
      </div>

      <!-- Capacidad Nueva Deuda -->
      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Puedes asumir hasta
        </div>
        <div
          class="text-3xl font-bold {getDebtCapacityColor(
            analysis.summary.capacity_new_debt,
            analysis.summary.liquidity_immediate,
          )}"
        >
          {formatCurrency(analysis.summary.capacity_new_debt)}
        </div>
        <div class="text-xs text-brand-surface-2 mt-2">En deuda nueva</div>
      </div>

      <!-- Runway en Días -->
      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Runway
        </div>
        <div class="text-3xl font-bold text-brand-cyan">
          {analysis.summary.runway_days}d
        </div>
        <div class="text-xs text-brand-surface-2 mt-2">Días sin ingresos</div>
      </div>
    </div>

    <!-- Main Chart -->
    <div class="card">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-xl font-bold">
            Proyección de Saldo ({horizonDays} días)
          </h2>
          <p class="text-sm text-brand-surface-2">
            Saldo proyectado considerando compromisos programados
          </p>
        </div>
        {#if analysis.summary.valley_date}
          <div class="text-right text-sm">
            <div class="font-semibold">Valle de liquidez</div>
            <div class="text-brand-rose">
              {formatDateDisplay(analysis.summary.valley_date)}
            </div>
            <div class="text-brand-surface-2">
              {formatCurrency(analysis.summary.valley_balance)}
            </div>
          </div>
        {/if}
      </div>

      <div class="h-96">
        <canvas bind:this={debtCanvas} />
      </div>
    </div>

    <!-- Risk & Summary Cards -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Risk Level -->
      <div class="card">
        <h3 class="text-lg font-bold mb-4">Nivel de Riesgo</h3>
        <div
          class="flex items-center justify-center h-32 rounded-lg {getRiskColor(
            analysis.summary.risk_level,
          )}"
        >
          <div class="text-center text-brand-deep font-bold text-2xl">
            {getRiskLabel(analysis.summary.risk_level)}
          </div>
        </div>
        <div class="text-xs text-brand-surface-2 mt-3 text-center">
          Horizonte: {horizonDays} días
          <br />
          Colchón: {safetyCushion}%
        </div>
      </div>

      <!-- Short Term Commitments -->
      <div class="card">
        <h3 class="text-lg font-bold mb-4">Próximos 30 días</h3>
        <div class="text-3xl font-bold text-brand-rose">
          {formatCurrency(analysis.summary.commitments_short_term)}
        </div>
        <div class="text-xs text-brand-surface-2 mt-2">En compromisos</div>
        <div class="mt-4 pt-4 border-t border-brand-surface-2">
          <div class="text-xs font-semibold text-brand-surface-2">
            Cobertura
          </div>
          <div class="text-sm font-bold mt-1">
            {analysis.summary.liquidity_immediate > 0
              ? (
                  (analysis.summary.liquidity_immediate /
                    analysis.summary.commitments_short_term) *
                  100
                ).toFixed(0)
              : 0}%
          </div>
        </div>
      </div>

      <!-- Medium Term Commitments -->
      <div class="card">
        <h3 class="text-lg font-bold mb-4">31-90 días</h3>
        <div class="text-3xl font-bold text-yellow-400">
          {formatCurrency(analysis.summary.commitments_medium_term)}
        </div>
        <div class="text-xs text-brand-surface-2 mt-2">En compromisos</div>
        <div class="mt-4 pt-4 border-t border-brand-surface-2">
          <div class="text-xs font-semibold text-brand-surface-2">
            Después de corto plazo
          </div>
          <div class="text-sm font-bold mt-1">
            {formatCurrency(
              analysis.summary.liquidity_immediate -
                analysis.summary.commitments_short_term,
            )}
          </div>
        </div>
      </div>
    </div>

    <!-- Commitments Breakdown Table -->
    {#if analysis.commitments_breakdown && analysis.commitments_breakdown.length > 0}
      <div class="card">
        <h2 class="text-xl font-bold mb-4">Obligaciones por rango</h2>
        <div class="space-y-3">
          {#each analysis.commitments_breakdown as range (range.days_range)}
            <div
              class="border-l-4 pl-3 py-2 {range.overdue_amount > 0
                ? 'border-brand-rose'
                : 'border-brand-cyan'}"
            >
              <div class="flex justify-between items-start">
                <div>
                  <div class="font-semibold text-sm">
                    Días {range.days_range}
                  </div>
                  <div class="text-xs text-brand-surface-2">
                    {range.count} compromisos
                  </div>
                  {#if range.overdue_amount > 0}
                    <div class="text-xs text-brand-rose font-semibold mt-1">
                      Vencido: {formatCurrency(range.overdue_amount)}
                    </div>
                  {/if}
                </div>
                <div class="text-right">
                  <div class="font-bold text-lg">
                    {formatCurrency(range.total_amount)}
                  </div>
                  {#if range.pending_amount > 0 && range.overdue_amount > 0}
                    <div class="text-xs text-brand-surface-2 mt-0.5">
                      Pendiente: {formatCurrency(range.pending_amount)}
                    </div>
                  {/if}
                  {#if range.entities && range.entities.length > 0}
                    <div class="text-xs text-brand-surface-2 mt-1">
                      {range.entities.slice(0, 2).join(", ")}
                      {range.entities.length > 2 ? "..." : ""}
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Credit Cards Breakdown -->
    {#if analysis.credit_cards_breakdown && analysis.credit_cards_breakdown.length > 0}
      <div class="card">
        <h2 class="text-xl font-bold mb-4">Detalle de tarjetas</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-b border-brand-surface-2">
              <tr>
                <th class="text-left py-2 px-3">Tarjeta</th>
                <th class="text-right py-2 px-3">Pendiente</th>
                <th class="text-right py-2 px-3">Límite</th>
                <th class="text-right py-2 px-3">Utilización</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-brand-surface-2">
              {#each analysis.credit_cards_breakdown as card (card.card_id)}
                <tr class="hover:bg-brand-surface-2 transition-colors">
                  <td class="py-3 px-3 font-semibold">{card.card_name}</td>
                  <td class="py-3 px-3 text-right text-brand-rose">
                    {formatCurrency(card.outstanding_balance)}
                  </td>
                  <td class="py-3 px-3 text-right">
                    {formatCurrency(card.credit_limit)}
                  </td>
                  <td class="py-3 px-3 text-right">
                    <span
                      class={card.utilization_pct >= 90
                        ? "text-brand-rose"
                        : card.utilization_pct >= 60
                          ? "text-yellow-400"
                          : "text-brand-emerald"}
                    >
                      {card.utilization_pct.toFixed(0)}%
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  details summary {
    list-style: none;
  }
</style>
