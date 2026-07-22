import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El frontend corre en :5173 y hace proxy de /api al backend Node en :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
