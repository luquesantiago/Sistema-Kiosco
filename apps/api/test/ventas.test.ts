import { notificacionSchema, ventaDetalleSchema, ventaResumenSchema } from '@kiosco/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { textoAvisoAnulacion } from '../src/modules/ventas/aviso.js';
import { limpiarBase, prismaTest } from './base.js';
import {
  abrirTurnoDePrueba,
  cerrarTurnoDePrueba,
  crearAppDePrueba,
  crearUsuarioDePrueba,
  sesionDe,
} from './ayudas.js';
import {
  crearProductoDePrueba,
  ingresarMercaderia,
  verificarStockConsistente,
} from './stock-ayudas.js';

beforeEach(async () => {
  await limpiarBase();
});

afterEach(async () => {
  await verificarStockConsistente();
});

const DIA = 24 * 60 * 60 * 1000;

/** Martes 20/10/2026 a las 15:42 en Argentina. */
const MARTES_1542 = new Date('2026-10-20T18:42:00Z');

async function preparar() {
  const { app, adelantar } = await crearAppDePrueba(MARTES_1542);
  await crearUsuarioDePrueba('ana', 'admin');
  const juan = await crearUsuarioDePrueba('juan');
  const admin = await sesionDe(app, 'ana');
  const empleado = await sesionDe(app, 'juan');
  const alfajor = await crearProductoDePrueba('Alfajor', { precio: '900', codigoBarras: '1' });
  const gaseosa = await crearProductoDePrueba('Gaseosa', { precio: '1500', codigoBarras: '2' });
  const turnoId = await abrirTurnoDePrueba(app, empleado);
  return { app, adelantar, admin, empleado, juan, alfajor, gaseosa, turnoId };
}

type Ctx = Awaited<ReturnType<typeof preparar>>;

function vender(ctx: Ctx, payload: Record<string, unknown>, cookies = ctx.empleado) {
  return ctx.app.inject({ method: 'POST', url: '/api/ventas', cookies, payload });
}

/** 2 alfajores y 1 gaseosa ($3.300) pagados con el medio indicado. */
function ventaTipica(ctx: Ctx, pago: Record<string, unknown> = { medio: 'debito', monto: '3300' }) {
  return vender(ctx, {
    items: [
      { productoId: ctx.alfajor.id, cantidad: 2 },
      { productoId: ctx.gaseosa.id, cantidad: 1 },
    ],
    pagos: [pago],
    totalEsperado: '3300',
  });
}

function anular(ctx: Ctx, id: string, motivo: string | undefined, cookies = ctx.empleado) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/ventas/${id}/anular`,
    cookies,
    payload: motivo === undefined ? {} : { motivo },
  });
}

/** Lleva una venta a ayer (las sesiones vencen si se adelanta el reloj un día). */
async function pasarAAyer(id: string) {
  await prismaTest.venta.update({
    where: { id },
    data: { creadaEn: new Date(MARTES_1542.getTime() - DIA) },
  });
}

async function stockDe(id: string) {
  return (await prismaTest.producto.findUniqueOrThrow({ where: { id } })).stockActual;
}

describe('registro de una venta', () => {
  it('venta simple: número siguiente, total, estado pagada, vendedor y pago', async () => {
    const ctx = await preparar();

    const primera = await ventaTipica(ctx);
    const segunda = await ventaTipica(ctx);

    expect(primera.statusCode).toBe(201);
    const venta = ventaDetalleSchema.parse(segunda.json());
    expect(venta.numero).toBe(primera.json().numero + 1);
    expect(venta).toMatchObject({
      total: '3300.00',
      estado: 'pagada',
      usuario: { id: ctx.juan.id },
      items: [
        { descripcion: 'Alfajor', cantidad: 2, precioUnitario: '900.00', subtotal: '1800.00' },
        { descripcion: 'Gaseosa', cantidad: 1, precioUnitario: '1500.00', subtotal: '1500.00' },
      ],
      pagos: [{ medio: 'debito', monto: '3300.00', montoRecibido: null, vuelto: null }],
      anulacion: null,
    });
  });

  it('queda en el turno abierto de quien vende', async () => {
    const ctx = await preparar();
    const { id } = (await ventaTipica(ctx)).json();
    expect((await prismaTest.venta.findUniqueOrThrow({ where: { id } })).turnoId).toBe(ctx.turnoId);
  });

  it('sin turno abierto responde 409, no registra la venta y no mueve stock', async () => {
    const ctx = await preparar();
    await cerrarTurnoDePrueba(ctx.app, ctx.empleado, ctx.turnoId);

    const res = await ventaTipica(ctx);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('SIN_TURNO_ABIERTO');
    expect(await prismaTest.venta.count()).toBe(0);
    expect(await prismaTest.movimientoStock.count()).toBe(0);
  });

  it.each([
    ['sin ítems', { items: [] }, 400],
    ['con cantidad 0', { items: [{ productoId: 'x', cantidad: 0 }] }, 400],
  ])('rechaza una venta %s', async (_caso, cambio, status) => {
    const ctx = await preparar();
    const res = await vender(ctx, {
      pagos: [{ medio: 'debito', monto: '900' }],
      totalEsperado: '900',
      ...cambio,
    });
    expect(res.statusCode).toBe(status);
    expect(await prismaTest.venta.count()).toBe(0);
  });

  it('rechaza un producto desactivado o inexistente con 409 y no registra nada', async () => {
    const ctx = await preparar();
    await prismaTest.producto.update({ where: { id: ctx.gaseosa.id }, data: { activo: false } });

    const desactivado = await ventaTipica(ctx);
    const inexistente = await vender(ctx, {
      items: [{ productoId: '0198a5b0-0000-7000-8000-000000000000', cantidad: 1 }],
      pagos: [{ medio: 'debito', monto: '900' }],
      totalEsperado: '900',
    });

    expect(desactivado.statusCode).toBe(409);
    expect(desactivado.json().error).toMatchObject({
      codigo: 'PRODUCTO_NO_DISPONIBLE',
      detalle: { productoId: ctx.gaseosa.id },
    });
    expect(desactivado.json().error.mensaje).toContain('Gaseosa');
    expect(inexistente.statusCode).toBe(409);
    expect(await prismaTest.venta.count()).toBe(0);
    expect(await stockDe(ctx.alfajor.id)).toBe(0);
  });

  it('agrupa los productos repetidos en un ítem', async () => {
    const ctx = await preparar();

    const res = await vender(ctx, {
      items: [
        { productoId: ctx.alfajor.id, cantidad: 1 },
        { productoId: ctx.gaseosa.id, cantidad: 1 },
        { productoId: ctx.alfajor.id, cantidad: 1 },
      ],
      pagos: [{ medio: 'efectivo', monto: '3300' }],
      totalEsperado: '3300',
    });

    expect(
      res
        .json()
        .items.map((i: { descripcion: string; cantidad: number }) => [i.descripcion, i.cantidad]),
    ).toEqual([
      ['Alfajor', 2],
      ['Gaseosa', 1],
    ]);
  });
});

describe('precios definidos por el servidor', () => {
  it('si el admin cambió un precio, responde 409 con los precios actuales', async () => {
    const ctx = await preparar();
    await prismaTest.producto.update({ where: { id: ctx.alfajor.id }, data: { precio: '1000' } });

    const res = await ventaTipica(ctx);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('PRECIOS_CAMBIARON');
    expect(res.json().error.detalle).toEqual(
      expect.arrayContaining([
        { productoId: ctx.alfajor.id, precio: '1000.00' },
        { productoId: ctx.gaseosa.id, precio: '1500.00' },
      ]),
    );
    expect(await prismaTest.venta.count()).toBe(0);
  });

  it('un cliente no puede vender más barato aunque los pagos coincidan', async () => {
    const ctx = await preparar();
    const res = await vender(ctx, {
      items: [{ productoId: ctx.alfajor.id, cantidad: 1 }],
      pagos: [{ medio: 'efectivo', monto: '1' }],
      totalEsperado: '1',
    });
    expect(res.statusCode).toBe(409);
  });

  it('la venta conserva precio y nombre aunque el producto cambie después', async () => {
    const ctx = await preparar();
    const { id } = (await ventaTipica(ctx)).json();
    await prismaTest.producto.update({
      where: { id: ctx.alfajor.id },
      data: { precio: '2000', nombre: 'Alfajor nuevo' },
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/ventas/${id}`,
      cookies: ctx.admin,
    });

    expect(res.json().items[0]).toMatchObject({ descripcion: 'Alfajor', precioUnitario: '900.00' });
  });
});

describe('ítem "Varios"', () => {
  it('se vende con su precio y descripción, y no mueve stock', async () => {
    const ctx = await preparar();

    const res = await vender(ctx, {
      items: [
        { varios: { descripcion: 'Caramelos sueltos', precio: '500' }, cantidad: 1 },
        { varios: { precio: '250' }, cantidad: 2 },
      ],
      pagos: [{ medio: 'efectivo', monto: '1000' }],
      totalEsperado: '1000',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().items).toEqual([
      {
        productoId: null,
        descripcion: 'Caramelos sueltos',
        cantidad: 1,
        precioUnitario: '500.00',
        subtotal: '500.00',
      },
      {
        productoId: null,
        descripcion: 'Varios',
        cantidad: 2,
        precioUnitario: '250.00',
        subtotal: '500.00',
      },
    ]);
    expect(await prismaTest.movimientoStock.count()).toBe(0);
  });
});

describe('costo de cada ítem vendido', () => {
  async function costosGuardados(ventaId: string) {
    const items = await prismaTest.itemVenta.findMany({
      where: { ventaId },
      orderBy: { id: 'asc' },
    });
    return items.map((i) => i.costoUnitario?.toFixed(2) ?? null);
  }

  function venderGaseosa(ctx: Ctx) {
    return vender(ctx, {
      items: [{ productoId: ctx.gaseosa.id, cantidad: 1 }],
      pagos: [{ medio: 'efectivo', monto: '1500' }],
      totalEsperado: '1500',
    });
  }

  it('copia el costo que tiene el producto al vender', async () => {
    const ctx = await preparar();
    await prismaTest.producto.update({ where: { id: ctx.gaseosa.id }, data: { costo: '1000' } });

    const res = await venderGaseosa(ctx);

    expect(res.statusCode).toBe(201);
    expect(await costosGuardados(res.json().id)).toEqual(['1000.00']);
  });

  it('el costo guardado no cambia cuando un ingreso cambia el costo del producto', async () => {
    const ctx = await preparar();
    await prismaTest.producto.update({ where: { id: ctx.gaseosa.id }, data: { costo: '1000' } });
    const primera = (await venderGaseosa(ctx)).json();

    const ingreso = await ingresarMercaderia(ctx.app, ctx.admin, [
      { productoId: ctx.gaseosa.id, cantidad: 12, costoUnitario: '1100' },
    ]);
    const segunda = (await venderGaseosa(ctx)).json();

    expect(ingreso.statusCode).toBe(200);
    expect(await costosGuardados(primera.id)).toEqual(['1000.00']);
    expect(await costosGuardados(segunda.id)).toEqual(['1100.00']);
  });

  it('un producto sin costo deja el ítem sin costo, aunque después se le cargue', async () => {
    const ctx = await preparar();
    await prismaTest.producto.update({ where: { id: ctx.gaseosa.id }, data: { costo: null } });
    const { id } = (await venderGaseosa(ctx)).json();

    await prismaTest.producto.update({ where: { id: ctx.gaseosa.id }, data: { costo: '1000' } });

    expect(await costosGuardados(id)).toEqual([null]);
  });

  it('el ítem "Varios" queda sin costo', async () => {
    const ctx = await preparar();

    const res = await vender(ctx, {
      items: [
        { productoId: ctx.alfajor.id, cantidad: 1 },
        { varios: { precio: '500' }, cantidad: 1 },
      ],
      pagos: [{ medio: 'efectivo', monto: '1400' }],
      totalEsperado: '1400',
    });

    expect(res.statusCode).toBe(201);
    expect(await costosGuardados(res.json().id)).toEqual(['600.00', null]);
  });
});

describe('pagos de una venta', () => {
  it('acepta un pago mixto', async () => {
    const ctx = await preparar();

    const res = await vender(ctx, {
      items: [
        { productoId: ctx.alfajor.id, cantidad: 2 },
        { productoId: ctx.gaseosa.id, cantidad: 2 },
        { varios: { precio: '200' }, cantidad: 1 },
      ],
      pagos: [
        { medio: 'efectivo', monto: '2000' },
        { medio: 'debito', monto: '3000' },
      ],
      totalEsperado: '5000',
    });

    expect(res.statusCode).toBe(201);
    expect(
      res.json().pagos.map((p: { medio: string; monto: string }) => [p.medio, p.monto]),
    ).toEqual([
      ['efectivo', '2000.00'],
      ['debito', '3000.00'],
    ]);
  });

  it('rechaza pagos que no suman el total con 400', async () => {
    const ctx = await preparar();
    const res = await ventaTipica(ctx, { medio: 'debito', monto: '3000' });
    expect(res.statusCode).toBe(400);
    expect(await prismaTest.venta.count()).toBe(0);
  });
});

describe('vuelto en efectivo', () => {
  it('guarda el monto recibido y el vuelto', async () => {
    const ctx = await preparar();

    const res = await ventaTipica(ctx, { medio: 'efectivo', monto: '3300', montoRecibido: '5000' });

    expect(res.json().pagos).toEqual([
      { medio: 'efectivo', monto: '3300.00', montoRecibido: '5000.00', vuelto: '1700.00' },
    ]);
  });

  it('un monto recibido insuficiente responde 400', async () => {
    const ctx = await preparar();
    const res = await ventaTipica(ctx, { medio: 'efectivo', monto: '3300', montoRecibido: '3000' });
    expect(res.statusCode).toBe(400);
  });
});

describe('descuento de stock al vender', () => {
  it('descuenta con un movimiento venta asociado a la venta', async () => {
    const ctx = await preparar();
    await prismaTest.$transaction(async (tx) => {
      const { registrarMovimiento } = await import('../src/modules/stock/movimientos.js');
      await registrarMovimiento(tx, {
        productoId: ctx.alfajor.id,
        tipo: 'compra',
        cantidad: 10,
        usuarioId: ctx.juan.id,
      });
    });

    const { id } = (await ventaTipica(ctx)).json();

    expect(await stockDe(ctx.alfajor.id)).toBe(8);
    const movimiento = await prismaTest.movimientoStock.findFirstOrThrow({
      where: { productoId: ctx.alfajor.id, tipo: 'venta' },
    });
    expect(movimiento).toMatchObject({ cantidad: -2, stockResultante: 8, ventaId: id });
  });

  it('vende sin stock y lo deja negativo', async () => {
    const ctx = await preparar();
    const res = await ventaTipica(ctx);
    expect(res.statusCode).toBe(201);
    expect(await stockDe(ctx.gaseosa.id)).toBe(-1);
  });
});

describe('listado de ventas según el rol', () => {
  it('el empleado ve solo las ventas de hoy en hora de Argentina', async () => {
    const ctx = await preparar();
    const ayer = await ventaTipica(ctx);
    await pasarAAyer(ayer.json().id);
    const hoy = await ventaTipica(ctx, { medio: 'efectivo', monto: '3300' });

    const res = await ctx.app.inject({ method: 'GET', url: '/api/ventas', cookies: ctx.empleado });

    const lista = z.array(ventaResumenSchema).parse(res.json());
    expect(lista.map((v) => v.id)).toEqual([hoy.json().id]);
    expect(lista[0]).toMatchObject({ usuario: { nombre: 'Nombre juan' }, medios: ['efectivo'] });
    expect(ayer.statusCode).toBe(201);
  });

  it('el empleado que pide ayer recibe 403; el admin puede pedir cualquier rango', async () => {
    const ctx = await preparar();
    const { id: deAyer } = (await ventaTipica(ctx)).json();
    await pasarAAyer(deAyer);
    await ventaTipica(ctx);

    const delEmpleado = await ctx.app.inject({
      method: 'GET',
      url: '/api/ventas?desde=2026-10-19&hasta=2026-10-19',
      cookies: ctx.empleado,
    });
    const delAdmin = await ctx.app.inject({
      method: 'GET',
      url: '/api/ventas?desde=2026-10-19&hasta=2026-10-20',
      cookies: ctx.admin,
    });
    const soloAyer = await ctx.app.inject({
      method: 'GET',
      url: '/api/ventas?desde=2026-10-19',
      cookies: ctx.admin,
    });

    expect(delEmpleado.statusCode).toBe(403);
    expect(delEmpleado.json().error.codigo).toBe('FUERA_DE_PLAZO');
    expect(delAdmin.json()).toHaveLength(2);
    expect(soloAyer.json()).toHaveLength(1);
  });

  it('una venta de las 23:30 en Argentina cuenta para ese día, no para el siguiente en UTC', async () => {
    const { app } = await crearAppDePrueba(new Date('2026-10-21T02:30:00Z'));
    await crearUsuarioDePrueba('ana', 'admin');
    const admin = await sesionDe(app, 'ana');
    const p = await crearProductoDePrueba('Agua', { precio: '500' });
    await abrirTurnoDePrueba(app, admin);
    await app.inject({
      method: 'POST',
      url: '/api/ventas',
      cookies: admin,
      payload: {
        items: [{ productoId: p.id, cantidad: 1 }],
        pagos: [{ medio: 'efectivo', monto: '500' }],
        totalEsperado: '500',
      },
    });

    const del20 = await app.inject({
      method: 'GET',
      url: '/api/ventas?desde=2026-10-20',
      cookies: admin,
    });
    const del21 = await app.inject({
      method: 'GET',
      url: '/api/ventas?desde=2026-10-21',
      cookies: admin,
    });

    expect(del20.json()).toHaveLength(1);
    expect(del21.json()).toHaveLength(0);
  });

  it('el admin ve el costo de cada ítem al vender, en el detalle y al anular', async () => {
    const ctx = await preparar();
    await prismaTest.producto.update({ where: { id: ctx.gaseosa.id }, data: { costo: '1000' } });
    const venta = {
      items: [
        { productoId: ctx.gaseosa.id, cantidad: 1 },
        { varios: { precio: '500' }, cantidad: 1 },
      ],
      pagos: [{ medio: 'efectivo', monto: '2000' }],
      totalEsperado: '2000',
    };

    const registrada = await vender(ctx, venta, ctx.admin);
    const { id } = registrada.json();
    const detalle = await ctx.app.inject({
      method: 'GET',
      url: `/api/ventas/${id}`,
      cookies: ctx.admin,
    });
    const anulada = await anular(ctx, id, 'prueba', ctx.admin);

    for (const res of [registrada, detalle, anulada]) {
      expect(res.statusCode).toBeLessThan(300);
      expect(res.json().items.map((i: { costoUnitario: unknown }) => i.costoUnitario)).toEqual([
        '1000.00',
        null,
      ]);
    }
  });

  it('al empleado no le llega el costo ni al vender ni al anular', async () => {
    const ctx = await preparar();

    const registrada = await ventaTipica(ctx);
    const anulada = await anular(ctx, registrada.json().id, 'cobré dos veces');

    for (const res of [registrada, anulada]) {
      expect(res.statusCode).toBeLessThan(300);
      expect(res.body).not.toMatch(/costo/i);
    }
  });

  it('el detalle no incluye costos y el empleado no ve el de días anteriores', async () => {
    const ctx = await preparar();
    const { id } = (await ventaTipica(ctx)).json();

    const hoy = await ctx.app.inject({
      method: 'GET',
      url: `/api/ventas/${id}`,
      cookies: ctx.empleado,
    });
    await pasarAAyer(id);
    const deAyer = await ctx.app.inject({
      method: 'GET',
      url: `/api/ventas/${id}`,
      cookies: ctx.empleado,
    });

    expect(hoy.statusCode).toBe(200);
    expect(hoy.body).not.toMatch(/costo/i);
    expect(deAyer.statusCode).toBe(403);
  });
});

describe('anulación de ventas', () => {
  it('el empleado anula una venta de hoy: queda anulada, repone stock y deja aviso', async () => {
    const ctx = await preparar();
    const { id, numero } = (await ventaTipica(ctx)).json();

    const res = await anular(ctx, id, 'cobré dos veces');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      estado: 'anulada',
      anulacion: {
        en: MARTES_1542.toISOString(),
        por: { nombre: 'Nombre juan' },
        motivo: 'cobré dos veces',
      },
    });
    expect(await stockDe(ctx.alfajor.id)).toBe(0);
    expect(await stockDe(ctx.gaseosa.id)).toBe(0);
    const anulaciones = await prismaTest.movimientoStock.findMany({ where: { tipo: 'anulacion' } });
    expect(anulaciones.map((m) => [m.cantidad, m.ventaId]).sort()).toEqual([
      [1, id],
      [2, id],
    ]);
    const [aviso] = await prismaTest.notificacion.findMany();
    expect(aviso).toMatchObject({ tipo: 'anulacion_venta', destino: 'admin', estado: 'pendiente' });
    expect(aviso?.texto).toContain(`#${numero}`);
    expect(aviso?.texto).toContain('cobré dos veces');
    expect(await prismaTest.venta.count()).toBe(1);
  });

  it('el empleado no puede anular una venta de ayer; el admin sí', async () => {
    const ctx = await preparar();
    const { id } = (await ventaTipica(ctx)).json();
    await pasarAAyer(id);
    // La venta de ayer quedó en un turno que ya se cerró.
    await cerrarTurnoDePrueba(ctx.app, ctx.empleado, ctx.turnoId);
    await abrirTurnoDePrueba(ctx.app, ctx.empleado);

    const delEmpleado = await anular(ctx, id, 'me equivoqué');
    expect(delEmpleado.statusCode).toBe(403);
    expect((await prismaTest.venta.findUniqueOrThrow({ where: { id } })).estado).toBe('pagada');

    const delAdmin = await anular(ctx, id, 'me equivoqué', ctx.admin);
    expect(delAdmin.statusCode).toBe(200);
  });

  it('el empleado no puede anular una venta de hoy de otro turno', async () => {
    const ctx = await preparar();
    const { id } = (await ventaTipica(ctx)).json();
    await cerrarTurnoDePrueba(ctx.app, ctx.empleado, ctx.turnoId);
    const nuevoTurno = await abrirTurnoDePrueba(ctx.app, ctx.empleado);

    const res = await anular(ctx, id, 'me equivoqué');

    expect(res.statusCode).toBe(403);
    expect(res.json().error.mensaje).toContain('turno');
    const venta = await prismaTest.venta.findUniqueOrThrow({ where: { id } });
    expect(venta).toMatchObject({ estado: 'pagada', anulacionTurnoId: null });
    expect(nuevoTurno).not.toBe(ctx.turnoId);
  });

  it('la anulación guarda el turno abierto; el admin puede anular sin turno abierto', async () => {
    const ctx = await preparar();
    const primera = (await ventaTipica(ctx)).json();
    const segunda = (await ventaTipica(ctx)).json();

    await anular(ctx, primera.id, 'cobré dos veces');
    await cerrarTurnoDePrueba(ctx.app, ctx.empleado, ctx.turnoId);
    const sinTurno = await anular(ctx, segunda.id, 'devolución a la noche', ctx.admin);

    expect(sinTurno.statusCode).toBe(200);
    const [a, b] = await Promise.all(
      [primera.id, segunda.id].map((id) => prismaTest.venta.findUniqueOrThrow({ where: { id } })),
    );
    expect(a?.anulacionTurnoId).toBe(ctx.turnoId);
    expect(b).toMatchObject({ estado: 'anulada', anulacionTurnoId: null });
  });

  it('anular dos veces responde 409 y no repone stock otra vez', async () => {
    const ctx = await preparar();
    const { id } = (await ventaTipica(ctx)).json();
    await anular(ctx, id, 'cobré dos veces');

    const otra = await anular(ctx, id, 'de nuevo');

    expect(otra.statusCode).toBe(409);
    expect(otra.json().error.codigo).toBe('VENTA_YA_ANULADA');
    expect(await stockDe(ctx.alfajor.id)).toBe(0);
    expect(await prismaTest.notificacion.count()).toBe(1);
  });

  it('dos anulaciones simultáneas reponen el stock una sola vez', async () => {
    const ctx = await preparar();
    const { id } = (await ventaTipica(ctx)).json();

    const respuestas = await Promise.all([
      anular(ctx, id, 'cobré dos veces'),
      anular(ctx, id, 'cobré dos veces', ctx.admin),
    ]);

    expect(respuestas.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await stockDe(ctx.alfajor.id)).toBe(0);
    expect(await prismaTest.movimientoStock.count({ where: { tipo: 'anulacion' } })).toBe(2);
    expect(await prismaTest.notificacion.count()).toBe(1);
  });

  it('sin motivo responde 400', async () => {
    const ctx = await preparar();
    const { id } = (await ventaTipica(ctx)).json();
    expect((await anular(ctx, id, undefined)).statusCode).toBe(400);
    expect((await anular(ctx, id, '  ')).statusCode).toBe(400);
  });

  it('repone el stock aunque el producto se haya desactivado después de vender', async () => {
    const ctx = await preparar();
    const { id } = (await ventaTipica(ctx)).json();
    await prismaTest.producto.update({ where: { id: ctx.gaseosa.id }, data: { activo: false } });

    const res = await anular(ctx, id, 'devolución');

    expect(res.statusCode).toBe(200);
    expect(await stockDe(ctx.gaseosa.id)).toBe(0);
  });
});

describe('texto del aviso de anulación', () => {
  it('menciona venta, hora, quién anuló, motivo, ítems y total', () => {
    const texto = textoAvisoAnulacion({
      numero: 120,
      total: '3300.00',
      items: [
        { descripcion: 'Alfajor', cantidad: 2, subtotal: '1800.00' },
        { descripcion: 'Gaseosa', cantidad: 1, subtotal: '1500.00' },
      ],
      anuladaPor: 'Juan',
      motivo: 'cobré dos veces',
      anuladaEn: MARTES_1542,
    });

    expect(texto).toBe(
      [
        '*Venta #120 anulada*',
        'Fecha y hora: 20/10/2026 15:42',
        'Anuló: Juan',
        'Motivo: cobré dos veces',
        '',
        '2 × Alfajor: $ 1.800,00',
        '1 × Gaseosa: $ 1.500,00',
        '*Total: $ 3.300,00*',
      ].join('\n'),
    );
  });
});

describe('avisos para el admin', () => {
  it('el admin ve los avisos pendientes, el más reciente primero', async () => {
    const ctx = await preparar();
    const a = (await ventaTipica(ctx)).json();
    const b = (await ventaTipica(ctx)).json();
    await anular(ctx, a.id, 'primera');
    ctx.adelantar(60_000);
    await anular(ctx, b.id, 'segunda');

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/notificaciones',
      cookies: ctx.admin,
    });

    const avisos = z.array(notificacionSchema).parse(res.json());
    expect(avisos.map((x) => [x.estado, x.texto.includes('segunda')])).toEqual([
      ['pendiente', true],
      ['pendiente', false],
    ]);
  });

  it('un empleado recibe 403', async () => {
    const ctx = await preparar();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/notificaciones',
      cookies: ctx.empleado,
    });
    expect(res.statusCode).toBe(403);
  });
});
