<script>
  import { onMount } from "svelte";
  import { apiGet } from "$lib/api";
  import { formatCurrency, formatDateDisplay } from "$lib/formatting";

  const typeOptions = [
    { value: "", label: "Todos" },
    { value: "ingreso", label: "Ingreso" },
    { value: "egreso", label: "Egreso" },
    { value: "transferencia", label: "Transferencia" },
  ];

  let transactions = [];
  let pagination = {
    page: 1,
    limit: 20,
    total: 0,
    pages: 1,
  };

  let loading = true;
  let error = null;

  let selectedType = "";
  let selectedCategoryId = "";
  let selectedTillId = "";
  let selectedLimit = 20;

  let categoryOptions = [];
  let tillOptions = [];

  onMount(async () => {
    await loadTransactions(1);
  });

  async function loadTransactions(page = pagination.page) {
    loading = true;
    error = null;

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(selectedLimit),
      });

      if (selectedType) {
        params.set("type", selectedType);
      }

      if (selectedCategoryId) {
        params.set("category_id", selectedCategoryId);
      }

      if (selectedTillId) {
        params.set("till_id", selectedTillId);
      }

      const response = await apiGet(`/transactions?${params.toString()}`);
      transactions = response.data || [];
      pagination = response.pagination || pagination;

      updateIdOptions(transactions);
    } catch (err) {
      error = err.message;
      transactions = [];
    } finally {
      loading = false;
    }
  }

  function updateIdOptions(rows) {
    const categoryMap = new Map(
      categoryOptions.map((option) => [option.value, option]),
    );
    const tillMap = new Map(
      tillOptions.map((option) => [option.value, option]),
    );

    for (const row of rows) {
      if (row.category_id !== null && row.category_id !== undefined) {
        const value = String(row.category_id);
        if (!categoryMap.has(value)) {
          categoryMap.set(value, {
            value,
            label: row.category_name
              ? `${row.category_name}`
              : `Categoría #${value}`,
          });
        }
      }

      if (row.till_id !== null && row.till_id !== undefined) {
        const value = String(row.till_id);
        if (!tillMap.has(value)) {
          tillMap.set(value, {
            value,
            label: row.till_name ? `${row.till_name}` : `Caja #${value}`,
          });
        }
      }
    }

    categoryOptions = Array.from(categoryMap.values()).sort(
      (a, b) => Number(a.value) - Number(b.value),
    );
    tillOptions = Array.from(tillMap.values()).sort(
      (a, b) => Number(a.value) - Number(b.value),
    );
  }

  async function applyFilters() {
    await loadTransactions(1);
  }

  async function clearFilters() {
    selectedType = "";
    selectedCategoryId = "";
    selectedTillId = "";
    selectedLimit = 20;
    await loadTransactions(1);
  }

  async function goToPage(page) {
    if (page < 1 || page > pagination.pages || page === pagination.page) {
      return;
    }

    await loadTransactions(page);
  }
</script>

<div class="p-8 space-y-6">
  <div>
    <h1 class="text-4xl font-bold">Transactions</h1>
    <p class="text-brand-surface-2 mt-2">
      Listado paginado con filtros por tipo, categoría y caja
    </p>
  </div>

  <div class="card space-y-4">
    <h2 class="text-xl font-bold">Filtros</h2>

    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      <div>
        <label class="block text-sm mb-2" for="type">Tipo</label>
        <select id="type" bind:value={selectedType} class="input-field">
          {#each typeOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      <div>
        <label class="block text-sm mb-2" for="category">Categoría</label>
        <select
          id="category"
          bind:value={selectedCategoryId}
          class="input-field"
        >
          <option value="">Todas</option>
          {#each categoryOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      <div>
        <label class="block text-sm mb-2" for="till">Caja (ID)</label>
        <select id="till" bind:value={selectedTillId} class="input-field">
          <option value="">Todas</option>
          {#each tillOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      <div>
        <label class="block text-sm mb-2" for="limit"
          >Resultados por página</label
        >
        <select id="limit" bind:value={selectedLimit} class="input-field">
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>
    </div>

    <div class="flex flex-wrap gap-3">
      <button class="button-primary" on:click={applyFilters} disabled={loading}>
        Aplicar filtros
      </button>
      <button
        class="button-secondary"
        on:click={clearFilters}
        disabled={loading}
      >
        Limpiar
      </button>
    </div>
  </div>

  {#if error}
    <div
      class="bg-brand-rose/20 border border-brand-rose rounded-lg p-4 text-brand-rose"
    >
      Error: {error}
    </div>
  {/if}

  <div class="card">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-bold">Resultado</h2>
      <p class="text-sm text-brand-surface-2">
        {pagination.total} transacciones
      </p>
    </div>

    {#if loading}
      <div class="text-center py-12">
        <p class="text-brand-surface-2">Cargando transacciones...</p>
      </div>
    {:else if transactions.length === 0}
      <div class="text-center py-12">
        <p class="text-brand-surface-2">
          No hay transacciones para estos filtros.
        </p>
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="border-b border-brand-surface-2">
            <tr>
              <th class="text-left py-2 px-3">Fecha</th>
              <th class="text-left py-2 px-3">Descripción</th>
              <th class="text-left py-2 px-3">Tipo</th>
              <th class="text-left py-2 px-3">Categoría</th>
              <th class="text-left py-2 px-3">Caja</th>
              <th class="text-right py-2 px-3">Monto</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-brand-surface-2">
            {#each transactions as txn (txn.id)}
              <tr class="hover:bg-brand-surface-2 transition-colors">
                <td class="py-3 px-3 text-brand-surface-2"
                  >{formatDateDisplay(txn.transaction_date)}</td
                >
                <td class="py-3 px-3">{txn.description || "-"}</td>
                <td class="py-3 px-3 uppercase text-xs tracking-wider"
                  >{txn.type}</td
                >
                <td class="py-3 px-3 text-brand-surface-2"
                  >{txn.category_name ?? "-"}</td
                >
                <td class="py-3 px-3 text-brand-surface-2"
                  >{txn.till_name ?? "-"}</td
                >
                <td
                  class="py-3 px-3 text-right font-semibold"
                  class:text-brand-emerald={txn.type === "ingreso" ||
                    txn.type === "transferencia"}
                  class:text-brand-rose={txn.type === "egreso"}
                >
                  {txn.type === "egreso" ? "-" : "+"}{formatCurrency(
                    Math.abs(txn.amount || 0),
                  )}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="mt-4 flex items-center justify-between">
        <p class="text-sm text-brand-surface-2">
          Página {pagination.page} de {pagination.pages || 1}
        </p>

        <div class="flex gap-2">
          <button
            class="button-secondary"
            disabled={loading || pagination.page <= 1}
            on:click={() => goToPage(pagination.page - 1)}
          >
            Anterior
          </button>
          <button
            class="button-secondary"
            disabled={loading || pagination.page >= pagination.pages}
            on:click={() => goToPage(pagination.page + 1)}
          >
            Siguiente
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>
