<script>
  import "../app.css";
  import { page } from "$app/stores";
  import { authStore } from "$lib/stores";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { getCurrentUser } from "$lib/api";

  let showMobileMenu = false;
  let updateAvailable = false;
  let checkingSession = true;

  $: isAuthenticated = $authStore.token !== null;
  $: isLoginPage = $page.url.pathname === "/login";
  $: shouldShowLayout = isAuthenticated && !isLoginPage;

  const navItems = [
    { label: "Panel", href: "/dashboard", icon: "📊" },
    { label: "Transacciones", href: "/transactions", icon: "💳" },
    { label: "Cajas", href: "/tills", icon: "💵" },
    { label: "Categorias", href: "/categories", icon: "🏷️" },
    { label: "Tarjetas de credito", href: "/credit-cards", icon: "🏦" },
    { label: "Entidades", href: "/entities", icon: "🏢" },
    { label: "Compromisos", href: "/compromisos", icon: "📅" },
    { label: "Proyecciones", href: "/projections", icon: "📈" },
    { label: "Análisis de Deuda", href: "/debt-capacity", icon: "💹" },
    { label: "Sincronizacion", href: "/sync", icon: "⚡" },
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
      authStore.setToken(token);
      const meData = await getCurrentUser();
      authStore.setToken(token, meData.user);
    } catch (err) {
      console.error("No se pudo verificar la sesion:", err);
      authStore.logout();
    } finally {
      checkingSession = false;
    }
  }

  onMount(() => {
    refreshSession();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "UPDATE_AVAILABLE") {
          updateAvailable = true;
        }
      });
    }
  });

  function handleLogout() {
    authStore.logout();
    goto("/login");
  }

  function closeMenu() {
    showMobileMenu = false;
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      showMobileMenu = false;
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if checkingSession}
  <div
    class="flex items-center justify-center min-h-screen bg-brand-deep text-white"
  >
    <div class="flex flex-col items-center gap-4">
      <div
        class="animate-spin rounded-full h-10 w-10 border-t-2 border-brand-cyan"
      ></div>
      <p class="text-sm text-brand-cyan">Verificando sesion...</p>
    </div>
  </div>
{:else if shouldShowLayout}
  <div class="flex h-screen bg-brand-deep text-white">
    <!-- Backdrop (mobile only) -->
    {#if showMobileMenu}
      <button
        class="fixed inset-0 z-30 bg-black/50 lg:hidden"
        aria-label="Cerrar menú"
        on:click={closeMenu}
      ></button>
    {/if}

    <!-- Sidebar -->
    <aside
      class="fixed inset-y-0 left-0 z-40 w-64 bg-brand-surface-1 border-r border-brand-surface-2 flex flex-col transform transition-transform duration-200 -translate-x-full lg:static lg:translate-x-0"
      class:translate-x-0={showMobileMenu}
    >
      <!-- Logo -->
      <div class="p-6 border-b border-brand-surface-2">
        <h1 class="text-2xl font-bold text-brand-cyan">Budget Blade</h1>
        <p class="text-xs text-brand-surface-2 mt-1">Portal de reportes</p>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 p-4 space-y-2 overflow-y-auto">
        {#each navItems as item (item.href)}
          <a
            href={item.href}
            class="flex items-center gap-2 px-4 py-2 rounded hover:bg-brand-surface-2 transition-colors"
            class:bg-brand-surface-2={$page.url.pathname.startsWith(item.href)}
            on:click={closeMenu}
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
            <div class="truncate">{$authStore.user.email}</div>
          {/if}
        </div>
        <button
          on:click={handleLogout}
          class="w-full px-3 py-2 bg-brand-rose text-white rounded text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          Cerrar sesion
        </button>
      </div>
    </aside>

    <!-- Main column -->
    <div class="flex flex-1 flex-col min-w-0">
      <!-- Mobile top bar -->
      <header
        class="lg:hidden sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-brand-surface-1 border-b border-brand-surface-2"
      >
        <div class="flex items-center gap-3">
          <button
            class="p-2 rounded hover:bg-brand-surface-2 transition-colors"
            aria-label="Abrir menú"
            on:click={() => (showMobileMenu = true)}
          >
            <svg
              class="w-6 h-6"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <span class="text-lg font-bold text-brand-cyan">Budget Blade</span>
        </div>
      </header>

      <!-- Main Content -->
      <main class="flex-1 overflow-auto bg-brand-deep">
        <slot />
      </main>
    </div>

    {#if updateAvailable}
      <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 bg-brand-surface-1 border border-brand-surface-2 rounded-lg shadow-xl">
        <span class="text-sm">Nueva versión disponible</span>
        <button
          class="button-primary text-sm"
          on:click={() => window.location.reload()}
        >
          Recargar
        </button>
      </div>
    {/if}
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
