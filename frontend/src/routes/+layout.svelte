<script>
  import "../app.css";
  import { page } from "$app/stores";
  import { authStore } from "$lib/stores";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { getCurrentUser } from "$lib/api";

  let showMobileMenu = false;
  let checkingSession = true;

  $: isAuthenticated = $authStore.token !== null;
  $: isLoginPage = $page.url.pathname === "/login";
  $: shouldShowLayout = isAuthenticated && !isLoginPage;

  const navItems = [
    { label: "Dashboard", href: "/dashboard", icon: "📊" },
    { label: "Transactions", href: "/transactions", icon: "💳" },
    { label: "Entity Monitor", href: "/entities", icon: "🏢" },
    { label: "Commitments", href: "/projections", icon: "📅" },
    { label: "Data Sync", href: "/sync", icon: "⚡" },
  ];

  async function refreshSession() {
    if (typeof window === "undefined") return;

    const token = sessionStorage.getItem("auth_token");
    if (!token) {
      authStore.logout();
      checkingSession = false;
      return;
    }

    try {
      authStore.setToken(token); // Set temporary token for subsequent API calls
      const meData = await getCurrentUser();
      authStore.setToken(token, meData.user);
    } catch (err) {
      console.error("Failed to verify session:", err);
      authStore.logout();
    } finally {
      checkingSession = false;
    }
  }

  onMount(() => {
    refreshSession();
  });

  function handleLogout() {
    authStore.logout();
    goto("/login");
  }
</script>

{#if checkingSession}
  <div
    class="flex items-center justify-center min-h-screen bg-brand-deep text-white"
  >
    <div class="flex flex-col items-center gap-4">
      <div
        class="animate-spin rounded-full h-10 w-10 border-t-2 border-brand-cyan"
      ></div>
      <p class="text-sm text-brand-cyan">Verifying session...</p>
    </div>
  </div>
{:else if shouldShowLayout}
  <div class="flex h-screen bg-brand-deep text-white">
    <!-- Sidebar -->
    <aside
      class="w-64 bg-brand-surface-1 border-r border-brand-surface-2 flex flex-col"
    >
      <!-- Logo -->
      <div class="p-6 border-b border-brand-surface-2">
        <h1 class="text-2xl font-bold text-brand-cyan">Budget Blade</h1>
        <p class="text-xs text-brand-surface-2 mt-1">Reports Portal</p>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 p-4 space-y-2">
        {#each navItems as item (item.href)}
          <a
            href={item.href}
            class="flex items-center gap-2 px-4 py-2 rounded hover:bg-brand-surface-2 transition-colors"
            class:bg-brand-surface-2={$page.url.pathname.startsWith(item.href)}
          >
            <span class="text-lg">{item.icon}</span>
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>

      <!-- User & Logout -->
      <div class="p-4 border-t border-brand-surface-2">
        <div class="text-xs text-brand-surface-2 mb-3">
          {#if $authStore.user?.email}
            <div>{$authStore.user.email}</div>
          {/if}
        </div>
        <button
          on:click={handleLogout}
          class="w-full px-3 py-2 bg-brand-rose text-white rounded text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          Logout
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 overflow-auto bg-brand-deep">
      <slot />
    </main>
  </div>
{:else}
  <slot />
{/if}

<style>
  :global(body) {
    margin: 0;
    padding: 0;
  }

  :global(html, body, #svelte) {
    height: 100%;
    width: 100%;
  }
</style>
