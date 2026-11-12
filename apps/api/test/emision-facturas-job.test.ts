import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leerCredenciales } from '../src/integrations/arca/cliente.js';
import { iniciarEmisionFacturas } from '../src/jobs/emision-facturas.js';
import { crearArcaFalso } from './arca-falso.js';
import { prismaTest } from './base.js';
import { configArca } from './facturacion-ayudas.js';

/*
 * Tarea de emisión de facturas y lectura de las credenciales al arrancar
 * (cambio facturacion-arca, tarea 5.3). Con ARCA caído la pasada no toca la base.
 */

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as FastifyBaseLogger;

afterEach(() => {
  vi.useRealTimers();
});

describe('iniciarEmisionFacturas', () => {
  it('detener() espera la pasada en curso; el estado es el que vio la última pasada', async () => {
    vi.useFakeTimers();
    const { cliente } = crearArcaFalso();
    let responder!: () => void;
    cliente.estadoServidores = () =>
      new Promise((listo) => {
        responder = () => listo('caido');
      });
    const tarea = iniciarEmisionFacturas({
      prisma: prismaTest,
      arca: cliente,
      config: configArca(),
      ahora: () => new Date(),
      log,
    });
    await vi.advanceTimersByTimeAsync(0);

    let detenida = false;
    const deteniendo = tarea.detener().then(() => {
      detenida = true;
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(detenida).toBe(false);

    responder();
    await deteniendo;
    expect(detenida).toBe(true);
    expect(tarea.estado()).toBe('no_disponible');
  });
});

describe('leerCredenciales', () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'arca-'));

  it('con un certificado inexistente, el error nombra la variable y el archivo', () => {
    const ruta = join(carpeta, 'no-existe.crt');

    expect(() => leerCredenciales({ certificado: ruta, clave: ruta })).toThrow(
      `No se puede leer el archivo de ARCA_CERT_PATH (${ruta}).`,
    );
  });

  it('con un archivo que no es PEM, lo dice sin mostrar el contenido', () => {
    const ruta = join(carpeta, 'basura.crt');
    writeFileSync(ruta, 'contenido-secreto');

    let mensaje = '';
    try {
      leerCredenciales({ certificado: ruta, clave: ruta });
    } catch (error) {
      mensaje = (error as Error).message;
    }
    expect(mensaje).toBe(`El archivo de ARCA_CERT_PATH (${ruta}) no es un PEM válido.`);
    expect(mensaje).not.toContain('contenido-secreto');
    rmSync(carpeta, { recursive: true, force: true });
  });
});
