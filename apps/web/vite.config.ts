import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// В dev-режиме /api и /ws проксируются на сервер, поэтому клиент и сервер для браузера на одном origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
