import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// В dev-режиме /api (включая поток SSE) проксируется на сервер, поэтому клиент и сервер для браузера на одном origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      // Адрес сервера можно переопределить: e2e-тесты поднимают свой сервер на другом порту.
      '/api': process.env.API_TARGET ?? 'http://localhost:3000',
    },
  },
});
