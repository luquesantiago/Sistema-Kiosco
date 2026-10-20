import { estadoServicioSchema } from '@kiosco/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app.js';
import { crearPrisma } from '../src/db.js';

const prisma = crearPrisma(process.env.DATABASE_URL!);
// Puerto donde no escucha nada: la conexión se rechaza enseguida.
const prismaCaido = crearPrisma('postgresql://kiosco:kiosco@127.0.0.1:1/kiosco_test');

afterAll(async () => {
  await prisma.$disconnect();
  await prismaCaido.$disconnect();
});

describe('GET /api/health', () => {
  it('responde 200 ok cuando la base responde', async () => {
    const app = await crearApp({
      verificarBase: async () => {
        await prisma.$queryRaw`SELECT 1`;
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    const cuerpo = estadoServicioSchema.parse(res.json());
    expect(cuerpo).toMatchObject({ estado: 'ok', baseDeDatos: 'ok' });
    expect(cuerpo.hora).toMatch(/Z$/);
  });

  it('responde 503 degradado sin detalles internos cuando la base está caída', async () => {
    const app = await crearApp({
      verificarBase: async () => {
        await prismaCaido.$queryRaw`SELECT 1`;
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(503);
    expect(Object.keys(res.json()).sort()).toEqual(['baseDeDatos', 'estado', 'hora']);
    expect(res.json()).toMatchObject({ estado: 'degradado', baseDeDatos: 'error' });
    expect(res.body).not.toContain('kiosco:kiosco');
  });

  it('responde antes de 3 segundos aunque la base no conteste', async () => {
    const app = await crearApp({ verificarBase: () => new Promise<void>(() => {}) });
    const inicio = Date.now();
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(Date.now() - inicio).toBeLessThan(3000);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ baseDeDatos: 'error' });
  });

  it('no pide sesión', async () => {
    const app = await crearApp({ verificarBase: async () => {} });
    const res = await app.inject({ method: 'GET', url: '/api/health', cookies: {} });
    expect(res.statusCode).toBe(200);
  });
});
