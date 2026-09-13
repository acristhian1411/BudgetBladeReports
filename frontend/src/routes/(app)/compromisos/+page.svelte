<script>
  import { onMount } from "svelte";
  import { apiGet, apiPost, apiPatch, apiDelete } from "$lib/api";
  import { formatCurrency, formatDateDisplay } from "$lib/formatting";

  let plans = [];
  let tills = [];
  let categories = [];
  let entities = [];
  let loading = true;
  let error = null;

  let expandedPlanId = null;
  let details = {};

  // Plan form
  let showPlanForm = false;
  let pTitle = "";
  let pType = "egreso";
  let pCategoryId = "";
  let pEntityId = "";
  let pTillId = "";
  let pBaseAmount = "";
  let pInstallments = "";
  let pStartDate = new Date().toISOString().split("T")[0];
  let planFormError = null;
  let saving = false;

  // Edit occurrence
  let editOccurrence = null;
  let eDueDate = "";
  let eAmount = "";
  let eRemaining = "";
  let eStatus = "pending";
  let editError = null;

  // Pay occurrence
  let payOccurrence = null;
  let payTillId = "";
  let payAmount = "";
  let payCategoryId = "";
  let payDate = new Date().toISOString().split("T")[0];
  let payError = null;

  // History
  let historyOccurrence = null;
  let historyPayments = [];

  onMount(async () => {
    await Promise.all([loadPlans(), loadOptions()]);
  });

  async function loadOptions() {
    try {
      [tills, categories, entities] = await Promise.all([
        apiGet("/tills"),
        apiGet("/categories"),
        apiGet("/entities"),
      ]);
    } catch {
      // Non-critical.
    }
  }

  async function loadPlans() {
    loading = true;
    error = null;
    try {
      plans = await apiGet("/scheduled/plans");
    } catch (err) {
      error = err.message;
      plans = [];
    } finally {
      loading = false;
    }
  }

  $: planCategories = categories.filter((c) =>
    pType === "ingreso" ? c.type === "income" : c.type === "expense",
  );

  function statusLabel(status) {
    return (
      { pending: "Pendiente", partially_paid: "Parcial", processed: "Procesado", overdue: "Vencido" }[
        status
      ] || status
    );
  }

  function statusColor(status) {
    if (status === "processed") return "text-brand-emerald";
    if (status === "overdue") return "text-brand-rose";
    if (status === "partially_paid") return "text-yellow-400";
    return "text-brand-cyan";
  }

  function openPlanForm() {
    pTitle = "";
    pType = "egreso";
    pCategoryId = "";
    pEntityId = "";
    pTillId = "";
    pBaseAmount = "";
    pInstallments = "";
    pStartDate = new Date().toISOString().split("T")[0];
    planFormError = null;
    showPlanForm = true;
  }

  function closePlanForm() {
    showPlanForm = false;
    planFormError = null;
  }

  async function submitPlanForm() {
    saving = true;
    planFormError = null;
    const baseAmount = pBaseAmount === "" ? null : Number(pBaseAmount);
    const totalInstallments = pInstallments === "" ? null : Number(pInstallments);

    try {
      await apiPost("/scheduled/plans", {
        title: pTitle.trim(),
        type: pType,
        category_id: pCategoryId ? Number(pCategoryId) : null,
        entity_id: pEntityId ? Number(pEntityId) : null,
        till_id: pTillId ? Number(pTillId) : null,
        base_amount: baseAmount,
        total_installments: totalInstallments,
        start_date: pStartDate,
      });
      closePlanForm();
      await loadPlans();
    } catch (err) {
      planFormError = err.message;
    } finally {
      saving = false;
    }
  }

  async function togglePlan(planId) {
    if (expandedPlanId === planId) {
      expandedPlanId = null;
      return;
    }
    expandedPlanId = planId;
    if (!details[planId]) {
      try {
        details[planId] = await apiGet(`/scheduled/plans/${planId}`);
      } catch (err) {
        details[planId] = { error: err.message };
      }
      details = details;
    }
  }

  async function deletePlan(plan) {
    if (!confirm(`¿Borrar el plan "${plan.title}"?`)) return;
    try {
      await apiDelete(`/scheduled/plans/${plan.id}`);
      if (expandedPlanId === plan.id) expandedPlanId = null;
      delete details[plan.id];
      await loadPlans();
    } catch (err) {
      error = err.message;
    }
  }

  function openEdit(occ) {
    editOccurrence = occ;
    eDueDate = occ.due_date || "";
    eAmount = occ.amount === null ? "" : String(occ.amount);
    eRemaining = occ.remaining_amount === null ? "" : String(occ.remaining_amount);
    eStatus = occ.status || "pending";
    editError = null;
  }

  function closeEdit() {
    editOccurrence = null;
    editError = null;
  }

  async function submitEdit() {
    try {
      const body = { due_date: eDueDate, status: eStatus };
      if (eAmount !== "") body.amount = Number(eAmount);
      if (eRemaining !== "") body.remaining_amount = Number(eRemaining);
      await apiPatch(`/scheduled/occurrences/${editOccurrence.id}`, body);
      const planId = editOccurrence.plan_id;
      closeEdit();
      details[planId] = await apiGet(`/scheduled/plans/${planId}`);
      details = details;
      await loadPlans();
    } catch (err) {
      editError = err.message;
    }
  }

  function openPay(occ) {
    payOccurrence = occ;
    payTillId = tills[0] ? String(tills[0].id) : "";
    payAmount = occ.remaining_amount ? String(occ.remaining_amount) : "";
    payCategoryId = "";
    payDate = new Date().toISOString().split("T")[0];
    payError = null;
  }

  function closePay() {
    payOccurrence = null;
    payError = null;
  }

  async function submitPay() {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      payError = "Ingresá un monto válido.";
      return;
    }
    try {
      await apiPost(`/scheduled/occurrences/${payOccurrence.id}/payment`, {
        till_id: Number(payTillId),
        amount,
        date: payDate,
        category_id: payCategoryId ? Number(payCategoryId) : null,
      });
      const planId = payOccurrence.plan_id;
      closePay();
      details[planId] = await apiGet(`/scheduled/plans/${planId}`);
      details = details;
      await loadPlans();
    } catch (err) {
      payError = err.message;
    }
  }

  async function openHistory(occ) {
    historyOccurrence = occ;
    try {
      historyPayments = await apiGet(`/scheduled/occurrences/${occ.id}/payments`);
    } catch (err) {
      historyPayments = [];
    }
  }

  function closeHistory() {
    historyOccurrence = null;
    historyPayments = [];
  }
</script>

<div class="p-8 space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-4xl font-bold">Compromisos</h1>
      <p class="text-brand-surface-2 mt-2">
        Planes de pago, cuotas y abonos
      </p>
    </div>
    <button class="button-primary" on:click={openPlanForm}>+ Nuevo plan</button>
  </div>

  {#if error}
    <div class="bg-brand-rose/20 border border-brand-rose rounded-lg p-4 text-brand-rose">
      Error: {error}
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12">
      <p class="text-brand-surface-2">Cargando planes...</p>
    </div>
  {:else if plans.length === 0}
    <div class="card text-center py-12">
      <p class="text-brand-surface-2 text-lg">No hay compromisos programados.</p>
      <p class="text-brand-surface-2 text-sm mt-2">Creá un plan para empezar.</p>
    </div>
  {:else}
    <div class="space-y-4">
      {#each plans as plan (plan.id)}
        <div class="card">
          <div class="flex items-start justify-between gap-4">
            <button class="flex-1 text-left" on:click={() => togglePlan(plan.id)}>
              <div class="flex items-center gap-2">
                <span class="font-semibold">{plan.title}</span>
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-medium
                  {plan.type === 'ingreso' ? 'bg-brand-emerald/20 text-brand-emerald' : 'bg-brand-rose/20 text-brand-rose'}"
                >
                  {plan.type === "ingreso" ? "Ingreso" : "Egreso"}
                </span>
              </div>
              <div class="text-xs text-brand-surface-2 mt-1">
                {plan.base_amount === null ? "Monto variable" : formatCurrency(plan.base_amount)}
                {plan.total_installments ? ` · ${plan.total_installments} cuotas` : " · recurrente"}
                {plan.entity_name ? ` · ${plan.entity_name}` : ""}
                {plan.category_name ? ` · ${plan.category_name}` : ""}
              </div>
            </button>
            <div class="flex items-center gap-3 shrink-0">
              <div class="text-right text-xs text-brand-surface-2">
                <div class="text-brand-cyan">{plan.pending_count} pend.</div>
                <div class="text-brand-rose">{plan.overdue_count} venc.</div>
              </div>
              <button class="text-xs text-brand-rose" on:click={() => deletePlan(plan)}>Borrar</button>
            </div>
          </div>

          {#if expandedPlanId === plan.id}
            <div class="mt-4 border-t border-brand-surface-2 pt-4">
              {#if !details[plan.id]}
                <p class="text-sm text-brand-surface-2">Cargando cuotas...</p>
              {:else if details[plan.id].error}
                <p class="text-sm text-brand-rose">{details[plan.id].error}</p>
              {:else}
                {#if details[plan.id].occurrences.length === 0}
                  <p class="text-sm text-brand-surface-2">Este plan aún no tiene cuotas generadas.</p>
                {:else}
                  <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                      <thead class="border-b border-brand-surface-2">
                        <tr>
                          <th class="text-left py-2 px-3">#</th>
                          <th class="text-left py-2 px-3">Vencimiento</th>
                          <th class="text-right py-2 px-3">Monto</th>
                          <th class="text-right py-2 px-3">Restante</th>
                          <th class="text-left py-2 px-3">Estado</th>
                          <th class="text-right py-2 px-3"></th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-brand-surface-2">
                        {#each details[plan.id].occurrences as occ (occ.id)}
                          <tr class="hover:bg-brand-surface-2 transition-colors">
                            <td class="py-3 px-3 text-brand-surface-2">{occ.installment_number ?? "-"}</td>
                            <td class="py-3 px-3">{formatDateDisplay(occ.due_date)}</td>
                            <td class="py-3 px-3 text-right">
                              {occ.amount === null ? "Variable" : formatCurrency(occ.amount)}
                            </td>
                            <td class="py-3 px-3 text-right font-semibold">{formatCurrency(occ.remaining_amount)}</td>
                            <td class="py-3 px-3">
                              <span class="text-xs font-semibold {statusColor(occ.effective_status)}">
                                {statusLabel(occ.effective_status)}
                              </span>
                            </td>
                            <td class="py-3 px-3 text-right whitespace-nowrap">
                              {#if occ.effective_status !== "processed"}
                                <button class="text-xs text-brand-cyan mr-2" on:click={() => openPay(occ)}>Abonar</button>
                              {/if}
                              <button class="text-xs text-brand-surface-2 mr-2" on:click={() => openEdit(occ)}>Editar</button>
                              <button class="text-xs text-brand-cyan" on:click={() => openHistory(occ)}>Historial</button>
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if showPlanForm}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="card w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 class="text-xl font-bold">Nuevo plan</h2>

        <div>
          <label class="block text-sm mb-2" for="p-title">Título</label>
          <input id="p-title" class="input-field" bind:value={pTitle} placeholder="Ej: Alquiler" />
        </div>

        <div class="flex gap-2">
          <button
            class="flex-1 px-3 py-2 rounded text-sm font-semibold"
            class:bg-brand-emerald={pType === "ingreso"}
            class:bg-brand-surface-2={pType !== "ingreso"}
            on:click={() => (pType = "ingreso")}
          >
            Ingreso
          </button>
          <button
            class="flex-1 px-3 py-2 rounded text-sm font-semibold"
            class:bg-brand-rose={pType === "egreso"}
            class:bg-brand-surface-2={pType !== "egreso"}
            on:click={() => (pType = "egreso")}
          >
            Egreso
          </button>
        </div>

        <div>
          <label class="block text-sm mb-2" for="p-category">Categoría</label>
          <select id="p-category" class="input-field" bind:value={pCategoryId}>
            <option value="">Sin categoría</option>
            {#each planCategories as category (category.id)}
              <option value={category.id}>{category.name}</option>
            {/each}
          </select>
        </div>

        <div>
          <label class="block text-sm mb-2" for="p-entity">Entidad (opcional)</label>
          <select id="p-entity" class="input-field" bind:value={pEntityId}>
            <option value="">Sin entidad</option>
            {#each entities as entity (entity.id)}
              <option value={entity.id}>{entity.name}</option>
            {/each}
          </select>
        </div>

        <div>
          <label class="block text-sm mb-2" for="p-till">Caja (opcional)</label>
          <select id="p-till" class="input-field" bind:value={pTillId}>
            <option value="">Sin caja</option>
            {#each tills as till (till.id)}
              <option value={till.id}>{till.name || `Caja #${till.id}`}</option>
            {/each}
          </select>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm mb-2" for="p-amount">Monto base</label>
            <input id="p-amount" type="number" step="0.01" min="0" class="input-field" bind:value={pBaseAmount} placeholder="0.00" />
          </div>
          <div>
            <label class="block text-sm mb-2" for="p-installments">Cuotas</label>
            <input id="p-installments" type="number" min="1" class="input-field" bind:value={pInstallments} placeholder="vacío = recurrente" />
          </div>
        </div>

        <div>
          <label class="block text-sm mb-2" for="p-start">Fecha de inicio</label>
          <input id="p-start" type="date" class="input-field" bind:value={pStartDate} />
        </div>

        {#if planFormError}
          <div class="bg-brand-rose/20 border border-brand-rose rounded-lg p-3 text-brand-rose text-sm">{planFormError}</div>
        {/if}

        <div class="flex justify-end gap-3">
          <button class="button-secondary" on:click={closePlanForm} disabled={saving}>Cancelar</button>
          <button class="button-primary" on:click={submitPlanForm} disabled={saving || !pTitle.trim()}>
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if editOccurrence}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="card w-full max-w-md space-y-4">
        <h2 class="text-xl font-bold">Editar cuota</h2>

        <div>
          <label class="block text-sm mb-2" for="e-date">Vencimiento</label>
          <input id="e-date" type="date" class="input-field" bind:value={eDueDate} />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm mb-2" for="e-amount">Monto</label>
            <input id="e-amount" type="number" step="0.01" min="0" class="input-field" bind:value={eAmount} placeholder="Variable" />
          </div>
          <div>
            <label class="block text-sm mb-2" for="e-remaining">Restante</label>
            <input id="e-remaining" type="number" step="0.01" min="0" class="input-field" bind:value={eRemaining} />
          </div>
        </div>
        <div>
          <label class="block text-sm mb-2" for="e-status">Estado</label>
          <select id="e-status" class="input-field" bind:value={eStatus}>
            <option value="pending">Pendiente</option>
            <option value="partially_paid">Parcial</option>
            <option value="processed">Procesado</option>
            <option value="overdue">Vencido</option>
          </select>
        </div>

        {#if editError}
          <div class="bg-brand-rose/20 border border-brand-rose rounded-lg p-3 text-brand-rose text-sm">{editError}</div>
        {/if}

        <div class="flex justify-end gap-3">
          <button class="button-secondary" on:click={closeEdit}>Cancelar</button>
          <button class="button-primary" on:click={submitEdit}>Guardar</button>
        </div>
      </div>
    </div>
  {/if}

  {#if payOccurrence}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="card w-full max-w-md space-y-4">
        <h2 class="text-xl font-bold">Abonar cuota</h2>
        <p class="text-sm text-brand-surface-2">
          Saldo pendiente: {formatCurrency(payOccurrence.remaining_amount)}
        </p>

        <div>
          <label class="block text-sm mb-2" for="pay-till">Caja</label>
          <select id="pay-till" class="input-field" bind:value={payTillId}>
            {#each tills as till (till.id)}
              <option value={till.id}>{till.name || `Caja #${till.id}`}</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="block text-sm mb-2" for="pay-amount">Monto a abonar</label>
          <input id="pay-amount" type="number" step="0.01" min="0" class="input-field" bind:value={payAmount} />
        </div>
        <div>
          <label class="block text-sm mb-2" for="pay-category">Categoría</label>
          <select id="pay-category" class="input-field" bind:value={payCategoryId}>
            <option value="">Sin categoría</option>
            {#each categories as category (category.id)}
              <option value={category.id}>{category.name}</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="block text-sm mb-2" for="pay-date">Fecha</label>
          <input id="pay-date" type="date" class="input-field" bind:value={payDate} />
        </div>

        {#if payError}
          <div class="bg-brand-rose/20 border border-brand-rose rounded-lg p-3 text-brand-rose text-sm">{payError}</div>
        {/if}

        <div class="flex justify-end gap-3">
          <button class="button-secondary" on:click={closePay}>Cancelar</button>
          <button class="button-primary" on:click={submitPay}>Abonar</button>
        </div>
      </div>
    </div>
  {/if}

  {#if historyOccurrence}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="card w-full max-w-md space-y-4">
        <h2 class="text-xl font-bold">Historial de pagos</h2>

        {#if historyPayments.length === 0}
          <p class="text-sm text-brand-surface-2">No hay abonos registrados.</p>
        {:else}
          <div class="space-y-2">
            {#each historyPayments as payment (payment.id)}
              <div class="flex items-center justify-between rounded border border-brand-surface-2 p-3">
                <div>
                  <div class="text-sm font-semibold">{formatCurrency(payment.amount_paid)}</div>
                  <div class="text-xs text-brand-surface-2">{formatDateDisplay(payment.payment_date)}</div>
                </div>
                <span class="text-xs text-brand-surface-2 uppercase">{payment.type}</span>
              </div>
            {/each}
          </div>
        {/if}

        <div class="flex justify-end">
          <button class="button-secondary" on:click={closeHistory}>Cerrar</button>
        </div>
      </div>
    </div>
  {/if}
</div>
