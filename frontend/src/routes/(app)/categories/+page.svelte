<script>
  import { onMount } from "svelte";
  import { apiGet, apiPost, apiPut, apiDelete } from "$lib/api";

  let categories = [];
  let loading = true;
  let error = null;

  let showForm = false;
  let editingId = null;
  let formName = "";
  let formType = "expense";
  let formError = null;
  let saving = false;

  onMount(loadCategories);

  async function loadCategories() {
    loading = true;
    error = null;
    try {
      categories = await apiGet("/categories");
    } catch (err) {
      error = err.message;
      categories = [];
    } finally {
      loading = false;
    }
  }

  $: expenseCategories = categories.filter((c) => c.type === "expense");
  $: incomeCategories = categories.filter((c) => c.type === "income");

  function openCreate(type = "expense") {
    editingId = null;
    formName = "";
    formType = type;
    formError = null;
    showForm = true;
  }

  function openEdit(category) {
    editingId = category.id;
    formName = category.name;
    formType = category.type;
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
    const body = { name: formName.trim(), type: formType };
    try {
      if (editingId) {
        await apiPut(`/categories/${editingId}`, body);
      } else {
        await apiPost("/categories", body);
      }
      closeForm();
      await loadCategories();
    } catch (err) {
      formError = err.message;
    } finally {
      saving = false;
    }
  }

  async function deleteCategory(category) {
    if (!confirm(`¿Borrar la categoría "${category.name}"?`)) return;
    try {
      await apiDelete(`/categories/${category.id}`);
      await loadCategories();
    } catch (err) {
      error = err.message;
    }
  }
</script>

<div class="p-8 space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-4xl font-bold">Categorías</h1>
      <p class="text-brand-surface-2 mt-2">Rubros de ingresos y egresos</p>
    </div>
    <button class="button-primary" on:click={() => openCreate()}>+ Nueva categoría</button>
  </div>

  {#if error}
    <div class="bg-brand-rose/20 border border-brand-rose rounded-lg p-4 text-brand-rose">
      Error: {error}
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12">
      <p class="text-brand-surface-2">Cargando categorías...</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="card">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold text-brand-rose">Egresos</h2>
          <button class="button-secondary text-xs px-3 py-1" on:click={() => openCreate('expense')}>
            + Agregar
          </button>
        </div>
        <div class="space-y-2">
          {#each expenseCategories as category (category.id)}
            <div class="flex items-center justify-between rounded px-3 py-2 hover:bg-brand-surface-2">
              <span class="text-sm">{category.name}</span>
              <div class="flex gap-2">
                <button class="text-xs text-brand-cyan" on:click={() => openEdit(category)}>Editar</button>
                <button class="text-xs text-brand-rose" on:click={() => deleteCategory(category)}>Borrar</button>
              </div>
            </div>
          {/each}
        </div>
      </div>

      <div class="card">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold text-brand-emerald">Ingresos</h2>
          <button class="button-secondary text-xs px-3 py-1" on:click={() => openCreate('income')}>
            + Agregar
          </button>
        </div>
        <div class="space-y-2">
          {#each incomeCategories as category (category.id)}
            <div class="flex items-center justify-between rounded px-3 py-2 hover:bg-brand-surface-2">
              <span class="text-sm">{category.name}</span>
              <div class="flex gap-2">
                <button class="text-xs text-brand-cyan" on:click={() => openEdit(category)}>Editar</button>
                <button class="text-xs text-brand-rose" on:click={() => deleteCategory(category)}>Borrar</button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  {#if showForm}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="card w-full max-w-md space-y-4">
        <h2 class="text-xl font-bold">{editingId ? "Editar categoría" : "Nueva categoría"}</h2>

        <div>
          <label class="block text-sm mb-2" for="cat-name">Nombre</label>
          <input id="cat-name" class="input-field" bind:value={formName} placeholder="Ej: Combustible" />
        </div>

        <div>
          <label class="block text-sm mb-2" for="cat-type">Tipo</label>
          <select id="cat-type" class="input-field" bind:value={formType}>
            <option value="expense">Egreso</option>
            <option value="income">Ingreso</option>
          </select>
        </div>

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
