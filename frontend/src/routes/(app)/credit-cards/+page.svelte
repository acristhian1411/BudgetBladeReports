<script>
  import { onMount } from "svelte";
  import { apiGet, apiPost, apiPut, apiDelete } from "$lib/api";
  import { formatCurrency, formatDateDisplay } from "$lib/formatting";

  let cards = [];
  let tills = [];
  let expenseCategories = [];
  let loading = true;
  let error = null;

  // Card form (create/edit)
  let showCardForm = false;
  let editingCardId = null;
  let formName = "";
  let formTillId = "";
  let formCreditLimit = "";
  let formError = null;
  let saving = false;

  // Charge form (register a card purchase)
  let showChargeForm = false;
  let chargeCardId = null;
  let chargeCardName = "";
  let chargeAmount = "";
  let chargeDescription = "";
  let chargeCategoryId = "";
  let chargeDate = new Date().toISOString().split("T")[0];
  let chargeError = null;

  // Payment form
  let showPayForm = false;
  let payCardId = null;
  let payCardName = "";
  let payCapital = "";
  let payInterest = "";
  let payDate = new Date().toISOString().split("T")[0];
  let payPurchases = [];
  let payError = null;

  onMount(async () => {
    await Promise.all([loadCards(), loadOptions()]);
  });

  async function loadOptions() {
    try {
      [tills, expenseCategories] = await Promise.all([
        apiGet("/tills"),
        apiGet("/categories?type=expense"),
      ]);
    } catch {
      // Non-critical.
    }
  }

  async function loadCards() {
    loading = true;
    error = null;
    try {
      cards = await apiGet("/credit-cards");
    } catch (err) {
      error = err.message;
      cards = [];
    } finally {
      loading = false;
    }
  }

  function utilizationPct(outstanding, limit) {
    if (!limit || limit <= 0) return 0;
    return Math.min(100, (outstanding / limit) * 100);
  }

  function utilizationColor(pct) {
    if (pct >= 90) return "text-brand-rose";
    if (pct >= 60) return "text-yellow-400";
    return "text-brand-emerald";
  }

  function openCardForm(card = null) {
    editingCardId = card?.id ?? null;
    formName = card?.name ?? "";
    formTillId = card ? String(card.till_id) : (tills[0] ? String(tills[0].id) : "");
    formCreditLimit = card ? String(card.credit_limit ?? "") : "";
    formError = null;
    showCardForm = true;
  }

  function closeCardForm() {
    showCardForm = false;
    editingCardId = null;
    formError = null;
  }

  async function submitCardForm() {
    saving = true;
    formError = null;
    const body = {
      till_id: Number(formTillId),
      name: formName.trim(),
      credit_limit: Number(formCreditLimit) || 0,
    };
    try {
      if (editingCardId) {
        await apiPut(`/credit-cards/${editingCardId}`, body);
      } else {
        await apiPost("/credit-cards", body);
      }
      closeCardForm();
      await loadCards();
    } catch (err) {
      formError = err.message;
    } finally {
      saving = false;
    }
  }

  async function deleteCard(card) {
    if (!confirm(`¿Borrar la tarjeta "${card.name}"?`)) return;
    try {
      await apiDelete(`/credit-cards/${card.id}`);
      await loadCards();
    } catch (err) {
      error = err.message;
    }
  }

  function openCharge(card) {
    chargeCardId = card.id;
    chargeCardName = card.name;
    chargeAmount = "";
    chargeDescription = "";
    chargeCategoryId = "";
    chargeDate = new Date().toISOString().split("T")[0];
    chargeError = null;
    showChargeForm = true;
  }

  function closeCharge() {
    showChargeForm = false;
    chargeCardId = null;
    chargeError = null;
  }

  async function submitCharge() {
    const card = cards.find((c) => c.id === chargeCardId);
    if (!card) return;
    const amount = Number(chargeAmount);
    if (!amount || amount <= 0) {
      chargeError = "Ingresá un monto válido.";
      return;
    }
    try {
      await apiPost("/transactions", {
        till_id: card.till_id,
        amount,
        type: "egreso",
        description: chargeDescription.trim(),
        date: chargeDate,
        category_id: chargeCategoryId ? Number(chargeCategoryId) : null,
        payment_method: "credit_card",
        credit_card_id: card.id,
        affects_balance: 0,
      });
      closeCharge();
      await loadCards();
    } catch (err) {
      chargeError = err.message;
    }
  }

  async function openPay(card) {
    payCardId = card.id;
    payCardName = card.name;
    payCapital = "";
    payInterest = "";
    payDate = new Date().toISOString().split("T")[0];
    payError = null;
    try {
      const purchases = await apiGet(`/credit-cards/${card.id}/purchases`);
      payPurchases = purchases.map((p) => ({ ...p, selected: true, toPay: p.pending_amount }));
    } catch (err) {
      payPurchases = [];
      payError = err.message;
    }
    showPayForm = true;
  }

  function closePay() {
    showPayForm = false;
    payCardId = null;
    payPurchases = [];
    payError = null;
  }

  async function submitPay() {
    const capital = Number(payCapital);
    const interest = Number(payInterest) || 0;
    if (!capital || capital <= 0) {
      payError = "Ingresá el monto a pagar.";
      return;
    }
    const paymentItems = payPurchases
      .filter((p) => p.selected && Number(p.toPay) > 0)
      .map((p) => ({ purchase_transaction_id: p.id, amount_paid: Number(p.toPay) }));

    try {
      await apiPost("/transactions/credit-card-payment", {
        till_id: cards.find((c) => c.id === payCardId)?.till_id,
        credit_card_id: payCardId,
        capital_amount: capital,
        interest_amount: interest,
        description: `Pago ${payCardName}`,
        date: payDate,
        payment_items: paymentItems,
      });
      closePay();
      await loadCards();
    } catch (err) {
      payError = err.message;
    }
  }
</script>

<div class="p-8 space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-4xl font-bold">Tarjetas de Crédito</h1>
      <p class="text-brand-surface-2 mt-2">
        Tarjetas asociadas a cajas y saldos pendientes
      </p>
    </div>
    <button class="button-primary" on:click={() => openCardForm()}>+ Nueva tarjeta</button>
  </div>

  {#if error}
    <div class="bg-brand-rose/20 border border-brand-rose rounded-lg p-4 text-brand-rose">
      Error: {error}
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12">
      <p class="text-brand-surface-2">Cargando tarjetas...</p>
    </div>
  {:else if cards.length === 0}
    <div class="card text-center py-12">
      <p class="text-brand-surface-2 text-lg">No hay tarjetas de crédito registradas.</p>
      <p class="text-brand-surface-2 text-sm mt-2">Creá una para empezar a registrar gastos y pagos.</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {#each cards as card (card.id)}
        {@const pct = utilizationPct(card.pending_debt, card.credit_limit)}
        <div class="card space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <span class="font-semibold truncate">{card.name}</span>
              <div class="text-xs text-brand-surface-2 mt-1">{card.till_name || "Sin caja"}</div>
            </div>
            <span class="shrink-0 text-xs font-bold {utilizationColor(pct)}">{pct.toFixed(0)}%</span>
          </div>

          <div class="bg-brand-surface-2 rounded h-2 overflow-hidden">
            <div class="h-2 rounded bg-brand-cyan transition-all" style="width: {pct}%" />
          </div>

          <div class="grid grid-cols-2 gap-2 text-sm">
            <div>
              <div class="text-xs text-brand-surface-2">Pendiente</div>
              <div class="font-bold text-brand-rose">{formatCurrency(card.pending_debt)}</div>
            </div>
            <div>
              <div class="text-xs text-brand-surface-2">Límite</div>
              <div class="font-semibold">{formatCurrency(card.credit_limit)}</div>
            </div>
          </div>

          <div class="flex flex-wrap gap-2 pt-2 border-t border-brand-surface-2">
            <button class="button-secondary text-xs px-3 py-1" on:click={() => openCharge(card)}>
              Registrar gasto
            </button>
            <button class="button-primary text-xs px-3 py-1" on:click={() => openPay(card)}>
              Pagar
            </button>
            <button class="text-xs text-brand-cyan px-2" on:click={() => openCardForm(card)}>Editar</button>
            <button class="text-xs text-brand-rose px-2" on:click={() => deleteCard(card)}>Borrar</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if showCardForm}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="card w-full max-w-md space-y-4">
        <h2 class="text-xl font-bold">{editingCardId ? "Editar tarjeta" : "Nueva tarjeta"}</h2>
        <div>
          <label class="block text-sm mb-2" for="card-name">Nombre</label>
          <input id="card-name" class="input-field" bind:value={formName} placeholder="Ej: Visa" />
        </div>
        <div>
          <label class="block text-sm mb-2" for="card-till">Caja asociada</label>
          <select id="card-till" class="input-field" bind:value={formTillId}>
            {#each tills as till (till.id)}
              <option value={till.id}>{till.name || `Caja #${till.id}`}</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="block text-sm mb-2" for="card-limit">Límite</label>
          <input id="card-limit" type="number" step="0.01" min="0" class="input-field" bind:value={formCreditLimit} placeholder="0.00" />
        </div>

        {#if formError}
          <div class="bg-brand-rose/20 border border-brand-rose rounded-lg p-3 text-brand-rose text-sm">{formError}</div>
        {/if}

        <div class="flex justify-end gap-3">
          <button class="button-secondary" on:click={closeCardForm} disabled={saving}>Cancelar</button>
          <button class="button-primary" on:click={submitCardForm} disabled={saving || !formName.trim()}>
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showChargeForm}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="card w-full max-w-md space-y-4">
        <h2 class="text-xl font-bold">Registrar gasto en {chargeCardName}</h2>
        <div>
          <label class="block text-sm mb-2" for="charge-amount">Monto</label>
          <input id="charge-amount" type="number" step="0.01" min="0" class="input-field" bind:value={chargeAmount} placeholder="0.00" />
        </div>
        <div>
          <label class="block text-sm mb-2" for="charge-desc">Descripción</label>
          <input id="charge-desc" class="input-field" bind:value={chargeDescription} placeholder="Ej: Compra online" />
        </div>
        <div>
          <label class="block text-sm mb-2" for="charge-category">Categoría</label>
          <select id="charge-category" class="input-field" bind:value={chargeCategoryId}>
            <option value="">Sin categoría</option>
            {#each expenseCategories as category (category.id)}
              <option value={category.id}>{category.name}</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="block text-sm mb-2" for="charge-date">Fecha</label>
          <input id="charge-date" type="date" class="input-field" bind:value={chargeDate} />
        </div>

        {#if chargeError}
          <div class="bg-brand-rose/20 border border-brand-rose rounded-lg p-3 text-brand-rose text-sm">{chargeError}</div>
        {/if}

        <div class="flex justify-end gap-3">
          <button class="button-secondary" on:click={closeCharge}>Cancelar</button>
          <button class="button-primary" on:click={submitCharge}>Guardar</button>
        </div>
      </div>
    </div>
  {/if}

  {#if showPayForm}
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="card w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 class="text-xl font-bold">Pagar {payCardName}</h2>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm mb-2" for="pay-capital">Monto a pagar</label>
            <input id="pay-capital" type="number" step="0.01" min="0" class="input-field" bind:value={payCapital} placeholder="0.00" />
          </div>
          <div>
            <label class="block text-sm mb-2" for="pay-interest">Intereses (opcional)</label>
            <input id="pay-interest" type="number" step="0.01" min="0" class="input-field" bind:value={payInterest} placeholder="0.00" />
          </div>
        </div>

        <div>
          <label class="block text-sm mb-2" for="pay-date">Fecha</label>
          <input id="pay-date" type="date" class="input-field" bind:value={payDate} />
        </div>

        <div>
          <div class="text-sm font-semibold mb-2">Compras a cubrir</div>
          {#if payPurchases.length === 0}
            <p class="text-sm text-brand-surface-2">No hay compras pendientes.</p>
          {:else}
            <div class="space-y-2">
              {#each payPurchases as purchase (purchase.id)}
                <div class="flex items-center gap-3 rounded border border-brand-surface-2 p-2">
                  <input type="checkbox" class="w-4 h-4" bind:checked={purchase.selected} />
                  <div class="flex-1 min-w-0">
                    <div class="text-sm truncate">{purchase.description || "Compra"}</div>
                    <div class="text-xs text-brand-surface-2">{formatDateDisplay(purchase.transaction_date)} · pendiente {formatCurrency(purchase.pending_amount)}</div>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    class="w-28 px-2 py-1 bg-brand-surface-2 rounded text-sm"
                    bind:value={purchase.toPay}
                    disabled={!purchase.selected}
                  />
                </div>
              {/each}
            </div>
          {/if}
        </div>

        {#if payError}
          <div class="bg-brand-rose/20 border border-brand-rose rounded-lg p-3 text-brand-rose text-sm">{payError}</div>
        {/if}

        <div class="flex justify-end gap-3">
          <button class="button-secondary" on:click={closePay}>Cancelar</button>
          <button class="button-primary" on:click={submitPay}>Pagar</button>
        </div>
      </div>
    </div>
  {/if}
</div>
