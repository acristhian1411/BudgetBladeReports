<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores';

  onMount(() => {
    if ($authStore.token) {
      goto('/dashboard');
    } else {
      goto('/login');
    }
  });
</script>
