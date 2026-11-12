import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase, prismaTest } from './base.js';
import { crearUsuarioDePrueba, sesionDe } from './ayudas.js';
import { crearArcaFalso } from './arca-falso.js';
import {
  configArca,
  crearAppConFacturacion,
  crearFacturaDirecta,
  crearVentaDirecta,
  type EstadoArca,
  opcionesFacturacion,
} from './facturacion-ayudas.js';

/*
 * Rutas del admin (specs/facturacion: "Estado de la facturación para el admin"
 * y "Reintento manual de una factura").
 *
 * `GET /api/facturacion` → `{ estado, entorno, puntoVenta, ultimoNumero,
 * pendientes, enError, facturas }`. Cada factura del listado trae, al menos,
 * `id`, `ventaNumero`, `parte`, `importe`, `estado`, `intentos`, `codigoError`
 * y `error` (el design dice "con número de venta, parte e importe"; el nombre
 * `ventaNumero` lo elige este test).
 */
const emision = () => import('../src/modules/facturacion/emision.js');

const HOY = new Date('2026-11-10T13:00:00Z');

beforeEach(async () => {
  await limpiarBase();
});

async function preparar({ conFacturacion = true, estado = 'disponible' as EstadoArca } = {}) {
  const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
  const facturacion = conFacturacion ? opcionesFacturacion(arca.cliente, estado) : undefined;
  const { app } = await crearAppConFacturacion(HOY, facturacion);
  await crearUsuarioDePrueba('ana', 'admin');
  const juan = await crearUsuarioDePrueba('juan');
  const admin = await sesionDe(app, 'ana');
  const empleado = await sesionDe(app, 'juan');
  return { app, arca, admin, empleado, juan };
}

type Ctx = Awaited<ReturnType<typeof preparar>>;

async function ventaConFactura(
  ctx: Ctx,
  factura: Record<string, unknown> = {},
  { importe = '3300.00', minuto = 0, estadoVenta = 'pagada' as 'pagada' | 'anulada' } = {},
) {
  const creadaEn = new Date(Date.parse('2026-11-10T12:00:00Z') + minuto * 60_000);
  const venta = await crearVentaDirecta({
    usuarioId: ctx.juan.id,
    creadaEn,
    pagos: [{ medio: 'debito', monto: importe }],
    estado: estadoVenta,
  });
  const f = await crearFacturaDirecta(venta.id, { importe, creadaEn, ...factura });
  return { venta, factura: f };
}

function estadoFacturacion(ctx: Ctx, cookies = ctx.admin) {
  return ctx.app.inject({ method: 'GET', url: '/api/facturacion', cookies });
}

function reintentar(ctx: Ctx, id: string, cookies = ctx.admin) {
  return ctx.app.inject({ method: 'POST', url: `/api/facturas/${id}/reintentar`, cookies });
}

const AUTORIZADA = (numero: number) => ({
  estado: 'autorizada',
  numero,
  fechaComprobante: new Date('2026-11-10T00:00:00Z'),
  cae: `7645123456789${numero % 10}`,
  caeVencimiento: new Date('2026-11-20T00:00:00Z'),
  autorizadaEn: HOY,
});

describe('GET /api/facturacion', () => {
  it('2 pendientes y 1 en error por el tope: el admin ve las 3 con su venta, importe y estado, y el motivo de la que falló', async () => {
    const ctx = await preparar();
    const p1 = await ventaConFactura(ctx, {}, { importe: '100.00', minuto: 0 });
    const p2 = await ventaConFactura(ctx, {}, { importe: '200.00', minuto: 1 });
    const tope = await ventaConFactura(
      ctx,
      {
        estado: 'error',
        codigoError: 'tope',
        error: 'Alcanza el tope para no identificar al cliente.',
      },
      { importe: '10000000.00', minuto: 2 },
    );
    await ventaConFactura(ctx, AUTORIZADA(41), { minuto: 3 });
    await ventaConFactura(ctx, AUTORIZADA(42), { minuto: 4 });

    const res = await estadoFacturacion(ctx);

    expect(res.statusCode).toBe(200);
    const cuerpo = res.json();
    expect(cuerpo).toMatchObject({
      estado: 'disponible',
      entorno: 'homologacion',
      puntoVenta: 5,
      ultimoNumero: 42,
      pendientes: 2,
      enError: 1,
    });
    expect(cuerpo.facturas).toHaveLength(3);
    expect(cuerpo.facturas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: p1.factura.id,
          ventaNumero: p1.venta.numero,
          parte: 'electronica',
          importe: '100.00',
          estado: 'pendiente',
          intentos: 0,
        }),
        expect.objectContaining({
          id: p2.factura.id,
          ventaNumero: p2.venta.numero,
          importe: '200.00',
          estado: 'pendiente',
        }),
        expect.objectContaining({
          id: tope.factura.id,
          ventaNumero: tope.venta.numero,
          importe: '10000000.00',
          estado: 'error',
          codigoError: 'tope',
          error: 'Alcanza el tope para no identificar al cliente.',
        }),
      ]),
    );
  });

  it('lista también la que está en curso, y no las autorizadas ni las canceladas', async () => {
    const ctx = await preparar();
    const enCurso = await ventaConFactura(ctx, {
      estado: 'en_curso',
      numero: 43,
      fechaComprobante: new Date('2026-11-10T00:00:00Z'),
    });
    await ventaConFactura(ctx, AUTORIZADA(42), { minuto: 1 });
    await ventaConFactura(ctx, { estado: 'cancelada' }, { minuto: 2, estadoVenta: 'anulada' });

    const res = await estadoFacturacion(ctx);

    expect(
      res.json().facturas.map((f: { id: string; estado: string }) => [f.id, f.estado]),
    ).toEqual([[enCurso.factura.id, 'en_curso']]);
  });

  it.each<EstadoArca>(['no_disponible', 'autenticacion_bloqueada'])(
    'informa el estado %s que dejó la última pasada',
    async (estado) => {
      const ctx = await preparar({ estado });

      const res = await estadoFacturacion(ctx);

      expect(res.json()).toMatchObject({ estado });
      // El estado sale de la memoria de la tarea: la ruta no le pregunta a ARCA.
      expect(ctx.arca.falso.llamadas).toEqual([]);
    },
  );

  it('sin facturación configurada → no_configurado', async () => {
    const ctx = await preparar({ conFacturacion: false });

    const res = await estadoFacturacion(ctx);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ estado: 'no_configurado' });
  });

  it('en producción informa el entorno', async () => {
    const arca = crearArcaFalso();
    const facturacion = opcionesFacturacion(
      arca.cliente,
      'disponible',
      configArca({ ARCA_ENTORNO: 'produccion', ARCA_PUNTO_VENTA: 99999 }),
    );
    const { app } = await crearAppConFacturacion(HOY, facturacion);
    await crearUsuarioDePrueba('ana', 'admin');
    const admin = await sesionDe(app, 'ana');

    const res = await app.inject({ method: 'GET', url: '/api/facturacion', cookies: admin });

    expect(res.json()).toMatchObject({ entorno: 'produccion', puntoVenta: 99999, ultimoNumero: 0 });
  });

  it('un empleado recibe 403', async () => {
    const ctx = await preparar();

    const res = await estadoFacturacion(ctx, ctx.empleado);

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/facturas/:id/reintentar', () => {
  it('una en error después de 5 rechazos vuelve a pendiente con 0 intentos y sale en la próxima pasada', async () => {
    const ctx = await preparar();
    const { factura } = await ventaConFactura(ctx, {
      estado: 'error',
      intentos: 5,
      codigoError: 'rechazo_arca',
      error: 'ARCA rechazó el comprobante.',
      proximoIntentoEn: null,
    });

    const res = await reintentar(ctx, factura.id);

    expect(res.statusCode).toBe(200);
    expect(await prismaTest.factura.findUniqueOrThrow({ where: { id: factura.id } })).toMatchObject(
      {
        estado: 'pendiente',
        intentos: 0,
        proximoIntentoEn: null,
        numero: null,
      },
    );

    const { procesarFacturas } = await emision();
    await procesarFacturas({
      prisma: prismaTest,
      arca: ctx.arca.cliente,
      config: configArca(),
      ahora: () => HOY,
    });
    expect(await prismaTest.factura.findUniqueOrThrow({ where: { id: factura.id } })).toMatchObject(
      {
        estado: 'autorizada',
        numero: 42,
      },
    );
  });

  it('una en error por numeración inconsistente se puede reintentar', async () => {
    const ctx = await preparar();
    const { factura } = await ventaConFactura(ctx, {
      estado: 'error',
      codigoError: 'numeracion_inconsistente',
      error: 'El 00005-00000042 de ARCA no coincide.',
      numero: 42,
      fechaComprobante: new Date('2026-11-10T00:00:00Z'),
    });

    const res = await reintentar(ctx, factura.id);

    expect(res.statusCode).toBe(200);
    expect(await prismaTest.factura.findUniqueOrThrow({ where: { id: factura.id } })).toMatchObject(
      {
        estado: 'pendiente',
        numero: null,
      },
    );
  });

  it.each([
    ['en error por el tope', { estado: 'error', codigoError: 'tope', error: 'Tope.' }, 'pagada'],
    [
      'en error por plazo vencido',
      { estado: 'error', codigoError: 'fuera_de_plazo', error: 'Plazo.' },
      'pagada',
    ],
    ['autorizada', AUTORIZADA(42), 'pagada'],
    ['pendiente', { estado: 'pendiente', intentos: 2 }, 'pagada'],
    [
      'en error por rechazos, con la venta anulada',
      { estado: 'error', intentos: 5, codigoError: 'rechazo_arca', error: 'Rechazo.' },
      'anulada',
    ],
  ] as const)('%s → 409 y la factura no cambia', async (_caso, datos, estadoVenta) => {
    const ctx = await preparar();
    const { factura } = await ventaConFactura(ctx, datos, { estadoVenta });

    const res = await reintentar(ctx, factura.id);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('FACTURA_NO_REINTENTABLE');
    expect(await prismaTest.factura.findUniqueOrThrow({ where: { id: factura.id } })).toEqual(
      factura,
    );
  });

  it('una factura inexistente → 404', async () => {
    const ctx = await preparar();

    const res = await reintentar(ctx, '0198a5b0-0000-7000-8000-000000000000');

    expect(res.statusCode).toBe(404);
    // El 404 es de la factura, no el de una ruta que no existe.
    expect(res.json().error.mensaje).not.toContain('No existe la ruta');
  });

  it('un empleado recibe 403 y la factura no cambia', async () => {
    const ctx = await preparar();
    const { factura } = await ventaConFactura(ctx, {
      estado: 'error',
      intentos: 5,
      codigoError: 'rechazo_arca',
      error: 'Rechazo.',
    });

    const res = await reintentar(ctx, factura.id, ctx.empleado);

    expect(res.statusCode).toBe(403);
    expect(await prismaTest.factura.findUniqueOrThrow({ where: { id: factura.id } })).toEqual(
      factura,
    );
  });
});
