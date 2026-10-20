import { ingresoDetalleSchema, ingresoListadoSchema } from '@kiosco/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limpiarBase, prismaTest } from './base.js';
import { crearAppDePrueba, crearUsuarioDePrueba, sesionDe } from './ayudas.js';
import { crearProductoDePrueba, verificarStockConsistente } from './stock-ayudas.js';

beforeEach(async () => {
  await limpiarBase();
});

afterEach(async () => {
  await verificarStockConsistente();
});

async function preparar() {
  const { app } = await crearAppDePrueba();
  await crearUsuarioDePrueba('ana', 'admin');
  const juan = await crearUsuarioDePrueba('juan');
  const admin = await sesionDe(app, 'ana');
  const empleado = await sesionDe(app, 'juan');
  const sur = await prismaTest.proveedor.create({ data: { nombre: 'Distribuidora Sur' } });
  const gaseosa = await crearProductoDePrueba('Gaseosa', { codigoBarras: '7790001' });
  const alfajor = await crearProductoDePrueba('Alfajor');
  return { app, admin, empleado, juan, sur, gaseosa, alfajor };
}

type Ctx = Awaited<ReturnType<typeof preparar>>;

function ingresar(ctx: Ctx, payload: Record<string, unknown>, cookies = ctx.admin) {
  return ctx.app.inject({ method: 'POST', url: '/api/stock/ingresos', cookies, payload });
}

async function producto(id: string) {
  return prismaTest.producto.findUniqueOrThrow({ where: { id } });
}

describe('registro de un ingreso de mercadería', () => {
  it('el empleado recibe al proveedor: sube el stock y queda como responsable', async () => {
    const ctx = await preparar();

    const res = await ingresar(
      ctx,
      {
        proveedorId: ctx.sur.id,
        nota: 'Remito 0001-123',
        items: [
          { productoId: ctx.gaseosa.id, cantidad: 24 },
          { productoId: ctx.alfajor.id, cantidad: 12 },
        ],
      },
      ctx.empleado,
    );

    expect(res.statusCode).toBe(201);
    expect(ingresoListadoSchema.parse(res.json())).toMatchObject({
      proveedor: { nombre: 'Distribuidora Sur' },
      usuario: { id: ctx.juan.id },
      nota: 'Remito 0001-123',
      cantidadProductos: 2,
    });
    expect((await producto(ctx.gaseosa.id)).stockActual).toBe(24);
    expect((await producto(ctx.alfajor.id)).stockActual).toBe(12);
    const movimientos = await prismaTest.movimientoStock.findMany();
    expect(movimientos.map((m) => [m.tipo, m.ingresoId, m.usuarioId])).toEqual([
      ['compra', res.json().id, ctx.juan.id],
      ['compra', res.json().id, ctx.juan.id],
    ]);
  });

  it.each([{ items: [] }, { items: [{ cantidad: 0 }] }, { items: [{ cantidad: -3 }] }])(
    'sin productos o con cantidades inválidas responde 400 (%#)',
    async ({ items }) => {
      const ctx = await preparar();
      const res = await ingresar(ctx, {
        items: items.map((i) => ({ productoId: ctx.gaseosa.id, ...i })),
      });
      expect(res.statusCode).toBe(400);
      expect(await prismaTest.ingresoMercaderia.count()).toBe(0);
    },
  );

  it('un producto repetido se suma en un solo movimiento', async () => {
    const ctx = await preparar();

    const res = await ingresar(ctx, {
      items: [
        { productoId: ctx.gaseosa.id, cantidad: 6 },
        { productoId: ctx.gaseosa.id, cantidad: 6 },
      ],
    });

    expect(res.json().cantidadProductos).toBe(1);
    expect((await producto(ctx.gaseosa.id)).stockActual).toBe(12);
    expect(await prismaTest.movimientoStock.count()).toBe(1);
  });

  it('si un producto está desactivado no registra nada', async () => {
    const ctx = await preparar();
    const viejo = await crearProductoDePrueba('Viejo', { activo: false });

    const res = await ingresar(ctx, {
      items: [
        { productoId: ctx.gaseosa.id, cantidad: 6 },
        { productoId: viejo.id, cantidad: 1 },
      ],
    });

    expect(res.statusCode).toBe(404);
    expect(await prismaTest.ingresoMercaderia.count()).toBe(0);
    expect((await producto(ctx.gaseosa.id)).stockActual).toBe(0);
  });

  it('rechaza un proveedor desactivado', async () => {
    const ctx = await preparar();
    await prismaTest.proveedor.update({ where: { id: ctx.sur.id }, data: { activo: false } });

    const res = await ingresar(ctx, {
      proveedorId: ctx.sur.id,
      items: [{ productoId: ctx.gaseosa.id, cantidad: 6 }],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.codigo).toBe('PROVEEDOR_INACTIVO');
  });
});

describe('costo opcional y precargado para el admin', () => {
  it('si llegó con otro costo, se actualiza y queda en el historial de precios', async () => {
    const ctx = await preparar();

    const res = await ingresar(ctx, {
      items: [{ productoId: ctx.alfajor.id, cantidad: 12, costoUnitario: '650' }],
    });

    expect(res.statusCode).toBe(201);
    expect((await producto(ctx.alfajor.id)).costo?.toFixed(2)).toBe('650.00');
    const cambios = await prismaTest.cambioPrecio.findMany();
    expect(
      cambios.map((c) => [
        c.origen,
        c.precioAnterior.toFixed(2),
        c.precioNuevo.toFixed(2),
        c.costoAnterior?.toFixed(2),
        c.costoNuevo?.toFixed(2),
      ]),
    ).toEqual([['manual', '1000.00', '1000.00', '600.00', '650.00']]);
  });

  it('con el costo sin cambios, o sin costo, no toca el producto ni el historial', async () => {
    const ctx = await preparar();

    await ingresar(ctx, {
      items: [
        { productoId: ctx.alfajor.id, cantidad: 12, costoUnitario: '600,00' },
        { productoId: ctx.gaseosa.id, cantidad: 6, costoUnitario: null },
      ],
    });

    expect((await producto(ctx.alfajor.id)).costo?.toFixed(2)).toBe('600.00');
    expect(await prismaTest.cambioPrecio.count()).toBe(0);
  });

  it('con costos distintos para el mismo producto gana el último', async () => {
    const ctx = await preparar();

    await ingresar(ctx, {
      items: [
        { productoId: ctx.alfajor.id, cantidad: 6, costoUnitario: '620' },
        { productoId: ctx.alfajor.id, cantidad: 6, costoUnitario: '640' },
      ],
    });

    expect((await producto(ctx.alfajor.id)).costo?.toFixed(2)).toBe('640.00');
  });

  it('un costo de un empleado responde 400 y no registra nada', async () => {
    const ctx = await preparar();

    const res = await ingresar(
      ctx,
      { items: [{ productoId: ctx.alfajor.id, cantidad: 12, costoUnitario: '650' }] },
      ctx.empleado,
    );

    expect(res.statusCode).toBe(400);
    expect(res.json().error.codigo).toBe('COSTO_NO_PERMITIDO');
    expect(await prismaTest.ingresoMercaderia.count()).toBe(0);
    expect((await producto(ctx.alfajor.id)).stockActual).toBe(0);
  });
});

describe('proveedores para elegir en el ingreso', () => {
  it('el empleado recibe solo id y nombre de los activos', async () => {
    const ctx = await preparar();
    await prismaTest.proveedor.create({
      data: { nombre: 'Aguas', telefono: '123', activo: false },
    });
    await prismaTest.proveedor.create({ data: { nombre: 'Bebidas', telefono: '456' } });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/stock/proveedores',
      cookies: ctx.empleado,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: expect.any(String), nombre: 'Bebidas' },
      { id: ctx.sur.id, nombre: 'Distribuidora Sur' },
    ]);
  });
});

describe('consulta de ingresos', () => {
  it('el admin ve la lista y el detalle de lo que cargó un empleado', async () => {
    const ctx = await preparar();
    await ingresar(ctx, { items: [{ productoId: ctx.alfajor.id, cantidad: 1 }] });
    const delEmpleado = await ingresar(
      ctx,
      {
        proveedorId: ctx.sur.id,
        items: [
          { productoId: ctx.gaseosa.id, cantidad: 24 },
          { productoId: ctx.alfajor.id, cantidad: 12 },
        ],
      },
      ctx.empleado,
    );

    const lista = await ctx.app.inject({
      method: 'GET',
      url: '/api/stock/ingresos',
      cookies: ctx.admin,
    });
    const detalle = await ctx.app.inject({
      method: 'GET',
      url: `/api/stock/ingresos/${delEmpleado.json().id}`,
      cookies: ctx.admin,
    });

    expect(
      z
        .array(ingresoListadoSchema)
        .parse(lista.json())
        .map((i) => [i.usuario.nombre, i.cantidadProductos]),
    ).toEqual([
      ['Nombre juan', 2],
      ['Nombre ana', 1],
    ]);
    expect(ingresoDetalleSchema.parse(detalle.json())).toMatchObject({
      usuario: { nombre: 'Nombre juan' },
      proveedor: { nombre: 'Distribuidora Sur' },
      items: [
        {
          producto: { nombre: 'Gaseosa', codigoBarras: '7790001' },
          cantidad: 24,
          costoUnitario: null,
        },
        { producto: { nombre: 'Alfajor' }, cantidad: 12, costoUnitario: null },
      ],
    });
  });

  it('el detalle muestra el costo que cargó el admin', async () => {
    const ctx = await preparar();
    const res = await ingresar(ctx, {
      items: [{ productoId: ctx.alfajor.id, cantidad: 12, costoUnitario: '650,5' }],
    });

    const detalle = await ctx.app.inject({
      method: 'GET',
      url: `/api/stock/ingresos/${res.json().id}`,
      cookies: ctx.admin,
    });

    expect(detalle.json().items[0].costoUnitario).toBe('650.50');
  });

  it('el empleado no puede consultar ingresos y un ingreso inexistente da 404', async () => {
    const ctx = await preparar();
    const delEmpleado = await ctx.app.inject({
      method: 'GET',
      url: '/api/stock/ingresos',
      cookies: ctx.empleado,
    });
    const inexistente = await ctx.app.inject({
      method: 'GET',
      url: '/api/stock/ingresos/0198a5b0-0000-7000-8000-000000000000',
      cookies: ctx.admin,
    });
    expect(delEmpleado.statusCode).toBe(403);
    expect(inexistente.statusCode).toBe(404);
  });
});
