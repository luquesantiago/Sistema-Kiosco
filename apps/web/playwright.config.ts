import { defineConfig, devices } from '@playwright/test';

/** La API compilada, en modo producción y sirviendo la web, contra la base de tests. */
export const PUERTO_E2E = 3100;
export const DATABASE_URL_E2E =
  process.env.TEST_DATABASE_URL ?? 'postgresql://kiosco:kiosco@localhost:5432/kiosco_test';

const enCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  // Comparten la base: de a uno.
  workers: 1,
  fullyParallel: false,
  forbidOnly: enCi,
  retries: enCi ? 1 : 0,
  reporter: enCi ? [['github'], ['list']] : 'list',
  globalSetup: './e2e/preparar.ts',
  use: {
    // localhost (no 127.0.0.1): Chromium acepta ahí la cookie Secure del modo producción.
    baseURL: `http://localhost:${PUERTO_E2E}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter web build && pnpm --filter api build && node ../api/dist/server.js',
    url: `http://localhost:${PUERTO_E2E}/api/health`,
    env: {
      PORT: String(PUERTO_E2E),
      DATABASE_URL: DATABASE_URL_E2E,
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
    },
    reuseExistingServer: !enCi,
    timeout: 240_000,
  },
});
