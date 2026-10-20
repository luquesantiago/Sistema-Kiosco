/** Base separada para tests (ver infra/db/init/01-test-db.sql). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://kiosco:kiosco@localhost:5432/kiosco_test';
