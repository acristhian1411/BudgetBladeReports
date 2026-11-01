<script>
  import { goto } from "$app/navigation";
  import { authStore } from "$lib/stores";
  import { changePassword } from "$lib/api";

  let currentPassword = "";
  let newPassword = "";
  let confirmation = "";
  let error = "";
  let saving = false;

  // reset_password === false means the account still uses a temporary password.
  $: forced = $authStore.user?.reset_password === false;

  async function submit() {
    if (newPassword !== confirmation) {
      error = "La confirmación no coincide con la nueva contraseña.";
      return;
    }

    saving = true;
    error = "";

    try {
      await changePassword({
        current_password: currentPassword,
        password: newPassword,
        password_confirmation: confirmation,
      });
      authStore.setToken($authStore.token, {
        ...$authStore.user,
        reset_password: true,
      });
      await goto("/dashboard");
    } catch (err) {
      error = err.message;
    } finally {
      saving = false;
    }
  }
</script>

<div class="max-w-md mx-auto">
  <h1 class="text-2xl sm:text-3xl font-bold">Cambiar contraseña</h1>
  <p class="text-brand-surface-2 mt-2">
    {forced
      ? "Tu cuenta usa una contraseña temporal. Elegí una nueva para continuar."
      : "Actualizá la contraseña de tu cuenta."}
  </p>

  {#if forced}
    <div class="mt-4 bg-brand-surface-2 border border-brand-cyan rounded-lg p-4 text-sm">
      Tenés que cambiar la contraseña antes de usar el panel.
    </div>
  {/if}

  {#if error}
    <div class="mt-4 bg-brand-rose/20 border border-brand-rose rounded-lg p-4 text-brand-rose text-sm">
      {error}
    </div>
  {/if}

  <form on:submit|preventDefault={submit} class="card mt-6 space-y-4">
    <div>
      <label class="block text-sm font-medium mb-2" for="current-password">
        Contraseña actual
      </label>
      <input
        type="password"
        id="current-password"
        bind:value={currentPassword}
        disabled={saving}
        class="input-field"
        autocomplete="current-password"
        required
      />
    </div>

    <div>
      <label class="block text-sm font-medium mb-2" for="new-password">
        Nueva contraseña
      </label>
      <input
        type="password"
        id="new-password"
        bind:value={newPassword}
        disabled={saving}
        class="input-field"
        autocomplete="new-password"
        minlength="8"
        required
      />
      <p class="text-xs text-brand-surface-2 mt-1">Mínimo 8 caracteres.</p>
    </div>

    <div>
      <label class="block text-sm font-medium mb-2" for="password-confirmation">
        Confirmar nueva contraseña
      </label>
      <input
        type="password"
        id="password-confirmation"
        bind:value={confirmation}
        disabled={saving}
        class="input-field"
        autocomplete="new-password"
        minlength="8"
        required
      />
    </div>

    <button
      type="submit"
      disabled={saving || !currentPassword || !newPassword || !confirmation}
      class="button-primary w-full"
    >
      {saving ? "Guardando..." : "Cambiar contraseña"}
    </button>
  </form>
</div>
