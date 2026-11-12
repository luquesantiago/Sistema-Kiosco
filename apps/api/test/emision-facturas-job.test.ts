import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import forge from 'node-forge';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
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

/** Tarea con ARCA "caído": cada pasada solo llama a `estadoServidores` y no toca la base. */
function tareaConArcaCaido() {
  const { cliente } = crearArcaFalso();
  const consultas = { cantidad: 0 };
  cliente.estadoServidores = async () => {
    consultas.cantidad++;
    return 'caido';
  };
  const tarea = iniciarEmisionFacturas({
    prisma: prismaTest,
    arca: cliente,
    config: configArca(),
    ahora: () => new Date(),
    log,
  });
  return { tarea, consultas };
}

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

  // Bordes agregados en la revisión.
  it('antes de la primera pasada el estado es "disponible"', async () => {
    vi.useFakeTimers();
    const { tarea } = tareaConArcaCaido();

    expect(tarea.estado()).toBe('disponible');

    await vi.advanceTimersByTimeAsync(0);
    expect(tarea.estado()).toBe('no_disponible');
    await tarea.detener();
  });

  it('corre al arrancar y después cada 10 s: nada a los 9.999 ms, la segunda a los 10.000 ms', async () => {
    vi.useFakeTimers();
    const { tarea, consultas } = tareaConArcaCaido();
    await vi.advanceTimersByTimeAsync(0);
    expect(consultas.cantidad).toBe(1);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(consultas.cantidad).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(consultas.cantidad).toBe(2);
    await tarea.detener();
  });

  it('despertar() adelanta la pasada sin esperar los 10 s', async () => {
    vi.useFakeTimers();
    const { tarea, consultas } = tareaConArcaCaido();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(consultas.cantidad).toBe(1);

    tarea.despertar();
    await vi.advanceTimersByTimeAsync(0);

    expect(consultas.cantidad).toBe(2);
    await tarea.detener();
  });
});

describe('leerCredenciales', () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'arca-'));

  afterAll(() => {
    rmSync(carpeta, { recursive: true, force: true });
  });

  /** Certificado autofirmado y su clave, en PEM, guardados en la carpeta del test. */
  function credencialesValidas() {
    const claves = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.createCertificate();
    cert.publicKey = claves.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
    cert.validity.notAfter = new Date('2028-01-01T00:00:00Z');
    cert.setSubject([{ name: 'commonName', value: 'kiosco' }]);
    cert.setIssuer([{ name: 'commonName', value: 'kiosco' }]);
    cert.sign(claves.privateKey, forge.md.sha256.create());
    const certificado = join(carpeta, 'valido.crt');
    const clave = join(carpeta, 'valida.key');
    writeFileSync(certificado, forge.pki.certificateToPem(cert));
    writeFileSync(clave, forge.pki.privateKeyToPem(claves.privateKey));
    return { certificado, clave };
  }

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
  });

  it('con los dos archivos válidos devuelve el certificado y la clave en PEM', () => {
    const rutas = credencialesValidas();

    const leidas = leerCredenciales(rutas);

    expect(leidas.certificado).toContain('-----BEGIN CERTIFICATE-----');
    expect(leidas.clave).toContain('PRIVATE KEY-----');
  });

  it('con el certificado bien y la clave inexistente, el error nombra ARCA_KEY_PATH', () => {
    const { certificado } = credencialesValidas();
    const clave = join(carpeta, 'no-existe.key');

    expect(() => leerCredenciales({ certificado, clave })).toThrow(
      `No se puede leer el archivo de ARCA_KEY_PATH (${clave}).`,
    );
  });

  it('con el certificado en el lugar de la clave, dice que la clave no es un PEM válido sin mostrarla', () => {
    const { certificado } = credencialesValidas();

    let mensaje = '';
    try {
      leerCredenciales({ certificado, clave: certificado });
    } catch (error) {
      mensaje = (error as Error).message;
    }
    expect(mensaje).toBe(`El archivo de ARCA_KEY_PATH (${certificado}) no es un PEM válido.`);
    expect(mensaje).not.toContain('BEGIN');
  });
});
