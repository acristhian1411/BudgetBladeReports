<script>
  import { onMount } from "svelte";
  import { apiGet, apiPost, apiPut, apiDelete } from "$lib/api";
  import { formatCurrency, formatDateDisplay } from "$lib/formatting";

  let entities = [];
  let selectedEntity = null;
  let selectedEntityLedger = null;
  let loading = true;
  let detailsLoading = false;
  let error = null;
  let detailsError = null;

  let showForm = false;
  let editingId = null;
  let formName = "";
  let formType = "client";
  let formContact = "";
  let formError = null;
  let saving = false;

  onMount(loadEntities);

  async function loadEntities() {
    loading = true;
    error = null;
    try {
      entities = await apiGet("/entities");
    } catch (err) {
      error = err.message;
      entities = [];
    } finally {
      loading = false;
    }
  }

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

  function openCreate() {
    editingId = null;
    formName = "";
    formType = "client";
    formContact = "";
    formError = null;
    showForm = true;
  }

  function openEdit(entity) {
    editingId = entity.id;
    formName = entity.name || "";
    formType = entity.type || "client";
    formContact = entity.contact || "";
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
    const body = { name: formName.trim(), type: formType, contact: formContact.trim() || null };
    try {
      if (editingId) {
        await apiPut(`/entities/${editingId}`, body);
      } else {
        await apiPost("/entities", body);
      }
      closeForm();
      await loadEntities();
    } catch (err) {
      formError = err.message;
    } finally {
      saving = false;
    }
  }

  async function deleteEntity(entity) {
    if (!confirm(`¿Borrar la entidad "${entity.name}"?`)) return;
    try {
      await apiDelete(`/entities/${entity.id}`);
      if (selectedEntity?.id === entity.id) {
        selectedEntity = null;
        selectedEntityLedger = null;
      }
      await loadEntities();
    } catch (err) {
      error = err.message;
    }
  }
</script>

<div class="p-8 space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-4xl font-bold">Monitor de entidades</h1>
      <p class="text-brand-surface-2 mt-2">
        Seguimiento de transacciones de clientes y proveedores
      </p>
    </div>
    <button class="button-primary" on:click={openCreate}>+ Nueva entidad</button>
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
      <p class="text-brand-surface-2">Cargando entidades...</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Entities List -->
      <div class="card lg:col-span-1">
        <h2 class="text-lg font-bold mb-4">Entidades</h2>
        <div class="space-y-2 max-h-96 overflow-y-auto">
          {#each entities as entity (entity.id)}
            <div
              class="w-full text-left px-4 py-3 rounded hover:bg-brand-surface-2 transition-colors text-sm flex items-start justify-between gap-2"
              class:bg-brand-surface-2={selectedEntity?.id === entity.id}
            >
              <button class="flex-1 text-left" on:click={() => selectEntity(entity)}>
                <div class="font-semibold">{entity.name}</div>
                <div class="text-xs text-brand-surface-2 capitalize">
                  {entity.type}
                </div>
              </button>
              <div class="flex flex-col gap-1">
                <button class="text-xs text-brand-cyan" on:click={() => openEdit(entity)}>Editar</button>
                <button class="text-xs text-brand-rose" on:click={() => deleteEntity(entity)}>Borrar</button>
              </div>
            </div>
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
              <h3 class="text-lg font-bold mb-4">Transacciones recientes</h3>
              {#if detailsLoading}
                <div class="text-center py-8 text-brand-surface-2">
                  Cargando libro mayor de la entidad...
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
                    Todavia no hay transacciones vinculadas a esta entidad.
                  </div>
                {:else}
                  <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                      <thead class="border-b border-brand-surface-2">
                        <tr>
                          <th class="text-left py-2 px-3">Descripcion</th>
                          <th class="text-left py-2 px-3">Categoria</th>
                          <th class="text-right py-2 px-3">Monto</th>
                          <th class="text-left py-2 px-3">Fecha</th>
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
                Planes de recordatorio (sin ocurrencias)
              </h3>

              {#if detailsLoading}
                <div class="text-center py-8 text-brand-surface-2">
                  Cargando planes de recordatorio...
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
                    No hay planes de recordatorio para esta entidad.
                  </div>
                {:else}
                  <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                      <thead class="border-b border-brand-surface-2">
                        <tr>
                          <th class="text-left py-2 px-3">Titulo</th>
                          <th class="text-left py-2 px-3">Categoria</th>
                          <th class="text-left py-2 px-3">Caja</th>
                          <th class="text-right py-2 px-3">Monto base</th>
                          <th class="text-left py-2 px-3">Fecha de inicio</th>
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
            <p class="text-brand-surface-2">
              Selecciona una entidad para ver detalles
            </p>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if showForm}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="card w-full max-w-md space-y-4">
        <h2 class="text-xl font-bold">{editingId ? "Editar entidad" : "Nueva entidad"}</h2>

        <div>
          <label class="block text-sm mb-2" for="entity-name">Nombre</label>
          <input id="entity-name" class="input-field" bind:value={formName} placeholder="Ej: Proveedor SRL" />
        </div>

        <div>
          <label class="block text-sm mb-2" for="entity-type">Tipo</label>
          <select id="entity-type" class="input-field" bind:value={formType}>
            <option value="client">Cliente</option>
            <option value="provider">Proveedor</option>
            <option value="both">Ambos</option>
          </select>
        </div>

        <div>
          <label class="block text-sm mb-2" for="entity-contact">Contacto (opcional)</label>
          <input id="entity-contact" class="input-field" bind:value={formContact} placeholder="Ej: +54 9 11 5555-1234" />
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
