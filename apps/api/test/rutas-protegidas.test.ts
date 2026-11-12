import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase, prismaTest } from './base.js';
import {
  abrirTurnoDePrueba,
  cerrarTurnoDePrueba,
  crearAppDePrueba,
  crearUsuarioDePrueba,
  ingresar,
  sesionDe,
} from './ayudas.js';

/**
 * Las únicas rutas de la API que se pueden usar sin sesión. El webhook de Mercado Pago
 * se protege con la firma (ver `cobro-mp.test.ts`).
 */
const RUTAS_ABIERTAS = [
  'POST /api/auth/ingresar',
  'GET /api/health',
  'POST /api/mercado-pago/webhook',
];

/** Módulos solo para el admin, salvo las rutas indicadas que también usa el empleado. */
const PREFIJOS_ADMIN = [
  '/api/usuarios',
  '/api/proveedores',
  '/api/productos',
  '/api/stock',
  '/api/notificaciones',
  '/api/caja',
  '/api/whatsapp',
  '/api/pedidos',
  '/api/dashboard',
  '/api/mercado-pago',
  '/api/facturacion',
  '/api/facturas',
];
const RUTAS_DEL_EMPLEADO = [
  'GET /api/productos',
  'GET /api/stock/proveedores',
  'GET /api/caja/estado',
  'POST /api/caja/turnos',
  'POST /api/caja/turnos/:id/cerrar',
  'GET /api/caja/movimientos',
  'POST /api/caja/movimientos',
  'GET /api/pedidos',
  'GET /api/pedidos/productos',
  'GET /api/pedidos/:id',
  'POST /api/pedidos/:id/llego',
  'POST /api/pedidos/sin-pedido',
  'POST /api/pedidos/:id/carga',
  'POST /api/pedidos/:id/pago',
  'GET /api/mercado-pago/saldo',
  // cobro-mercado-pago: la devolución en efectivo la confirma quien opera el turno.
  'POST /api/mercado-pago/cobros/:id/devolucion',
  'POST /api/mercado-pago/cobros/:id/sin-devolver',
];

const ID_CUALQUIERA = '0198a5b0-0000-7000-8000-000000000000';

type App = Awaited<ReturnType<typeof crearAppDePrueba>>['app'];

/** Rutas de /api registradas, una por método. */
function rutasDeApi(app: App) {
  return app.rutasRegistradas
    .flatMap(({ method, url }) =>
      (Array.isArray(method) ? method : [method]).map((m) => ({ m, url })),
    )
    .filter(({ m, url }) => url.startsWith('/api/') && m !== 'HEAD' && m !== 'OPTIONS');
}

beforeEach(async () => {
  await limpiarBase();
});

describe('acceso a la API según sesión', () => {
  it('toda ruta de /api, salvo las abiertas, responde 401 sin sesión', async () => {
    const { app } = await crearAppDePrueba();
    await app.ready();

    const protegidas = rutasDeApi(app).filter(
      ({ m, url }) => !RUTAS_ABIERTAS.includes(`${m} ${url}`),
    );

    expect(protegidas.length).toBeGreaterThan(0);
    for (const { m, url } of protegidas) {
      const res = await app.inject({
        method: m as 'GET',
        url: url.replace(':id', ID_CUALQUIERA),
        payload: m === 'GET' ? undefined : {},
      });
      expect(res.statusCode, `${m} ${url}`).toBe(401);
      expect(res.json().error.codigo, `${m} ${url}`).toBe('NO_AUTENTICADO');
    }
  });

  it('un empleado recibe 403 en una ruta de admin', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    const cookies = await sesionDe(app, 'juan');

    const res = await app.inject({ method: 'GET', url: '/api/usuarios', cookies });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.codigo).toBe('SIN_PERMISO');
  });

  it('los módulos de admin responden 403 al empleado, salvo búsqueda y pedidos', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    const cookies = await sesionDe(app, 'juan');

    const deAdmin = rutasDeApi(app).filter(
      ({ m, url }) =>
        PREFIJOS_ADMIN.some((p) => url === p || url.startsWith(`${p}/`)) &&
        !RUTAS_DEL_EMPLEADO.includes(`${m} ${url}`) &&
        !RUTAS_ABIERTAS.includes(`${m} ${url}`),
    );

    expect(deAdmin.map(({ m, url }) => `${m} ${url}`)).toEqual(
      expect.arrayContaining([
        'GET /api/proveedores',
        'GET /api/notificaciones',
        'POST /api/notificaciones/:id/reintentar',
        'GET /api/whatsapp',
        'POST /api/whatsapp/vincular',
        'GET /api/whatsapp/qr',
        'POST /api/whatsapp/desvincular',
        'PUT /api/whatsapp/destino',
        'POST /api/whatsapp/prueba',
        'POST /api/stock/ajustes',
        'GET /api/stock/ingresos',
        'GET /api/stock/productos/:id/movimientos',
        'GET /api/caja/movimientos-mp',
        'POST /api/pedidos',
        'GET /api/dashboard',
        'PATCH /api/pedidos/:id',
        'POST /api/pedidos/:id/cancelar',
        'POST /api/productos/aumento',
        'GET /api/productos/:id/historial-precios',
      ]),
    );
    for (const { m, url } of deAdmin) {
      const res = await app.inject({
        method: m as 'GET',
        url: url.replace(':id', ID_CUALQUIERA),
        cookies,
        payload: m === 'GET' ? undefined : {},
      });
      expect(res.statusCode, `${m} ${url}`).toBe(403);
    }

    const busqueda = await app.inject({ method: 'GET', url: '/api/productos?q=x', cookies });
    expect(busqueda.statusCode).toBe(200);

    const producto = await prismaTest.producto.create({
      data: {
        nombre: 'Agua',
        nombreBusqueda: 'agua',
        precio: '500',
        stockMinimo: 0,
        stockMaximo: 0,
      },
    });
    const paraCargar = await app.inject({
      method: 'GET',
      url: '/api/pedidos/productos?q=agua',
      cookies,
    });
    expect(paraCargar.json()).toMatchObject([{ id: producto.id, costo: null }]);
  });
});

describe('saldo de Mercado Pago', () => {
  it('GET /api/mercado-pago/saldo está registrada, pide sesión y la usa también el empleado', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    await app.ready();

    expect(rutasDeApi(app).map(({ m, url }) => `${m} ${url}`)).toContain(
      'GET /api/mercado-pago/saldo',
    );

    const sinSesion = await app.inject({ method: 'GET', url: '/api/mercado-pago/saldo' });
    expect(sinSesion.statusCode).toBe(401);
    expect(sinSesion.json().error.codigo).toBe('NO_AUTENTICADO');

    const cookies = await sesionDe(app, 'juan');
    const empleado = await app.inject({ method: 'GET', url: '/api/mercado-pago/saldo', cookies });
    expect(empleado.statusCode).toBe(200);
  });
});

describe('rutas del cobro con el Point (cobro-mercado-pago)', () => {
  // Se registran siempre, aunque el Point no esté configurado.
  it('están registradas; el webhook es la única abierta y los cobros a revisar son del admin', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    await app.ready();

    expect(rutasDeApi(app).map(({ m, url }) => `${m} ${url}`)).toEqual(
      expect.arrayContaining([
        'POST /api/mercado-pago/webhook',
        'GET /api/mercado-pago/cobros-a-revisar',
        'POST /api/mercado-pago/cobros/:id/revisado',
        'POST /api/mercado-pago/cobros/:id/devolucion',
        'POST /api/mercado-pago/cobros/:id/sin-devolver',
        'GET /api/ventas/en-espera',
        'GET /api/ventas/:id/cobro',
        'POST /api/ventas/:id/cobro/reintentar',
        'POST /api/ventas/:id/cancelar',
      ]),
    );

    // Sin sesión, el webhook no pide login: sin clave configurada responde 401 por la
    // firma, nunca NO_AUTENTICADO.
    const webhook = await app.inject({
      method: 'POST',
      url: '/api/mercado-pago/webhook',
      payload: {},
    });
    expect(webhook.statusCode).toBe(401);
    expect(webhook.json().error?.codigo).not.toBe('NO_AUTENTICADO');

    const cookies = await sesionDe(app, 'juan');
    for (const [method, url] of [
      ['GET', '/api/mercado-pago/cobros-a-revisar'],
      ['POST', `/api/mercado-pago/cobros/${ID_CUALQUIERA}/revisado`],
    ] as const) {
      const res = await app.inject({ method, url, cookies, payload: method === 'POST' ? {} : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    for (const [method, url] of [
      ['GET', '/api/ventas/en-espera'],
      ['POST', `/api/mercado-pago/cobros/${ID_CUALQUIERA}/devolucion`],
      ['POST', `/api/mercado-pago/cobros/${ID_CUALQUIERA}/sin-devolver`],
      ['POST', `/api/ventas/${ID_CUALQUIERA}/cancelar`],
    ] as const) {
      const res = await app.inject({ method, url, cookies });
      expect([401, 403], `${method} ${url}`).not.toContain(res.statusCode);
    }
  });
});

describe('rutas de facturación', () => {
  // Se registran siempre, aunque ARCA no esté configurado (responden 409 o `no_configurado`).
  it('están registradas, piden sesión, las de admin dan 403 al empleado y pedir factura es de los dos', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    await app.ready();

    expect(rutasDeApi(app).map(({ m, url }) => `${m} ${url}`)).toEqual(
      expect.arrayContaining([
        'POST /api/ventas/:id/factura',
        'GET /api/facturacion',
        'POST /api/facturas/:id/reintentar',
      ]),
    );

    for (const [method, url] of [
      ['POST', `/api/ventas/${ID_CUALQUIERA}/factura`],
      ['GET', '/api/facturacion'],
      ['POST', `/api/facturas/${ID_CUALQUIERA}/reintentar`],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }

    const cookies = await sesionDe(app, 'juan');
    const estado = await app.inject({ method: 'GET', url: '/api/facturacion', cookies });
    const reintento = await app.inject({
      method: 'POST',
      url: `/api/facturas/${ID_CUALQUIERA}/reintentar`,
      cookies,
    });
    const pedido = await app.inject({
      method: 'POST',
      url: `/api/ventas/${ID_CUALQUIERA}/factura`,
      cookies,
    });
    expect(estado.statusCode).toBe(403);
    expect(reintento.statusCode).toBe(403);
    // El empleado sí puede pedir factura: la venta no existe, pero no es un problema de permisos.
    expect(pedido.statusCode).not.toBe(403);
    expect(pedido.statusCode).not.toBe(401);
  });
});

describe('contraseñas nunca expuestas', () => {
  it('ninguna respuesta de ingreso, sesión ni usuarios incluye contraseñas o hashes', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('ana', 'admin');
    const cookies = await sesionDe(app, 'ana');

    const respuestas = [
      await ingresar(app, 'ana'),
      await app.inject({ method: 'GET', url: '/api/auth/sesion', cookies }),
      await app.inject({ method: 'GET', url: '/api/usuarios', cookies }),
      await app.inject({
        method: 'POST',
        url: '/api/usuarios',
        cookies,
        payload: { nombre: 'Juan', usuario: 'juan', rol: 'empleado', contrasena: 'clave-de-juan' },
      }),
    ];

    for (const res of respuestas) {
      expect(res.statusCode).toBeLessThan(300);
      expect(res.body).not.toMatch(/contrasena|argon2|clave-/i);
    }
  });
});

describe('ventas para admin y empleado', () => {
  it('el empleado puede abrir su turno, vender, listar, anular, mover la caja y cerrar', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    const cookies = await sesionDe(app, 'juan');
    const producto = await prismaTest.producto.create({
      data: {
        nombre: 'Agua',
        nombreBusqueda: 'agua',
        precio: '500',
        stockMinimo: 0,
        stockMaximo: 0,
      },
    });
    const turnoId = await abrirTurnoDePrueba(app, cookies);

    const venta = await app.inject({
      method: 'POST',
      url: '/api/ventas',
      cookies,
      payload: {
        items: [{ productoId: producto.id, cantidad: 1 }],
        pagos: [{ medio: 'efectivo', monto: '500' }],
        totalEsperado: '500',
      },
    });
    const lista = await app.inject({ method: 'GET', url: '/api/ventas', cookies });
    const anulacion = await app.inject({
      method: 'POST',
      url: `/api/ventas/${venta.json().id}/anular`,
      cookies,
      payload: { motivo: 'prueba' },
    });

    const gasto = await app.inject({
      method: 'POST',
      url: '/api/caja/movimientos',
      cookies,
      payload: { tipo: 'gasto', categoria: 'otro', monto: '100', motivo: 'Hielo' },
    });
    const cierre = await cerrarTurnoDePrueba(app, cookies, turnoId);

    expect([venta, lista, anulacion, gasto, cierre].map((r) => r.statusCode)).toEqual([
      201, 200, 200, 201, 200,
    ]);
  });
});
