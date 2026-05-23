<script>
  import { onMount } from "svelte";
  import { apiGet } from "$lib/api";
  import { formatCurrency, formatDateDisplay } from "$lib/formatting";

  let entities = [];
  let selectedEntity = null;
  let selectedEntityLedger = null;
  let loading = true;
  let detailsLoading = false;
  let error = null;
  let detailsError = null;

  onMount(async () => {
    try {
      entities = await apiGet("/entities");
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  });

  async function selectEntity(entity) {
    selectedEntity = entity;
    selectedEntityLedger = null;
    detailsError = null;
    detailsLoading = true;

    try {
      selectedEntityLedger = await apiGet(`/entities/${entity.id}/ledger`);
    } catch (err) {
      detailsError = err.message;
    } finally {
      detailsLoading = false;
    }
  }
</script>

<div class="p-8 space-y-6">
  <div>
    <h1 class="text-4xl font-bold">Entity Monitor</h1>
    <p class="text-brand-surface-2 mt-2">
      Track clients and providers transactions
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
      <p class="text-brand-surface-2">Loading entities...</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Entities List -->
      <div class="card lg:col-span-1">
        <h2 class="text-lg font-bold mb-4">Entities</h2>
        <div class="space-y-2 max-h-96 overflow-y-auto">
          {#each entities as entity (entity.id)}
            <button
              on:click={() => selectEntity(entity)}
              class="w-full text-left px-4 py-3 rounded hover:bg-brand-surface-2 transition-colors text-sm"
              class:bg-brand-surface-2={selectedEntity?.id === entity.id}
            >
              <div class="font-semibold">{entity.name}</div>
              <div class="text-xs text-brand-surface-2 capitalize">
                {entity.type}
              </div>
            </button>
          {/each}
        </div>
      </div>

      <!-- Entity Details -->
      <div class="lg:col-span-2">
        {#if selectedEntity}
          <div class="space-y-4">
            <!-- Header -->
            <div class="card">
              <div class="flex justify-between items-start">
                <div>
                  <h2 class="text-2xl font-bold">{selectedEntity.name}</h2>
                  <p class="text-sm text-brand-surface-2 capitalize mt-1">
                    {selectedEntity.type}
                  </p>
                  {#if selectedEntity.contact}
                    <p class="text-sm text-brand-surface-2 mt-2">
                      {selectedEntity.contact}
                    </p>
                  {/if}
                </div>
              </div>
            </div>

            <!-- Transactions -->
            <div class="card">
              <h3 class="text-lg font-bold mb-4">Recent Transactions</h3>
              {#if detailsLoading}
                <div class="text-center py-8 text-brand-surface-2">
                  Loading entity ledger...
                </div>
              {:else if detailsError}
                <div
                  class="bg-brand-rose/20 border border-brand-rose rounded-lg p-4 text-brand-rose"
                >
                  Error: {detailsError}
                </div>
              {:else if selectedEntityLedger}
                {#if selectedEntityLedger.transactions.length === 0}
                  <div class="text-center py-8 text-brand-surface-2">
                    No transactions linked to this entity yet.
                  </div>
                {:else}
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
                        {#each selectedEntityLedger.transactions as txn (txn.id)}
                          <tr
                            class="hover:bg-brand-surface-2 transition-colors"
                          >
                            <td class="py-3 px-3">{txn.description || "-"}</td>
                            <td class="py-3 px-3 text-brand-surface-2"
                              >{txn.category || "-"}</td
                            >
                            <td
                              class="py-3 px-3 text-right font-semibold"
                              class:text-brand-emerald={txn.type ===
                                "ingreso" || txn.type === "transferencia"}
                              class:text-brand-rose={txn.type === "egreso"}
                            >
                              {txn.type === "egreso"
                                ? "-"
                                : "+"}{formatCurrency(
                                Math.abs(txn.amount || 0),
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
                {/if}
              {/if}
            </div>

            <!-- Reminder Plans -->
            <div class="card">
              <h3 class="text-lg font-bold mb-4">
                Reminder Plans (No Occurrences)
              </h3>

              {#if detailsLoading}
                <div class="text-center py-8 text-brand-surface-2">
                  Loading reminder plans...
                </div>
              {:else if detailsError}
                <div
                  class="bg-brand-rose/20 border border-brand-rose rounded-lg p-4 text-brand-rose"
                >
                  Error: {detailsError}
                </div>
              {:else if selectedEntityLedger}
                {#if selectedEntityLedger.reminders.length === 0}
                  <div class="text-center py-8 text-brand-surface-2">
                    No reminder plans for this entity.
                  </div>
                {:else}
                  <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                      <thead class="border-b border-brand-surface-2">
                        <tr>
                          <th class="text-left py-2 px-3">Title</th>
                          <th class="text-left py-2 px-3">Category</th>
                          <th class="text-left py-2 px-3">Till</th>
                          <th class="text-right py-2 px-3">Base Amount</th>
                          <th class="text-left py-2 px-3">Start Date</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-brand-surface-2">
                        {#each selectedEntityLedger.reminders as reminder (reminder.id)}
                          <tr
                            class="hover:bg-brand-surface-2 transition-colors"
                          >
                            <td class="py-3 px-3">{reminder.title}</td>
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
                            <td class="py-3 px-3 text-brand-surface-2"
                              >{formatDateDisplay(reminder.start_date)}</td
                            >
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {/if}
              {/if}
            </div>
          </div>
        {:else}
          <div class="card text-center py-12">
            <p class="text-brand-surface-2">Select an entity to view details</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
