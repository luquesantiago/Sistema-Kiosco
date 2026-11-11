import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clienteMercadoPago } from '../src/integrations/mercadopago/cliente.js';
import { limpiarBase } from './base.js';
import { crearAppDePrueba, crearUsuarioDePrueba, sesionDe } from './ayudas.js';
import { crearMercadoPagoFalso } from './mercadopago-falso.js';

/** 10:00 en Argentina. */
const DIEZ = new Date('2026-11-11T13:00:00.000Z');
const TOKEN = 'APP_USR-token-secreto-de-prueba';

let servidor: Server | undefined;

beforeEach(async () => {
  await limpiarBase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  servidor?.closeAllConnections();
  await new Promise((listo) => (servidor ? servidor.close(listo) : listo(undefined)));
  servidor = undefined;
});

/** App con Mercado Pago falso y sesiones de un admin y un empleado. */
async function preparar() {
  const { falso, cliente } = crearMercadoPagoFalso();
  const { app, adelantar } = await crearAppDePrueba(DIEZ, { mercadoPago: cliente });
  await crearUsuarioDePrueba('ana', 'admin');
  await crearUsuarioDePrueba('juan');
  const admin = await sesionDe(app, 'ana');
  const empleado = await sesionDe(app, 'juan');
  const saldo = (cookies?: typeof admin) =>
    app.inject({ method: 'GET', url: '/api/mercado-pago/saldo', cookies });
  return { app, falso, adelantar, admin, empleado, saldo };
}

function responder(res: ServerResponse, status: number, cuerpo: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
}

describe('GET /api/mercado-pago/saldo', () => {
  it('el admin ve disponible $250.000,00, a liberar $40.000,00 y la hora de lectura (10:00)', async () => {
    const { saldo, admin } = await preparar();

    const res = await saldo(admin);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      estado: 'disponible',
      disponible: '250000.00',
      aLiberar: '40000.00',
      leidoEn: '2026-11-11T13:00:00.000Z',
      desactualizado: false,
    });
  });

  it('el empleado recibe el mismo saldo que el admin (y sale de la misma lectura)', async () => {
    const { saldo, admin, empleado, falso } = await preparar();

    const delAdmin = await saldo(admin);
    const delEmpleado = await saldo(empleado);

    expect(delEmpleado.statusCode).toBe(200);
    expect(delEmpleado.json()).toEqual(delAdmin.json());
    expect(falso.llamadas).toBe(1);
  });

  it('si MP no informa lo que está a liberar, aLiberar es null', async () => {
    const { saldo, admin, falso } = await preparar();
    falso.saldo = { disponible: '250000.00', aLiberar: null };

    expect((await saldo(admin)).json()).toMatchObject({
      estado: 'disponible',
      disponible: '250000.00',
      aLiberar: null,
    });
  });

  it('sin sesión responde 401 y no consulta a MP', async () => {
    const { saldo, falso } = await preparar();

    const res = await saldo();

    expect(res.statusCode).toBe(401);
    expect(res.json().error.codigo).toBe('NO_AUTENTICADO');
    expect(falso.llamadas).toBe(0);
  });

  it('usa el reloj de la app: a los 59,999 s reutiliza la caché y a los 60 s vuelve a pedir', async () => {
    const { saldo, admin, falso, adelantar } = await preparar();
    await saldo(admin);

    adelantar(59_999);
    await saldo(admin);
    expect(falso.llamadas).toBe(1);

    adelantar(1);
    const res = await saldo(admin);
    expect(falso.llamadas).toBe(2);
    expect(res.json()).toMatchObject({ leidoEn: '2026-11-11T13:01:00.000Z' });
  });

  it('si MP deja de responder, devuelve el último saldo marcado como desactualizado', async () => {
    const { saldo, admin, falso, adelantar } = await preparar();
    await saldo(admin);
    adelantar(5 * 60_000);
    falso.falla = 'no_responde';

    const res = await saldo(admin);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      estado: 'disponible',
      disponible: '250000.00',
      aLiberar: '40000.00',
      leidoEn: '2026-11-11T13:00:00.000Z',
      desactualizado: true,
      motivo: 'no_responde',
    });
  });

  it('con credenciales rechazadas y sin saldo anterior: no disponible, sin detalles de MP', async () => {
    const { saldo, admin, falso } = await preparar();
    falso.falla = 401;

    const res = await saldo(admin);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ estado: 'no_disponible', motivo: 'credenciales' });
    expect(res.body).not.toContain('detalle-interno-de-mp');
  });
});

describe('el token nunca llega a la web', () => {
  /** App con el cliente real contra una API de MP local que responde `status` en el saldo. */
  async function conMpLocal(status: number) {
    servidor = createServer((req, res) => {
      if (req.url === '/users/me') return responder(res, 200, { id: 123456 });
      if (status === 200) {
        return responder(res, 200, { available_balance: 250000, unavailable_balance: 40000 });
      }
      responder(res, status, { message: `detalle interno ${TOKEN}` });
    });
    await new Promise<void>((listo) => servidor!.listen(0, '127.0.0.1', listo));
    const baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

    const { app } = await crearAppDePrueba(DIEZ, {
      mercadoPago: clienteMercadoPago(TOKEN, { baseUrl }),
    });
    await crearUsuarioDePrueba('juan');
    return { app, cookies: await sesionDe(app, 'juan') };
  }

  it.each([
    { status: 200, esperado: { estado: 'disponible' } },
    { status: 401, esperado: { estado: 'no_disponible', motivo: 'credenciales' } },
    { status: 500, esperado: { estado: 'no_disponible', motivo: 'no_responde' } },
  ])('MP responde $status: la respuesta no incluye el token ni el detalle de MP', async ({
    status,
    esperado,
  }) => {
    const { app, cookies } = await conMpLocal(status);

    const res = await app.inject({ method: 'GET', url: '/api/mercado-pago/saldo', cookies });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject(esperado);
    expect(res.body).not.toContain(TOKEN);
    expect(res.body).not.toContain('APP_USR');
    expect(res.body).not.toContain('detalle interno');
  });
});

describe('sistema sin Mercado Pago configurado', () => {
  it('sin cliente el saldo es no_configurado y no se hace ningún pedido HTTP', async () => {
    const fetchEspia = vi.spyOn(globalThis, 'fetch');
    const { app } = await crearAppDePrueba(DIEZ);
    await crearUsuarioDePrueba('ana', 'admin');
    const cookies = await sesionDe(app, 'ana');

    const res = await app.inject({ method: 'GET', url: '/api/mercado-pago/saldo', cookies });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ estado: 'no_configurado' });
    expect(fetchEspia).not.toHaveBeenCalled();
  });

  it('con MP caído, GET /api/health responde 200 ok y no consulta a MP', async () => {
    const { falso, cliente } = crearMercadoPagoFalso();
    falso.colgado = true;
    const { app } = await crearAppDePrueba(DIEZ, { mercadoPago: cliente });

    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ estado: 'ok' });
    expect(falso.llamadas).toBe(0);
  });
});
