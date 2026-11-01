import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// The browser talks to the same origin: Vite forwards /api to the backend,
	// so no CORS and no dependency on a published backend port.
	server: {
		proxy: {
			'/api': process.env.VITE_PROXY_TARGET || 'http://localhost:3000',
		},
	},
});
