import { beforeEach, describe, expect, it } from 'vitest';
import { TEXTO_PRUEBA } from '../src/modules/whatsapp/servicio.js';
import { limpiarBase, prismaTest } from './base.js';
import { crearAppDePrueba, crearUsuarioDePrueba, sesionDe } from './ayudas.js';
import { crearWhatsappFalso } from './whatsapp-falso.js';

beforeEach(async () => {
  await limpiarBase();
});

/** App con WhatsApp falso y la sesión de un admin. */
async function preparar() {
  const { falso, cliente } = crearWhatsappFalso();
  const { app } = await crearAppDePrueba(undefined, { whatsapp: cliente });
  await crearUsuarioDePrueba('ana', 'admin');
  const cookies = await sesionDe(app, 'ana');
  const pedir = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
    app.inject({ method, url: `/api/whatsapp${url}`, cookies, payload: payload as object });
  return { app, falso, cookies, pedir };
}

function crearAviso(estado: 'pendiente' | 'enviada' | 'error' = 'pendiente') {
  return prismaTest.notificacion.create({
    data: { tipo: 'gasto_caja', destino: 'admin', texto: 'Gasto de $8.000', estado },
  });
}

describe('estado de la conexión', () => {
  it('con el chip vinculado muestra conectado, el número del chip y los pendientes', async () => {
    const { pedir } = await preparar();
    await crearAviso();
    await crearAviso('enviada');

    const res = await pedir('GET', '');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      estado: 'conectado',
      cuenta: { numero: '1100000000' },
      destino: null,
      pendientes: 1,
    });
  });

  it('con WAHA caído responde no_disponible sin detalles internos', async () => {
    const { falso, pedir } = await preparar();
    falso.estadoActual = 'no_disponible';

    const res = await pedir('GET', '');

    expect(res.json()).toMatchObject({ estado: 'no_disponible', cuenta: null });
  });

  it('un empleado recibe 403', async () => {
    const { app } = await preparar();
    await crearUsuarioDePrueba('juan');
    const cookies = await sesionDe(app, 'juan');

    const res = await app.inject({ method: 'GET', url: '/api/whatsapp', cookies });

    expect(res.statusCode).toBe(403);
  });
});

describe('sistema sin WhatsApp configurado', () => {
  it('el estado es no_configurado, los avisos quedan pendientes y el resto responde 409', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('ana', 'admin');
    const cookies = await sesionDe(app, 'ana');
    await crearAviso();

    const estado = await app.inject({ method: 'GET', url: '/api/whatsapp', cookies });
    const vincular = await app.inject({ method: 'POST', url: '/api/whatsapp/vincular', cookies });

    expect(estado.json()).toEqual({
      estado: 'no_configurado',
      cuenta: null,
      destino: null,
      pendientes: 1,
    });
    expect(vincular.statusCode).toBe(409);
    expect(vincular.json().error.codigo).toBe('WHATSAPP_NO_CONFIGURADO');
  });

  it('GET /api/health responde ok aunque WhatsApp esté caído', async () => {
    const { falso, cliente } = crearWhatsappFalso();
    falso.estadoActual = 'no_disponible';
    const { app } = await crearAppDePrueba(undefined, { whatsapp: cliente });

    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json().estado).toBe('ok');
  });
});

describe('vinculación del chip por QR', () => {
  it('desvinculado: reinicia la sesión, queda esperando el QR y lo muestra', async () => {
    const { falso, pedir } = await preparar();
    falso.estadoActual = 'desvinculado';

    const vincular = await pedir('POST', '/vincular');
    const qr = await pedir('GET', '/qr');

    expect(falso.llamadas).toEqual(['reiniciar']);
    expect(vincular.json().estado).toBe('esperando_qr');
    expect(qr.json()).toEqual({ imagen: 'data:image/png;base64,UVI=' });
  });

  it('si la sesión no existe, la crea', async () => {
    const { falso, pedir } = await preparar();
    falso.estadoActual = 'desvinculado';
    falso.sinSesion = true;

    const res = await pedir('POST', '/vincular');

    expect(falso.llamadas).toEqual(['reiniciar', 'iniciar']);
    expect(res.json().estado).toBe('esperando_qr');
  });

  it('con el chip ya conectado no hace nada y no hay QR', async () => {
    const { falso, pedir } = await preparar();

    const vincular = await pedir('POST', '/vincular');
    const qr = await pedir('GET', '/qr');

    expect(falso.llamadas).toEqual([]);
    expect(vincular.json().estado).toBe('conectado');
    expect(qr.statusCode).toBe(409);
    expect(qr.json().error.codigo).toBe('WHATSAPP_SIN_QR');
  });

  it('esperando el QR no reinicia la sesión (no invalida el QR que se está mostrando)', async () => {
    const { falso, pedir } = await preparar();
    falso.estadoActual = 'esperando_qr';

    await pedir('POST', '/vincular');

    expect(falso.llamadas).toEqual([]);
  });

  it('al escanear, el estado pasa a conectado', async () => {
    const { falso, pedir } = await preparar();
    falso.estadoActual = 'desvinculado';
    await pedir('POST', '/vincular');

    falso.estadoActual = 'conectado';

    expect((await pedir('GET', '')).json().estado).toBe('conectado');
  });
});

describe('desvinculación del chip', () => {
  it('pasa a desvinculado y los avisos nuevos quedan pendientes', async () => {
    const { falso, pedir } = await preparar();

    const res = await pedir('POST', '/desvincular');
    await crearAviso();

    expect(falso.llamadas).toEqual(['desvincular']);
    expect(res.json().estado).toBe('desvinculado');
    expect((await pedir('GET', '')).json().pendientes).toBe(1);
  });
});

describe('número que recibe los avisos', () => {
  it('acepta el formato internacional y lo guarda con 10 dígitos y el chatId', async () => {
    const { pedir } = await preparar();

    const res = await pedir('PUT', '/destino', { numero: '+54 9 11 2345-6789' });

    expect(res.statusCode).toBe(200);
    expect(res.json().destino).toEqual({ numero: '1123456789' });
    expect(
      await prismaTest.configuracionWhatsapp.findUniqueOrThrow({ where: { id: 1 } }),
    ).toMatchObject({ numero: '1123456789', chatId: '5491123456789@c.us' });
  });

  it('cambiar el número reemplaza el anterior', async () => {
    const { pedir } = await preparar();
    await pedir('PUT', '/destino', { numero: '11 2345-6789' });

    await pedir('PUT', '/destino', { numero: '0351 234-5678' });

    expect(await prismaTest.configuracionWhatsapp.findMany()).toEqual([
      expect.objectContaining({ numero: '3512345678' }),
    ]);
  });

  it('rechaza el número con 15 pidiendo cargarlo sin el 15', async () => {
    const { pedir } = await preparar();

    const res = await pedir('PUT', '/destino', { numero: '11 15 2345-6789' });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.codigo).toBe('NUMERO_CON_15');
    expect(res.json().error.mensaje).toMatch(/sin el 15/);
  });

  it('rechaza un número sin WhatsApp y conserva el anterior', async () => {
    const { falso, pedir } = await preparar();
    await pedir('PUT', '/destino', { numero: '11 2345-6789' });
    falso.sinWhatsapp.add('5491199999999');

    const res = await pedir('PUT', '/destino', { numero: '11 9999-9999' });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.codigo).toBe('NUMERO_SIN_WHATSAPP');
    expect((await pedir('GET', '')).json().destino).toEqual({ numero: '1123456789' });
  });

  it('sin el chip vinculado pide vincular primero', async () => {
    const { falso, pedir } = await preparar();
    falso.estadoActual = 'desvinculado';

    const res = await pedir('PUT', '/destino', { numero: '11 2345-6789' });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('WHATSAPP_NO_CONECTADO');
    expect(res.json().error.mensaje).toMatch(/vincul/i);
  });
});

describe('mensaje de prueba', () => {
  it('llega al destino y no se guarda como aviso', async () => {
    const { falso, pedir } = await preparar();
    await pedir('PUT', '/destino', { numero: '11 2345-6789' });

    const res = await pedir('POST', '/prueba');

    expect(res.statusCode).toBe(204);
    expect(falso.enviados).toEqual([{ chatId: '5491123456789@c.us', texto: TEXTO_PRUEBA }]);
    expect(await prismaTest.notificacion.count()).toBe(0);
  });

  it('sin número cargado pide cargarlo', async () => {
    const { pedir } = await preparar();

    const res = await pedir('POST', '/prueba');

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('WHATSAPP_SIN_DESTINO');
  });

  it('si WhatsApp rechaza el envío, responde el motivo', async () => {
    const { falso, pedir } = await preparar();
    await pedir('PUT', '/destino', { numero: '11 2345-6789' });
    falso.fallas = ['rechazo'];

    const res = await pedir('POST', '/prueba');

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatchObject({ codigo: 'WHATSAPP_FALLO' });
    expect(res.json().error.mensaje).toMatch(/rechazó/);
  });
});

describe('reintento manual', () => {
  it('el admin reintenta un aviso en error: vuelve a pendiente con intentos en cero', async () => {
    const { app, cookies } = await preparar();
    const aviso = await prismaTest.notificacion.create({
      data: {
        tipo: 'gasto_caja',
        destino: 'admin',
        texto: 'Gasto',
        estado: 'error',
        intentos: 5,
        error: 'WhatsApp rechazó el pedido (HTTP 500).',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/notificaciones/${aviso.id}/reintentar`,
      cookies,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ estado: 'pendiente', intentos: 0, error: null });
  });

  it('un aviso enviado no se puede reintentar', async () => {
    const { app, cookies } = await preparar();
    const aviso = await crearAviso('enviada');

    const res = await app.inject({
      method: 'POST',
      url: `/api/notificaciones/${aviso.id}/reintentar`,
      cookies,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('AVISO_NO_REINTENTABLE');
    expect(
      (await prismaTest.notificacion.findUniqueOrThrow({ where: { id: aviso.id } })).estado,
    ).toBe('enviada');
  });

  it('un aviso inexistente responde 404 y un empleado 403', async () => {
    const { app, cookies } = await preparar();
    await crearUsuarioDePrueba('juan');
    const empleado = await sesionDe(app, 'juan');
    const aviso = await crearAviso('error');

    const inexistente = await app.inject({
      method: 'POST',
      url: '/api/notificaciones/0198a5b0-0000-7000-8000-000000000000/reintentar',
      cookies,
    });
    const delEmpleado = await app.inject({
      method: 'POST',
      url: `/api/notificaciones/${aviso.id}/reintentar`,
      cookies: empleado,
    });

    expect(inexistente.statusCode).toBe(404);
    expect(delEmpleado.statusCode).toBe(403);
  });
});
