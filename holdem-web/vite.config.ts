import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Colyseus ws/http endpoint.
      '/matchmake': {
        target: 'http://localhost:2567',
        changeOrigin: true,
      },
    },
  },
});
