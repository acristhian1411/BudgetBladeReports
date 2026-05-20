<script>
  import { onMount } from "svelte";
  import { apiGet } from "$lib/api";
  import { formatCurrency, formatDateDisplay } from "$lib/formatting";

  let summary = null;
  let loading = true;
  let error = null;

  onMount(async () => {
    try {
      summary = await apiGet("/dashboard/summary");
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  });
</script>

<div class="p-8 space-y-6">
  <!-- Header -->
  <div>
    <h1 class="text-4xl font-bold">Dashboard</h1>
    <p class="text-brand-surface-2 mt-2">Your financial overview at a glance</p>
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
      <p class="text-brand-surface-2">Loading dashboard data...</p>
    </div>
  {:else if summary}
    <!-- KPI Cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <!-- Total Balance -->
      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Total Balance
        </div>
        <div class="text-4xl font-bold text-brand-emerald">
          {formatCurrency(summary.totalBalance)}
        </div>
      </div>

      <!-- Spending This Month -->
      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Upcoming Commitments
        </div>
        <div class="text-3xl font-bold text-brand-rose">
          {summary.upcomingCommitments.length}
        </div>
        <div class="text-xs text-brand-surface-2 mt-2">
          {formatCurrency(
            summary.upcomingCommitments.reduce(
              (sum, c) => sum + (c.amount || 0),
              0,
            ),
          )}
        </div>
      </div>

      <!-- Categories -->
      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Expense Categories
        </div>
        <div class="text-3xl font-bold text-brand-cyan">
          {summary.byCategory.length}
        </div>
      </div>
    </div>

    <!-- Content Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Spending by Category -->
      <div class="lg:col-span-2 card">
        <h2 class="text-xl font-bold mb-4">Top Expense Categories</h2>
        <div class="space-y-3">
          {#each summary.byCategory.slice(0, 8) as category (category.name)}
            <div>
              <div class="flex justify-between items-center mb-1">
                <span class="text-sm">{category.name}</span>
                <span class="text-sm font-semibold"
                  >{formatCurrency(category.total)}</span
                >
              </div>
              <div class="bg-brand-surface-2 rounded h-2">
                <div
                  class="bg-brand-cyan h-2 rounded"
                  style="width: {Math.min(
                    100,
                    (category.total / (summary.byCategory[0]?.total || 1)) *
                      100,
                  )}%"
                />
              </div>
            </div>
          {/each}
        </div>
      </div>

      <!-- Upcoming Commitments -->
      <div class="card">
        <h2 class="text-xl font-bold mb-4">Next Payments</h2>
        <div class="space-y-3">
          {#each summary.upcomingCommitments.slice(0, 5) as commitment (commitment.id)}
            <div class="border-l-2 border-brand-cyan pl-3 py-1">
              <div class="text-sm font-semibold truncate">
                {commitment.title}
              </div>
              <div class="text-xs text-brand-surface-2">
                {formatDateDisplay(commitment.due_date)}
              </div>
              <div class="text-sm font-bold text-brand-rose mt-1">
                {formatCurrency(commitment.amount)}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- Till Balances -->
    <div class="card">
      <h2 class="text-xl font-bold mb-4">Saldo por Caja</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {#each summary.tillBalances as till (till.id)}
          <div
            class="flex items-start gap-3 rounded-lg border border-brand-surface-2 p-4"
          >
            <div
              class="mt-0.5 text-lg"
              title={till.is_bank ? "Banco" : "Efectivo"}
            >
              {till.is_bank ? "🏦" : "💵"}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="font-semibold truncate"
                  >{till.name || "Sin nombre"}</span
                >
                <span
                  class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium
                  {till.is_bank
                    ? 'bg-brand-cyan/20 text-brand-cyan'
                    : 'bg-brand-emerald/20 text-brand-emerald'}"
                >
                  {till.is_bank ? "Banco" : "Efectivo"}
                </span>
              </div>
              <div
                class="mt-2 text-xl font-bold
                {till.balance >= 0 ? 'text-brand-emerald' : 'text-brand-rose'}"
              >
                {formatCurrency(till.balance)}
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Recent Transactions -->
    <div class="card">
      <h2 class="text-xl font-bold mb-4">Recent Transactions</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="border-b border-brand-surface-2">
            <tr>
              <th class="text-left py-2 px-3">Description</th>
              <th class="text-left py-2 px-3">Category</th>
              <th class="text-right py-2 px-3">Amount</th>
              <th class="text-left py-2 px-3">Date</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-brand-surface-2">
            {#each summary.recentTransactions as txn (txn.id)}
              <tr class="hover:bg-brand-surface-2 transition-colors">
                <td class="py-3 px-3 truncate">{txn.description}</td>
                <td class="py-3 px-3 text-brand-surface-2"
                  >{txn.category || "-"}</td
                >
                <td
                  class="py-3 px-3 text-right font-semibold"
                  class:text-brand-emerald={txn.type === "income"}
                  class:text-brand-rose={txn.type === "expense"}
                >
                  {txn.type === "income" ? "+" : "-"}{formatCurrency(
                    Math.abs(txn.amount),
                  )}
                </td>
                <td class="py-3 px-3 text-brand-surface-2"
                  >{formatDateDisplay(txn.transaction_date)}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>
