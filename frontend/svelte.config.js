import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      out: 'build',
      precompress: false,
    }),
    serviceWorker: {
      register: process.env.NODE_ENV === 'production',
    },
    env: {
      dir: '.',
      publicPrefix: '',
    },
  },
};
