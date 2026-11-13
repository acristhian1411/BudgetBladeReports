<script>
  import { createEventDispatcher } from "svelte";

  export let columns = []; // [{ index, header }]
  export let preview = []; // string[][]
  export let detected = null; // mapping proposal
  export let saving = false;

  const dispatch = createEventDispatcher();

  const ROLES = [
    { value: "ignore", label: "Ignorar" },
    { value: "date", label: "Fecha" },
    { value: "description", label: "Descripción" },
    { value: "amount_signed", label: "Monto (con signo)" },
    { value: "amount_egreso", label: "Egresos" },
    { value: "amount_ingreso", label: "Ingresos" },
  ];

  let roles = [];
  let saveTemplate = true;
  let error = "";

  $: if (columns.length && roles.length === 0) initRoles(columns, detected);

  function initRoles(cols, mapping) {
    const next = cols.map(() => "ignore");
    if (mapping?.date?.column != null) next[mapping.date.column] = "date";
    for (const c of mapping?.description?.columns ?? []) next[c] = "description";
    if (mapping?.amount?.mode === "signed" && mapping.amount.column != null) {
      next[mapping.amount.column] = "amount_signed";
    } else if (mapping?.amount?.mode === "split") {
      next[mapping.amount.egreso] = "amount_egreso";
      next[mapping.amount.ingreso] = "amount_ingreso";
    }
    roles = next;
  }

  function buildMapping() {
    const dateCol = roles.indexOf("date");
    const descCols = roles
      .map((r, i) => (r === "description" ? i : -1))
      .filter((i) => i !== -1);
    const signedCol = roles.indexOf("amount_signed");
    const egresoCol = roles.indexOf("amount_egreso");
    const ingresoCol = roles.indexOf("amount_ingreso");

    const mapping = { header_row: detected?.header_row ?? 0 };

    if (dateCol === -1) {
      error = "Elegí una columna de Fecha";
      return null;
    }
    mapping.date = { column: dateCol, format: detected?.date?.format ?? "DD/MM/YYYY" };

    if (descCols.length) mapping.description = { columns: descCols };

    if (signedCol !== -1) {
      mapping.amount = { mode: "signed", column: signedCol };
    } else if (egresoCol !== -1 && ingresoCol !== -1) {
      mapping.amount = { mode: "split", egreso: egresoCol, ingreso: ingresoCol };
    } else {
      error = "Elegí una columna de Monto (con signo, o Egresos + Ingresos)";
      return null;
    }
    return mapping;
  }

  function submit() {
    error = "";
    const mapping = buildMapping();
    if (!mapping) return;
    dispatch("map", { mapping, saveTemplate });
  }

  // --- lightweight live preview (no server round-trip) ---
  $: dateCol = roles.indexOf("date");
  $: descCols = roles.map((r, i) => (r === "description" ? i : -1)).filter((i) => i !== -1);
  $: signedCol = roles.indexOf("amount_signed");
  $: egresoCol = roles.indexOf("amount_egreso");
  $: ingresoCol = roles.indexOf("amount_ingreso");

  $: previewRows = preview.map((row) => {
    const date = dateCol >= 0 ? row[dateCol] : "";
    const desc = descCols.map((c) => row[c]).filter(Boolean).join(" ");
    let amount = "";
    let type = "";
    if (signedCol >= 0) {
      amount = row[signedCol] ?? "";
      type = /^-|\(.*\)$/.test(amount.trim()) ? "Egreso" : "Ingreso";
    } else {
      if (egresoCol >= 0 && row[egresoCol]) {
        amount = row[egresoCol];
        type = "Egreso";
      } else if (ingresoCol >= 0 && row[ingresoCol]) {
        amount = row[ingresoCol];
        type = "Ingreso";
      }
    }
    return { date, desc, amount, type };
  });
</script>

<div class="space-y-4">
  <p class="text-sm text-brand-surface-2">
    La primera vez, confirmá qué significa cada columna. La próxima vez se usará
    automáticamente.
  </p>

  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="text-left text-brand-surface-2">
          {#each columns as col (col.index)}
            <th class="p-2 align-bottom">
              <div class="font-semibold text-white">{col.header || `Col. ${col.index + 1}`}</div>
              <select class="input-field mt-1" bind:value={roles[col.index]}>
                {#each ROLES as role}
                  <option value={role.value}>{role.label}</option>
                {/each}
              </select>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each preview as row}
          <tr class="border-t border-brand-surface-2">
            {#each row as cell, i}
              <td class="p-2 text-brand-surface-2">{cell}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="p-4 bg-brand-surface-2 rounded">
    <h3 class="text-sm font-semibold mb-2">Vista previa del resultado</h3>
    <table class="w-full text-sm">
      <thead>
        <tr class="text-left text-brand-surface-2">
          <th class="p-2">Fecha</th>
          <th class="p-2">Descripción</th>
          <th class="p-2 text-right">Monto</th>
          <th class="p-2">Tipo</th>
        </tr>
      </thead>
      <tbody>
        {#each previewRows as r}
          <tr class="border-t border-brand-surface-2">
            <td class="p-2">{r.date}</td>
            <td class="p-2">{r.desc}</td>
            <td class="p-2 text-right">{r.amount}</td>
            <td class="p-2 {r.type === 'Egreso' ? 'text-brand-rose' : 'text-brand-cyan'}">{r.type}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <label class="flex items-center gap-2 cursor-pointer">
    <input type="checkbox" class="w-4 h-4" bind:checked={saveTemplate} />
    <span class="text-sm">Guardar plantilla para esta caja</span>
  </label>

  {#if error}
    <div class="p-3 bg-brand-rose/20 border border-brand-rose rounded text-brand-rose text-sm">
      {error}
    </div>
  {/if}

  <button class="button-primary w-full" on:click={submit} disabled={saving}>
    {saving ? "Procesando..." : "Guardar e importar"}
  </button>
</div>
