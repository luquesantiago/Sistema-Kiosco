import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` no necesita la URL; las migraciones sí.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
