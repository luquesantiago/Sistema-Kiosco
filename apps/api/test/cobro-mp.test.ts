import { sumar, ventaDetalleSchema } from '@kiosco/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase, prismaTest } from './base.js';
import {
  abrirTurnoDePrueba,
  cerrarTurnoDePrueba,
  crearUsuarioDePrueba,
  sesionDe,
  type Cookies,
} from './ayudas.js';
import {
  avisosDeTipo,
  avisoWebhook,
  cobrosDe,
  contarAvisosMp,
  contarCobros,
  crearAppConPoint,
  fijarConsultadoEn,
  filaVenta,
  movimientosDeTipo,
  revisar,
  TERMINAL_ID,
  type OpcionesAppConPoint,
} from './cobro-mp-ayudas.js';
import { opcionesFacturacion } from './facturacion-ayudas.js';
import {
  crearProductoDePrueba,
  ingresarMercaderia,
  verificarStockConsistente,
} from './stock-ayudas.js';

/*
 * Cobro con el Point integrado (cambio cobro-mercado-pago): registro en espera,
 * estados del pago, cancelación, pago aprobado después de cancelar con su
 * devolución en efectivo, bordes de tiempo y webhook.
 *
 * El contrato de la app, del cliente falso y de `revisarCobros` está en
 * `cobro-mp-ayudas.ts` y `mercadopago-falso.ts`. Además se asume (el design no lo fija):
 * - `POST /api/ventas/:id/cobro/reintentar` → 200 con el cobro (el intento nuevo o el mismo).
 * - `POST /api/ventas/:id/cancelar` → 200 con el detalle de la venta.
 * - `GET /api/ventas/en-espera` → 200 con el detalle de la venta en espera del turno, o `null`.
 * - `POST /api/mercado-pago/cobros/:id/devolucion` y `/sin-devolver` → 200 con el cobro.
 * - `POST /api/mercado-pago/cobros/:id/revisado` → 200 con el cobro revisado.
 * - El motivo de un cobro creándose sin respuesta de MP no se fija acá: el mostrador
 *   muestra el texto del spec cuando el cobro queda `creando` (ver los tests de la web).
 */

beforeEach(async () => {
  await limpiarBase();
});

afterEach(async () => {
  await verificarStockConsistente();
});

const S = 1000;
const MIN = 60 * S;

/** Lunes 9/11/2026 a las 10:00:00 en Argentina. */
const LUNES_1000 = new Date('2026-11-09T13:00:00Z');
const a = (hhmmss: string) => new Date(`2026-11-09T${hhmmss}-03:00`);

async function preparar(opciones: OpcionesAppConPoint = {}) {
  const ctx = await crearAppConPoint(LUNES_1000, opciones);
  await crearUsuarioDePrueba('ana', 'admin');
  const juan = await crearUsuarioDePrueba('juan');
  await crearUsuarioDePrueba('pedro');
  const admin = await sesionDe(ctx.app, 'ana');
  const empleado = await sesionDe(ctx.app, 'juan');
  const pedro = await sesionDe(ctx.app, 'pedro');
  const alfajor = await crearProductoDePrueba('Alfajor', { precio: '900' });
  const gaseosa = await crearProductoDePrueba('Gaseosa', { precio: '1500' });
  // Esperado del turno: $52.000 (como en los escenarios del spec de caja).
  const turnoId = await abrirTurnoDePrueba(ctx.app, empleado, '52000');
  return { ...ctx, admin, empleado, pedro, juan, alfajor, gaseosa, turnoId };
}

type Ctx = Awaited<ReturnType<typeof preparar>>;
type Pago = { medio: string; monto: string; montoRecibido?: string };
type Item = Record<string, unknown>;

const gaseosas = (ctx: Ctx, cantidad: number): Item => ({
  productoId: ctx.gaseosa.id,
  cantidad,
});
const varios = (precio: string): Item => ({
  varios: { descripcion: 'Recarga', precio },
  cantidad: 1,
});

function vender(
  ctx: Ctx,
  pagos: Pago[],
  items: Item[],
  { cookies = ctx.empleado, total }: { cookies?: Cookies; total?: string } = {},
) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/ventas',
    cookies,
    payload: { items, pagos, totalEsperado: total ?? sumar(...pagos.map((p) => p.monto)) },
  });
}

/** 2 gaseosas ($3.000) con débito por el Point. */
async function ventaDebito(ctx: Ctx, cookies = ctx.empleado) {
  const res = await vender(ctx, [{ medio: 'debito', monto: '3000' }], [gaseosas(ctx, 2)], {
    cookies,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; numero: number; estado: string; cobro: { id: string } };
}

/** $5.000: 2 gaseosas y $2.000 de "Varios", con $3.000 en débito y $2.000 en efectivo (paga con $5.000). */
async function ventaMixta(ctx: Ctx) {
  const res = await vender(
    ctx,
    [
      { medio: 'debito', monto: '3000' },
      { medio: 'efectivo', monto: '2000', montoRecibido: '5000' },
    ],
    [gaseosas(ctx, 2), varios('2000')],
  );
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; numero: number };
}

function cobro(ctx: Ctx, ventaId: string, cookies = ctx.empleado) {
  return ctx.app.inject({ method: 'GET', url: `/api/ventas/${ventaId}/cobro`, cookies });
}

function cancelar(ctx: Ctx, ventaId: string, cookies = ctx.empleado) {
  return ctx.app.inject({ method: 'POST', url: `/api/ventas/${ventaId}/cancelar`, cookies });
}

function reintentar(ctx: Ctx, ventaId: string, cookies = ctx.empleado) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/ventas/${ventaId}/cobro/reintentar`,
    cookies,
  });
}

function devolver(ctx: Ctx, cobroId: string, cookies = ctx.empleado, payload?: unknown) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/mercado-pago/cobros/${cobroId}/devolucion`,
    cookies,
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

function sinDevolver(ctx: Ctx, cobroId: string, cookies = ctx.empleado) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/mercado-pago/cobros/${cobroId}/sin-devolver`,
    cookies,
  });
}

async function esperado(ctx: Ctx, turnoId = ctx.turnoId) {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/caja/turnos/${turnoId}`,
    cookies: ctx.admin,
  });
  expect(res.statusCode).toBe(200);
  return res.json().resumen.esperado as string;
}

async function estadoCaja(ctx: Ctx, cookies = ctx.empleado) {
  return (await ctx.app.inject({ method: 'GET', url: '/api/caja/estado', cookies })).json();
}

async function stockDe(id: string) {
  return (await prismaTest.producto.findUniqueOrThrow({ where: { id } })).stockActual;
}

function movimientosDeStock(ventaId: string) {
  return prismaTest.movimientoStock.findMany({ where: { ventaId } });
}

/** El cliente paga en el Point: MP lo informa en la próxima consulta (3 s después). */
async function aprobarPorConsulta(ctx: Ctx, ordenId = ctx.falso.ultimaOrden().id) {
  ctx.falso.aprobar(ordenId);
  ctx.adelantar(3 * S);
  await revisar(ctx);
}

/**
 * Venta cancelada en el mostrador antes de que la terminal tomara el cobro (MP confirma
 * la cancelación en el momento) y, después, MP informa el pago aprobado y llega el aviso.
 */
async function pagoDespuesDeCancelar(
  ctx: Ctx,
  { mixta = false, horaAprobacion }: { mixta?: boolean; horaAprobacion?: Date } = {},
) {
  const venta = mixta ? await ventaMixta(ctx) : await ventaDebito(ctx);
  const ordenId = ctx.falso.ultimaOrden().id;
  const cancelacion = await cancelar(ctx, venta.id);
  expect(cancelacion.statusCode).toBe(200);
  expect(cancelacion.json().estado).toBe('cancelada');

  ctx.falso.aprobar(ordenId);
  if (horaAprobacion) ctx.fijarHora(horaAprobacion);
  else ctx.adelantar(3 * S);
  expect((await avisoWebhook(ctx, { ordenId })).statusCode).toBe(200);
  const [cobroMp] = await cobrosDe(venta.id);
  return { venta, ordenId, cobroId: cobroMp!.id };
}

/** `$ 3.000,00` con o sin espacio. */
const pesos = (texto: string) => new RegExp(`\\$\\s?${texto.replace(/\./g, '\\.')}`);

describe('monto enviado a la terminal', () => {
  it.each([
    ['$1.500 (entero)', '1500', '1500.00'],
    ['$1.500,5 (un decimal)', '1500.5', '1500.50'],
    ['$0,01 (mínimo del sistema)', '0.01', '0.01'],
  ])('parte del Point de %s → se envía "%s" con 2 decimales', async (_caso, monto, enviado) => {
    const ctx = await preparar();

    const res = await vender(ctx, [{ medio: 'debito', monto }], [varios(monto)]);

    expect(res.statusCode).toBe(201);
    const venta = ventaDetalleSchema.parse(res.json());
    expect(venta.estado).toBe('pendiente');
    expect(ctx.falso.pedidosCreacion).toHaveLength(1);
    expect(ctx.falso.pedidosCreacion[0]).toMatchObject({
      monto: enviado,
      medio: 'debito',
      terminalId: TERMINAL_ID,
      referenciaExterna: `venta-${venta.numero}-1`,
    });
    expect(ctx.falso.pedidosCreacion[0]!.claveIdempotencia).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(res.json().cobro).toMatchObject({ intento: 1, medio: 'debito', monto: enviado });
  });

  it.each([
    ['$0,00', '0'],
    ['$0,005 (tres decimales)', '0.005'],
  ])('parte del Point de %s → 400 y no crea la venta ni el cobro', async (_caso, monto) => {
    const ctx = await preparar();

    const res = await vender(
      ctx,
      [
        { medio: 'debito', monto },
        { medio: 'efectivo', monto: '1500' },
      ],
      [varios('1500')],
      { total: '1500' },
    );

    expect(res.statusCode).toBe(400);
    expect(await prismaTest.venta.count()).toBe(0);
    expect(await contarCobros()).toBe(0);
    expect(ctx.falso.pedidosCreacion).toHaveLength(0);
  });

  // "0.005" no puede leerse como $5 con punto de miles: con los totales alineados a $5,
  // si se leyera así la venta pasaría. Hoy `textoAMonto` (shared/montos.ts) lo lee como "5.00".
  it.each([
    ['como texto', '0.005'],
    ['como número', 0.005],
  ])('$0,005 %s no se toma como $5 por el punto de miles → 400', async (_caso, monto) => {
    const ctx = await preparar();

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/ventas',
      cookies: ctx.empleado,
      payload: { items: [varios('5')], pagos: [{ medio: 'debito', monto }], totalEsperado: '5' },
    });

    expect(res.statusCode).toBe(400);
    expect(await prismaTest.venta.count()).toBe(0);
    expect(ctx.falso.pedidosCreacion).toHaveLength(0);
  });

  it('el monto con tres decimales tampoco pasa como pago único', async () => {
    const ctx = await preparar();

    const res = await vender(ctx, [{ medio: 'debito', monto: '0.005' }], [varios('0.01')], {
      total: '0.01',
    });

    expect(res.statusCode).toBe(400);
    expect(await contarCobros()).toBe(0);
    expect(ctx.falso.pedidosCreacion).toHaveLength(0);
  });

  it.each([
    ['débito', 'debito'],
    ['crédito', 'credito'],
    ['Mercado Pago (QR del Point)', 'mercado_pago'],
  ])('cobrar con %s le pide a la terminal ese medio', async (_caso, medio) => {
    const ctx = await preparar();

    const res = await vender(ctx, [{ medio, monto: '3300' }], [varios('3300')]);

    expect(res.statusCode).toBe(201);
    expect(ctx.falso.pedidosCreacion[0]).toMatchObject({ medio, monto: '3300.00' });
  });
});

describe('pagos de una venta con el Point', () => {
  it('parte del Point igual al total: en espera con un solo pago en débito', async () => {
    const ctx = await preparar();

    const res = await vender(ctx, [{ medio: 'debito', monto: '5000' }], [varios('5000')]);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      estado: 'pendiente',
      total: '5000.00',
      pagos: [{ medio: 'debito', monto: '5000.00' }],
    });
    expect(ctx.falso.pedidosCreacion[0]!.monto).toBe('5000.00');
  });

  it('parte del Point un centavo menor que el total: los dos pagos y al Point van $4.999,99', async () => {
    const ctx = await preparar();

    const res = await vender(
      ctx,
      [
        { medio: 'debito', monto: '4999.99' },
        { medio: 'efectivo', monto: '0.01' },
      ],
      [varios('5000')],
    );

    expect(res.statusCode).toBe(201);
    const venta = ventaDetalleSchema.parse(res.json());
    expect(venta.estado).toBe('pendiente');
    expect(venta.pagos.map((p) => [p.medio, p.monto])).toEqual(
      expect.arrayContaining([
        ['debito', '4999.99'],
        ['efectivo', '0.01'],
      ]),
    );
    expect(ctx.falso.pedidosCreacion[0]!.monto).toBe('4999.99');
  });

  it('parte en efectivo de $0 → 400 y no registra nada', async () => {
    const ctx = await preparar();

    const res = await vender(
      ctx,
      [
        { medio: 'debito', monto: '5000' },
        { medio: 'efectivo', monto: '0' },
      ],
      [varios('5000')],
      { total: '5000' },
    );

    expect(res.statusCode).toBe(400);
    expect(await prismaTest.venta.count()).toBe(0);
    expect(ctx.falso.pedidosCreacion).toHaveLength(0);
  });

  it.each([
    ['$0,01 menos', '1999.99'],
    ['$0,01 más', '2000.01'],
  ])('pagos que suman %s que el total → 400', async (_caso, efectivo) => {
    const ctx = await preparar();

    const res = await vender(
      ctx,
      [
        { medio: 'debito', monto: '3000' },
        { medio: 'efectivo', monto: efectivo },
      ],
      [varios('5000')],
      { total: '5000' },
    );

    expect(res.statusCode).toBe(400);
    expect(await prismaTest.venta.count()).toBe(0);
    expect(ctx.falso.pedidosCreacion).toHaveLength(0);
  });

  it('dos medios electrónicos con el Point → 400 UN_SOLO_MEDIO_ELECTRONICO, sin venta ni llamada a MP', async () => {
    const ctx = await preparar();

    const res = await vender(
      ctx,
      [
        { medio: 'debito', monto: '2000' },
        { medio: 'credito', monto: '3000' },
      ],
      [varios('5000')],
    );

    expect(res.statusCode).toBe(400);
    expect(res.json().error.codigo).toBe('UN_SOLO_MEDIO_ELECTRONICO');
    expect(await prismaTest.venta.count()).toBe(0);
    expect(ctx.falso.pedidosCreacion).toHaveLength(0);
  });

  it('sin el Point, dos medios electrónicos se siguen aceptando como antes', async () => {
    const ctx = await preparar({ conPoint: false });

    const res = await vender(
      ctx,
      [
        { medio: 'debito', monto: '2000' },
        { medio: 'credito', monto: '3000' },
      ],
      [varios('5000')],
    );

    expect(res.statusCode).toBe(201);
    expect(res.json().estado).toBe('pagada');
  });

  it('solo efectivo con el Point configurado: pagada en el momento y sin llamar a MP', async () => {
    const ctx = await preparar();

    const res = await vender(ctx, [{ medio: 'efectivo', monto: '3000' }], [gaseosas(ctx, 2)]);

    expect(res.statusCode).toBe(201);
    expect(res.json().estado).toBe('pagada');
    expect(await stockDe(ctx.gaseosa.id)).toBe(-2);
    expect(ctx.falso.pedidosCreacion).toHaveLength(0);
    expect(await contarCobros()).toBe(0);
  });

  it('sin el Point configurado, débito queda pagada en el momento, descuenta stock y no llama a MP', async () => {
    const ctx = await preparar({ conPoint: false });

    const res = await vender(ctx, [{ medio: 'debito', monto: '3000' }], [gaseosas(ctx, 2)]);

    expect(res.statusCode).toBe(201);
    expect(res.json().estado).toBe('pagada');
    expect(await stockDe(ctx.gaseosa.id)).toBe(-2);
    expect(ctx.falso.pedidosCreacion).toHaveLength(0);
  });
});

describe('registro de una venta en espera', () => {
  it('débito por el Point: número siguiente, pendiente, su turno, un pago y el cobro enviado', async () => {
    const ctx = await preparar();
    const anterior = (
      await vender(ctx, [{ medio: 'efectivo', monto: '1500' }], [gaseosas(ctx, 1)])
    ).json();

    const res = await vender(ctx, [{ medio: 'debito', monto: '3300' }], [varios('3300')]);

    expect(res.statusCode).toBe(201);
    const venta = res.json();
    expect(venta).toMatchObject({
      numero: anterior.numero + 1,
      total: '3300.00',
      estado: 'pendiente',
      usuario: { id: ctx.juan.id },
      pagos: [{ medio: 'debito', monto: '3300.00' }],
      cobro: { estado: 'en_espera', intento: 1, medio: 'debito', monto: '3300.00' },
    });
    const fila = await filaVenta(venta.id);
    expect(fila.venceEn).toEqual(new Date(LUNES_1000.getTime() + 10 * MIN));
    expect(fila.pagadaEn).toBeNull();
    expect((await prismaTest.venta.findUniqueOrThrow({ where: { id: venta.id } })).turnoId).toBe(
      ctx.turnoId,
    );
    const [cobroMp] = await cobrosDe(venta.id);
    expect(cobroMp).toMatchObject({
      estado: 'en_espera',
      ordenId: ctx.falso.ultimaOrden().id,
      referenciaExterna: `venta-${venta.numero}-1`,
    });
    expect(cobroMp!.consultadoEn).toEqual(LUNES_1000);
  });

  it('no descuenta stock ni deja movimientos mientras espera', async () => {
    const ctx = await preparar();
    await ingresarMercaderia(ctx.app, ctx.admin, [{ productoId: ctx.gaseosa.id, cantidad: 10 }]);

    const venta = await ventaDebito(ctx);

    expect(await stockDe(ctx.gaseosa.id)).toBe(10);
    expect(await movimientosDeStock(venta.id)).toHaveLength(0);
  });

  it('una venta en espera no se puede anular (409) y no cambia', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/ventas/${venta.id}/anular`,
      cookies: ctx.admin,
      payload: { motivo: 'error de carga' },
    });

    expect(res.statusCode).toBe(409);
    expect((await filaVenta(venta.id)).estado).toBe('pendiente');
  });

  it('el listado y el detalle muestran la venta en espera con su cobro', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);

    const lista = await ctx.app.inject({
      method: 'GET',
      url: '/api/ventas',
      cookies: ctx.empleado,
    });
    const detalle = await ctx.app.inject({
      method: 'GET',
      url: `/api/ventas/${venta.id}`,
      cookies: ctx.empleado,
    });

    expect(lista.json()).toEqual([expect.objectContaining({ id: venta.id, estado: 'pendiente' })]);
    expect(detalle.json()).toMatchObject({
      estado: 'pendiente',
      cobro: { estado: 'en_espera' },
      cancelacion: null,
    });
  });

  it('GET /api/ventas/:id/cobro devuelve el estado del último cobro sin llamar a MP', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);

    const res = await cobro(ctx, venta.id);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ventaId: venta.id,
      estado: 'en_espera',
      intento: 1,
      medio: 'debito',
      monto: '3000.00',
      cancelacionPedida: false,
    });
    expect(ctx.falso.consultas).toHaveLength(0);
  });

  it('GET /api/ventas/en-espera devuelve la venta en espera del turno, y null si no hay', async () => {
    const ctx = await preparar();
    const ninguna = await ctx.app.inject({
      method: 'GET',
      url: '/api/ventas/en-espera',
      cookies: ctx.empleado,
    });
    expect(ninguna.statusCode).toBe(200);
    expect(ninguna.json()).toBeNull();

    const venta = await ventaDebito(ctx);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/ventas/en-espera',
      cookies: ctx.empleado,
    });

    expect(res.json()).toMatchObject({
      id: venta.id,
      estado: 'pendiente',
      cobro: { estado: 'en_espera' },
    });
  });
});

describe('un cobro a la vez', () => {
  it('segundo cobro con el primero esperando → 409 TERMINAL_OCUPADA y no registra la segunda venta', async () => {
    const ctx = await preparar();
    await ventaDebito(ctx);

    const res = await vender(ctx, [{ medio: 'credito', monto: '1500' }], [gaseosas(ctx, 1)]);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('TERMINAL_OCUPADA');
    expect(await prismaTest.venta.count()).toBe(1);
    expect(ctx.falso.pedidosCreacion).toHaveLength(1);
  });

  it('dos pedidos simultáneos: uno queda en espera y el otro recibe 409 TERMINAL_OCUPADA', async () => {
    const ctx = await preparar();

    const respuestas = await Promise.all([
      vender(ctx, [{ medio: 'debito', monto: '3000' }], [gaseosas(ctx, 2)]),
      vender(ctx, [{ medio: 'credito', monto: '1500' }], [gaseosas(ctx, 1)]),
    ]);

    expect(respuestas.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(respuestas.find((r) => r.statusCode === 409)!.json().error.codigo).toBe(
      'TERMINAL_OCUPADA',
    );
    expect(await prismaTest.venta.count()).toBe(1);
    expect(await contarCobros()).toBe(1);
  });

  it('un cobro rechazado ya no ocupa la terminal: otra venta sí se puede cobrar', async () => {
    const ctx = await preparar();
    await ventaDebito(ctx);
    ctx.falso.fijar(ctx.falso.ultimaOrden().id, {
      estado: 'rechazado',
      detalle: 'rejected_by_issuer',
    });
    ctx.adelantar(3 * S);
    await revisar(ctx);

    const res = await vender(ctx, [{ medio: 'credito', monto: '1500' }], [gaseosas(ctx, 1)]);

    expect(res.statusCode).toBe(201);
  });

  it('una venta cancelada cuyo cobro no llegó a crearse libera la terminal', async () => {
    const ctx = await preparar();
    ctx.falso.fallaCrear = 'no_responde';
    const venta = await ventaDebito(ctx);
    expect((await cancelar(ctx, venta.id)).statusCode).toBe(200);
    ctx.falso.fallaCrear = null;

    const res = await vender(ctx, [{ medio: 'credito', monto: '1500' }], [gaseosas(ctx, 1)]);

    expect(res.statusCode).toBe(201);
  });

  it('MP dice que la terminal tiene otro cobro: rechazado con el motivo que pide liberar el Point', async () => {
    const ctx = await preparar();
    ctx.falso.fallaCrear = { status: 409, codigo: 'terminal_ocupada' };

    const res = await vender(ctx, [{ medio: 'debito', monto: '3000' }], [gaseosas(ctx, 2)]);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      estado: 'pendiente',
      cobro: {
        estado: 'rechazado',
        motivo: 'El Point tiene otro cobro abierto: cancelalo en el Point y reintentá',
      },
    });
  });

  it('MP no acepta el monto de $0,01: rechazado con "Mercado Pago no acepta ese monto" y la venta en espera', async () => {
    const ctx = await preparar();
    ctx.falso.fallaCrear = { status: 400, codigo: 'monto_invalido' };

    const res = await vender(ctx, [{ medio: 'debito', monto: '0.01' }], [varios('0.01')]);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      estado: 'pendiente',
      cobro: { estado: 'rechazado', motivo: 'Mercado Pago no acepta ese monto' },
    });
  });
});

describe('estado del cobro según Mercado Pago', () => {
  it('pago aprobado: pagada con la fecha de aprobación, stock descontado una vez y factura encolada una vez', async () => {
    const facturacion = opcionesFacturacion();
    const ctx = await preparar({ facturacion });
    await ingresarMercaderia(ctx.app, ctx.admin, [{ productoId: ctx.gaseosa.id, cantidad: 10 }]);
    const venta = await ventaDebito(ctx);
    ctx.falso.aprobar(ctx.falso.ultimaOrden().id);
    ctx.fijarHora(a('10:15:05'));

    await revisar(ctx);
    ctx.adelantar(3 * S);
    await revisar(ctx);

    const fila = await filaVenta(venta.id);
    expect(fila.estado).toBe('pagada');
    expect(fila.pagadaEn).toEqual(a('10:15:05'));
    expect(fila.venceEn).toBeNull();
    expect(await stockDe(ctx.gaseosa.id)).toBe(8);
    expect(
      (await movimientosDeStock(venta.id)).map((m) => [m.tipo, m.cantidad, m.usuarioId]),
    ).toEqual([['venta', -2, ctx.juan.id]]);
    const facturas = await prismaTest.factura.findMany({ where: { ventaId: venta.id } });
    expect(facturas.map((f) => [f.parte, f.importe.toFixed(2)])).toEqual([
      ['electronica', '3000.00'],
    ]);
    expect(facturacion.despertar).toHaveBeenCalled();
    expect((await cobro(ctx, venta.id)).json().estado).toBe('aprobado');
  });

  it('venta mixta aprobada: una sola factura automática por la parte electrónica ($3.000)', async () => {
    const ctx = await preparar({ facturacion: opcionesFacturacion() });
    const venta = await ventaMixta(ctx);

    await aprobarPorConsulta(ctx);

    expect((await filaVenta(venta.id)).estado).toBe('pagada');
    const facturas = await prismaTest.factura.findMany({ where: { ventaId: venta.id } });
    expect(facturas.map((f) => [f.parte, f.importe.toFixed(2)])).toEqual([
      ['electronica', '3000.00'],
    ]);
  });

  it('los precios quedan fijos durante la espera: aprobada con la gaseosa a $1.500 aunque ahora valga $1.600', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    await prismaTest.producto.update({ where: { id: ctx.gaseosa.id }, data: { precio: '1600' } });

    await aprobarPorConsulta(ctx);

    const detalle = (
      await ctx.app.inject({ method: 'GET', url: `/api/ventas/${venta.id}`, cookies: ctx.admin })
    ).json();
    expect(detalle).toMatchObject({
      estado: 'pagada',
      total: '3000.00',
      items: [{ descripcion: 'Gaseosa', precioUnitario: '1500.00', subtotal: '3000.00' }],
    });
  });

  it('se descuenta el stock al aprobarse aunque el producto se haya desactivado durante la espera', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    await prismaTest.producto.update({ where: { id: ctx.gaseosa.id }, data: { activo: false } });

    await aprobarPorConsulta(ctx);

    expect((await filaVenta(venta.id)).estado).toBe('pagada');
    expect(await stockDe(ctx.gaseosa.id)).toBe(-2);
  });

  it.each([
    ['insufficient_amount', 'Fondos insuficientes'],
    ['rejected_by_issuer', 'Tarjeta rechazada por el banco'],
    ['card_disabled', 'Tarjeta bloqueada'],
    ['bad_filled_card_data', 'Datos de la tarjeta incorrectos'],
    ['high_risk', 'Mercado Pago lo rechazó por seguridad'],
    ['cualquier_otro_detalle', 'Pago rechazado'],
  ])(
    'pago fallido por %s: rechazado con "%s" y la venta sigue en espera',
    async (detalle, motivo) => {
      const ctx = await preparar();
      await ingresarMercaderia(ctx.app, ctx.admin, [{ productoId: ctx.gaseosa.id, cantidad: 10 }]);
      const venta = await ventaDebito(ctx);
      ctx.falso.fijar(ctx.falso.ultimaOrden().id, { estado: 'rechazado', detalle });
      ctx.adelantar(3 * S);

      await revisar(ctx);

      expect((await cobro(ctx, venta.id)).json()).toMatchObject({ estado: 'rechazado', motivo });
      expect((await filaVenta(venta.id)).estado).toBe('pendiente');
      expect(await stockDe(ctx.gaseosa.id)).toBe(10);
      expect(await movimientosDeStock(venta.id)).toHaveLength(0);
    },
  );

  it('cobro vencido en MP (3 minutos sin pagar): vencido y la venta sigue en espera', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    ctx.falso.fijar(ctx.falso.ultimaOrden().id, { estado: 'vencido', detalle: null });
    ctx.adelantar(3 * MIN);

    await revisar(ctx);

    expect((await cobro(ctx, venta.id)).json().estado).toBe('vencido');
    expect((await filaVenta(venta.id)).estado).toBe('pendiente');
  });

  it('la terminal pide revisar el pago: a revisar, venta en espera y aviso al admin', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    ctx.falso.fijar(ctx.falso.ultimaOrden().id, {
      estado: 'a_revisar',
      detalle: 'check_on_terminal',
    });
    ctx.adelantar(3 * S);

    await revisar(ctx);
    ctx.adelantar(3 * S);
    await revisar(ctx);

    expect((await cobro(ctx, venta.id)).json().estado).toBe('a_revisar');
    expect((await filaVenta(venta.id)).estado).toBe('pendiente');
    const avisos = await avisosDeTipo('cobro_mp_a_revisar');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.texto).toContain(`venta #${venta.numero}`);
    expect(avisos[0]!.texto).toContain('el Point pidió revisar el pago');
    expect(avisos[0]!.texto).toContain('Revisalo en Administración → Mercado Pago');
    expect(avisos[0]!.texto).toMatch(pesos('3.000,00'));
  });

  it.each([
    ['aprobado', { estado: 'aprobado', detalle: 'accredited' }],
    ['rechazado', { estado: 'rechazado', detalle: 'insufficient_amount' }],
    ['vencido', { estado: 'vencido', detalle: null }],
  ] as const)('un cobro %s no se vuelve a consultar', async (_caso, final) => {
    const ctx = await preparar();
    await ventaDebito(ctx);
    const ordenId = ctx.falso.ultimaOrden().id;
    ctx.falso.fijar(ordenId, final);
    ctx.adelantar(3 * S);
    await revisar(ctx);
    const consultas = ctx.falso.consultas.length;

    ctx.adelantar(3 * S);
    await revisar(ctx);
    ctx.adelantar(30 * S);
    await revisar(ctx);

    expect(ctx.falso.consultas).toHaveLength(consultas);
  });

  it('un cobro cancelado no se vuelve a consultar', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    await cancelar(ctx, venta.id);
    const consultas = ctx.falso.consultas.length;

    ctx.adelantar(3 * S);
    await revisar(ctx);

    expect(ctx.falso.consultas).toHaveLength(consultas);
  });
});

describe('cancelación de una venta en espera', () => {
  it('con el cobro sin tomar por la terminal: MP confirma en el momento y la venta queda cancelada', async () => {
    const ctx = await preparar();
    await ingresarMercaderia(ctx.app, ctx.admin, [{ productoId: ctx.gaseosa.id, cantidad: 10 }]);
    const venta = await ventaDebito(ctx);
    ctx.fijarHora(a('10:01:30'));

    const res = await cancelar(ctx, venta.id);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      estado: 'cancelada',
      cancelacion: { motivo: 'Cancelada en el mostrador', en: a('10:01:30').toISOString() },
    });
    expect(ctx.falso.cancelaciones).toEqual([ctx.falso.ultimaOrden().id]);
    const fila = await filaVenta(venta.id);
    expect(fila).toMatchObject({
      estado: 'cancelada',
      motivoCancelacion: 'Cancelada en el mostrador',
    });
    expect(fila.canceladaEn).toEqual(a('10:01:30'));
    expect((await cobro(ctx, venta.id)).json().estado).toBe('cancelado');
    expect(await stockDe(ctx.gaseosa.id)).toBe(10);
    expect(await movimientosDeStock(venta.id)).toHaveLength(0);
  });

  it('con el cobro en la pantalla del Point (202): sigue en espera hasta que MP confirma, y entonces cancelada', async () => {
    const ctx = await preparar();
    ctx.falso.nacenEnTerminal = true;
    const venta = await ventaDebito(ctx);

    const res = await cancelar(ctx, venta.id);

    expect(res.statusCode).toBe(200);
    expect(res.json().estado).toBe('pendiente');
    expect((await cobro(ctx, venta.id)).json()).toMatchObject({
      estado: 'cancelando',
      cancelacionPedida: true,
    });

    ctx.falso.fijar(ctx.falso.ultimaOrden().id, { estado: 'cancelado', detalle: null });
    ctx.adelantar(3 * S);
    await revisar(ctx);

    expect((await filaVenta(venta.id)).estado).toBe('cancelada');
    expect((await cobro(ctx, venta.id)).json().estado).toBe('cancelado');
  });

  it('el cliente pagó mientras se cancelaba: la venta queda pagada (no a devolver)', async () => {
    const ctx = await preparar();
    ctx.falso.nacenEnTerminal = true;
    const venta = await ventaDebito(ctx);
    await cancelar(ctx, venta.id);

    await aprobarPorConsulta(ctx);

    expect((await filaVenta(venta.id)).estado).toBe('pagada');
    expect((await cobro(ctx, venta.id)).json().estado).toBe('aprobado');
    expect(await stockDe(ctx.gaseosa.id)).toBe(-2);
    expect(await movimientosDeTipo('ingreso')).toHaveLength(0);
    expect(await avisosDeTipo('cobro_mp_a_revisar')).toHaveLength(0);
  });

  it('MP ya había procesado el pago al pedir cancelar (409): se consulta y la venta queda pagada', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    ctx.falso.aprobar(ctx.falso.ultimaOrden().id);

    const res = await cancelar(ctx, venta.id);

    expect(res.statusCode).toBe(200);
    expect(res.json().estado).toBe('pagada');
    expect(ctx.falso.consultas).toContain(ctx.falso.ultimaOrden().id);
    expect(await stockDe(ctx.gaseosa.id)).toBe(-2);
  });

  it('después de un rechazo: cancelada en el momento, sin pedirle nada a MP', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    ctx.falso.fijar(ctx.falso.ultimaOrden().id, {
      estado: 'rechazado',
      detalle: 'rejected_by_issuer',
    });
    ctx.adelantar(3 * S);
    await revisar(ctx);

    const res = await cancelar(ctx, venta.id);

    expect(res.json().estado).toBe('cancelada');
    expect(ctx.falso.cancelaciones).toHaveLength(0);
    expect(await movimientosDeStock(venta.id)).toHaveLength(0);
  });

  it('con el cobro sin crear porque MP no respondió: cancelada en el momento, sin pedirle nada a MP', async () => {
    const ctx = await preparar();
    ctx.falso.fallaCrear = 'no_responde';
    const venta = await ventaDebito(ctx);

    const res = await cancelar(ctx, venta.id);

    expect(res.json().estado).toBe('cancelada');
    expect(ctx.falso.cancelaciones).toHaveLength(0);
  });

  it('un empleado que no es del turno recibe 403 y la venta no cambia; el admin sí puede', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);

    const otro = await cancelar(ctx, venta.id, ctx.pedro);
    expect(otro.statusCode).toBe(403);
    expect((await filaVenta(venta.id)).estado).toBe('pendiente');

    const admin = await cancelar(ctx, venta.id, ctx.admin);
    expect(admin.statusCode).toBe(200);
    expect(admin.json().estado).toBe('cancelada');
  });

  it.each(['pagada', 'cancelada'])(
    'cancelar una venta %s → 409 VENTA_NO_EN_ESPERA',
    async (estado) => {
      const ctx = await preparar();
      let ventaId: string;
      if (estado === 'pagada') {
        ventaId = (
          await vender(ctx, [{ medio: 'efectivo', monto: '1500' }], [gaseosas(ctx, 1)])
        ).json().id;
      } else {
        ventaId = (await ventaDebito(ctx)).id;
        await cancelar(ctx, ventaId);
      }

      const res = await cancelar(ctx, ventaId);

      expect(res.statusCode).toBe(409);
      expect(res.json().error.codigo).toBe('VENTA_NO_EN_ESPERA');
      expect((await filaVenta(ventaId)).estado).toBe(estado);
    },
  );

  it('una venta cancelada conserva su número y figura en el listado', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    await cancelar(ctx, venta.id);

    const lista = await ctx.app.inject({ method: 'GET', url: '/api/ventas', cookies: ctx.admin });

    expect(lista.json()).toEqual([
      expect.objectContaining({ id: venta.id, numero: venta.numero, estado: 'cancelada' }),
    ]);
  });
});

describe('Mercado Pago no responde', () => {
  it('responde a tiempo (dentro de los 10 s): el cobro queda esperando en la terminal', async () => {
    const ctx = await preparar();

    const res = await vender(ctx, [{ medio: 'debito', monto: '3000' }], [gaseosas(ctx, 2)]);

    expect(res.json().cobro.estado).toBe('en_espera');
  });

  it('sin respuesta al crear: el cobro sigue creándose (no rechazado) y la venta en espera', async () => {
    const ctx = await preparar();
    ctx.falso.fallaCrear = 'no_responde';

    const res = await vender(ctx, [{ medio: 'debito', monto: '3000' }], [gaseosas(ctx, 2)]);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ estado: 'pendiente', cobro: { estado: 'creando' } });
    const [cobroMp] = await cobrosDe(res.json().id);
    expect(cobroMp!.ordenId).toBeNull();
  });

  it('reintentar después de un timeout reutiliza la clave: MP devuelve el mismo cobro y hay uno solo', async () => {
    const ctx = await preparar();
    ctx.falso.fallaCrear = 'no_responde_pero_creada';
    const venta = (
      await vender(ctx, [{ medio: 'debito', monto: '3000' }], [gaseosas(ctx, 2)])
    ).json();
    ctx.falso.fallaCrear = null;

    const res = await reintentar(ctx, venta.id);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ estado: 'en_espera', intento: 1 });
    expect(ctx.falso.pedidosCreacion).toHaveLength(2);
    expect(ctx.falso.pedidosCreacion[1]!.claveIdempotencia).toBe(
      ctx.falso.pedidosCreacion[0]!.claveIdempotencia,
    );
    expect(ctx.falso.ordenes).toHaveLength(1);
    const cobros = await cobrosDe(venta.id);
    expect(cobros).toHaveLength(1);
    expect(cobros[0]!.ordenId).toBe(ctx.falso.ultimaOrden().id);
  });

  it('reintentar y que MP siga sin responder: el cobro sigue creándose, con la misma clave', async () => {
    const ctx = await preparar();
    ctx.falso.fallaCrear = 'no_responde';
    const venta = (
      await vender(ctx, [{ medio: 'debito', monto: '3000' }], [gaseosas(ctx, 2)])
    ).json();

    const res = await reintentar(ctx, venta.id);

    expect(res.statusCode).toBe(200);
    expect(res.json().estado).toBe('creando');
    expect(new Set(ctx.falso.pedidosCreacion.map((p) => p.claveIdempotencia)).size).toBe(1);
  });

  it('consulta sin respuesta: el cobro sigue esperando y se vuelve a consultar en la siguiente revisión', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    ctx.falso.fallaConsultar = 'no_responde';
    ctx.adelantar(3 * S);

    await revisar(ctx);

    expect((await cobro(ctx, venta.id)).json().estado).toBe('en_espera');
    expect((await filaVenta(venta.id)).estado).toBe('pendiente');

    ctx.falso.fallaConsultar = null;
    ctx.falso.aprobar(ctx.falso.ultimaOrden().id);
    ctx.adelantar(3 * S);
    await revisar(ctx);

    expect((await filaVenta(venta.id)).estado).toBe('pagada');
  });
});

describe('reintento después de un rechazo', () => {
  it('crea el intento siguiente por el mismo monto, con clave y referencia nuevas', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    ctx.falso.fijar(ctx.falso.ultimaOrden().id, {
      estado: 'rechazado',
      detalle: 'rejected_by_issuer',
    });
    ctx.adelantar(3 * S);
    await revisar(ctx);

    const res = await reintentar(ctx, venta.id);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ intento: 2, estado: 'en_espera', monto: '3000.00' });
    const [primero, segundo] = ctx.falso.pedidosCreacion;
    expect(segundo).toMatchObject({
      monto: '3000.00',
      referenciaExterna: `venta-${venta.numero}-2`,
    });
    expect(segundo!.claveIdempotencia).not.toBe(primero!.claveIdempotencia);
    expect(await cobrosDe(venta.id)).toHaveLength(2);
  });

  it('con el cobro todavía activo → 409 TERMINAL_OCUPADA', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);

    const res = await reintentar(ctx, venta.id);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('TERMINAL_OCUPADA');
    expect(ctx.falso.pedidosCreacion).toHaveLength(1);
  });
});

describe('consulta de respaldo cada 3 segundos', () => {
  it.each([
    ['10:00:02,999', 0, 2_999],
    ['10:00:03,000', 1, 3_000],
    ['10:00:03,001', 1, 3_001],
  ])(
    'última consulta a las 10:00:00,000 y revisión a las %s → %i consultas',
    async (_hora, consultas, ms) => {
      const ctx = await preparar();
      const venta = await ventaDebito(ctx);
      const [cobroMp] = await cobrosDe(venta.id);
      await fijarConsultadoEn(cobroMp!.id, LUNES_1000);
      ctx.fijarHora(new Date(LUNES_1000.getTime() + ms));

      await revisar(ctx);

      expect(ctx.falso.consultas).toHaveLength(consultas);
    },
  );

  it('sin notificaciones, el pago con débito se detecta en la siguiente consulta', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    ctx.falso.aprobar(ctx.falso.ultimaOrden().id);

    ctx.adelantar(3 * S);
    await revisar(ctx);

    expect((await filaVenta(venta.id)).estado).toBe('pagada');
  });
});

describe('vencimiento de una venta en espera (10 minutos desde el último intento)', () => {
  /** Venta registrada a las 10:00:00 cuyo cobro venció en MP. */
  async function ventaConCobroVencido(ctx: Ctx) {
    const venta = await ventaDebito(ctx);
    ctx.falso.fijar(ctx.falso.ultimaOrden().id, { estado: 'vencido', detalle: null });
    ctx.fijarHora(a('10:03:00'));
    await revisar(ctx);
    return venta;
  }

  it.each([
    ['10:09:59 (1 s antes)', '10:09:59', 'pendiente'],
    ['10:10:00 (justo en el vencimiento)', '10:10:00', 'cancelada'],
    ['10:10:01 (1 s después)', '10:10:01', 'cancelada'],
  ])('revisión a las %s → venta %s', async (_caso, hora, estado) => {
    const ctx = await preparar();
    const venta = await ventaConCobroVencido(ctx);
    ctx.fijarHora(a(hora));

    await revisar(ctx);

    const fila = await filaVenta(venta.id);
    expect(fila.estado).toBe(estado);
    if (estado === 'cancelada') {
      expect(fila.motivoCancelacion).toBe('Venció la espera');
      expect(fila.canceladaEn).toEqual(a(hora));
    }
  });

  it('reintentar a las 10:06 renueva el plazo: sigue en espera a las 10:12 y a las 10:15:59, vence a las 10:16:00', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    ctx.falso.fijar(ctx.falso.ultimaOrden().id, {
      estado: 'rechazado',
      detalle: 'insufficient_amount',
    });
    ctx.fijarHora(a('10:00:03'));
    await revisar(ctx);
    ctx.fijarHora(a('10:06:00'));
    expect((await reintentar(ctx, venta.id)).statusCode).toBe(200);
    expect((await filaVenta(venta.id)).venceEn).toEqual(a('10:16:00'));
    ctx.falso.fijar(ctx.falso.ultimaOrden().id, { estado: 'vencido', detalle: null });

    for (const hora of ['10:12:00', '10:15:59']) {
      ctx.fijarHora(a(hora));
      await revisar(ctx);
      expect((await filaVenta(venta.id)).estado, hora).toBe('pendiente');
    }
    ctx.fijarHora(a('10:16:00'));
    await revisar(ctx);
    expect((await filaVenta(venta.id)).estado).toBe('cancelada');
  });

  it('aprobado justo al vencer: la consulta informa el pago y la venta queda pagada, no cancelada', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    ctx.falso.aprobar(ctx.falso.ultimaOrden().id);
    // La última consulta fue hace menos de 3 s: el vencimiento consulta igual antes de cancelar.
    const [cobroMp] = await cobrosDe(venta.id);
    await fijarConsultadoEn(cobroMp!.id, a('10:09:59'));
    ctx.fijarHora(a('10:10:00'));

    await revisar(ctx);

    expect((await filaVenta(venta.id)).estado).toBe('pagada');
    expect(await stockDe(ctx.gaseosa.id)).toBe(-2);
  });

  it('al vencer con el cobro todavía activo, pide la cancelación en MP antes de cancelar la venta', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    ctx.fijarHora(a('10:10:00'));

    await revisar(ctx);

    expect(ctx.falso.cancelaciones).toEqual([ctx.falso.ultimaOrden().id]);
    const fila = await filaVenta(venta.id);
    expect(fila.estado).toBe('cancelada');
    expect(fila.motivoCancelacion).toBe('Venció la espera');
  });

  it('al vencer con el cobro en la pantalla del Point, la venta espera la confirmación de MP', async () => {
    const ctx = await preparar();
    ctx.falso.nacenEnTerminal = true;
    const venta = await ventaDebito(ctx);
    ctx.fijarHora(a('10:10:00'));

    await revisar(ctx);

    expect((await filaVenta(venta.id)).estado).toBe('pendiente');
    expect((await cobro(ctx, venta.id)).json().estado).toBe('cancelando');
  });
});

describe('pago aprobado después de cancelar', () => {
  it('la venta sigue cancelada sin stock ni factura; ingreso en la cuenta MP, cobro a devolver y aviso', async () => {
    const ctx = await preparar({ facturacion: opcionesFacturacion() });
    await ingresarMercaderia(ctx.app, ctx.admin, [{ productoId: ctx.gaseosa.id, cantidad: 10 }]);

    const { venta, cobroId } = await pagoDespuesDeCancelar(ctx, { horaAprobacion: a('10:15:00') });

    expect((await filaVenta(venta.id)).estado).toBe('cancelada');
    expect(await stockDe(ctx.gaseosa.id)).toBe(10);
    expect(await movimientosDeStock(venta.id)).toHaveLength(0);
    expect(await prismaTest.factura.count({ where: { ventaId: venta.id } })).toBe(0);
    expect((await cobro(ctx, venta.id)).json()).toMatchObject({
      id: cobroId,
      estado: 'a_devolver',
    });

    const ingresos = await movimientosDeTipo('ingreso');
    expect(ingresos).toHaveLength(1);
    expect(ingresos[0]).toMatchObject({
      cuenta: 'mercado_pago',
      turnoId: ctx.turnoId,
      usuarioId: ctx.juan.id,
      motivo: `Cobro de la venta #${venta.numero} cancelada`,
    });
    expect(ingresos[0]!.monto.toFixed(2)).toBe('3000.00');

    const avisos = await avisosDeTipo('cobro_mp_a_revisar');
    expect(avisos).toHaveLength(1);
    const texto = avisos[0]!.texto;
    expect(texto).toContain('*Cobro de Mercado Pago a devolver*');
    expect(texto).toMatch(pesos('3.000,00'));
    expect(texto).toMatch(/débito/i);
    expect(texto).toContain(`venta #${venta.numero}`);
    expect(texto).toContain('10:15');
    expect(texto).toContain('se aprobó después de cancelar la venta');
    expect(texto).toContain('Se devuelve en efectivo desde la caja');
  });

  it('el ingreso no toca el efectivo esperado ($52.000) hasta que se confirma la devolución', async () => {
    const ctx = await preparar();

    await pagoDespuesDeCancelar(ctx);

    expect(await esperado(ctx)).toBe('52000.00');
  });

  it('el estado de la caja trae la devolución pendiente para el mostrador', async () => {
    const ctx = await preparar();

    const { venta, cobroId } = await pagoDespuesDeCancelar(ctx);

    expect(await estadoCaja(ctx)).toMatchObject({
      pointHabilitado: true,
      devolucionesPendientes: [{ cobroId, monto: '3000.00', ventaNumero: venta.numero }],
    });
  });

  it('la misma aprobación por el aviso, un reenvío y la consulta deja un solo ingreso y una sola devolución pendiente', async () => {
    const ctx = await preparar();
    const { ordenId } = await pagoDespuesDeCancelar(ctx);

    ctx.adelantar(3 * S);
    await avisoWebhook(ctx, { ordenId });
    await Promise.all([avisoWebhook(ctx, { ordenId }), revisar(ctx)]);

    expect(await movimientosDeTipo('ingreso')).toHaveLength(1);
    expect(await avisosDeTipo('cobro_mp_a_revisar')).toHaveLength(1);
    expect((await estadoCaja(ctx)).devolucionesPendientes).toHaveLength(1);
  });

  it('pago mixto cancelado ($3.000 débito + $2.000 efectivo): ingreso y devolución solo por los $3.000', async () => {
    const ctx = await preparar();

    const { cobroId } = await pagoDespuesDeCancelar(ctx, { mixta: true });

    const ingresos = await movimientosDeTipo('ingreso');
    expect(ingresos.map((m) => m.monto.toFixed(2))).toEqual(['3000.00']);
    expect((await estadoCaja(ctx)).devolucionesPendientes).toEqual([
      expect.objectContaining({ cobroId, monto: '3000.00' }),
    ]);
  });

  it('el cobro que se creó sin respuesta y se canceló entra por el aviso con external_reference', async () => {
    const ctx = await preparar();
    ctx.falso.fallaCrear = 'no_responde_pero_creada';
    const venta = await ventaDebito(ctx);
    await cancelar(ctx, venta.id);
    const orden = ctx.falso.ultimaOrden();
    ctx.falso.aprobar(orden.id);
    ctx.adelantar(3 * S);

    const res = await avisoWebhook(ctx, {
      ordenId: orden.id,
      referenciaExterna: orden.referenciaExterna,
    });

    expect(res.statusCode).toBe(200);
    expect((await filaVenta(venta.id)).estado).toBe('cancelada');
    expect((await cobro(ctx, venta.id)).json().estado).toBe('a_devolver');
    expect(await movimientosDeTipo('ingreso')).toHaveLength(1);
  });
});

describe('devolución en efectivo de un cobro de una venta cancelada', () => {
  it('el empleado devuelve: salida de $3.000 en su turno, esperado $49.000, cobro devuelto y aviso', async () => {
    const ctx = await preparar();
    const { venta, cobroId } = await pagoDespuesDeCancelar(ctx);
    ctx.fijarHora(a('10:17:00'));

    const res = await devolver(ctx, cobroId);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: cobroId, estado: 'devuelto' });
    const salidas = await movimientosDeTipo('devolucion_cobro');
    expect(salidas).toHaveLength(1);
    expect(salidas[0]).toMatchObject({
      cuenta: 'efectivo',
      turnoId: ctx.turnoId,
      usuarioId: ctx.juan.id,
      motivo: `Devolución de cobro de Mercado Pago · venta #${venta.numero}`,
    });
    expect(salidas[0]!.monto.toFixed(2)).toBe('3000.00');
    expect(await esperado(ctx)).toBe('49000.00');
    expect((await estadoCaja(ctx)).devolucionesPendientes).toEqual([]);

    const avisos = await avisosDeTipo('devolucion_cobro_mp');
    expect(avisos).toHaveLength(1);
    const texto = avisos[0]!.texto;
    expect(texto).toContain('*Devolución en efectivo de un cobro de Mercado Pago*');
    expect(texto).toMatch(pesos('3.000,00'));
    expect(texto).toContain(`venta #${venta.numero}`);
    expect(texto).toContain('Nombre juan');
    expect(texto).toContain('10:17');
  });

  it('el detalle del turno lista la devolución entre sus movimientos', async () => {
    const ctx = await preparar();
    const { cobroId } = await pagoDespuesDeCancelar(ctx);
    await devolver(ctx, cobroId);

    const detalle = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/caja/turnos/${ctx.turnoId}`,
        cookies: ctx.admin,
      })
    ).json();

    expect(detalle.movimientos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tipo: 'devolucion_cobro', monto: '3000.00' }),
      ]),
    );
    expect(detalle.resumen.devoluciones).toBe('3000.00');
  });

  it('el monto es siempre el cobrado: un pedido con otro monto se ignora', async () => {
    const ctx = await preparar();
    const { cobroId } = await pagoDespuesDeCancelar(ctx, { mixta: true });

    const res = await devolver(ctx, cobroId, ctx.empleado, { monto: '5000' });

    expect(res.statusCode).toBe(200);
    const salidas = await movimientosDeTipo('devolucion_cobro');
    expect(salidas.map((m) => m.monto.toFixed(2))).toEqual(['3000.00']);
  });

  it('confirmación repetida: la segunda recibe 409 DEVOLUCION_YA_CONFIRMADA y hay una sola salida', async () => {
    const ctx = await preparar();
    const { cobroId } = await pagoDespuesDeCancelar(ctx);

    const primera = await devolver(ctx, cobroId);
    const segunda = await devolver(ctx, cobroId);

    expect(primera.statusCode).toBe(200);
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().error.codigo).toBe('DEVOLUCION_YA_CONFIRMADA');
    expect(await movimientosDeTipo('devolucion_cobro')).toHaveLength(1);
    expect(await esperado(ctx)).toBe('49000.00');
  });

  it('doble clic (dos confirmaciones a la vez): una sola salida', async () => {
    const ctx = await preparar();
    const { cobroId } = await pagoDespuesDeCancelar(ctx);

    const respuestas = await Promise.all([
      devolver(ctx, cobroId),
      devolver(ctx, cobroId, ctx.admin),
    ]);

    expect(respuestas.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await movimientosDeTipo('devolucion_cobro')).toHaveLength(1);
    expect(await avisosDeTipo('devolucion_cobro_mp')).toHaveLength(1);
  });

  it('el pago llega sin turno abierto: ingreso sin turno y la devolución queda pendiente hasta abrir uno', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    const ordenId = ctx.falso.ultimaOrden().id;
    await cancelar(ctx, venta.id);
    expect(
      (await cerrarTurnoDePrueba(ctx.app, ctx.empleado, ctx.turnoId, { montoContado: '52000' }))
        .statusCode,
    ).toBe(200);
    ctx.falso.aprobar(ordenId);
    ctx.adelantar(3 * S);

    expect((await avisoWebhook(ctx, { ordenId })).statusCode).toBe(200);

    const ingresos = await movimientosDeTipo('ingreso');
    expect(ingresos).toHaveLength(1);
    expect(ingresos[0]!.turnoId).toBeNull();
    const [cobroMp] = await cobrosDe(venta.id);
    expect(cobroMp!.estado).toBe('a_devolver');

    // Confirmar sin turno abierto: 409 y sigue pendiente.
    const sinTurno = await devolver(ctx, cobroMp!.id, ctx.admin);
    expect(sinTurno.statusCode).toBe(409);
    expect(sinTurno.json().error.codigo).toBe('SIN_TURNO_ABIERTO');
    expect((await cobrosDe(venta.id))[0]!.estado).toBe('a_devolver');
    expect(await movimientosDeTipo('devolucion_cobro')).toHaveLength(0);

    // A la mañana Pedro abre su turno: ve la devolución y la confirma desde ese turno.
    const turnoPedro = await abrirTurnoDePrueba(ctx.app, ctx.pedro, '52000');
    expect((await estadoCaja(ctx, ctx.pedro)).devolucionesPendientes).toEqual([
      expect.objectContaining({ cobroId: cobroMp!.id, monto: '3000.00' }),
    ]);
    expect((await devolver(ctx, cobroMp!.id, ctx.pedro)).statusCode).toBe(200);
    const salidas = await movimientosDeTipo('devolucion_cobro');
    expect(salidas[0]!.turnoId).toBe(turnoPedro);
    expect(await esperado(ctx, turnoPedro)).toBe('49000.00');
  });

  it('el cliente ya se fue: sin devolver, sin salida de efectivo, esperado igual y aviso al admin', async () => {
    const ctx = await preparar();
    const { venta, cobroId } = await pagoDespuesDeCancelar(ctx);

    const res = await sinDevolver(ctx, cobroId);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: cobroId, estado: 'sin_devolver' });
    expect(await movimientosDeTipo('devolucion_cobro')).toHaveLength(0);
    expect(await esperado(ctx)).toBe('52000.00');
    expect((await estadoCaja(ctx)).devolucionesPendientes).toEqual([]);
    const avisos = await avisosDeTipo('cobro_mp_a_revisar');
    expect(avisos).toHaveLength(2);
    const texto = avisos[1]!.texto;
    expect(texto).toContain(`venta #${venta.numero}`);
    expect(texto).toMatch(pesos('3.000,00'));
    expect(texto).toContain('el cliente se fue sin la devolución en efectivo');
    expect(texto).toContain('Resolvelo en Administración → Mercado Pago');
  });

  it('después de devolver ya no se puede marcar "el cliente ya se fue" (409)', async () => {
    const ctx = await preparar();
    const { venta, cobroId } = await pagoDespuesDeCancelar(ctx);
    await devolver(ctx, cobroId);

    const res = await sinDevolver(ctx, cobroId);

    expect(res.statusCode).toBe(409);
    expect((await cobro(ctx, venta.id)).json().estado).toBe('devuelto');
  });
});

describe('cierre del turno con cobros en espera o devoluciones pendientes', () => {
  it('con un cobro esperando en el Point → 409 COBRO_EN_ESPERA con la venta, y el turno sigue abierto', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);

    const res = await cerrarTurnoDePrueba(ctx.app, ctx.empleado, ctx.turnoId, {
      montoContado: '52000',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      codigo: 'COBRO_EN_ESPERA',
      mensaje: `Hay un cobro con Mercado Pago en espera (venta #${venta.numero}): esperalo o cancelalo`,
    });
    expect((await estadoCaja(ctx)).turnoAbierto?.id).toBe(ctx.turnoId);
  });

  it('con una venta en espera cuyo cobro fue rechazado también bloquea (la venta sigue en espera)', async () => {
    const ctx = await preparar();
    await ventaDebito(ctx);
    ctx.falso.fijar(ctx.falso.ultimaOrden().id, { estado: 'rechazado', detalle: 'high_risk' });
    ctx.adelantar(3 * S);
    await revisar(ctx);

    const res = await cerrarTurnoDePrueba(ctx.app, ctx.empleado, ctx.turnoId, {
      montoContado: '52000',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('COBRO_EN_ESPERA');
  });

  it('después de cancelar la venta en espera, el turno cierra normalmente', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    await cancelar(ctx, venta.id);

    const res = await cerrarTurnoDePrueba(ctx.app, ctx.empleado, ctx.turnoId, {
      montoContado: '52000',
    });

    expect(res.statusCode).toBe(200);
  });

  it('con un cobro a devolver de $3.000 → 409 DEVOLUCION_PENDIENTE con el monto, y el turno sigue abierto', async () => {
    const ctx = await preparar();
    await pagoDespuesDeCancelar(ctx);

    const res = await cerrarTurnoDePrueba(ctx.app, ctx.empleado, ctx.turnoId, {
      montoContado: '52000',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('DEVOLUCION_PENDIENTE');
    expect(res.json().error.mensaje).toMatch(
      /^Antes de cerrar, devolvé \$\s?3\.000(,00)? en efectivo de un cobro cancelado$/,
    );
    expect((await estadoCaja(ctx)).turnoAbierto?.id).toBe(ctx.turnoId);
  });

  it('después de devolver, cierra con la devolución incluida en el esperado ($49.000)', async () => {
    const ctx = await preparar();
    const { cobroId } = await pagoDespuesDeCancelar(ctx);
    await devolver(ctx, cobroId);

    const res = await cerrarTurnoDePrueba(ctx.app, ctx.admin, ctx.turnoId, {
      montoContado: '49000',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ esperado: '49000.00', diferencia: '0.00' });
  });

  it('con el cobro "sin devolver" (el cliente se fue), cierra normalmente', async () => {
    const ctx = await preparar();
    const { cobroId } = await pagoDespuesDeCancelar(ctx);
    await sinDevolver(ctx, cobroId);

    const res = await cerrarTurnoDePrueba(ctx.app, ctx.empleado, ctx.turnoId, {
      montoContado: '52000',
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('ventas en espera o canceladas sin factura', () => {
  it('pedir factura de una venta en espera con $2.000 en efectivo → 409 y no tiene facturas', async () => {
    const ctx = await preparar({ facturacion: opcionesFacturacion() });
    const venta = await ventaMixta(ctx);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/ventas/${venta.id}/factura`,
      cookies: ctx.empleado,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).not.toBe('FACTURACION_NO_CONFIGURADA');
    expect(await prismaTest.factura.count({ where: { ventaId: venta.id } })).toBe(0);
  });

  it('pedir factura de una venta cancelada → 409 y no tiene facturas', async () => {
    const ctx = await preparar({ facturacion: opcionesFacturacion() });
    const venta = await ventaMixta(ctx);
    await cancelar(ctx, venta.id);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/ventas/${venta.id}/factura`,
      cookies: ctx.admin,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).not.toBe('FACTURACION_NO_CONFIGURADA');
    expect(await prismaTest.factura.count({ where: { ventaId: venta.id } })).toBe(0);
  });

  it('venta cancelada con el cobro aprobado y devuelto en efectivo: sigue cancelada y sin facturas', async () => {
    const ctx = await preparar({ facturacion: opcionesFacturacion() });
    const { venta, cobroId } = await pagoDespuesDeCancelar(ctx);
    await devolver(ctx, cobroId);

    expect((await filaVenta(venta.id)).estado).toBe('cancelada');
    expect(await prismaTest.factura.count({ where: { ventaId: venta.id } })).toBe(0);
  });

  it('la venta en espera no se factura al registrarse, solo al quedar pagada', async () => {
    const ctx = await preparar({ facturacion: opcionesFacturacion() });
    const venta = await ventaDebito(ctx);
    expect(await prismaTest.factura.count({ where: { ventaId: venta.id } })).toBe(0);

    await aprobarPorConsulta(ctx);

    expect(await prismaTest.factura.count({ where: { ventaId: venta.id } })).toBe(1);
  });
});

describe('webhook POST /api/mercado-pago/webhook', () => {
  it('firma válida de hace 10 s: 200 sin sesión y consulta el estado de ese cobro en MP', async () => {
    const ctx = await preparar();
    await ventaDebito(ctx);
    const ordenId = ctx.falso.ultimaOrden().id;

    const res = await avisoWebhook(ctx, { ordenId, desfasajeS: -10 });

    expect(res.statusCode).toBe(200);
    expect(ctx.falso.consultas).toEqual([ordenId]);
  });

  it('la notificación de un pago aprobado confirma la venta (después de consultar a MP)', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    const ordenId = ctx.falso.ultimaOrden().id;
    ctx.falso.aprobar(ordenId);

    await avisoWebhook(ctx, { ordenId });

    expect((await filaVenta(venta.id)).estado).toBe('pagada');
  });

  it.each([
    ['firma con otra clave', { secreto: 'otra-clave' }],
    ['sin encabezado de firma', { firma: null }],
    ['firma con formato inválido', { firma: 'cualquier cosa' }],
    ['marca de tiempo de hace 301 s', { desfasajeS: -301 }],
    ['marca de tiempo 301 s en el futuro', { desfasajeS: 301 }],
  ])('%s: 401, no consulta a MP y no cambia nada', async (_caso, cambios) => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    const ordenId = ctx.falso.ultimaOrden().id;
    ctx.falso.aprobar(ordenId);

    const res = await avisoWebhook(ctx, { ordenId, ...cambios });

    expect(res.statusCode).toBe(401);
    expect(ctx.falso.consultas).toHaveLength(0);
    expect((await filaVenta(venta.id)).estado).toBe('pendiente');
    expect(await contarAvisosMp()).toBe(0);
  });

  it.each([
    ['hace 300 s (el límite)', -300],
    ['300 s en el futuro', 300],
  ])('marca de tiempo de %s: se acepta', async (_caso, desfasajeS) => {
    const ctx = await preparar();
    await ventaDebito(ctx);
    const ordenId = ctx.falso.ultimaOrden().id;

    const res = await avisoWebhook(ctx, { ordenId, desfasajeS });

    expect(res.statusCode).toBe(200);
    expect(ctx.falso.consultas).toEqual([ordenId]);
  });

  it('la misma notificación dos veces: la segunda recibe 200 y no dispara otra consulta', async () => {
    const ctx = await preparar();
    await ventaDebito(ctx);
    const ordenId = ctx.falso.ultimaOrden().id;

    const primera = await avisoWebhook(ctx, { ordenId, idAviso: 'aviso-123' });
    const segunda = await avisoWebhook(ctx, { ordenId, idAviso: 'aviso-123' });

    expect([primera.statusCode, segunda.statusCode]).toEqual([200, 200]);
    expect(ctx.falso.consultas).toEqual([ordenId]);
    expect(await contarAvisosMp()).toBe(1);
  });

  it('notificación y consulta de respaldo a la vez: pagada una vez y stock descontado una vez', async () => {
    const ctx = await preparar({ facturacion: opcionesFacturacion() });
    const venta = await ventaDebito(ctx);
    const ordenId = ctx.falso.ultimaOrden().id;
    ctx.falso.aprobar(ordenId);
    ctx.adelantar(3 * S);

    const [res] = await Promise.all([avisoWebhook(ctx, { ordenId }), revisar(ctx)]);

    expect(res.statusCode).toBe(200);
    expect((await filaVenta(venta.id)).estado).toBe('pagada');
    expect(await movimientosDeStock(venta.id)).toHaveLength(1);
    expect(await stockDe(ctx.gaseosa.id)).toBe(-2);
    expect(await prismaTest.factura.count({ where: { ventaId: venta.id } })).toBe(1);
  });

  it('el aviso dice aprobado pero MP informa que el cobro sigue en la terminal: la venta sigue en espera', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    const ordenId = ctx.falso.ultimaOrden().id;
    ctx.falso.fijar(ordenId, { estado: 'en_espera', enTerminal: true });

    const res = await avisoWebhook(ctx, { ordenId, accion: 'order.processed' });

    expect(res.statusCode).toBe(200);
    expect((await filaVenta(venta.id)).estado).toBe('pendiente');
    expect(await stockDe(ctx.gaseosa.id)).toBe(0);
  });

  it('notificación válida de un cobro que el sistema no creó: 200 y no cambia nada', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);

    const res = await avisoWebhook(ctx, { ordenId: 'ORD99999999999999' });

    expect(res.statusCode).toBe(200);
    expect((await filaVenta(venta.id)).estado).toBe('pendiente');
  });

  it('una notificación que no es de órdenes: 200 sin consultar a MP', async () => {
    const ctx = await preparar();
    await ventaDebito(ctx);

    const res = await avisoWebhook(ctx, { ordenId: ctx.falso.ultimaOrden().id, tipo: 'payment' });

    expect(res.statusCode).toBe(200);
    expect(ctx.falso.consultas).toHaveLength(0);
  });

  it('MP no responde a la consulta del aviso: igual 200, y la consulta de respaldo lo resuelve', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    const ordenId = ctx.falso.ultimaOrden().id;
    ctx.falso.aprobar(ordenId);
    ctx.falso.fallaConsultar = 'no_responde';

    expect((await avisoWebhook(ctx, { ordenId })).statusCode).toBe(200);
    expect((await filaVenta(venta.id)).estado).toBe('pendiente');

    ctx.falso.fallaConsultar = null;
    ctx.adelantar(3 * S);
    await revisar(ctx);
    expect((await filaVenta(venta.id)).estado).toBe('pagada');
  });

  it('sin clave secreta configurada: 401, y los cobros se siguen resolviendo por la consulta de respaldo', async () => {
    const ctx = await preparar({ secreto: null });
    const venta = await ventaDebito(ctx);
    const ordenId = ctx.falso.ultimaOrden().id;
    ctx.falso.aprobar(ordenId);

    const res = await avisoWebhook(ctx, { ordenId });

    expect(res.statusCode).toBe(401);
    expect(ctx.falso.consultas).toHaveLength(0);
    ctx.adelantar(3 * S);
    await revisar(ctx);
    expect((await filaVenta(venta.id)).estado).toBe('pagada');
  });

  it('el cobro que quedó sin ordenId por un timeout se confirma por el aviso con external_reference', async () => {
    const ctx = await preparar();
    ctx.falso.fallaCrear = 'no_responde_pero_creada';
    const venta = await ventaDebito(ctx);
    const orden = ctx.falso.ultimaOrden();
    ctx.falso.aprobar(orden.id);

    const res = await avisoWebhook(ctx, {
      ordenId: orden.id,
      referenciaExterna: orden.referenciaExterna,
    });

    expect(res.statusCode).toBe(200);
    expect((await filaVenta(venta.id)).estado).toBe('pagada');
  });

  it.each([
    ['64 KB justos', 200, 64 * 1024],
    ['64 KB + 1 byte', 413, 64 * 1024 + 1],
  ])('cuerpo de %s → %i', async (_caso, status, tamanoCuerpo) => {
    const ctx = await preparar();
    await ventaDebito(ctx);

    const res = await avisoWebhook(ctx, { ordenId: ctx.falso.ultimaOrden().id, tamanoCuerpo });

    expect(res.statusCode).toBe(status);
  });
});

describe('cobros a revisar para el admin', () => {
  function lista(ctx: Ctx, cookies = ctx.admin) {
    return ctx.app.inject({ method: 'GET', url: '/api/mercado-pago/cobros-a-revisar', cookies });
  }

  function revisado(
    ctx: Ctx,
    cobroId: string,
    payload: Record<string, unknown>,
    cookies = ctx.admin,
  ) {
    return ctx.app.inject({
      method: 'POST',
      url: `/api/mercado-pago/cobros/${cobroId}/revisado`,
      cookies,
      payload,
    });
  }

  it('un empleado recibe 403', async () => {
    const ctx = await preparar();

    expect((await lista(ctx, ctx.empleado)).statusCode).toBe(403);
  });

  it('lista la devolución pendiente con monto, medio y venta', async () => {
    const ctx = await preparar();
    const { venta, cobroId } = await pagoDespuesDeCancelar(ctx);

    const res = await lista(ctx);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      expect.objectContaining({
        id: cobroId,
        estado: 'a_devolver',
        monto: '3000.00',
        medio: 'debito',
        ventaNumero: venta.numero,
      }),
    ]);
  });

  it('una devolución pendiente no se puede marcar revisada (409)', async () => {
    const ctx = await preparar();
    const { cobroId } = await pagoDespuesDeCancelar(ctx);

    const res = await revisado(ctx, cobroId, { nota: 'ya está' });

    expect(res.statusCode).toBe(409);
  });

  it('el admin resuelve un cobro sin devolver con nota: deja de figurar y guarda nota, quién y cuándo', async () => {
    const ctx = await preparar();
    const { venta, cobroId } = await pagoDespuesDeCancelar(ctx);
    await sinDevolver(ctx, cobroId);
    ctx.fijarHora(a('18:00:00'));

    const res = await revisado(ctx, cobroId, { nota: 'devuelto por la app' });

    expect(res.statusCode).toBe(200);
    expect((await lista(ctx)).json()).toEqual([]);
    const [fila] = await cobrosDe(venta.id);
    expect(fila).toMatchObject({ estado: 'sin_devolver', notaRevision: 'devuelto por la app' });
    expect(fila!.revisadoEn).toEqual(a('18:00:00'));
    expect(fila!.revisadoPorId).toBe(
      (await prismaTest.usuario.findFirstOrThrow({ where: { usuario: 'ana' } })).id,
    );
    expect(await movimientosDeTipo('devolucion_cobro')).toHaveLength(0);
  });

  it('un cobro a revisar (la terminal pidió confirmar) figura y se marca revisado con nota', async () => {
    const ctx = await preparar();
    const venta = await ventaDebito(ctx);
    ctx.falso.fijar(ctx.falso.ultimaOrden().id, {
      estado: 'a_revisar',
      detalle: 'check_on_terminal',
    });
    ctx.adelantar(3 * S);
    await revisar(ctx);
    const [cobroMp] = await cobrosDe(venta.id);

    expect((await lista(ctx)).json()).toEqual([
      expect.objectContaining({ id: cobroMp!.id, estado: 'a_revisar' }),
    ]);
    expect((await revisado(ctx, cobroMp!.id, { nota: 'no se cobró' })).statusCode).toBe(200);
    // Revisar no cambia ventas, stock ni caja.
    expect((await filaVenta(venta.id)).estado).toBe('pendiente');
  });

  it.each([
    ['sin nota', 400, {}],
    ['nota vacía', 400, { nota: '' }],
    ['nota de 2 letras', 400, { nota: 'ok' }],
    ['nota de 3 letras', 200, { nota: 'app' }],
    ['nota de 200 caracteres', 200, { nota: 'x'.repeat(200) }],
    ['nota de 201 caracteres', 400, { nota: 'x'.repeat(201) }],
  ])('marcar revisado %s → %i', async (_caso, status, payload) => {
    const ctx = await preparar();
    const { cobroId } = await pagoDespuesDeCancelar(ctx);
    await sinDevolver(ctx, cobroId);

    expect((await revisado(ctx, cobroId, payload)).statusCode).toBe(status);
  });

  it('un empleado no puede marcar revisado (403)', async () => {
    const ctx = await preparar();
    const { cobroId } = await pagoDespuesDeCancelar(ctx);
    await sinDevolver(ctx, cobroId);

    expect((await revisado(ctx, cobroId, { nota: 'devuelto' }, ctx.empleado)).statusCode).toBe(403);
  });
});
