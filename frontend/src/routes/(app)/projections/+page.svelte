<script>
  import { onDestroy, onMount, tick } from "svelte";
  import { apiGet } from "$lib/api";
  import { formatCurrency, formatDateDisplay } from "$lib/formatting";

  let projections = null;
  let loading = true;
  let error = null;
  let chartData = null;
  let chartOptions = null;
  let valleyInfo = null;
  let forecastCanvas;
  let forecastChart = null;

  onMount(async () => {
    try {
      projections = await apiGet("/projections");
      setupForecastChart(projections?.forecast || []);
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;

      await tick();
      await renderForecastChart();
    }
  });

  onDestroy(() => {
    if (forecastChart) {
      forecastChart.destroy();
    }
  });

  function setupForecastChart(forecast) {
    if (!Array.isArray(forecast) || forecast.length === 0) {
      chartData = null;
      chartOptions = null;
      valleyInfo = null;
      return;
    }

    const labels = forecast.map((d) => formatDateDisplay(d.date));
    const cumulativeValues = forecast.map(
      (d) => Number(d.cumulativeBalance) || 0,
    );
    const valleyIndex = cumulativeValues.reduce(
      (minIdx, value, idx, arr) => (value < arr[minIdx] ? idx : minIdx),
      0,
    );

    const valleyPointData = cumulativeValues.map((value, idx) =>
      idx === valleyIndex ? value : null,
    );

    valleyInfo = {
      date: forecast[valleyIndex].date,
      cumulativeBalance: cumulativeValues[valleyIndex],
      amount: Number(forecast[valleyIndex].amount) || 0,
      count: Number(forecast[valleyIndex].count) || 0,
    };

    chartData = {
      labels,
      datasets: [
        {
          label: "Acumulado de compromisos",
          data: cumulativeValues,
          borderColor: "#06b6d4",
          backgroundColor: "rgba(6, 182, 212, 0.15)",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.25,
          fill: true,
        },
        {
          label: "Valle de liquidez",
          data: valleyPointData,
          borderColor: "#f43f5e",
          backgroundColor: "#f43f5e",
          borderWidth: 0,
          showLine: false,
          pointRadius: 6,
          pointHoverRadius: 8,
        },
      ],
    };

    chartOptions = {
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
              return formatDateDisplay(forecast[idx].date);
            },
            label(context) {
              if (context.datasetIndex === 1) {
                return `Valle: ${formatCurrency(context.parsed.y || 0)}`;
              }
              return `Acumulado: ${formatCurrency(context.parsed.y || 0)}`;
            },
            afterBody(items) {
              const idx = items?.[0]?.dataIndex ?? 0;
              const day = forecast[idx] || { amount: 0, count: 0 };
              return [
                `Compromisos del dia: ${formatCurrency(Number(day.amount) || 0)}`,
                `Cantidad de compromisos: ${Number(day.count) || 0}`,
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
    };
  }

  async function renderForecastChart() {
    if (!forecastCanvas || !chartData || !chartOptions) {
      return;
    }

    const { Chart, registerables } = await import("chart.js");
    Chart.register(...registerables);

    if (forecastChart) {
      forecastChart.destroy();
    }

    forecastChart = new Chart(forecastCanvas, {
      type: "line",
      data: chartData,
      options: chartOptions,
    });
  }
</script>

<div class="p-8 space-y-6">
  <div>
    <h1 class="text-4xl font-bold">Proyeccion de compromisos</h1>
    <p class="text-brand-surface-2 mt-2">
      Visualiza tus compromisos financieros y el pronostico de liquidez
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
      <p class="text-brand-surface-2">Cargando proyecciones...</p>
    </div>
  {:else if projections}
    <!-- Summary KPIs -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Compromisos totales
        </div>
        <div class="text-3xl font-bold text-brand-cyan">
          {formatCurrency(projections.summary.total_amount)}
        </div>
      </div>

      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Pendientes
        </div>
        <div class="text-3xl font-bold text-brand-rose">
          {projections.summary.pending_count}
        </div>
      </div>

      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Vencidos
        </div>
        <div class="text-3xl font-bold text-brand-rose">
          {projections.summary.overdue_count}
        </div>
      </div>

      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Recordatorios (sin ocurrencias)
        </div>
        <div class="text-3xl font-bold text-brand-cyan">
          {projections.summary.reminders_count || 0}
        </div>
      </div>
    </div>

    <!-- Liquidity Forecast Chart -->
    <div class="card">
      <div
        class="flex flex-col gap-1 md:flex-row md:items-center md:justify-between mb-4"
      >
        <div>
          <h2 class="text-xl font-bold">Forecast de liquidez (180 dias)</h2>
          <p class="text-sm text-brand-surface-2">
            Acumulado de compromisos proyectados por fecha
          </p>
        </div>
        {#if valleyInfo}
          <div class="text-sm text-brand-surface-2">
            Valle: <span class="font-semibold text-brand-rose"
              >{formatDateDisplay(valleyInfo.date)}</span
            >
            ({formatCurrency(valleyInfo.cumulativeBalance)})
          </div>
        {/if}
      </div>

      {#if chartData && chartOptions}
        <div class="h-80">
          <canvas bind:this={forecastCanvas} />
        </div>
      {:else}
        <div class="text-center py-8 text-brand-surface-2">
          No hay datos suficientes para generar el forecast.
        </div>
      {/if}
    </div>

    <!-- Upcoming Commitments Table -->
    <div class="card">
      <h2 class="text-xl font-bold mb-4">Compromisos programados</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="border-b border-brand-surface-2">
            <tr>
              <th class="text-left py-2 px-3">Titulo</th>
              <th class="text-left py-2 px-3">Entidad</th>
              <th class="text-right py-2 px-3">Monto</th>
              <th class="text-left py-2 px-3">Vencimiento</th>
              <th class="text-left py-2 px-3">Estado</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-brand-surface-2">
            {#each projections.occurrences.slice(0, 20) as occurrence (occurrence.id)}
              <tr class="hover:bg-brand-surface-2 transition-colors">
                <td class="py-3 px-3">{occurrence.title}</td>
                <td class="py-3 px-3 text-brand-surface-2"
                  >{occurrence.entity_name || "-"}</td
                >
                <td class="py-3 px-3 text-right font-semibold text-brand-rose">
                  {formatCurrency(occurrence.amount)}
                </td>
                <td class="py-3 px-3"
                  >{formatDateDisplay(occurrence.due_date)}</td
                >
                <td class="py-3 px-3">
                  <span
                    class="px-2 py-1 rounded text-xs font-semibold
                      {occurrence.status === 'processed'
                      ? 'bg-brand-emerald/20 text-brand-emerald'
                      : ''}
                      {occurrence.status === 'pending'
                      ? 'bg-brand-cyan/20 text-brand-cyan'
                      : ''}
                      {occurrence.status === 'overdue'
                      ? 'bg-brand-rose/20 text-brand-rose'
                      : ''}"
                  >
                    {occurrence.status === "processed"
                      ? "Procesado"
                      : occurrence.status === "pending"
                        ? "Pendiente"
                        : occurrence.status === "overdue"
                          ? "Vencido"
                          : occurrence.status}
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2 class="text-xl font-bold mb-4">
        Recordatorios de servicios (sin ocurrencias)
      </h2>

      {#if !projections.reminders || projections.reminders.length === 0}
        <div class="text-center py-8 text-brand-surface-2">
          No hay planes de recordatorio sin ocurrencias.
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-b border-brand-surface-2">
              <tr>
                <th class="text-left py-2 px-3">Titulo</th>
                <th class="text-left py-2 px-3">Entidad</th>
                <th class="text-left py-2 px-3">Categoria</th>
                <th class="text-left py-2 px-3">Caja</th>
                <th class="text-right py-2 px-3">Monto base</th>
                <th class="text-left py-2 px-3">Fecha de inicio</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-brand-surface-2">
              {#each projections.reminders as reminder (reminder.id)}
                <tr class="hover:bg-brand-surface-2 transition-colors">
                  <td class="py-3 px-3">{reminder.title}</td>
                  <td class="py-3 px-3 text-brand-surface-2"
                    >{reminder.entity_name || "-"}</td
                  >
                  <td class="py-3 px-3 text-brand-surface-2"
                    >{reminder.category_name || "-"}</td
                  >
                  <td class="py-3 px-3 text-brand-surface-2"
                    >{reminder.till_name || "-"}</td
                  >
                  <td
                    class="py-3 px-3 text-right font-semibold text-brand-cyan"
                  >
                    {reminder.base_amount === null
                      ? "Variable"
                      : formatCurrency(reminder.base_amount)}
                  </td>
                  <td class="py-3 px-3"
                    >{formatDateDisplay(reminder.start_date)}</td
                  >
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</div>
