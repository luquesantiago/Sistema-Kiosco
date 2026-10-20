import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // e2e/ es de Playwright (pnpm e2e).
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
