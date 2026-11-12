import { expect } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client.js';
import type { App, Cookies } from './ayudas.js';
import { prismaTest } from './base.js';

/** Producto activo con stock 0, sin código, precio $1.000 y costo $600 salvo que se indique otra cosa. */
export function crearProductoDePrueba(
  nombre: string,
  datos: Partial<Prisma.ProductoUncheckedCreateInput> = {},
) {
  return prismaTest.producto.create({
    data: {
      nombre,
      nombreBusqueda: nombre.toLowerCase(),
      precio: '1000',
      costo: '600',
      stockMinimo: 0,
      stockMaximo: 0,
      ...datos,
    },
  });
}

/**
 * El stock actual de cada producto tiene que ser igual a la suma de sus
 * movimientos: nada puede cambiar `stockActual` sin dejar un movimiento.
 */
export async function verificarStockConsistente(): Promise<void> {
  const productos = await prismaTest.producto.findMany({
    select: { id: true, nombre: true, stockActual: true },
  });
  const sumas = await prismaTest.movimientoStock.groupBy({
    by: ['productoId'],
    _sum: { cantidad: true },
  });
  const sumaPorProducto = new Map(sumas.map((s) => [s.productoId, s._sum.cantidad ?? 0]));
  for (const p of productos) {
    expect(p.stockActual, `stock de ${p.nombre} vs. sus movimientos`).toBe(
      sumaPorProducto.get(p.id) ?? 0,
    );
  }
}

/**
 * Ingresa mercadería como lo hace el kiosco: recibe sin pedido (de un proveedor
 * de prueba, sin pagar) y carga los productos. Devuelve la respuesta de la carga.
 */
export async function ingresarMercaderia(
  app: App,
  cookies: Cookies,
  items: { productoId: string; cantidad: number; costoUnitario?: string }[],
) {
  const proveedor = await prismaTest.proveedor.create({ data: { nombre: 'Proveedor de prueba' } });
  const recepcion = await app.inject({
    method: 'POST',
    url: '/api/pedidos/sin-pedido',
    cookies,
    payload: { proveedorId: proveedor.id, total: '1000' },
  });
  expect(recepcion.statusCode).toBe(201);
  return app.inject({
    method: 'POST',
    url: `/api/pedidos/${recepcion.json().id}/carga`,
    cookies,
    payload: { items },
  });
}
