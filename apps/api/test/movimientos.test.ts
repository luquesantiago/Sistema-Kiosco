import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registrarMovimiento } from '../src/modules/stock/movimientos.js';
import { limpiarBase, prismaTest } from './base.js';
import { crearUsuarioDePrueba } from './ayudas.js';
import { crearProductoDePrueba, verificarStockConsistente } from './stock-ayudas.js';

let usuarioId: string;

beforeEach(async () => {
  await limpiarBase();
  usuarioId = (await crearUsuarioDePrueba('ana', 'admin')).id;
});

function mover(productoId: string, cantidad: number, tipo: 'compra' | 'ajuste' = 'compra') {
  return prismaTest.$transaction((tx) =>
    registrarMovimiento(tx, {
      productoId,
      tipo,
      cantidad,
      motivo: tipo === 'ajuste' ? 'correccion' : null,
      usuarioId,
    }),
  );
}

describe('registrarMovimiento', () => {
  afterEach(async () => {
    await verificarStockConsistente();
  });

  it('movimiento y stock coinciden: +12 sobre 3 deja 15', async () => {
    const p = await crearProductoDePrueba('Gaseosa');
    await mover(p.id, 3);

    const movimiento = await mover(p.id, 12);

    expect(movimiento).toMatchObject({ cantidad: 12, stockResultante: 15, tipo: 'compra' });
    const guardado = await prismaTest.producto.findUniqueOrThrow({ where: { id: p.id } });
    expect(guardado.stockActual).toBe(15);
  });

  it('permite que el stock quede negativo: -5 sobre 2 deja -3', async () => {
    const p = await crearProductoDePrueba('Alfajor');
    await mover(p.id, 2);

    const movimiento = await mover(p.id, -5, 'ajuste');

    expect(movimiento.stockResultante).toBe(-3);
  });

  it('dos movimientos simultáneos (+5 y -2 sobre 10) dejan 13 y resultantes consistentes', async () => {
    const p = await crearProductoDePrueba('Chicle');
    await mover(p.id, 10);

    const [a, b] = await Promise.all([mover(p.id, 5), mover(p.id, -2, 'ajuste')]);

    const guardado = await prismaTest.producto.findUniqueOrThrow({ where: { id: p.id } });
    expect(guardado.stockActual).toBe(13);
    // Cualquiera haya sido el orden, el último resultante es 13 y el primero, 10 + su cantidad.
    const resultantes = [a.stockResultante, b.stockResultante].sort((x, y) => x - y);
    expect([
      [8, 13],
      [13, 15],
    ]).toContainEqual(resultantes);
  });

  it('muchos movimientos simultáneos no pierden ninguna actualización', async () => {
    const p = await crearProductoDePrueba('Agua');

    await Promise.all(Array.from({ length: 20 }, () => mover(p.id, 1)));

    const guardado = await prismaTest.producto.findUniqueOrThrow({ where: { id: p.id } });
    expect(guardado.stockActual).toBe(20);
    const resultantes = (await prismaTest.movimientoStock.findMany()).map((m) => m.stockResultante);
    expect(resultantes.sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('un producto inexistente o desactivado da 404 y no deja movimiento', async () => {
    const p = await crearProductoDePrueba('Viejo', { activo: false });

    await expect(mover(p.id, 5)).rejects.toMatchObject({
      status: 404,
      codigo: 'PRODUCTO_NO_ENCONTRADO',
    });
    await expect(mover('0198a5b0-0000-7000-8000-000000000000', 5)).rejects.toMatchObject({
      status: 404,
    });
    expect(await prismaTest.movimientoStock.count()).toBe(0);
  });

  it('exige motivo en los ajustes y lo prohíbe en los demás tipos', async () => {
    const p = await crearProductoDePrueba('Galletitas');
    const intento = (tipo: 'compra' | 'ajuste', motivo: 'rotura' | null) =>
      prismaTest.$transaction((tx) =>
        registrarMovimiento(tx, { productoId: p.id, tipo, cantidad: 1, motivo, usuarioId }),
      );

    await expect(intento('ajuste', null)).rejects.toThrow('Motivo inválido');
    await expect(intento('compra', 'rotura')).rejects.toThrow('Motivo inválido');
  });
});

describe('verificarStockConsistente', () => {
  it('falla si el stock actual cambia sin un movimiento', async () => {
    const p = await crearProductoDePrueba('Caramelos');
    await mover(p.id, 4);
    await prismaTest.producto.update({ where: { id: p.id }, data: { stockActual: 10 } });

    await expect(verificarStockConsistente()).rejects.toThrow('stock de Caramelos');
  });
});
