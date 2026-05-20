<script>
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores';

  $: if (!$authStore.token) {
    goto('/login');
  }
</script>

<slot />
