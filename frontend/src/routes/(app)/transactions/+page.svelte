<script>
  import { onMount } from "svelte";
  import { apiGet, apiPost, apiDelete } from "$lib/api";
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
  let selectedStartDate = "";
  let selectedEndDate = "";

  let categoryOptions = [];
  let tillOptions = [];

  let allTills = [];
  let allCategories = [];

  let showForm = false;
  let formMode = "ingreso";
  let formTillId = "";
  let formFromTillId = "";
  let formToTillId = "";
  let formCategoryId = "";
  let formAmount = "";
  let formDescription = "";
  let formDate = new Date().toISOString().split("T")[0];
  let formError = null;
  let saving = false;

  onMount(async () => {
    await Promise.all([loadTransactions(1), loadOptions()]);
  });

  async function loadOptions() {
    try {
      [allTills, allCategories] = await Promise.all([
        apiGet("/tills"),
        apiGet("/categories"),
      ]);
      if (allTills.length > 0) {
        formTillId = String(allTills[0].id);
        formFromTillId = String(allTills[0].id);
        formToTillId = allTills[1] ? String(allTills[1].id) : String(allTills[0].id);
      }
    } catch (err) {
      // Non-critical: options just stay empty.
    }
  }

  async function loadTransactions(page = pagination.page) {
    loading = true;
    error = null;

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(selectedLimit),
      });

      if (selectedStartDate) {
        params.set("start_date", selectedStartDate);
      }
      if (selectedEndDate) {
        params.set("end_date", selectedEndDate);
      }

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
    selectedStartDate = "";
    selectedEndDate = "";
    await loadTransactions(1);
  }

  async function goToPage(page) {
    if (page < 1 || page > pagination.pages || page === pagination.page) {
      return;
    }

    await loadTransactions(page);
  }

  $: formCategories = allCategories.filter((c) =>
    formMode === "ingreso" ? c.type === "income" : c.type === "expense",
  );

  function openCreate() {
    formMode = "ingreso";
    formAmount = "";
    formDescription = "";
    formCategoryId = "";
    formDate = new Date().toISOString().split("T")[0];
    formError = null;
    showForm = true;
  }

  function closeForm() {
    showForm = false;
    formError = null;
  }

  async function submitForm() {
    saving = true;
    formError = null;

    try {
      const amount = Number(formAmount);
      if (!amount || amount <= 0) {
        formError = "Ingresá un monto válido.";
        saving = false;
        return;
      }

      if (formMode === "transferencia") {
        if (!formFromTillId || !formToTillId || formFromTillId === formToTillId) {
          formError = "Seleccioná una caja de origen y una de destino distintas.";
          saving = false;
          return;
        }
        await apiPost("/transactions/transfer", {
          from_till_id: Number(formFromTillId),
          to_till_id: Number(formToTillId),
          amount,
          description: formDescription.trim(),
          date: formDate,
        });
      } else {
        if (!formTillId) {
          formError = "Seleccioná una caja.";
          saving = false;
          return;
        }
        await apiPost("/transactions", {
          till_id: Number(formTillId),
          amount,
          type: formMode,
          description: formDescription.trim(),
          date: formDate,
          category_id: formCategoryId ? Number(formCategoryId) : null,
        });
      }

      closeForm();
      await loadTransactions(1);
    } catch (err) {
      formError = err.message;
    } finally {
      saving = false;
    }
  }

  async function deleteTxn(txn) {
    if (!confirm(`¿Borrar la transacción "${txn.description || txn.type}"?`)) return;
    try {
      await apiDelete(`/transactions/${txn.id}`);
      await loadTransactions();
    } catch (err) {
      error = err.message;
    }
  }
</script>

<div class="p-8 space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-4xl font-bold">Transacciones</h1>
      <p class="text-brand-surface-2 mt-2">
        Listado paginado con filtros por tipo, categoría y caja
      </p>
    </div>
    <button class="button-primary" on:click={openCreate}>+ Nueva transacción</button>
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
        <label class="block text-sm mb-2" for="start_date"
          >Fecha de inicio</label
        >
        <input
          id="start_date"
          type="date"
          bind:value={selectedStartDate}
          class="input-field"
        />
      </div>

      <div>
        <label class="block text-sm mb-2" for="end_date">Fecha de fin</label>
        <input
          id="end_date"
          type="date"
          bind:value={selectedEndDate}
          class="input-field"
        />
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
              <th class="text-right py-2 px-3"></th>
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
                <td class="py-3 px-3 text-right">
                  <button
                    class="text-xs text-brand-rose"
                    on:click={() => deleteTxn(txn)}
                  >
                    Borrar
                  </button>
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

  {#if showForm}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="card w-full max-w-md space-y-4">
        <h2 class="text-xl font-bold">Nueva transacción</h2>

        <div class="flex gap-2">
          <button
            class="flex-1 px-3 py-2 rounded text-sm font-semibold"
            class:bg-brand-emerald={formMode === "ingreso"}
            class:bg-brand-surface-2={formMode !== "ingreso"}
            on:click={() => (formMode = "ingreso")}
          >
            Ingreso
          </button>
          <button
            class="flex-1 px-3 py-2 rounded text-sm font-semibold"
            class:bg-brand-rose={formMode === "egreso"}
            class:bg-brand-surface-2={formMode !== "egreso"}
            on:click={() => (formMode = "egreso")}
          >
            Egreso
          </button>
          <button
            class="flex-1 px-3 py-2 rounded text-sm font-semibold"
            class:bg-brand-cyan={formMode === "transferencia"}
            class:bg-brand-surface-2={formMode !== "transferencia"}
            on:click={() => (formMode = "transferencia")}
          >
            Transferencia
          </button>
        </div>

        {#if formMode === "transferencia"}
          <div>
            <label class="block text-sm mb-2" for="from-till">Caja origen</label>
            <select id="from-till" class="input-field" bind:value={formFromTillId}>
              {#each allTills as till (till.id)}
                <option value={till.id}>{till.name || `Caja #${till.id}`}</option>
              {/each}
            </select>
          </div>
          <div>
            <label class="block text-sm mb-2" for="to-till">Caja destino</label>
            <select id="to-till" class="input-field" bind:value={formToTillId}>
              {#each allTills as till (till.id)}
                <option value={till.id}>{till.name || `Caja #${till.id}`}</option>
              {/each}
            </select>
          </div>
        {:else}
          <div>
            <label class="block text-sm mb-2" for="till">Caja</label>
            <select id="till" class="input-field" bind:value={formTillId}>
              {#each allTills as till (till.id)}
                <option value={till.id}>{till.name || `Caja #${till.id}`}</option>
              {/each}
            </select>
          </div>
          <div>
            <label class="block text-sm mb-2" for="category">Categoría</label>
            <select id="category" class="input-field" bind:value={formCategoryId}>
              <option value="">Sin categoría</option>
              {#each formCategories as category (category.id)}
                <option value={category.id}>{category.name}</option>
              {/each}
            </select>
          </div>
        {/if}

        <div>
          <label class="block text-sm mb-2" for="amount">Monto</label>
          <input id="amount" type="number" step="0.01" min="0" class="input-field" bind:value={formAmount} placeholder="0.00" />
        </div>

        <div>
          <label class="block text-sm mb-2" for="description">Descripción</label>
          <input id="description" class="input-field" bind:value={formDescription} placeholder="Ej: Compra supermercado" />
        </div>

        <div>
          <label class="block text-sm mb-2" for="date">Fecha</label>
          <input id="date" type="date" class="input-field" bind:value={formDate} />
        </div>

        {#if formError}
          <div class="bg-brand-rose/20 border border-brand-rose rounded-lg p-3 text-brand-rose text-sm">
            {formError}
          </div>
        {/if}

        <div class="flex justify-end gap-3">
          <button class="button-secondary" on:click={closeForm} disabled={saving}>Cancelar</button>
          <button class="button-primary" on:click={submitForm} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
