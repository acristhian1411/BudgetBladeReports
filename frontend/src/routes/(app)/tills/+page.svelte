<script>
  import { onMount } from "svelte";
  import { apiGet, apiPost, apiPut, apiDelete } from "$lib/api";
  import { formatCurrency } from "$lib/formatting";

  let tills = [];
  let loading = true;
  let error = null;

  let showForm = false;
  let editingId = null;
  let formName = "";
  let formAccountNumber = "";
  let formIsBank = false;
  let formError = null;
  let saving = false;

  onMount(loadTills);

  async function loadTills() {
    loading = true;
    error = null;
    try {
      tills = await apiGet("/tills");
    } catch (err) {
      error = err.message;
      tills = [];
    } finally {
      loading = false;
    }
  }

  function openCreate() {
    editingId = null;
    formName = "";
    formAccountNumber = "";
    formIsBank = false;
    formError = null;
    showForm = true;
  }

  function openEdit(till) {
    editingId = till.id;
    formName = till.name || "";
    formAccountNumber = till.account_number || "";
    formIsBank = Boolean(till.is_bank);
    formError = null;
    showForm = true;
  }

  function closeForm() {
    showForm = false;
    editingId = null;
    formError = null;
  }

  async function submitForm() {
    saving = true;
    formError = null;
    const body = {
      name: formName.trim(),
      account_number: formAccountNumber.trim() || null,
      is_bank: formIsBank,
    };
    try {
      if (editingId) {
        await apiPut(`/tills/${editingId}`, body);
      } else {
        await apiPost("/tills", body);
      }
      closeForm();
      await loadTills();
    } catch (err) {
      formError = err.message;
    } finally {
      saving = false;
    }
  }

  async function deleteTill(till) {
    if (!confirm(`¿Borrar la caja "${till.name}"?`)) return;
    try {
      await apiDelete(`/tills/${till.id}`);
      await loadTills();
    } catch (err) {
      error = err.message;
    }
  }
</script>

<div class="p-8 space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-4xl font-bold">Cajas</h1>
      <p class="text-brand-surface-2 mt-2">
        Cuentas y cajas (banco o efectivo) con su saldo
      </p>
    </div>
    <button class="button-primary" on:click={openCreate}>+ Nueva caja</button>
  </div>

  {#if error}
    <div class="bg-brand-rose/20 border border-brand-rose rounded-lg p-4 text-brand-rose">
      Error: {error}
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12">
      <p class="text-brand-surface-2">Cargando cajas...</p>
    </div>
  {:else if tills.length === 0}
    <div class="card text-center py-12">
      <p class="text-brand-surface-2 text-lg">No hay cajas registradas.</p>
      <p class="text-brand-surface-2 text-sm mt-2">Creá una para empezar.</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {#each tills as till (till.id)}
        <div class="card flex items-start gap-3">
          <div class="mt-0.5 text-lg" title={till.is_bank ? "Banco" : "Efectivo"}>
            {till.is_bank ? "🏦" : "💵"}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-semibold truncate">{till.name || "Sin nombre"}</span>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium
                {till.is_bank ? 'bg-brand-cyan/20 text-brand-cyan' : 'bg-brand-emerald/20 text-brand-emerald'}"
              >
                {till.is_bank ? "Banco" : "Efectivo"}
              </span>
            </div>
            {#if till.account_number}
              <div class="text-xs text-brand-surface-2 mt-1">{till.account_number}</div>
            {/if}
            <div
              class="mt-2 text-xl font-bold
              {till.balance >= 0 ? 'text-brand-emerald' : 'text-brand-rose'}"
            >
              {formatCurrency(till.balance)}
            </div>
            <div class="mt-3 flex gap-2">
              <button class="button-secondary text-xs px-3 py-1" on:click={() => openEdit(till)}>
                Editar
              </button>
              <button
                class="px-3 py-1 text-xs font-semibold rounded bg-brand-rose text-white hover:opacity-90"
                on:click={() => deleteTill(till)}
              >
                Borrar
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if showForm}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="card w-full max-w-md space-y-4">
        <h2 class="text-xl font-bold">{editingId ? "Editar caja" : "Nueva caja"}</h2>

        <div>
          <label class="block text-sm mb-2" for="till-name">Nombre</label>
          <input id="till-name" class="input-field" bind:value={formName} placeholder="Ej: Cuenta sueldo" />
        </div>

        <div>
          <label class="block text-sm mb-2" for="till-account">Número de cuenta (opcional)</label>
          <input id="till-account" class="input-field" bind:value={formAccountNumber} placeholder="Ej: 001-234567-8" />
        </div>

        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" class="w-4 h-4" bind:checked={formIsBank} />
          <span class="text-sm">Es una cuenta bancaria</span>
        </label>

        {#if formError}
          <div class="bg-brand-rose/20 border border-brand-rose rounded-lg p-3 text-brand-rose text-sm">
            {formError}
          </div>
        {/if}

        <div class="flex justify-end gap-3">
          <button class="button-secondary" on:click={closeForm} disabled={saving}>Cancelar</button>
          <button class="button-primary" on:click={submitForm} disabled={saving || !formName.trim()}>
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
