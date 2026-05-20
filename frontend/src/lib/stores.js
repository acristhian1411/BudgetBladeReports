import { writable } from 'svelte/store';

/**
 * Create auth store with token persistence
 */
function createAuthStore() {
  const token = typeof window !== 'undefined'
    ? sessionStorage.getItem('auth_token')
    : null;

  const { subscribe, set } = writable({
    token: token,
    user: null,
    isLoading: false,
  });

  return {
    subscribe,
    setToken: (newToken, user = null) => {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('auth_token', newToken);
      }
      set({ token: newToken, user, isLoading: false });
    },
    logout: () => {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('auth_token');
      }
      set({ token: null, user: null, isLoading: false });
    },
    setLoading: (isLoading) => {
      set((current) => ({ ...current, isLoading }));
    },
  };
}

export const authStore = createAuthStore();

/**
 * Create sync status store
 */
export const syncStore = writable({
  isSyncing: false,
  progress: 0,
  status: '',
  logs: [],
  error: null,
});
