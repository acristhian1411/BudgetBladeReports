<script>
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores';

  $: if (!$authStore.token) {
    goto('/login');
  }
</script>

<div class="p-4 sm:p-6 lg:p-8 space-y-6">
  <slot />
</div>
