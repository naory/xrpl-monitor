import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3000,
    proxy: {
      '/fills':  { target: 'http://127.0.0.1:3002', changeOrigin: true },
      '/book':   { target: 'http://127.0.0.1:3002', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:3002', changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
  },
});
