import { describe, expect, it } from 'vitest';
import { crearApp } from '../src/app.js';
import { prismaTest } from './base.js';

/** App con una ruta que devuelve la IP que ve Fastify (y que va a los logs). */
async function ipVista(trustProxy: boolean) {
  const app = await crearApp({ prisma: prismaTest, trustProxy });
  app.get('/ip', async (request) => ({ ip: request.ip }));
  const res = await app.inject({
    method: 'GET',
    url: '/ip',
    remoteAddress: '172.18.0.5',
    headers: { 'x-forwarded-for': '181.10.20.30' },
  });
  return res.json().ip as string;
}

describe('IP del cliente detrás de Caddy', () => {
  it('con trustProxy, la IP sale de X-Forwarded-For', async () => {
    expect(await ipVista(true)).toBe('181.10.20.30');
  });

  it('sin trustProxy, se ignora X-Forwarded-For', async () => {
    expect(await ipVista(false)).toBe('172.18.0.5');
  });
});
