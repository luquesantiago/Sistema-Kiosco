import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/url-base.js';

export default defineConfig({
  test: {
    env: { DATABASE_URL: TEST_DATABASE_URL },
    globalSetup: ['./test/setup-global.ts'],
    // Todos los archivos comparten la misma base: se corren de a uno.
    fileParallelism: false,
  },
});
