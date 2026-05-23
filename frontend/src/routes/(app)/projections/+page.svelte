<script>
  import { onMount } from "svelte";
  import { apiGet } from "$lib/api";
  import { formatCurrency, formatDateDisplay } from "$lib/formatting";

  let projections = null;
  let loading = true;
  let error = null;

  onMount(async () => {
    try {
      projections = await apiGet("/projections");
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  });
</script>

<div class="p-8 space-y-6">
  <div>
    <h1 class="text-4xl font-bold">Commitment Projection</h1>
    <p class="text-brand-surface-2 mt-2">
      Visualize your financial commitments and liquidity forecast
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
      <p class="text-brand-surface-2">Loading projections...</p>
    </div>
  {:else if projections}
    <!-- Summary KPIs -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Total Commitments
        </div>
        <div class="text-3xl font-bold text-brand-cyan">
          {formatCurrency(projections.summary.total_amount)}
        </div>
      </div>

      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Pending
        </div>
        <div class="text-3xl font-bold text-brand-rose">
          {projections.summary.pending_count}
        </div>
      </div>

      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Overdue
        </div>
        <div class="text-3xl font-bold text-brand-rose">
          {projections.summary.overdue_count}
        </div>
      </div>

      <div class="card">
        <div class="text-sm text-brand-surface-2 mb-2 uppercase tracking-wider">
          Reminders (No Occurrences)
        </div>
        <div class="text-3xl font-bold text-brand-cyan">
          {projections.summary.reminders_count || 0}
        </div>
      </div>
    </div>

    <!-- Upcoming Commitments Table -->
    <div class="card">
      <h2 class="text-xl font-bold mb-4">Scheduled Commitments</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="border-b border-brand-surface-2">
            <tr>
              <th class="text-left py-2 px-3">Title</th>
              <th class="text-left py-2 px-3">Entity</th>
              <th class="text-right py-2 px-3">Amount</th>
              <th class="text-left py-2 px-3">Due Date</th>
              <th class="text-left py-2 px-3">Status</th>
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
                    {occurrence.status}
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2 class="text-xl font-bold mb-4">Service Reminders (No Occurrences)</h2>

      {#if !projections.reminders || projections.reminders.length === 0}
        <div class="text-center py-8 text-brand-surface-2">
          No reminder plans without occurrences.
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-b border-brand-surface-2">
              <tr>
                <th class="text-left py-2 px-3">Title</th>
                <th class="text-left py-2 px-3">Entity</th>
                <th class="text-left py-2 px-3">Category</th>
                <th class="text-left py-2 px-3">Till</th>
                <th class="text-right py-2 px-3">Base Amount</th>
                <th class="text-left py-2 px-3">Start Date</th>
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
