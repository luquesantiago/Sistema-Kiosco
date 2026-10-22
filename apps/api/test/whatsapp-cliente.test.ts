import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clienteWaha,
  WhatsappNoDisponible,
  WhatsappRechazo,
} from '../src/modules/whatsapp/cliente.js';

type Manejador = (
  req: IncomingMessage & { cuerpo: unknown },
  res: ServerResponse,
) => void | Promise<void>;

let servidor: Server | undefined;

/** Levanta un WAHA de mentira en un puerto libre y devuelve su URL. */
async function wahaFalso(manejador: Manejador): Promise<string> {
  servidor = createServer(async (req, res) => {
    let texto = '';
    for await (const parte of req) texto += parte;
    const conCuerpo = Object.assign(req, { cuerpo: texto ? JSON.parse(texto) : undefined });
    await manejador(conCuerpo, res);
  });
  await new Promise<void>((listo) => servidor!.listen(0, '127.0.0.1', listo));
  return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}

function responder(res: ServerResponse, status: number, cuerpo?: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(cuerpo === undefined ? undefined : JSON.stringify(cuerpo));
}

afterEach(async () => {
  await new Promise((listo) => (servidor ? servidor.close(listo) : listo(undefined)));
  servidor = undefined;
});

describe('clienteWaha', () => {
  it('traduce los estados de WAHA y manda la API key', async () => {
    const claves: (string | undefined)[] = [];
    let status = 'WORKING';
    const url = await wahaFalso((req, res) => {
      claves.push(req.headers['x-api-key'] as string);
      responder(res, 200, { name: 'default', status, me: { id: '5491100000000@c.us' } });
    });
    const cliente = clienteWaha(url, 'clave');

    expect(await cliente.estado()).toEqual({ estado: 'conectado', cuenta: '5491100000000' });
    for (const [waha, esperado] of [
      ['SCAN_QR_CODE', 'esperando_qr'],
      ['STARTING', 'esperando_qr'],
      ['STOPPED', 'desvinculado'],
      ['FAILED', 'desvinculado'],
      ['PASSKEY_REQUIRED', 'desvinculado'],
    ]) {
      status = waha!;
      expect(await cliente.estado(), waha).toEqual({ estado: esperado, cuenta: null });
    }
    expect(claves.every((c) => c === 'clave')).toBe(true);
  });

  it('sesión inexistente es desvinculado y WAHA caído es no disponible', async () => {
    let status = 404;
    const url = await wahaFalso((_req, res) => responder(res, status, { message: 'interno' }));
    const cliente = clienteWaha(url, 'clave');

    expect(await cliente.estado()).toEqual({ estado: 'desvinculado', cuenta: null });
    status = 502;
    expect(await cliente.estado()).toEqual({ estado: 'no_disponible', cuenta: null });

    const sinServidor = clienteWaha('http://127.0.0.1:9', 'clave');
    expect(await sinServidor.estado()).toEqual({ estado: 'no_disponible', cuenta: null });
  });

  it('crea la sesión si al iniciarla no existe', async () => {
    const pedidos: string[] = [];
    const url = await wahaFalso((req, res) => {
      pedidos.push(`${req.method} ${req.url} ${JSON.stringify(req.cuerpo ?? null)}`);
      if (req.url === '/api/sessions/default/start') return responder(res, 404, {});
      responder(res, 201, {});
    });

    await clienteWaha(url, 'clave').iniciar();

    expect(pedidos).toEqual([
      'POST /api/sessions/default/start null',
      'POST /api/sessions {"name":"default","start":true}',
    ]);
  });

  it('devuelve el QR como data URL', async () => {
    const url = await wahaFalso((req, res) => {
      expect(req.url).toBe('/api/default/auth/qr');
      expect(req.headers.accept).toBe('application/json');
      responder(res, 200, { mimetype: 'image/png', data: 'UVI=' });
    });

    expect(await clienteWaha(url, 'clave').qr()).toBe('data:image/png;base64,UVI=');
  });

  it('verifica números con check-exists', async () => {
    const url = await wahaFalso((req, res) => {
      const existe = req.url!.includes('phone=5491123456789');
      responder(res, 200, {
        numberExists: existe,
        chatId: existe ? '123@lid' : null,
      });
    });
    const cliente = clienteWaha(url, 'clave');

    expect(await cliente.verificarNumero('5491123456789')).toBe('123@lid');
    expect(await cliente.verificarNumero('5491199999999')).toBeNull();
  });

  it('envía texto y distingue rechazo de no disponible', async () => {
    let status = 201;
    const cuerpos: unknown[] = [];
    const url = await wahaFalso((req, res) => {
      cuerpos.push(req.cuerpo);
      responder(res, status, { detalle: 'secreto interno' });
    });
    const cliente = clienteWaha(url, 'clave');

    await cliente.enviarTexto('123@c.us', 'Hola');
    expect(cuerpos).toEqual([{ session: 'default', chatId: '123@c.us', text: 'Hola' }]);

    status = 500;
    const rechazo = await cliente.enviarTexto('123@c.us', 'Hola').catch((e: unknown) => e);
    expect(rechazo).toBeInstanceOf(WhatsappRechazo);
    expect((rechazo as Error).message).not.toContain('secreto');

    await expect(clienteWaha('http://127.0.0.1:9', 'clave').enviarTexto('1', 'x')).rejects.toThrow(
      WhatsappNoDisponible,
    );
  });

  it('corta por timeout si WAHA no contesta', async () => {
    const url = await wahaFalso(() => {
      // No responde nunca.
    });

    await expect(
      clienteWaha(url, 'clave', { timeoutMs: 200 }).enviarTexto('1', 'x'),
    ).rejects.toThrow(WhatsappNoDisponible);
    servidor!.closeAllConnections();
  });
});
