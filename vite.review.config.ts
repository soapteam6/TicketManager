import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// This entry never loads the Power Apps plugin, .env files, SDK context or connectors.
export default defineConfig({
  envDir: false,
  plugins: [
    react(),
    {
      name: 'isolated-synthetic-review-entry',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) =>
          html.replace('/src/main.tsx', '/src/review/main.tsx'),
      },
    },
  ],
  server: {
    watch: { ignored: ['**/design-artifacts.local/**'] },
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: { strict: true },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: 'review-dist' },
});
