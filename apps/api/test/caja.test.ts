import {
  cierreRespuestaSchema,
  estadoCajaSchema,
  movimientoCajaSchema,
  turnoDetalleSchema,
  turnoResumenSchema,
} from '@kiosco/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { textoAvisoCierre, textoAvisoMovimiento } from '../src/modules/caja/avisos.js';
import { limpiarBase, prismaTest } from './base.js';
import {
  abrirTurnoDePrueba,
  cerrarTurnoDePrueba,
  crearAppDePrueba,
  crearUsuarioDePrueba,
  sesionDe,
} from './ayudas.js';
import { crearProductoDePrueba } from './stock-ayudas.js';

beforeEach(async () => {
  await limpiarBase();
});

/** Martes 20/10/2026 a las 07:02 en Argentina. */
const MARTES_0702 = new Date('2026-10-20T10:02:00Z');
const HORA = 60 * 60 * 1000;

async function preparar() {
  const { app, adelantar } = await crearAppDePrueba(MARTES_0702);
  await crearUsuarioDePrueba('admin', 'admin');
  const ana = await crearUsuarioDePrueba('ana');
  const juan = await crearUsuarioDePrueba('juan');
  const sesiones = {
    admin: await sesionDe(app, 'admin'),
    ana: await sesionDe(app, 'ana'),
    juan: await sesionDe(app, 'juan'),
  };
  const alfajor = await crearProductoDePrueba('Alfajor', { precio: '1000' });
  return { app, adelantar, usuarios: { ana, juan }, ...sesiones, alfajor };
}

type Ctx = Awaited<ReturnType<typeof preparar>>;
type Cookies = Ctx['admin'];

function estado(ctx: Ctx, cookies: Cookies) {
  return ctx.app.inject({ method: 'GET', url: '/api/caja/estado', cookies });
}

function abrir(ctx: Ctx, cookies: Cookies, montoInicial: string) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/caja/turnos',
    cookies,
    payload: { montoInicial },
  });
}

/** Los gastos van como "otro" salvo que se indique la categoría. */
function movimiento(
  ctx: Ctx,
  cookies: Cookies,
  tipo: string,
  monto: string,
  motivo = 'motivo',
  categoria = tipo === 'gasto' ? 'otro' : undefined,
) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/caja/movimientos',
    cookies,
    payload: { tipo, categoria, monto, motivo },
  });
}

/** Gasto, retiro o ingreso de la cuenta Mercado Pago (los gastos, como "insumos"). */
function movimientoMp(ctx: Ctx, cookies: Cookies, tipo: string, monto: string, motivo = 'motivo') {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/caja/movimientos',
    cookies,
    payload: {
      tipo,
      categoria: tipo === 'gasto' ? 'insumos' : undefined,
      cuenta: 'mercado_pago',
      monto,
      motivo,
    },
  });
}

/** Vende `cantidad` alfajores de $1.000 con los pagos indicados. */
function vender(ctx: Ctx, cookies: Cookies, pagos: Record<string, unknown>[], cantidad = 1) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/ventas',
    cookies,
    payload: {
      items: [{ productoId: ctx.alfajor.id, cantidad }],
      pagos,
      totalEsperado: String(cantidad * 1000),
    },
  });
}

function anular(ctx: Ctx, cookies: Cookies, id: string) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/ventas/${id}/anular`,
    cookies,
    payload: { motivo: 'devolución' },
  });
}

function detalle(ctx: Ctx, id: string, cookies = ctx.admin) {
  return ctx.app.inject({ method: 'GET', url: `/api/caja/turnos/${id}`, cookies });
}

describe('un solo turno abierto', () => {
  it('abrir con otro turno abierto responde 409', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.ana);

    const res = await abrir(ctx, ctx.juan, '0');

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('TURNO_YA_ABIERTO');
    expect(await prismaTest.turno.count()).toBe(1);
  });

  it('dos aperturas simultáneas abren un solo turno', async () => {
    const ctx = await preparar();

    const respuestas = await Promise.all([abrir(ctx, ctx.ana, '0'), abrir(ctx, ctx.juan, '0')]);

    expect(respuestas.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await prismaTest.turno.count()).toBe(1);
  });
});

describe('apertura con monto sugerido', () => {
  it('el primer turno sugiere $0', async () => {
    const ctx = await preparar();
    const res = await estado(ctx, ctx.ana);
    expect(estadoCajaSchema.parse(res.json())).toEqual({
      turnoAbierto: null,
      montoSugerido: '0.00',
    });
  });

  it('sugiere lo que quedó en caja y registra la diferencia de apertura', async () => {
    const ctx = await preparar();
    const turnoAna = await abrirTurnoDePrueba(ctx.app, ctx.ana, '20000');
    await cerrarTurnoDePrueba(ctx.app, ctx.ana, turnoAna, {
      montoContado: '50000',
      retiro: '30000',
      motivoRetiro: 'Al banco',
    });

    expect((await estado(ctx, ctx.juan)).json().montoSugerido).toBe('20000.00');
    const res = await abrir(ctx, ctx.juan, '19500');

    expect(res.statusCode).toBe(201);
    const turnoJuan = res.json().turnoAbierto.id;
    const turno = turnoResumenSchema.parse((await detalle(ctx, turnoJuan)).json());
    expect(turno).toMatchObject({
      montoSugerido: '20000.00',
      montoInicial: '19500.00',
      diferenciaApertura: '-500.00',
      responsable: { id: ctx.usuarios.juan.id },
    });
  });
});

describe('estado de la caja para quien opera', () => {
  it('informa el turno abierto, de quién es y si es propio', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.ana);

    const paraAna = estadoCajaSchema.parse((await estado(ctx, ctx.ana)).json());
    const paraJuan = estadoCajaSchema.parse((await estado(ctx, ctx.juan)).json());

    expect(paraAna.turnoAbierto).toMatchObject({
      responsable: { nombre: 'Nombre ana' },
      esMio: true,
    });
    expect(paraJuan.turnoAbierto).toMatchObject({
      responsable: { nombre: 'Nombre ana' },
      esMio: false,
    });
  });

  it('el empleado ve sus movimientos pero no el esperado ni los turnos', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.ana);
    await movimiento(ctx, ctx.ana, 'gasto', '500', 'Hielo');

    const movs = await ctx.app.inject({
      method: 'GET',
      url: '/api/caja/movimientos',
      cookies: ctx.ana,
    });
    const lista = await ctx.app.inject({
      method: 'GET',
      url: '/api/caja/turnos',
      cookies: ctx.ana,
    });

    expect(z.array(movimientoCajaSchema).parse(movs.json())).toMatchObject([
      {
        tipo: 'gasto',
        categoria: 'otro',
        monto: '500.00',
        motivo: 'Hielo',
        usuario: { id: ctx.usuarios.ana.id },
      },
    ]);
    expect(lista.statusCode).toBe(403);
    expect(JSON.stringify((await estado(ctx, ctx.ana)).json())).not.toContain('esperado');
  });

  it('otro empleado no ve los movimientos del turno ajeno', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.ana);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/caja/movimientos',
      cookies: ctx.juan,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('TURNO_DE_OTRO');
  });
});

describe('quién opera en el turno abierto', () => {
  it('un empleado no vende ni mueve la caja en el turno de otro', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.ana);

    const venta = await vender(ctx, ctx.juan, [{ medio: 'efectivo', monto: '1000' }]);
    const gasto = await movimiento(ctx, ctx.juan, 'gasto', '100');

    for (const res of [venta, gasto]) {
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatchObject({
        codigo: 'TURNO_DE_OTRO',
        detalle: { responsable: 'Nombre ana' },
      });
    }
    expect(await prismaTest.venta.count()).toBe(0);
    expect(await prismaTest.movimientoCaja.count()).toBe(0);
  });

  it('el admin vende y mueve la caja en el turno del empleado', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana);

    const venta = await vender(ctx, ctx.admin, [{ medio: 'efectivo', monto: '1000' }]);
    const ingreso = await movimiento(ctx, ctx.admin, 'ingreso', '2000', 'Ventas del corte de luz');

    expect(venta.statusCode).toBe(201);
    expect(ingreso.statusCode).toBe(201);
    const v = await prismaTest.venta.findFirstOrThrow();
    expect(v.turnoId).toBe(turnoId);
  });

  it('sin turno abierto, un movimiento responde 409', async () => {
    const ctx = await preparar();
    const res = await movimiento(ctx, ctx.admin, 'ingreso', '100');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('SIN_TURNO_ABIERTO');
  });
});

describe('movimientos de caja', () => {
  it('el empleado registra un gasto con categoría, monto, motivo, usuario y fecha', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana);

    const res = await movimiento(ctx, ctx.ana, 'gasto', '8000', 'pago a proveedor - Coca');

    expect(res.statusCode).toBe(201);
    expect(movimientoCajaSchema.parse(res.json())).toMatchObject({
      tipo: 'gasto',
      categoria: 'otro',
      monto: '8000.00',
      motivo: 'pago a proveedor - Coca',
      creadoEn: MARTES_0702.toISOString(),
    });
    expect((await prismaTest.movimientoCaja.findFirstOrThrow()).turnoId).toBe(turnoId);
  });

  it('el empleado no puede registrar un ingreso', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.ana);
    const res = await movimiento(ctx, ctx.ana, 'ingreso', '100');
    expect(res.statusCode).toBe(403);
    expect(await prismaTest.movimientoCaja.count()).toBe(0);
  });

  it.each([
    ['sin motivo', { tipo: 'gasto', categoria: 'otro', monto: '100', motivo: '' }],
    ['con monto cero', { tipo: 'retiro', monto: '0', motivo: 'algo' }],
    ['de gasto sin categoría', { tipo: 'gasto', monto: '100', motivo: 'Hielo' }],
    [
      'de gasto con la categoría proveedor',
      { tipo: 'gasto', categoria: 'proveedor', monto: '100', motivo: 'Coca' },
    ],
    [
      'de retiro con categoría',
      { tipo: 'retiro', categoria: 'otro', monto: '100', motivo: 'algo' },
    ],
  ])('un movimiento %s responde 400', async (_caso, payload) => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.ana);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/caja/movimientos',
      cookies: ctx.ana,
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(await prismaTest.movimientoCaja.count()).toBe(0);
  });

  it('el admin registra un gasto de Servicios y el retiro queda sin categoría', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.admin);

    const gasto = await movimiento(ctx, ctx.admin, 'gasto', '45000', 'luz de octubre', 'servicios');
    const retiro = await movimiento(ctx, ctx.admin, 'retiro', '1000', 'Al banco');

    expect(gasto.statusCode).toBe(201);
    expect(gasto.json()).toMatchObject({ tipo: 'gasto', categoria: 'servicios' });
    expect(retiro.json()).toMatchObject({ tipo: 'retiro', categoria: null });
  });
});

describe('aviso por gasto o retiro del empleado', () => {
  it('el gasto y el retiro del empleado dejan un aviso; los del admin no', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.ana);

    await movimiento(ctx, ctx.ana, 'gasto', '8000', 'bolsas de camiseta', 'insumos');
    await movimiento(ctx, ctx.ana, 'retiro', '5000', 'Lo pidió el dueño');
    await movimiento(ctx, ctx.admin, 'retiro', '1000', 'Para cambio');
    await movimiento(ctx, ctx.admin, 'gasto', '1000', 'Hielo');

    const avisos = await prismaTest.notificacion.findMany({ orderBy: { creadaEn: 'asc' } });
    expect(avisos.map((a) => a.tipo).sort()).toEqual(['gasto_caja', 'retiro_caja']);
    const gasto = avisos.find((a) => a.tipo === 'gasto_caja')!;
    expect(gasto).toMatchObject({ destino: 'admin', estado: 'pendiente' });
    expect(gasto.texto).toContain('8.000');
    expect(gasto.texto).toContain('Insumos');
    expect(gasto.texto).toContain('bolsas de camiseta');
    expect(gasto.texto).toContain('Nombre ana');
    expect(gasto.texto).toContain('07:02');
    const retiro = avisos.find((a) => a.tipo === 'retiro_caja')!;
    expect(retiro.texto).toMatch(/^\*Retiro de caja: /);
  });

  it('texto del aviso de gasto', () => {
    expect(
      textoAvisoMovimiento({
        tipo: 'gasto',
        categoria: 'insumos',
        cuenta: 'efectivo',
        monto: '8000.00',
        motivo: 'bolsas de camiseta',
        usuario: 'Juan',
        creadoEn: new Date('2026-10-21T13:15:00Z'),
      }),
    ).toBe(
      [
        '*Gasto de caja · Insumos: $ 8.000,00*',
        'Fecha y hora: 21/10/2026 10:15',
        'Registró: Juan',
        'Motivo: bolsas de camiseta',
      ].join('\n'),
    );
  });
});

describe('efectivo esperado', () => {
  it('inicial + efectivo vendido + ingresos - gastos - retiros; las tarjetas y el vuelto no cuentan', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana, '20000');
    // $50.000 en efectivo, uno con vuelto (paga con $20.000 una venta de $10.000).
    await vender(ctx, ctx.ana, [{ medio: 'efectivo', monto: '40000' }], 40);
    await vender(ctx, ctx.ana, [{ medio: 'efectivo', monto: '10000', montoRecibido: '20000' }], 10);
    await vender(ctx, ctx.ana, [{ medio: 'debito', monto: '30000' }], 30);
    await movimiento(ctx, ctx.ana, 'gasto', '8000');
    await movimiento(ctx, ctx.ana, 'retiro', '10000');
    await movimiento(ctx, ctx.admin, 'ingreso', '0,50');

    const turno = turnoDetalleSchema.parse((await detalle(ctx, turnoId)).json());

    expect(turno.resumen).toEqual({
      cantidadVentas: 3,
      porMedio: { efectivo: '50000.00', debito: '30000.00', credito: '0.00', mercado_pago: '0.00' },
      montoInicial: '20000.00',
      efectivoVendido: '50000.00',
      ingresos: '0.50',
      gastos: '8000.00',
      retiros: '10000.00',
      devoluciones: '0.00',
      esperado: '52000.50',
    });
  });

  it('una venta anulada en el mismo turno no cambia el esperado', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana, '1000');
    const { id } = (await vender(ctx, ctx.ana, [{ medio: 'efectivo', monto: '3000' }], 3)).json();
    await anular(ctx, ctx.ana, id);

    const turno = turnoDetalleSchema.parse((await detalle(ctx, turnoId)).json());

    expect(turno.resumen).toMatchObject({
      efectivoVendido: '3000.00',
      devoluciones: '3000.00',
      esperado: '1000.00',
    });
    expect(turno.anulaciones).toMatchObject([{ ventaId: id, efectivo: '3000.00' }]);
  });

  it('una venta con débito anulada en el mismo turno resta su total, porque se devuelve en efectivo', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana, '5000');
    const { id } = (await vender(ctx, ctx.ana, [{ medio: 'debito', monto: '3000' }], 3)).json();
    await anular(ctx, ctx.ana, id);

    const turno = turnoDetalleSchema.parse((await detalle(ctx, turnoId)).json());

    expect(turno.resumen).toMatchObject({ devoluciones: '3000.00', esperado: '2000.00' });
  });

  it('los movimientos de Mercado Pago no tocan el efectivo', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana, '52000');
    await movimientoMp(ctx, ctx.ana, 'gasto', '45000');
    await movimientoMp(ctx, ctx.admin, 'retiro', '1000');
    await movimientoMp(ctx, ctx.admin, 'ingreso', '500');

    const turno = turnoDetalleSchema.parse((await detalle(ctx, turnoId)).json());

    expect(turno.resumen).toMatchObject({ gastos: '0.00', retiros: '0.00', esperado: '52000.00' });
    expect(turno.movimientos).toHaveLength(3);
  });
});

describe('devolución de una anulación en la caja', () => {
  it('el admin anula una venta de ayer con la caja abierta: resta del turno de hoy', async () => {
    const ctx = await preparar();
    const ayer = await abrirTurnoDePrueba(ctx.app, ctx.ana);
    const { id } = (
      await vender(
        ctx,
        ctx.ana,
        [
          { medio: 'efectivo', monto: '2000' },
          { medio: 'mercado_pago', monto: '3000' },
        ],
        5,
      )
    ).json();
    await cerrarTurnoDePrueba(ctx.app, ctx.ana, ayer, { montoContado: '2000' });
    const hoy = await abrirTurnoDePrueba(ctx.app, ctx.juan, '5000');

    await anular(ctx, ctx.admin, id);

    // Pago mixto: se devuelve todo en efectivo, también la parte de Mercado Pago.
    const deHoy = turnoDetalleSchema.parse((await detalle(ctx, hoy)).json());
    const deAyer = turnoDetalleSchema.parse((await detalle(ctx, ayer)).json());
    expect(deHoy.resumen).toMatchObject({ devoluciones: '5000.00', esperado: '0.00' });
    expect(deHoy.anulaciones).toMatchObject([{ ventaId: id, efectivo: '5000.00' }]);
    expect(deAyer.resumen).toMatchObject({ devoluciones: '0.00', esperado: '2000.00' });
    expect(deAyer.diferencia).toBe('0.00');
  });

  it('una anulación sin turno abierto no afecta ninguna caja', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana);
    const { id } = (await vender(ctx, ctx.ana, [{ medio: 'efectivo', monto: '1000' }])).json();
    await cerrarTurnoDePrueba(ctx.app, ctx.ana, turnoId, { montoContado: '1000' });

    expect((await anular(ctx, ctx.admin, id)).statusCode).toBe(200);

    const turno = turnoDetalleSchema.parse((await detalle(ctx, turnoId)).json());
    expect(turno.resumen).toMatchObject({ devoluciones: '0.00', esperado: '1000.00' });
  });
});

describe('cierre ciego', () => {
  async function turnoConEsperado52000(ctx: Ctx) {
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana, '20000');
    await vender(ctx, ctx.ana, [{ medio: 'efectivo', monto: '50000' }], 50);
    await movimiento(ctx, ctx.ana, 'gasto', '8000');
    await movimiento(ctx, ctx.ana, 'retiro', '10000');
    return turnoId;
  }

  it('el empleado cierra con faltante sin ver el esperado ni la diferencia', async () => {
    const ctx = await preparar();
    const turnoId = await turnoConEsperado52000(ctx);
    ctx.adelantar(6 * HORA);

    const res = await cerrarTurnoDePrueba(ctx.app, ctx.ana, turnoId, {
      montoContado: '51500',
      retiro: '30000',
      motivoRetiro: 'Al banco',
    });

    expect(res.statusCode).toBe(200);
    const cuerpo = cierreRespuestaSchema.parse(res.json());
    expect(cuerpo).toEqual({ id: turnoId, quedoEnCaja: '21500.00' });
    expect(Object.keys(res.json())).not.toContain('esperado');
    expect(Object.keys(res.json())).not.toContain('diferencia');

    const turno = turnoDetalleSchema.parse((await detalle(ctx, turnoId)).json());
    expect(turno).toMatchObject({
      cerradoPor: { id: ctx.usuarios.ana.id },
      cerradoEn: new Date(MARTES_0702.getTime() + 6 * HORA).toISOString(),
      montoContado: '51500.00',
      retiroCierre: '30000.00',
      motivoRetiroCierre: 'Al banco',
      diferencia: '-500.00',
      quedoEnCaja: '21500.00',
      resumen: { esperado: '52000.00' },
    });
    expect((await estado(ctx, ctx.juan)).json()).toEqual({
      turnoAbierto: null,
      montoSugerido: '21500.00',
    });
  });

  it('el admin que cierra sí recibe el esperado y la diferencia', async () => {
    const ctx = await preparar();
    const turnoId = await turnoConEsperado52000(ctx);
    const res = await cerrarTurnoDePrueba(ctx.app, ctx.admin, turnoId, { montoContado: '52100' });
    expect(res.json()).toEqual({
      id: turnoId,
      quedoEnCaja: '52100.00',
      esperado: '52000.00',
      diferencia: '100.00',
    });
  });

  it('un retiro mayor que lo contado responde 400 y el turno sigue abierto', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana, '1000');
    const res = await cerrarTurnoDePrueba(ctx.app, ctx.ana, turnoId, {
      montoContado: '1000',
      retiro: '2000',
      motivoRetiro: 'Al banco',
    });
    expect(res.statusCode).toBe(400);
    expect((await prismaTest.turno.findUniqueOrThrow({ where: { id: turnoId } })).cerradoEn).toBe(
      null,
    );
  });

  it('el esperado del cierre no cambia si después se anula una venta del turno', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana);
    const { id } = (await vender(ctx, ctx.ana, [{ medio: 'efectivo', monto: '1000' }])).json();
    await cerrarTurnoDePrueba(ctx.app, ctx.ana, turnoId, { montoContado: '1000' });
    await abrirTurnoDePrueba(ctx.app, ctx.juan, '1000');

    await anular(ctx, ctx.admin, id);

    const turno = turnoDetalleSchema.parse((await detalle(ctx, turnoId)).json());
    expect(turno.resumen.esperado).toBe('1000.00');
    expect(turno.diferencia).toBe('0.00');
  });

  it('una venta concurrente con el cierre, o entra en el esperado, o recibe 409', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.admin);

    const [venta, cierre] = await Promise.all([
      vender(ctx, ctx.admin, [{ medio: 'efectivo', monto: '1000' }]),
      cerrarTurnoDePrueba(ctx.app, ctx.admin, turnoId, { montoContado: '0' }),
    ]);

    expect(cierre.statusCode).toBe(200);
    const entro = venta.statusCode === 201;
    if (!entro) expect(venta.json().error.codigo).toBe('SIN_TURNO_ABIERTO');
    expect(cierre.json().esperado).toBe(entro ? '1000.00' : '0.00');
    expect(await prismaTest.venta.count()).toBe(entro ? 1 : 0);
  });
});

describe('cierre del turno de otro', () => {
  it('Juan cierra el turno que Ana dejó abierto y después abre el suyo', async () => {
    const ctx = await preparar();
    const turnoAna = await abrirTurnoDePrueba(ctx.app, ctx.ana);

    const res = await cerrarTurnoDePrueba(ctx.app, ctx.juan, turnoAna, { montoContado: '40000' });

    expect(res.statusCode).toBe(200);
    const turno = turnoDetalleSchema.parse((await detalle(ctx, turnoAna)).json());
    expect(turno).toMatchObject({
      responsable: { id: ctx.usuarios.ana.id },
      cerradoPor: { id: ctx.usuarios.juan.id },
    });
    expect((await abrir(ctx, ctx.juan, '40000')).statusCode).toBe(201);
  });

  it('cerrar un turno ya cerrado responde 409; dos cierres a la vez registran uno', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana);

    const respuestas = await Promise.all([
      cerrarTurnoDePrueba(ctx.app, ctx.ana, turnoId, { montoContado: '10' }),
      cerrarTurnoDePrueba(ctx.app, ctx.juan, turnoId, { montoContado: '20' }),
    ]);
    const otra = await cerrarTurnoDePrueba(ctx.app, ctx.ana, turnoId);

    expect(respuestas.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(otra.statusCode).toBe(409);
    expect(otra.json().error.codigo).toBe('TURNO_YA_CERRADO');
    expect(await prismaTest.notificacion.count({ where: { tipo: 'cierre_turno' } })).toBe(1);
  });

  it('cerrar un turno inexistente responde 404', async () => {
    const ctx = await preparar();
    const res = await cerrarTurnoDePrueba(ctx.app, ctx.ana, '0198a5b0-0000-7000-8000-000000000000');
    expect(res.statusCode).toBe(404);
  });
});

describe('resumen del cierre de turno', () => {
  it('el cierre deja un aviso pendiente con el resumen; indica quién cerró si es otro', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana, '20000');
    await vender(ctx, ctx.ana, [{ medio: 'efectivo', monto: '1000' }]);
    await vender(ctx, ctx.ana, [{ medio: 'debito', monto: '1000' }]);
    ctx.adelantar(6 * HORA + 3 * 60 * 1000);

    await cerrarTurnoDePrueba(ctx.app, ctx.juan, turnoId, { montoContado: '20500' });

    const aviso = await prismaTest.notificacion.findFirstOrThrow({
      where: { tipo: 'cierre_turno' },
    });
    expect(aviso).toMatchObject({ destino: 'admin', estado: 'pendiente' });
    for (const parte of [
      'Turno cerrado - Nombre ana',
      '07:02 a 13:05',
      'Cerró: Nombre juan (en nombre de Nombre ana)',
      'Ventas: 2',
      'Débito: $ 1.000,00',
      'Esperado: $ 21.000,00',
      'Contado: $ 20.500,00',
      '*Diferencia: -$ 500,00*',
      'Quedó en caja: $ 20.500,00',
    ]) {
      expect(aviso.texto).toContain(parte);
    }
  });

  it('texto completo del aviso de cierre', () => {
    const texto = textoAvisoCierre({
      responsable: 'Juan',
      cerradoPor: 'Juan',
      abiertoEn: new Date('2026-10-20T10:02:00Z'),
      cerradoEn: new Date('2026-10-20T16:05:00Z'),
      montoSugerido: '20000.00',
      resumen: {
        cantidadVentas: 84,
        porMedio: {
          efectivo: '50000.00',
          debito: '30000.00',
          credito: '0.00',
          mercado_pago: '0.00',
        },
        montoInicial: '19500.00',
        efectivoVendido: '50000.00',
        ingresos: '0.00',
        gastos: '8000.00',
        retiros: '10000.00',
        devoluciones: '0.00',
        esperado: '51500.00',
      },
      montoContado: '51000.00',
      diferencia: '-500.00',
      retiro: '30000.00',
      motivoRetiro: 'Al banco',
      quedoEnCaja: '21000.00',
    });

    expect(texto).toBe(
      [
        '*Turno cerrado - Juan*',
        'De 20/10/2026 07:02 a 13:05',
        '',
        'Ventas: 84',
        'Efectivo: $ 50.000,00',
        'Débito: $ 30.000,00',
        '',
        'Inicial: $ 19.500,00',
        'Diferencia de apertura: -$ 500,00',
        'Gastos: $ 8.000,00',
        'Retiros: $ 10.000,00',
        'Esperado: $ 51.500,00',
        'Contado: $ 51.000,00',
        '*Diferencia: -$ 500,00*',
        'Retiro al cierre: $ 30.000,00 (Al banco)',
        'Quedó en caja: $ 21.000,00',
      ].join('\n'),
    );
  });
});

describe('turnos para el admin', () => {
  it('lista los turnos del más reciente al más antiguo con sus diferencias', async () => {
    const ctx = await preparar();
    const primero = await abrirTurnoDePrueba(ctx.app, ctx.ana, '100');
    await cerrarTurnoDePrueba(ctx.app, ctx.ana, primero, { montoContado: '90' });
    ctx.adelantar(HORA);
    const segundo = await abrirTurnoDePrueba(ctx.app, ctx.juan, '80');

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/caja/turnos',
      cookies: ctx.admin,
    });

    const turnos = z.array(turnoResumenSchema).parse(res.json());
    expect(turnos).toMatchObject([
      { id: segundo, diferenciaApertura: '-10.00', diferencia: null, cerradoEn: null },
      {
        id: primero,
        diferenciaApertura: '100.00',
        diferencia: '-10.00',
        cerradoPor: { id: ctx.usuarios.ana.id },
      },
    ]);
  });

  it('el detalle muestra movimientos y el esperado en vivo con el turno abierto', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana, '100');
    await movimiento(ctx, ctx.ana, 'gasto', '30', 'Hielo');

    const turno = turnoDetalleSchema.parse((await detalle(ctx, turnoId)).json());

    expect(turno.resumen.esperado).toBe('70.00');
    expect(turno.movimientos).toMatchObject([
      { tipo: 'gasto', categoria: 'otro', monto: '30.00', motivo: 'Hielo' },
    ]);
    expect(turno.montoContado).toBe(null);
  });

  it('un empleado recibe 403 en la lista y en el detalle', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana);
    expect((await detalle(ctx, turnoId, ctx.ana)).statusCode).toBe(403);
    const lista = await ctx.app.inject({
      method: 'GET',
      url: '/api/caja/turnos',
      cookies: ctx.ana,
    });
    expect(lista.statusCode).toBe(403);
  });
});

describe('cuenta de cada movimiento', () => {
  it('el empleado paga un gasto con Mercado Pago en su turno', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana);

    const res = await movimientoMp(ctx, ctx.ana, 'gasto', '6000', 'bolsas');

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ tipo: 'gasto', cuenta: 'mercado_pago', turnoId });
  });

  it('sin cuenta, el movimiento es en efectivo', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.ana);

    const res = await movimiento(ctx, ctx.ana, 'gasto', '100', 'Hielo');

    expect(res.json()).toMatchObject({ cuenta: 'efectivo' });
  });

  it('el empleado no puede hacer un retiro de Mercado Pago', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.ana);

    const res = await movimientoMp(ctx, ctx.ana, 'retiro', '1000');

    expect(res.statusCode).toBe(403);
    expect(await prismaTest.movimientoCaja.count()).toBe(0);
  });

  it('el admin registra movimientos de Mercado Pago sin turno abierto', async () => {
    const ctx = await preparar();

    const gasto = await movimientoMp(ctx, ctx.admin, 'gasto', '45000', 'luz de octubre');
    const retiro = await movimientoMp(ctx, ctx.admin, 'retiro', '100000', 'a mi cuenta');

    expect(gasto.statusCode).toBe(201);
    expect(retiro.json()).toMatchObject({ cuenta: 'mercado_pago', turnoId: null });
  });

  it('sin turno abierto, el admin no puede mover efectivo ni el empleado Mercado Pago', async () => {
    const ctx = await preparar();

    expect((await movimiento(ctx, ctx.admin, 'gasto', '100')).statusCode).toBe(409);
    expect((await movimientoMp(ctx, ctx.ana, 'gasto', '100')).statusCode).toBe(409);
    expect(await prismaTest.movimientoCaja.count()).toBe(0);
  });

  it('con un turno abierto, el movimiento de Mercado Pago del admin queda en ese turno', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.ana);

    const res = await movimientoMp(ctx, ctx.admin, 'retiro', '1000');

    expect(res.json()).toMatchObject({ turnoId });
  });
});

describe('movimientos de Mercado Pago para el admin', () => {
  function listarMp(ctx: Ctx, query = '', cookies = ctx.admin) {
    return ctx.app.inject({ method: 'GET', url: `/api/caja/movimientos-mp${query}`, cookies });
  }

  it('lista solo los de Mercado Pago del rango, del más reciente al más antiguo', async () => {
    const ctx = await preparar();
    const viejo = (await movimientoMp(ctx, ctx.admin, 'gasto', '100', 'de septiembre')).json();
    await prismaTest.movimientoCaja.update({
      where: { id: viejo.id },
      data: { creadoEn: new Date('2026-09-30T12:00:00Z') },
    });
    await abrirTurnoDePrueba(ctx.app, ctx.ana);
    await movimiento(ctx, ctx.ana, 'gasto', '200', 'en efectivo');
    const primero = (await movimientoMp(ctx, ctx.admin, 'retiro', '300', 'primero')).json();
    ctx.adelantar(HORA);
    const segundo = (await movimientoMp(ctx, ctx.ana, 'gasto', '400', 'segundo')).json();

    const res = await listarMp(ctx, '?desde=2026-10-01&hasta=2026-10-20');

    expect(res.statusCode).toBe(200);
    expect(
      z
        .array(movimientoCajaSchema)
        .parse(res.json())
        .map((m) => m.id),
    ).toEqual([segundo.id, primero.id]);
  });

  it('sin fechas lista los de hoy; desde posterior a hasta responde 400', async () => {
    const ctx = await preparar();
    await movimientoMp(ctx, ctx.admin, 'gasto', '100');

    expect((await listarMp(ctx)).json()).toHaveLength(1);
    expect((await listarMp(ctx, '?desde=2026-10-21&hasta=2026-10-20')).statusCode).toBe(400);
  });

  it('un empleado recibe 403', async () => {
    const ctx = await preparar();
    expect((await listarMp(ctx, '', ctx.ana)).statusCode).toBe(403);
  });
});

describe('aviso de un gasto de Mercado Pago', () => {
  it('el aviso del empleado dice que salió de Mercado Pago', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.ana);

    await movimientoMp(ctx, ctx.ana, 'gasto', '6000', 'bolsas');

    const aviso = await prismaTest.notificacion.findFirstOrThrow({ where: { tipo: 'gasto_caja' } });
    expect(aviso.texto).toMatch(/^\*Gasto de Mercado Pago · Insumos: \$ 6\.000,00\*/);
  });
});
