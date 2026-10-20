import { crearPrisma } from '../src/db.js';

/** Cliente de Prisma conectado a la base de tests. */
export const prismaTest = crearPrisma(process.env.DATABASE_URL!);

/** Vacía todas las tablas de datos (no la de migraciones). */
export async function limpiarBase(): Promise<void> {
  const tablas = await prismaTest.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tablas.length === 0) return;
  const lista = tablas.map((t) => `"${t.tablename}"`).join(', ');
  await prismaTest.$executeRawUnsafe(`TRUNCATE ${lista} CASCADE`);
}
