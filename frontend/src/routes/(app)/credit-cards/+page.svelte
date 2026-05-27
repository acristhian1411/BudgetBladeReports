<script>
  import { onMount } from "svelte";
  import { apiGet } from "$lib/api";
  import { formatCurrency } from "$lib/formatting";

  let data = null;
  let loading = true;
  let error = null;

  onMount(async () => {
    try {
      data = await apiGet("/dashboard/credit-cards");
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  });

  function utilizationPct(outstanding, limit) {
    if (!limit || limit <= 0) return 0;
    return Math.min(100, (outstanding / limit) * 100);
  }

  function utilizationColor(pct) {
    if (pct >= 90) return "bg-brand-rose";
    if (pct >= 60) return "text-yellow-400";
    return "text-brand-emerald";
  }

  function utilizationBarColor(pct) {
    if (pct >= 90) return "bg-brand-rose";
    if (pct >= 60) return "bg-yellow-400";
    return "bg-brand-emerald";
  }
</script>

<div class="p-8 space-y-6">
  <!-- Header -->
  <div>
    <h1 class="text-4xl font-bold">Tarjetas de Crédito</h1>
    <p class="text-brand-surface-2 mt-2">
      Tarjetas asociadas a cajas y saldos pendientes
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
      <p class="text-brand-surface-2">Cargando tarjetas...</p>
    </div>
  {:else if data}
    {#if data.tills.length === 0}
      <div class="card text-center py-12">
        <p class="text-brand-surface-2 text-lg">
          No hay tarjetas de crédito registradas.
        </p>
        <p class="text-brand-surface-2 text-sm mt-2">
          Sincronizá un backup de NativeBudgetBlade que incluya tarjetas.
        </p>
      </div>
    {:else}
      <!-- Summary KPIs -->
      {@const allCards = data.tills.flatMap((t) => t.credit_cards)}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="card">
          <div
            class="text-xs text-brand-surface-2 uppercase tracking-wider mb-2"
          >
            Total tarjetas
          </div>
          <div class="text-3xl font-bold text-brand-cyan">
            {allCards.length}
          </div>
        </div>
        <div class="card">
          <div
            class="text-xs text-brand-surface-2 uppercase tracking-wider mb-2"
          >
            Saldo pendiente total
          </div>
          <div class="text-3xl font-bold text-brand-rose">
            {formatCurrency(
              allCards.reduce((s, c) => s + c.outstanding_balance, 0),
            )}
          </div>
        </div>
        <div class="card">
          <div
            class="text-xs text-brand-surface-2 uppercase tracking-wider mb-2"
          >
            Límite total
          </div>
          <div class="text-3xl font-bold text-brand-emerald">
            {formatCurrency(allCards.reduce((s, c) => s + c.credit_limit, 0))}
          </div>
        </div>
      </div>

      <!-- Cards grouped by till -->
      <div class="space-y-6">
        {#each data.tills as till (till.till_id)}
          <div class="card space-y-4">
            <!-- Till header -->
            <div
              class="flex items-center gap-3 border-b border-brand-surface-2 pb-3"
            >
              <span
                class="text-2xl"
                title={till.is_bank ? "Banco" : "Efectivo"}
              >
                {till.is_bank ? "🏦" : "💵"}
              </span>
              <div>
                <h2 class="text-lg font-bold">
                  {till.till_name || "Sin nombre"}
                </h2>
                <span
                  class="text-xs rounded-full px-2 py-0.5 font-medium
                  {till.is_bank
                    ? 'bg-brand-cyan/20 text-brand-cyan'
                    : 'bg-brand-emerald/20 text-brand-emerald'}"
                >
                  {till.is_bank ? "Banco" : "Efectivo"}
                </span>
              </div>
              <div class="ml-auto text-sm text-brand-surface-2">
                {till.credit_cards.length}
                {till.credit_cards.length === 1 ? "tarjeta" : "tarjetas"}
              </div>
            </div>

            <!-- Credit card list -->
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {#each till.credit_cards as card (card.id)}
                {@const pct = utilizationPct(
                  card.outstanding_balance,
                  card.credit_limit,
                )}
                <div
                  class="rounded-lg border border-brand-surface-2 p-4 space-y-3"
                >
                  <!-- Card name -->
                  <div class="flex items-start justify-between gap-2">
                    <span class="font-semibold truncate">{card.name}</span>
                    <span
                      class="shrink-0 text-xs font-bold
                      {pct >= 90
                        ? 'text-brand-rose'
                        : pct >= 60
                          ? 'text-yellow-400'
                          : 'text-brand-emerald'}"
                    >
                      {pct.toFixed(0)}%
                    </span>
                  </div>

                  <!-- Utilization bar -->
                  <div class="bg-brand-surface-2 rounded h-2 overflow-hidden">
                    <div
                      class="h-2 rounded transition-all {utilizationBarColor(
                        pct,
                      )}"
                      style="width: {pct}%"
                    />
                  </div>

                  <!-- Amounts -->
                  <div class="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div class="text-xs text-brand-surface-2">Pendiente</div>
                      <div class="font-bold text-brand-rose">
                        {formatCurrency(card.outstanding_balance)}
                      </div>
                    </div>
                    <div>
                      <div class="text-xs text-brand-surface-2">Límite</div>
                      <div class="font-semibold">
                        {formatCurrency(card.credit_limit)}
                      </div>
                    </div>
                    <div>
                      <div class="text-xs text-brand-surface-2">Cargado</div>
                      <div class="font-semibold text-brand-surface-2">
                        {formatCurrency(card.total_charged)}
                      </div>
                    </div>
                    <div>
                      <div class="text-xs text-brand-surface-2">Pagado</div>
                      <div class="font-semibold text-brand-emerald">
                        {formatCurrency(card.total_paid)}
                      </div>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
