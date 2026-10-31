<script>
  import { formatCurrency, formatDateDisplay, formatNumber } from "$lib/formatting";

  export let summary = null;
  export let loading = false;
  export let error = null;

  const COLORS = [
    "#2AA98F",
    "#E0742B",
    "#4C6FD1",
    "#C9A21A",
    "#B04A9E",
    "#D2472B",
    "#5E8C2E",
    "#7A6A5C",
  ];

  function buildSegments(list, total) {
    const rows = list.slice(0, 5).map((category, index) => ({
      label: category.name || "Sin categoría",
      amount: category.total,
      count: category.count || 0,
      color: COLORS[index],
    }));

    const rest = list.slice(5);
    if (rest.length) {
      rows.push({
        label: "Otros",
        amount: rest.reduce((sum, category) => sum + category.total, 0),
        count: rest.reduce((sum, category) => sum + (category.count || 0), 0),
        color: COLORS[5],
      });
    }

    let offset = 0;
    return rows.map((row) => {
      const percent = total ? (row.amount / total) * 100 : 0;
      const segment = { ...row, percent, offset };
      offset += percent;
      return segment;
    });
  }

  $: income = summary?.totalIncome || 0;
  $: expense = summary?.totalExpense || 0;
  $: net = income - expense;
  $: categories = summary?.byCategory || [];
  $: segments = buildSegments(categories, expense);
  $: transactions = (summary?.recentTransactions || []).slice(0, 5);
  $: commitments = (summary?.upcomingCommitments || []).slice(0, 3);

  const amountLabel = (txn) => {
    const value = formatCurrency(Math.abs(txn.amount));
    if (txn.type === "ingreso") return `+${value}`;
    if (txn.type === "egreso") return `−${value}`;
    return `⇄ ${value}`;
  };

  const amountClass = (type) =>
    type === "ingreso"
      ? "text-brand-emerald"
      : type === "egreso"
        ? "text-brand-rose"
        : "text-brand-surface-2";
</script>

<div class="md:hidden space-y-4">
  {#if error}
    <div
      class="bg-brand-rose/20 border border-brand-rose rounded-lg p-4 text-brand-rose text-sm"
    >
      Error: {error}
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12">
      <p class="text-brand-surface-2">Cargando datos del panel...</p>
    </div>
  {:else if summary}
    <div>
      <h1 class="text-2xl font-bold">Finanzas</h1>
      <p class="text-sm text-brand-surface-2 mt-1">
        Tu resumen financiero de un vistazo
      </p>
    </div>

    <!-- Cajas -->
    {#if summary.tillBalances?.length}
      <div
        class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6"
      >
        {#each summary.tillBalances as till (till.id)}
          <a
            href="/tills"
            class="min-w-[140px] rounded-xl border border-brand-surface-2 bg-brand-surface-1 p-3"
          >
            <span class="block truncate text-xs text-brand-surface-2"
              >{till.name || "Sin nombre"}</span
            >
            <span
              class="mt-1 block whitespace-nowrap text-base font-bold {till.balance >=
              0
                ? 'text-brand-emerald'
                : 'text-brand-rose'}"
            >
              {formatCurrency(till.balance)}
            </span>
            <span class="text-[11px] text-brand-surface-2"
              >{till.is_bank ? "Banco" : "Efectivo"}</span
            >
          </a>
        {/each}
      </div>
    {/if}

    <!-- Resumen -->
    <div>
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-brand-surface-2">Resumen</h2>
        <span class="text-[11px] text-brand-surface-2">Histórico</span>
      </div>
      <div class="grid grid-cols-3 gap-2 text-center">
        <div
          class="rounded-xl border border-brand-surface-2 bg-brand-surface-1 p-3"
        >
          <div class="text-[10px] uppercase tracking-wide text-brand-surface-2">
            Ingresos
          </div>
          <div class="mt-1 text-sm font-bold text-brand-emerald">
            {formatCurrency(income)}
          </div>
        </div>
        <div
          class="rounded-xl border border-brand-surface-2 bg-brand-surface-1 p-3"
        >
          <div class="text-[10px] uppercase tracking-wide text-brand-surface-2">
            Gastos
          </div>
          <div class="mt-1 text-sm font-bold text-brand-rose">
            {formatCurrency(expense)}
          </div>
        </div>
        <div
          class="rounded-xl border border-brand-surface-2 bg-brand-surface-1 p-3"
        >
          <div class="text-[10px] uppercase tracking-wide text-brand-surface-2">
            Neto
          </div>
          <div
            class="mt-1 text-sm font-bold {net >= 0
              ? 'text-brand-emerald'
              : 'text-brand-rose'}"
          >
            {formatCurrency(net)}
          </div>
        </div>
      </div>
    </div>

    <!-- Próximos pagos -->
    {#if commitments.length}
      <section>
        <div class="mb-2 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-brand-surface-2">
            Próximos pagos
          </h2>
          <a href="/compromisos" class="text-xs">Ver todos</a>
        </div>
        <div
          class="rounded-xl border border-brand-surface-2 bg-brand-surface-1"
        >
          {#each commitments as commitment (commitment.id)}
            <a
              href="/compromisos"
              class="flex items-center justify-between gap-3 border-b border-brand-surface-2 px-3 py-2.5 last:border-b-0"
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-semibold"
                  >{commitment.title}</span
                >
                <span class="block text-[11px] text-brand-surface-2"
                  >{formatDateDisplay(commitment.due_date)}</span
                >
              </span>
              <span class="shrink-0 text-sm font-bold text-brand-rose">
                {formatCurrency(commitment.amount)}
              </span>
            </a>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Por categoría -->
    <section>
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-brand-surface-2">
          Por categoría
        </h2>
        <a href="/categories" class="text-xs">Ver todas</a>
      </div>
      <div
        class="rounded-xl border border-brand-surface-2 bg-brand-surface-1 p-3"
      >
        {#if segments.length}
          <svg
            viewBox="0 0 42 42"
            class="mx-auto block w-44"
            role="img"
            aria-label="Distribución de gastos por categoría"
          >
            <circle
              cx="21"
              cy="21"
              r="15.9"
              fill="none"
              class="stroke-brand-surface-2"
              stroke-width="7"
            />
            {#each segments as segment (segment.label)}
              <circle
                cx="21"
                cy="21"
                r="15.9"
                fill="none"
                stroke={segment.color}
                stroke-width="7"
                stroke-dasharray="{Math.max(
                  segment.percent - 0.5,
                  0.1,
                )} {100 - Math.max(segment.percent - 0.5, 0.1)}"
                stroke-dashoffset="{25 - segment.offset}"
              />
            {/each}
            <text
              x="21"
              y="19.3"
              text-anchor="middle"
              fill="currentColor"
              class="text-brand-surface-2"
              font-size="3.2">Total</text
            >
            <text
              x="21"
              y="24.2"
              text-anchor="middle"
              fill="currentColor"
              class="text-white"
              font-size="3.6"
              font-weight="700">{formatNumber(expense)}</text
            >
          </svg>

          <div class="mt-2">
            {#each segments as segment (segment.label)}
              <div
                class="border-t border-brand-surface-2 py-2 first:border-t-0"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      class="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                      style="background: {segment.color}"
                    ></span>
                    <span class="truncate text-sm"
                      >{segment.label}
                      <span class="text-brand-surface-2"
                        >· {segment.count}</span
                      ></span
                    >
                  </div>
                  <div class="shrink-0 text-right">
                    <div class="text-sm font-bold">
                      {formatNumber(segment.amount)}
                    </div>
                    <div class="text-[11px] text-brand-surface-2">
                      {Math.round(segment.percent)}%
                    </div>
                  </div>
                </div>
                <div
                  class="mt-1 h-1 overflow-hidden rounded bg-brand-surface-2"
                >
                  <div
                    class="h-full rounded"
                    style="width: {Math.min(
                      segment.percent,
                      100,
                    )}%; background: {segment.color}"
                  ></div>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-brand-surface-2">Sin gastos registrados.</p>
        {/if}
      </div>
    </section>

    <!-- Últimos movimientos -->
    <section>
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-brand-surface-2">
          Últimos movimientos
        </h2>
        <a href="/transactions" class="text-xs">Ver todos</a>
      </div>
      <div
        class="rounded-xl border border-brand-surface-2 bg-brand-surface-1"
      >
        {#each transactions as txn (txn.id)}
          <a
            href="/transactions"
            class="flex items-start justify-between gap-3 border-b border-brand-surface-2 px-3 py-2.5 last:border-b-0"
          >
            <span class="min-w-0">
              <span class="block truncate text-sm font-semibold"
                >{txn.description || "Sin descripción"}</span
              >
              <span class="block text-[11px] text-brand-surface-2">
                {txn.category || "Sin categoría"} · {formatDateDisplay(
                  txn.transaction_date,
                )}
              </span>
            </span>
            <span
              class="shrink-0 text-sm font-bold {amountClass(txn.type)}"
            >
              {amountLabel(txn)}
            </span>
          </a>
        {:else}
          <p class="px-3 py-2 text-sm text-brand-surface-2">
            Sin movimientos.
          </p>
        {/each}
      </div>
    </section>
  {/if}
</div>
