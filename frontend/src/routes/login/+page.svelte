<script>
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores';
  import { login, getCurrentUser } from '$lib/api';

  let email = '';
  let password = '';
  let error = '';
  let loading = false;

  async function handleLogin() {
    loading = true;
    error = '';

    try {
      const data = await login(email, password);
      // Temporarily store the token so that the next API call (/auth/me) includes it
      authStore.setToken(data.access_token);

      const meData = await getCurrentUser();
      authStore.setToken(data.access_token, meData.user);
      
      await goto('/dashboard');
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }
</script>

<div class="flex items-center justify-center min-h-screen bg-brand-deep p-4">
  <div class="w-full max-w-md">
    <div class="bg-brand-surface-1 rounded-lg border border-brand-surface-2 shadow-xl p-8">
      <!-- Logo -->
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-brand-cyan">Budget Blade</h1>
        <p class="text-sm text-brand-surface-2 mt-2">Financial Reports Dashboard</p>
      </div>

      <!-- Error Message -->
      {#if error}
        <div class="mb-4 p-4 bg-brand-rose/20 border border-brand-rose rounded text-brand-rose text-sm">
          {error}
        </div>
      {/if}

      <!-- Login Form -->
      <form on:submit|preventDefault={handleLogin} class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-white mb-2" for="email">
            Email
          </label>
          <input
            type="email"
            id="email"
            bind:value={email}
            disabled={loading}
            class="input-field"
            placeholder="your@email.com"
            required
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-white mb-2" for="password">
            Password
          </label>
          <input
            type="password"
            id="password"
            bind:value={password}
            disabled={loading}
            class="input-field"
            placeholder="••••••••"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading || !email || !password}
          class="button-primary w-full"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <!-- Help Text -->
      <p class="text-xs text-brand-surface-2 mt-6 text-center">
        Sign in with your Budget Blade credentials from the mobile app
      </p>
    </div>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
  }
</style>
