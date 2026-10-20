import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      // Base separada para tests (ver infra/db/init/01-test-db.sql).
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgresql://kiosco:kiosco@localhost:5432/kiosco_test',
    },
  },
});
