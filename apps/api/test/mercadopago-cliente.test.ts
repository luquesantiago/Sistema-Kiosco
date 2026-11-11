import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clienteMercadoPago,
  MercadoPagoNoDisponible,
  MercadoPagoRechazo,
} from '../src/integrations/mercadopago/cliente.js';

const TOKEN = 'APP_USR-token-secreto-de-prueba';
const USUARIO = 123456;
const RUTA_SALDO = `/users/${USUARIO}/mercadopago_account/balance`;

type Manejador = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

let servidor: Server | undefined;

/** Levanta una API de Mercado Pago de mentira en un puerto libre y devuelve su URL. */
async function mpFalso(manejador: Manejador): Promise<string> {
  servidor = createServer((req, res) => void manejador(req, res));
  await new Promise<void>((listo) => servidor!.listen(0, '127.0.0.1', listo));
  return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}

function responder(res: ServerResponse, status: number, cuerpo?: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(cuerpo === undefined ? undefined : JSON.stringify(cuerpo));
}

/** MP que contesta `/users/me` y el saldo con el cuerpo dado. */
function mpConSaldo(saldo: Record<string, unknown>, pedidos: string[] = []) {
  return mpFalso((req, res) => {
    pedidos.push(req.url!);
    if (req.url === '/users/me') return responder(res, 200, { id: USUARIO, nickname: 'KIOSCO' });
    if (req.url === RUTA_SALDO) return responder(res, 200, saldo);
    responder(res, 404, { message: 'not found' });
  });
}

afterEach(async () => {
  servidor?.closeAllConnections();
  await new Promise((listo) => (servidor ? servidor.close(listo) : listo(undefined)));
  servidor = undefined;
});

describe('clienteMercadoPago: lectura del saldo', () => {
  it('pide el usuario y su saldo con el token, y devuelve disponible y a liberar', async () => {
    const pedidos: string[] = [];
    const autorizaciones: (string | undefined)[] = [];
    const url = await mpFalso((req, res) => {
      pedidos.push(req.url!);
      autorizaciones.push(req.headers.authorization);
      if (req.url === '/users/me') return responder(res, 200, { id: USUARIO });
      responder(res, 200, {
        available_balance: 250000,
        unavailable_balance: 40000,
        total_amount: 290000,
      });
    });

    const saldo = await clienteMercadoPago(TOKEN, { baseUrl: url }).saldo();

    expect(saldo).toEqual({ disponible: '250000.00', aLiberar: '40000.00' });
    expect(pedidos).toEqual(['/users/me', RUTA_SALDO]);
    expect(autorizaciones).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
  });

  it('el usuario de /users/me se pide una sola vez y queda en memoria', async () => {
    const pedidos: string[] = [];
    const url = await mpConSaldo({ available_balance: 1, unavailable_balance: 0 }, pedidos);
    const cliente = clienteMercadoPago(TOKEN, { baseUrl: url });

    await cliente.saldo();
    await cliente.saldo();

    expect(pedidos).toEqual(['/users/me', RUTA_SALDO, RUTA_SALDO]);
  });

  it('sin unavailable_balance, a liberar es null', async () => {
    const url = await mpConSaldo({ available_balance: 250000, total_amount: 250000 });

    expect(await clienteMercadoPago(TOKEN, { baseUrl: url }).saldo()).toEqual({
      disponible: '250000.00',
      aLiberar: null,
    });
  });

  // Los montos llegan como números JSON y salen como texto con 2 decimales (vía Decimal).
  it.each([
    { mp: 0, texto: '0.00' },
    { mp: 0.01, texto: '0.01' },
    { mp: 0.1, texto: '0.10' },
    { mp: 1234.5, texto: '1234.50' },
    { mp: 1234.56, texto: '1234.56' },
    { mp: 250000, texto: '250000.00' },
    { mp: 99999999.99, texto: '99999999.99' },
  ])('el monto $mp de MP se devuelve como "$texto"', async ({ mp, texto }) => {
    const url = await mpConSaldo({ available_balance: mp, unavailable_balance: mp });

    expect(await clienteMercadoPago(TOKEN, { baseUrl: url }).saldo()).toEqual({
      disponible: texto,
      aLiberar: texto,
    });
  });
});

describe('clienteMercadoPago: errores', () => {
  // 4xx es un rechazo (con su código); 5xx es "no responde".
  it.each([
    { status: 400, error: MercadoPagoRechazo },
    { status: 401, error: MercadoPagoRechazo },
    { status: 403, error: MercadoPagoRechazo },
    { status: 404, error: MercadoPagoRechazo },
    { status: 499, error: MercadoPagoRechazo },
    { status: 500, error: MercadoPagoNoDisponible },
    { status: 502, error: MercadoPagoNoDisponible },
    { status: 599, error: MercadoPagoNoDisponible },
  ])('MP responde $status en el saldo', async ({ status, error }) => {
    const url = await mpFalso((req, res) => {
      if (req.url === '/users/me') return responder(res, 200, { id: USUARIO });
      responder(res, status, { message: 'detalle interno de MP', error: 'unauthorized' });
    });

    const falla = await clienteMercadoPago(TOKEN, { baseUrl: url })
      .saldo()
      .catch((e: unknown) => e);

    expect(falla).toBeInstanceOf(error);
    if (falla instanceof MercadoPagoRechazo) expect(falla.status).toBe(status);
    expect((falla as Error).message).not.toContain(TOKEN);
    expect((falla as Error).message).not.toContain('detalle interno');
  });

  it('credenciales rechazadas ya en /users/me es un rechazo 401 sin el token', async () => {
    const url = await mpFalso((_req, res) =>
      responder(res, 401, { message: 'invalid access token', detalle: TOKEN }),
    );

    const falla = await clienteMercadoPago(TOKEN, { baseUrl: url })
      .saldo()
      .catch((e: unknown) => e);

    expect(falla).toBeInstanceOf(MercadoPagoRechazo);
    expect((falla as MercadoPagoRechazo).status).toBe(401);
    expect(JSON.stringify(falla)).not.toContain(TOKEN);
    expect((falla as Error).message).not.toContain(TOKEN);
    expect((falla as Error).message).not.toContain('invalid access token');
  });

  it('sin red (nadie escucha en el puerto) es no disponible', async () => {
    await expect(
      clienteMercadoPago(TOKEN, { baseUrl: 'http://127.0.0.1:9' }).saldo(),
    ).rejects.toThrow(MercadoPagoNoDisponible);
  });

  it('corta por timeout si MP no contesta (timeoutMs reducido)', async () => {
    const url = await mpFalso(() => {
      // No responde nunca.
    });

    await expect(
      clienteMercadoPago(TOKEN, { baseUrl: url, timeoutMs: 200 }).saldo(),
    ).rejects.toThrow(MercadoPagoNoDisponible);
  });
});

/**
 * Borde del timeout con el valor por defecto (10 s, sin pasar `timeoutMs`): se usa
 * el reloj real porque el límite lo pone `AbortSignal.timeout` del `fetch`. Los dos
 * casos suman unos 20 s; el margen de 100 ms hace que no dependan de la latencia local.
 */
describe('clienteMercadoPago: borde del timeout de 10 s', () => {
  function mpQueTarda(ms: number) {
    return mpFalso((req, res) => {
      if (req.url === '/users/me') return responder(res, 200, { id: USUARIO });
      setTimeout(() => {
        if (!res.writableEnded && !res.destroyed) {
          responder(res, 200, { available_balance: 250000, unavailable_balance: 40000 });
        }
      }, ms);
    });
  }

  it('responde a los 9,9 s: devuelve el saldo', { timeout: 15_000 }, async () => {
    const url = await mpQueTarda(9_900);

    expect(await clienteMercadoPago(TOKEN, { baseUrl: url }).saldo()).toEqual({
      disponible: '250000.00',
      aLiberar: '40000.00',
    });
  });

  it('a los 10 s todavía no respondió: no disponible', { timeout: 15_000 }, async () => {
    const url = await mpQueTarda(10_000);

    await expect(clienteMercadoPago(TOKEN, { baseUrl: url }).saldo()).rejects.toThrow(
      MercadoPagoNoDisponible,
    );
  });
});
