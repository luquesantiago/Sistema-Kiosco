import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Los comandos de Prisma (migrate, generate) no cargan .env por sí solos.
// loadEnvFile no pisa variables ya definidas (por ejemplo, en los tests o la CI).
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` no necesita la URL; las migraciones sí.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
