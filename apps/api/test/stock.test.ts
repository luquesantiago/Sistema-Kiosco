import { movimientoStockSchema } from '@kiosco/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limpiarBase, prismaTest } from './base.js';
import { crearAppDePrueba, crearUsuarioDePrueba, sesionDe } from './ayudas.js';
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

async function preparar() {
  const { app } = await crearAppDePrueba();
  await crearUsuarioDePrueba('ana', 'admin');
  await crearUsuarioDePrueba('juan');
  const admin = await sesionDe(app, 'ana');
  const empleado = await sesionDe(app, 'juan');
  return { app, admin, empleado };
}

type Ctx = Awaited<ReturnType<typeof preparar>>;

function post(ctx: Ctx, ruta: string, payload: Record<string, unknown>, cookies = ctx.admin) {
  return ctx.app.inject({ method: 'POST', url: `/api/stock${ruta}`, cookies, payload });
}

async function stockDe(id: string) {
  return (await prismaTest.producto.findUniqueOrThrow({ where: { id } })).stockActual;
}

/** Deja el producto con el stock indicado mediante un ingreso (así queda su movimiento). */
async function conStock(ctx: Ctx, nombre: string, stock: number) {
  const p = await crearProductoDePrueba(nombre);
  const res = await ingresarMercaderia(ctx.app, ctx.admin, [{ productoId: p.id, cantidad: stock }]);
  expect(res.statusCode).toBe(200);
  return p;
}

async function movimientos(ctx: Ctx, id: string, query = '') {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/stock/productos/${id}/movimientos${query}`,
    cookies: ctx.admin,
  });
  expect(res.statusCode).toBe(200);
  return z.array(movimientoStockSchema).parse(res.json());
}

describe('ajustes de stock', () => {
  it('un ajuste por rotura baja el stock y queda con tipo y motivo', async () => {
    const ctx = await preparar();
    const p = await conStock(ctx, 'Gaseosa', 10);

    const res = await post(ctx, '/ajustes', { productoId: p.id, cantidad: -2, motivo: 'rotura' });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      tipo: 'ajuste',
      motivo: 'rotura',
      cantidad: -2,
      stockResultante: 8,
      usuario: { nombre: 'Nombre ana' },
    });
    expect(await stockDe(p.id)).toBe(8);
  });

  it('el motivo "otro" sin nota responde 400 y el stock no cambia', async () => {
    const ctx = await preparar();
    const p = await conStock(ctx, 'Gaseosa', 10);

    const res = await post(ctx, '/ajustes', { productoId: p.id, cantidad: -1, motivo: 'otro' });

    expect(res.statusCode).toBe(400);
    expect(await stockDe(p.id)).toBe(10);
  });

  it('un empleado no puede ajustar', async () => {
    const ctx = await preparar();
    const p = await conStock(ctx, 'Gaseosa', 10);

    const res = await post(
      ctx,
      '/ajustes',
      { productoId: p.id, cantidad: -1, motivo: 'rotura' },
      ctx.empleado,
    );

    expect(res.statusCode).toBe(403);
    expect(await stockDe(p.id)).toBe(10);
  });

  it('un producto desactivado responde 404', async () => {
    const ctx = await preparar();
    const p = await crearProductoDePrueba('Viejo', { activo: false });

    const res = await post(ctx, '/ajustes', { productoId: p.id, cantidad: 1, motivo: 'conteo' });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.codigo).toBe('PRODUCTO_NO_ENCONTRADO');
  });
});

describe('movimientos inmutables', () => {
  it('un error se corrige con otro movimiento y los dos quedan en el historial', async () => {
    const ctx = await preparar();
    const p = await conStock(ctx, 'Alfajor', 10);

    await post(ctx, '/ajustes', { productoId: p.id, cantidad: -9, motivo: 'correccion' });

    expect((await movimientos(ctx, p.id)).map((m) => [m.tipo, m.cantidad])).toEqual([
      ['ajuste', -9],
      ['compra', 10],
    ]);
    expect(await stockDe(p.id)).toBe(1);
  });

  it('no existen rutas para editar ni borrar movimientos', async () => {
    const ctx = await preparar();
    await ctx.app.ready();
    const rutasDeStock = ctx.app.rutasRegistradas
      .filter((r) => r.url.startsWith('/api/stock'))
      .flatMap((r) => (Array.isArray(r.method) ? r.method : [r.method]));

    expect(rutasDeStock).not.toContain('PATCH');
    expect(rutasDeStock).not.toContain('PUT');
    expect(rutasDeStock).not.toContain('DELETE');
  });
});

describe('historial de movimientos', () => {
  it('muestra el ingreso y el ajuste, el más reciente primero, con quién los hizo', async () => {
    const ctx = await preparar();
    const p = await crearProductoDePrueba('Gaseosa');
    await ingresarMercaderia(ctx.app, ctx.empleado, [{ productoId: p.id, cantidad: 24 }]);
    await post(ctx, '/ajustes', {
      productoId: p.id,
      cantidad: -1,
      motivo: 'otro',
      nota: 'Se la tomó el repartidor',
    });

    const lista = await movimientos(ctx, p.id);

    expect(lista).toMatchObject([
      {
        tipo: 'ajuste',
        motivo: 'otro',
        nota: 'Se la tomó el repartidor',
        cantidad: -1,
        stockResultante: 23,
        usuario: { nombre: 'Nombre ana' },
      },
      { tipo: 'compra', motivo: null, cantidad: 24, usuario: { nombre: 'Nombre juan' } },
    ]);
    expect(lista[1]?.ingresoId).not.toBeNull();
  });

  it('pagina de a 50', async () => {
    const ctx = await preparar();
    const p = await crearProductoDePrueba('Chicle');
    for (let i = 0; i < 55; i++) {
      await post(ctx, '/ajustes', { productoId: p.id, cantidad: 1, motivo: 'conteo' });
    }

    expect(await movimientos(ctx, p.id)).toHaveLength(50);
    expect(await movimientos(ctx, p.id, '?pagina=2')).toHaveLength(5);
  });

  it('un producto inexistente responde 404 y el empleado no puede verlo', async () => {
    const ctx = await preparar();
    const p = await crearProductoDePrueba('Chicle');

    const inexistente = await ctx.app.inject({
      method: 'GET',
      url: '/api/stock/productos/0198a5b0-0000-7000-8000-000000000000/movimientos',
      cookies: ctx.admin,
    });
    const delEmpleado = await ctx.app.inject({
      method: 'GET',
      url: `/api/stock/productos/${p.id}/movimientos`,
      cookies: ctx.empleado,
    });

    expect(inexistente.statusCode).toBe(404);
    expect(delEmpleado.statusCode).toBe(403);
  });
});

describe('conteo rápido', () => {
  it('con faltante registra un ajuste por la diferencia', async () => {
    const ctx = await preparar();
    const p = await conStock(ctx, 'Gaseosa', 20);

    const res = await post(ctx, '/conteos', { productoId: p.id, cantidadContada: 17 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ diferencia: -3, stockActual: 17 });
    const [ultimo] = await movimientos(ctx, p.id);
    expect(ultimo).toMatchObject({ tipo: 'ajuste', motivo: 'conteo', cantidad: -3 });
  });

  it('con sobrante también ajusta, y funciona con stock negativo', async () => {
    const ctx = await preparar();
    const p = await conStock(ctx, 'Gaseosa', 2);
    await post(ctx, '/ajustes', { productoId: p.id, cantidad: -5, motivo: 'correccion' });

    const res = await post(ctx, '/conteos', { productoId: p.id, cantidadContada: 4 });

    expect(res.json()).toEqual({ diferencia: 7, stockActual: 4 });
  });

  it('sin diferencia no registra ningún movimiento', async () => {
    const ctx = await preparar();
    const p = await conStock(ctx, 'Gaseosa', 20);

    const res = await post(ctx, '/conteos', { productoId: p.id, cantidadContada: 20 });

    expect(res.json()).toEqual({ diferencia: 0, stockActual: 20 });
    expect(await movimientos(ctx, p.id)).toHaveLength(1);
  });

  it('un producto desactivado responde 404', async () => {
    const ctx = await preparar();
    const p = await crearProductoDePrueba('Viejo', { activo: false });
    const res = await post(ctx, '/conteos', { productoId: p.id, cantidadContada: 3 });
    expect(res.statusCode).toBe(404);
  });
});

describe('ventas hechas sin sistema', () => {
  it('descuenta cada producto con motivo venta_sin_sistema', async () => {
    const ctx = await preparar();
    const gaseosa = await conStock(ctx, 'Gaseosa', 10);
    const alfajor = await conStock(ctx, 'Alfajor', 10);

    const res = await post(ctx, '/ventas-sin-sistema', {
      nota: 'Corte de luz del martes',
      items: [
        { productoId: gaseosa.id, cantidad: 3 },
        { productoId: alfajor.id, cantidad: 2 },
        { productoId: alfajor.id, cantidad: 3 },
      ],
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ productos: 2 });
    expect(await stockDe(gaseosa.id)).toBe(7);
    expect(await stockDe(alfajor.id)).toBe(5);
    const [ultimo] = await movimientos(ctx, alfajor.id);
    expect(ultimo).toMatchObject({
      motivo: 'venta_sin_sistema',
      cantidad: -5,
      nota: 'Corte de luz del martes',
    });
  });

  it('si un producto no existe, no cambia el stock de ninguno', async () => {
    const ctx = await preparar();
    const gaseosa = await conStock(ctx, 'Gaseosa', 10);

    const res = await post(ctx, '/ventas-sin-sistema', {
      items: [
        { productoId: gaseosa.id, cantidad: 3 },
        { productoId: '0198a5b0-0000-7000-8000-000000000000', cantidad: 1 },
      ],
    });

    expect(res.statusCode).toBe(404);
    expect(await stockDe(gaseosa.id)).toBe(10);
    expect(await movimientos(ctx, gaseosa.id)).toHaveLength(1);
  });

  it('rechaza cantidades cero y es solo para el admin', async () => {
    const ctx = await preparar();
    const p = await conStock(ctx, 'Gaseosa', 10);

    const cero = await post(ctx, '/ventas-sin-sistema', {
      items: [{ productoId: p.id, cantidad: 0 }],
    });
    const empleado = await post(
      ctx,
      '/ventas-sin-sistema',
      { items: [{ productoId: p.id, cantidad: 1 }] },
      ctx.empleado,
    );

    expect(cero.statusCode).toBe(400);
    expect(empleado.statusCode).toBe(403);
    expect(await stockDe(p.id)).toBe(10);
  });
});
