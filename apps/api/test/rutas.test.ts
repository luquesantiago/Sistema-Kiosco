import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errorApiSchema } from '@kiosco/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app.js';
import { prismaTest } from './base.js';

const verificarBase = async () => {};

const webDist = mkdtempSync(join(tmpdir(), 'kiosco-web-'));
writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>Kiosco</title>');
writeFileSync(join(webDist, 'app.js'), 'console.log("kiosco");');

afterAll(() => {
  rmSync(webDist, { recursive: true, force: true });
});

describe('rutas inexistentes', () => {
  it('una ruta de API desconocida responde 404 con el formato de error', async () => {
    const app = await crearApp({ prisma: prismaTest, verificarBase });
    const res = await app.inject({ method: 'GET', url: '/api/no-existe' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(errorApiSchema.parse(res.json()).error.codigo).toBe('NO_ENCONTRADO');
  });
});

describe('build de la web', () => {
  it('sirve index.html en / y en rutas de la SPA', async () => {
    const app = await crearApp({ prisma: prismaTest, verificarBase, webDist });

    for (const url of ['/', '/admin/productos']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('<title>Kiosco</title>');
    }
  });

  it('sirve los archivos estáticos del build', async () => {
    const app = await crearApp({ prisma: prismaTest, verificarBase, webDist });
    const res = await app.inject({ method: 'GET', url: '/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('kiosco');
  });

  it('las rutas de API desconocidas siguen respondiendo JSON', async () => {
    const app = await crearApp({ prisma: prismaTest, verificarBase, webDist });
    const res = await app.inject({ method: 'GET', url: '/api/no-existe' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('sin build, / responde 404 JSON', async () => {
    const app = await crearApp({
      prisma: prismaTest,
      verificarBase,
      webDist: join(webDist, 'no-existe'),
    });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });
});
