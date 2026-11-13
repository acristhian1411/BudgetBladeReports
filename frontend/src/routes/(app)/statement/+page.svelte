<script>
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import {
    apiGet,
    parseStatement,
    mapStatementImport,
    getStatementImports,
    getStatementImport,
    assignStatementRows,
    importStatement,
    deleteStatementImport,
  } from "$lib/api";
  import { formatCurrency } from "$lib/formatting";
  import ColumnMapping from "$lib/components/ColumnMapping.svelte";

  const tillId = Number($page.url.searchParams.get("till"));

  let till = null;
  let categories = [];
  let imports = [];
  let file = null;
  let loading = false;
  let saving = false;
  let error = "";
  let message = "";

  // 'upload' | 'mapping' | 'review'
  let step = "upload";
  let importId = null;
  let columns = [];
  let preview = [];
  let detected = null;
  let rows = [];

  let selectedRows = new Set();
  let bulkCategoryId = "";

  onMount(async () => {
    if (!tillId) {
      error = "Falta la caja";
      return;
    }
    await Promise.all([loadTill(), loadCategories(), loadImports()]);
  });

  async function loadTill() {
    try {
      const tills = await apiGet("/tills");
      till = tills.find((t) => t.id === tillId) ?? null;
      if (!till) error = "Caja no encontrada";
    } catch (err) {
      error = err.message;
    }
  }

  async function loadCategories() {
    try {
      categories = await apiGet("/categories");
    } catch (err) {
      // non-critical
    }
  }

  async function loadImports() {
    try {
      imports = await getStatementImports(tillId);
    } catch (err) {
      // non-critical
    }
  }

  function categoriesFor(type) {
    const wanted = type === "ingreso" ? "income" : "expense";
    return categories.filter((c) => c.type === wanted);
  }

  function displayAmount(row) {
    const sign = row.type === "egreso" ? "-" : "+";
    return `${sign} ${formatCurrency(row.amount)}`;
  }

  function toMappingState(rawGrid, mapping) {
    const headerRow = mapping?.header_row ?? 0;
    columns = (rawGrid[headerRow] ?? []).map((cell, index) => ({ index, header: cell }));
    preview = rawGrid.slice(headerRow + 1, headerRow + 9);
    detected = mapping;
  }

  async function handleParse() {
    if (!file) return;
    loading = true;
    error = "";
    message = "";
    try {
      const result = await parseStatement(file, tillId);
      importId = result.import_id;
      if (result.needs_mapping) {
        columns = result.columns;
        preview = result.preview;
        detected = result.detected;
        step = "mapping";
      } else {
        rows = result.rows;
        step = "review";
        message = `${result.rows.length} movimientos detectados`;
      }
      await loadImports();
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function handleMap(event) {
    saving = true;
    error = "";
    try {
      const result = await mapStatementImport(importId, event.detail.mapping, event.detail.saveTemplate);
      rows = result.rows;
      step = "review";
      message = `${result.rows.length} movimientos detectados`;
      await loadImports();
    } catch (err) {
      error = err.message;
    } finally {
      saving = false;
    }
  }

  async function openImport(id) {
    loading = true;
    error = "";
    try {
      const result = await getStatementImport(id);
      importId = result.id;
      if (result.status === "mapping" && result.raw_grid) {
        toMappingState(result.raw_grid, result.detected);
        step = "mapping";
      } else {
        rows = result.rows;
        step = "review";
      }
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function remap() {
    loading = true;
    error = "";
    try {
      const result = await getStatementImport(importId);
      if (result.raw_grid) {
        toMappingState(result.raw_grid, result.detected);
        step = "mapping";
      }
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function handleDelete(id) {
    try {
      await deleteStatementImport(id);
      if (importId === id) {
        importId = null;
        step = "upload";
      }
      await loadImports();
    } catch (err) {
      error = err.message;
    }
  }

  async function setCategory(row, categoryId) {
    saving = true;
    error = "";
    try {
      const result = await assignStatementRows(importId, [
        { id: row.id, category_id: categoryId ? Number(categoryId) : null },
      ]);
      rows = result.rows;
    } catch (err) {
      error = err.message;
    } finally {
      saving = false;
    }
  }

  function toggleRow(id) {
    selectedRows = new Set(selectedRows);
    if (selectedRows.has(id)) selectedRows.delete(id);
    else selectedRows.add(id);
  }

  function toggleAll() {
    const editable = rows.filter((r) => !r.imported).map((r) => r.id);
    const allSelected = editable.every((id) => selectedRows.has(id));
    selectedRows = new Set(allSelected ? [] : editable);
  }

  async function applyBulkCategory() {
    if (!bulkCategoryId || selectedRows.size === 0) return;
    const cat = categories.find((c) => String(c.id) === bulkCategoryId);
    const assignments = [];
    for (const row of rows) {
      if (!selectedRows.has(row.id) || row.imported) continue;
      const wanted = row.type === "ingreso" ? "income" : "expense";
      if (cat.type === wanted) assignments.push({ id: row.id, category_id: cat.id });
    }
    if (assignments.length === 0) {
      error = "La categoría no coincide con el tipo de las filas seleccionadas";
      return;
    }
    saving = true;
    error = "";
    try {
      const result = await assignStatementRows(importId, assignments);
      rows = result.rows;
      selectedRows = new Set();
      bulkCategoryId = "";
      message = `Categoría asignada a ${assignments.length} fila(s)`;
    } catch (err) {
      error = err.message;
    } finally {
      saving = false;
    }
  }

  async function handleImport() {
    saving = true;
    error = "";
    try {
      const result = await importStatement(importId);
      message = `Importadas ${result.imported} transacción(es)${
        result.pending ? `, ${result.pending} pendientes de categoría` : ""
      }`;
      if (result.pending > 0) {
        const current = await getStatementImport(importId);
        rows = current.rows;
      } else {
        importId = null;
        rows = [];
        step = "upload";
      }
      await loadImports();
    } catch (err) {
      error = err.message;
    } finally {
      saving = false;
    }
  }
</script>

<div>
  <div class="flex items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl sm:text-3xl lg:text-4xl font-bold">Importar extracto</h1>
      <p class="text-brand-surface-2 mt-2">
        {till ? `${till.name}${till.account_number ? ` · ${till.account_number}` : ""}` : "Caja"}
      </p>
    </div>
    <button class="button-secondary" on:click={() => goto("/tills")}>← Cajas</button>
  </div>

  {#if step === "upload"}
    <div class="card mt-6 space-y-4">
      <div>
        <label class="block text-sm font-medium mb-2" for="stmt-file">
          Seleccionar extracto (PDF, CSV o XLSX)
        </label>
        <input
          type="file"
          id="stmt-file"
          accept=".pdf,.csv,.xlsx,.xls"
          disabled={loading}
          on:change={(e) => {
            file = e.target.files?.[0] || null;
            e.target.value = "";
          }}
          class="w-full px-4 py-2 bg-brand-surface-2 border border-brand-surface-2 rounded cursor-pointer hover:bg-brand-surface-1 transition-colors"
        />
        {#if file}
          <p class="text-xs text-brand-cyan mt-2">✓ {file.name}</p>
        {/if}
      </div>

      <button on:click={handleParse} disabled={!file || loading} class="button-primary w-full">
        {loading ? "Analizando..." : "Analizar extracto"}
      </button>

      {#if imports.length > 0}
        <div class="mt-6">
          <h3 class="text-sm font-semibold mb-2">Importaciones pendientes</h3>
          <div class="space-y-2">
            {#each imports as imp}
              <div class="flex items-center justify-between p-3 bg-brand-surface-2 rounded">
                <div class="text-sm">
                  <span class="text-white">{imp.source_filename}</span>
                  <span class="text-brand-surface-2 ml-2 text-xs">
                    {imp.categorized_count}/{imp.row_count} categorizadas
                  </span>
                </div>
                <div class="flex gap-2">
                  <button class="text-brand-cyan text-sm" on:click={() => openImport(imp.id)}>
                    Revisar
                  </button>
                  <button class="text-brand-rose text-sm" on:click={() => handleDelete(imp.id)}>
                    Eliminar
                  </button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {:else if step === "mapping"}
    <div class="card mt-6">
      <h2 class="text-xl font-bold mb-4">Mapear columnas</h2>
      <ColumnMapping {columns} {preview} {detected} {saving} on:map={handleMap} />
    </div>
  {:else if step === "review"}
    <div class="space-y-4 mt-6">
      <div class="flex items-center justify-between gap-2">
        <div class="flex gap-2">
          <button on:click={handleImport} disabled={saving} class="button-primary">
            {saving ? "Importando..." : "Importar"}
          </button>
          <button
            class="button-secondary"
            on:click={remap}
          >
            Ajustar columnas
          </button>
        </div>
        <button class="button-secondary" on:click={() => (step = "upload")}>Volver</button>
      </div>

      {#if selectedRows.size > 0}
        <div class="flex items-end gap-2 p-3 bg-brand-surface-2 rounded">
          <div class="flex-1">
            <label class="block text-sm font-medium mb-2" for="bulk-cat">
              Asignar categoría a {selectedRows.size} fila(s)
            </label>
            <select id="bulk-cat" bind:value={bulkCategoryId} class="input-field">
              <option value="">Seleccionar categoría...</option>
              {#each categories as cat}
                <option value={String(cat.id)}>
                  {cat.type === "income" ? "Ingreso" : "Egreso"} · {cat.name}
                </option>
              {/each}
            </select>
          </div>
          <button on:click={applyBulkCategory} disabled={saving || !bulkCategoryId} class="button-primary">
            Asignar
          </button>
        </div>
      {/if}

      <div class="card overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-brand-surface-2">
              <th class="p-2"><input type="checkbox" on:change={toggleAll} /></th>
              <th class="p-2">Fecha</th>
              <th class="p-2">Descripción</th>
              <th class="p-2 text-right">Monto</th>
              <th class="p-2">Categoría</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row}
              <tr class="border-t border-brand-surface-2">
                <td class="p-2">
                  {#if row.imported}
                    ✓
                  {:else}
                    <input
                      type="checkbox"
                      checked={selectedRows.has(row.id)}
                      on:change={() => toggleRow(row.id)}
                    />
                  {/if}
                </td>
                <td class="p-2 text-brand-surface-2">{row.transaction_date}</td>
                <td class="p-2">{row.description}</td>
                <td class="p-2 text-right {row.type === 'egreso' ? 'text-brand-rose' : 'text-brand-cyan'}">
                  {displayAmount(row)}
                </td>
                <td class="p-2">
                  {#if row.imported}
                    <span class="text-brand-surface-2 text-xs">Importada</span>
                  {:else}
                    <select
                      class="input-field"
                      value={row.category_id ? String(row.category_id) : ""}
                      on:change={(e) => setCategory(row, e.target.value)}
                    >
                      <option value="">Sin categoría</option>
                      {#each categoriesFor(row.type) as cat}
                        <option value={String(cat.id)}>{cat.name}</option>
                      {/each}
                    </select>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  {#if message}
    <div class="mt-4 p-3 bg-brand-cyan/20 border border-brand-cyan rounded text-brand-cyan text-sm">
      {message}
    </div>
  {/if}
  {#if error}
    <div class="mt-4 p-3 bg-brand-rose/20 border border-brand-rose rounded text-brand-rose text-sm">
      {error}
    </div>
  {/if}
</div>
