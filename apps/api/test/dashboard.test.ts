import { dashboardSchema } from '@kiosco/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase, prismaTest } from './base.js';
import {
  abrirTurnoDePrueba,
  cerrarTurnoDePrueba,
  crearAppDePrueba,
  crearUsuarioDePrueba,
  sesionDe,
  type Cookies,
} from './ayudas.js';
import { crearProductoDePrueba, verificarStockConsistente } from './stock-ayudas.js';

beforeEach(async () => {
  await limpiarBase();
});

afterEach(async () => {
  await verificarStockConsistente();
});

/** Jueves 22/10/2026 a las 15:00 en Argentina. */
const JUEVES_1500 = new Date('2026-10-22T18:00:00Z');

async function preparar() {
  const { app, adelantar } = await crearAppDePrueba(JUEVES_1500);
  await crearUsuarioDePrueba('ana', 'admin');
  await crearUsuarioDePrueba('juan');
  const admin = await sesionDe(app, 'ana');
  const empleado = await sesionDe(app, 'juan');
  const gaseosa = await crearProductoDePrueba('Gaseosa', { precio: '1500', costo: '1000' });
  const alfajor = await crearProductoDePrueba('Alfajor', { precio: '900', costo: '600' });
  const chicle = await crearProductoDePrueba('Chicle', { precio: '200', costo: null });
  const coca = await prismaTest.proveedor.create({ data: { nombre: 'Coca-Cola' } });
  return { app, adelantar, admin, empleado, gaseosa, alfajor, chicle, coca };
}

type Ctx = Awaited<ReturnType<typeof preparar>>;

async function dashboard(ctx: Ctx, query = '', cookies = ctx.admin) {
  const res = await ctx.app.inject({ method: 'GET', url: `/api/dashboard${query}`, cookies });
  return res;
}

async function datos(ctx: Ctx, query = '') {
  const res = await dashboard(ctx, query);
  expect(res.statusCode).toBe(200);
  return dashboardSchema.parse(res.json());
}

/** Vende en el turno abierto y, si se indica, mueve la venta a otro instante. */
async function vender(
  ctx: Ctx,
  items: Record<string, unknown>[],
  pagos: Record<string, unknown>[],
  total: string,
  creadaEn?: string,
  cookies: Cookies = ctx.empleado,
) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/ventas',
    cookies,
    payload: { items, pagos, totalEsperado: total },
  });
  expect(res.statusCode).toBe(201);
  const venta = res.json();
  if (creadaEn) {
    await prismaTest.venta.update({
      where: { id: venta.id },
      data: { creadaEn: new Date(creadaEn) },
    });
  }
  return venta as { id: string };
}

function movimiento(ctx: Ctx, payload: Record<string, unknown>, cookies: Cookies = ctx.admin) {
  return ctx.app.inject({ method: 'POST', url: '/api/caja/movimientos', cookies, payload });
}

describe('acceso y período', () => {
  it('un empleado recibe 403; sin fechas es hoy; el rango al revés da 400', async () => {
    const ctx = await preparar();

    expect((await dashboard(ctx, '', ctx.empleado)).statusCode).toBe(403);
    const hoy = await datos(ctx);
    expect(hoy.periodo).toEqual({ desde: '2026-10-22', hasta: '2026-10-22' });
    expect(hoy.anterior).toEqual({ desde: '2026-10-21', hasta: '2026-10-21' });
    expect((await dashboard(ctx, '?desde=2026-10-21&hasta=2026-10-20')).statusCode).toBe(400);
  });
});

describe('efectivo en caja y pendiente de pagar', () => {
  it('sin turno es lo que quedó en el último cierre; con turno, el esperado en vivo', async () => {
    const ctx = await preparar();
    const turno = await abrirTurnoDePrueba(ctx.app, ctx.empleado, '30000');
    await cerrarTurnoDePrueba(ctx.app, ctx.empleado, turno, {
      montoContado: '30000',
      retiro: '8500',
      motivoRetiro: 'Al banco',
    });

    expect((await datos(ctx)).ahora).toMatchObject({
      efectivoEnCaja: '21500.00',
      turnoAbierto: false,
    });

    const empleado = await sesionDe(ctx.app, 'juan');
    await abrirTurnoDePrueba(ctx.app, empleado, '21500');
    await vender(
      ctx,
      [{ productoId: ctx.gaseosa.id, cantidad: 2 }],
      [{ medio: 'efectivo', monto: '3000' }],
      '3000',
      undefined,
      empleado,
    );

    expect((await datos(ctx)).ahora).toMatchObject({
      efectivoEnCaja: '24500.00',
      turnoAbierto: true,
    });
  });

  it('pendiente: por llegar más los que deben, sin cancelados ni pagados', async () => {
    const ctx = await preparar();
    const pedido = (datos: Record<string, unknown>) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/pedidos',
        cookies: ctx.admin,
        payload: { proveedorId: ctx.coca.id, llegaEl: '2026-10-29', ...datos },
      });
    const sinPedido = (total: string, cuenta: string | null) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/pedidos/sin-pedido',
        cookies: ctx.admin,
        payload: { proveedorId: ctx.coca.id, total, cuenta },
      });
    await pedido({ totalPedido: '200000' });
    await pedido({ totalPedido: '110000' });
    const cancelado = (await pedido({ totalPedido: '99999' })).json();
    await ctx.app.inject({
      method: 'POST',
      url: `/api/pedidos/${cancelado.id}/cancelar`,
      cookies: ctx.admin,
      payload: { motivo: 'no vino' },
    });
    await sinPedido('100000', null);
    await sinPedido('60000', null);
    await sinPedido('50000', null);
    await sinPedido('70000', 'mercado_pago');

    expect((await datos(ctx)).ahora.pendiente).toEqual({
      total: '520000.00',
      porLlegar: { cantidad: 2, total: '310000.00' },
      deben: { cantidad: 3, total: '210000.00' },
    });
  });
});

describe('ventas, ganancia y comparación', () => {
  it('sin anuladas; "Varios" y productos sin costo van aparte; margen sobre lo que tiene costo', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.empleado);
    await vender(
      ctx,
      [
        { productoId: ctx.gaseosa.id, cantidad: 1 },
        { varios: { precio: '500' }, cantidad: 1 },
      ],
      [{ medio: 'debito', monto: '2000' }],
      '2000',
    );
    const anulada = await vender(
      ctx,
      [{ productoId: ctx.gaseosa.id, cantidad: 2 }],
      [{ medio: 'efectivo', monto: '3000' }],
      '3000',
    );
    await ctx.app.inject({
      method: 'POST',
      url: `/api/ventas/${anulada.id}/anular`,
      cookies: ctx.empleado,
      payload: { motivo: 'cobré dos veces' },
    });

    const d = await datos(ctx);

    expect(d.ventas).toMatchObject({ total: '2000.00', cantidad: 1 });
    expect(d.ganancia).toMatchObject({ total: '500.00', margen: 33 });
    expect(d.sinCosto).toBe('500.00');
    expect(d.movimientos.anuladas).toEqual({ cantidad: 1, total: '3000.00' });
  });

  it('compara con el período anterior y no da porcentaje si el anterior es cero', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.empleado);
    const gaseosas = (cantidad: number, creadaEn?: string) =>
      vender(
        ctx,
        [{ productoId: ctx.gaseosa.id, cantidad }],
        [{ medio: 'efectivo', monto: String(1500 * cantidad) }],
        String(1500 * cantidad),
        creadaEn,
      );
    await gaseosas(10, '2026-10-21T15:00:00Z'); // ayer: $15.000
    await gaseosas(11); // hoy: $16.500

    const hoy = await datos(ctx);
    expect(hoy.ventas).toMatchObject({ total: '16500.00', anterior: '15000.00', variacion: 10 });
    expect(hoy.ganancia).toMatchObject({ total: '5500.00', anterior: '5000.00', variacion: 10 });

    const ayer = await datos(ctx, '?desde=2026-10-21&hasta=2026-10-21');
    expect(ayer.ventas).toMatchObject({ anterior: '0.00', variacion: null });

    const mes = await datos(ctx, '?desde=2026-10-01&hasta=2026-10-22');
    expect(mes.anterior).toEqual({ desde: '2026-09-01', hasta: '2026-09-22' });
  });
});

describe('gastos, resultado y movimientos', () => {
  it('los pagos a proveedores, retiros e ingresos no restan del resultado', async () => {
    const ctx = await preparar();
    const turno = await abrirTurnoDePrueba(ctx.app, ctx.admin, '400000');
    // Ganancia $150.000: 300 gaseosas con $500 de ganancia cada una.
    await vender(
      ctx,
      [{ productoId: ctx.gaseosa.id, cantidad: 300 }],
      [{ medio: 'efectivo', monto: '450000' }],
      '450000',
      undefined,
      ctx.admin,
    );
    await movimiento(ctx, {
      tipo: 'gasto',
      categoria: 'servicios',
      cuenta: 'mercado_pago',
      monto: '15000',
      motivo: 'luz',
    });
    await movimiento(ctx, { tipo: 'gasto', categoria: 'insumos', monto: '5000', motivo: 'bolsas' });
    await movimiento(ctx, {
      tipo: 'retiro',
      cuenta: 'mercado_pago',
      monto: '90000',
      motivo: 'a mi cuenta',
    });
    await movimiento(ctx, { tipo: 'ingreso', monto: '10000', motivo: 'cambio' });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/pedidos/sin-pedido',
      cookies: ctx.admin,
      payload: { proveedorId: ctx.coca.id, total: '210000', cuenta: 'efectivo' },
    });
    // Cierre con $1.500 de faltante y un retiro de $20.000.
    await cerrarTurnoDePrueba(ctx.app, ctx.admin, turno, {
      montoContado: '643500',
      retiro: '20000',
      motivoRetiro: 'Al banco',
    });

    const d = await datos(ctx);

    expect(d.gastos).toEqual({
      total: '20000.00',
      porCategoria: { servicios: '15000.00', insumos: '5000.00', otro: '0.00' },
    });
    expect(d.ganancia.total).toBe('150000.00');
    expect(d.resultado).toBe('130000.00');
    expect(d.movimientos).toMatchObject({
      pagosProveedor: { total: '210000.00', efectivo: '210000.00', mercadoPago: '0.00' },
      retiros: '110000.00',
      ingresos: '10000.00',
      diferencias: { total: '-1500.00', turnos: 1 },
    });
  });
});

describe('serie, medios y más vendidos', () => {
  it('una venta de las 23:30 cae en su día; hoy va por hora; el pago mixto suma a cada medio', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.empleado);
    await vender(
      ctx,
      [{ productoId: ctx.alfajor.id, cantidad: 1 }],
      [{ medio: 'efectivo', monto: '900' }],
      '900',
      '2026-10-21T02:30:00Z', // 20/10 23:30 en Argentina
    );
    await vender(
      ctx,
      [
        { productoId: ctx.gaseosa.id, cantidad: 3 },
        { productoId: ctx.alfajor.id, cantidad: 5 },
      ],
      [
        { medio: 'efectivo', monto: '2000' },
        { medio: 'debito', monto: '7000' },
      ],
      '9000',
      '2026-10-22T11:10:00Z', // 22/10 08:10
    );

    const semana = await datos(ctx, '?desde=2026-10-19&hasta=2026-10-22');
    expect(semana.serie.agrupacion).toBe('dia');
    expect(semana.serie.puntos).toEqual([
      { inicio: '2026-10-19', total: '0.00' },
      { inicio: '2026-10-20', total: '900.00' },
      { inicio: '2026-10-21', total: '0.00' },
      { inicio: '2026-10-22', total: '9000.00' },
    ]);

    const hoy = await datos(ctx);
    expect(hoy.serie.agrupacion).toBe('hora');
    expect(hoy.serie.puntos).toHaveLength(24);
    expect(hoy.serie.puntos[8]).toEqual({ inicio: '2026-10-22T08', total: '9000.00' });
    expect(hoy.medios).toEqual({
      efectivo: '2000.00',
      debito: '7000.00',
      credito: '0.00',
      mercado_pago: '0.00',
    });

    const largo = await datos(ctx, '?desde=2026-06-01&hasta=2026-10-22');
    expect(largo.serie.agrupacion).toBe('semana');
    expect(largo.serie.puntos[0]?.inicio).toBe('2026-06-01');
  });

  it('más vendidos sin "Varios"; por ganancia solo los que tienen costo', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.empleado);
    await vender(
      ctx,
      [
        { productoId: ctx.chicle.id, cantidad: 20 },
        { productoId: ctx.gaseosa.id, cantidad: 3 },
        { productoId: ctx.alfajor.id, cantidad: 2 },
        { varios: { precio: '9000' }, cantidad: 1 },
      ],
      [{ medio: 'efectivo', monto: '19300' }],
      '19300',
    );

    const { masVendidos } = await datos(ctx);

    expect(masVendidos.unidades.map((p) => p.nombre)).toEqual(['Chicle', 'Gaseosa', 'Alfajor']);
    expect(masVendidos.importe.map((p) => p.nombre)).toEqual(['Gaseosa', 'Chicle', 'Alfajor']);
    expect(masVendidos.ganancia.map((p) => [p.nombre, p.ganancia])).toEqual([
      ['Gaseosa', '1500.00'],
      ['Alfajor', '600.00'],
    ]);
  });
});
