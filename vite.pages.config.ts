import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Both planners run entirely in the browser; Pages needs no server or API.
export default defineConfig({
  root: local('./pages'),
  base: '/HTS-plate-map-designer/',
  publicDir: local('./public'),
  plugins: [react()],
  resolve: { alias: { '@': local('./') } },
  build: {
    outDir: local('./dist-pages'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        detailed: local('./pages/index.html'),
        simple: local('./pages/simple/index.html'),
      },
    },
  },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
