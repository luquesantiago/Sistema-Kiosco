import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Mismo origen en desarrollo: la cookie de sesión funciona sin CORS.
    // API_PORT tiene que coincidir con PORT de apps/api/.env (por defecto 3000).
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? '3000'}` },
  },
});
