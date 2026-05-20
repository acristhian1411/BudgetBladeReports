<script>
  import { onMount } from 'svelte';
  import { apiGet } from '$lib/api';
  import { formatCurrency, formatDateDisplay } from '$lib/formatting';

  let entities = [];
  let selectedEntity = null;
  let loading = true;
  let error = null;

  onMount(async () => {
    try {
      entities = await apiGet('/entities');
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  });

  async function selectEntity(entity) {
    selectedEntity = entity;
  }
</script>

<div class="p-8 space-y-6">
  <div>
    <h1 class="text-4xl font-bold">Entity Monitor</h1>
    <p class="text-brand-surface-2 mt-2">Track clients and providers transactions</p>
  </div>

  {#if error}
    <div class="bg-brand-rose/20 border border-brand-rose rounded-lg p-4 text-brand-rose">
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
              <div class="text-xs text-brand-surface-2 capitalize">{entity.type}</div>
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
                  <p class="text-sm text-brand-surface-2 capitalize mt-1">{selectedEntity.type}</p>
                  {#if selectedEntity.contact}
                    <p class="text-sm text-brand-surface-2 mt-2">{selectedEntity.contact}</p>
                  {/if}
                </div>
              </div>
            </div>

            <!-- Transactions -->
            <div class="card">
              <h3 class="text-lg font-bold mb-4">Recent Transactions</h3>
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
                    <!-- Note: Would need to fetch ledger data -->
                  </tbody>
                </table>
              </div>
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
