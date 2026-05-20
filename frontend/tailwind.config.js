export default {
  darkMode: 'class',
  content: ['./src/**/*.{svelte,html}'],
  theme: {
    extend: {
      colors: {
        brand: {
          deep: '#020617',
          'surface-1': '#0F172A',
          'surface-2': '#1E293B',
          emerald: '#10B981',
          rose: '#F43F5E',
          cyan: '#22D3EE',
        },
      },
      fontFamily: {
        sans: [
          'Geist',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        mono: [
          'Geist Mono',
          'Menlo',
          'Monaco',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};
