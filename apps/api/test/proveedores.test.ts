import { proveedorListadoSchema } from '@kiosco/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limpiarBase, prismaTest } from './base.js';
import { crearAppDePrueba, crearUsuarioDePrueba, sesionDe } from './ayudas.js';

beforeEach(async () => {
  await limpiarBase();
});

/** Jueves 22/10/2026 a las 12:00 de Argentina. */
const JUEVES = new Date('2026-10-22T15:00:00Z');

/** App con un admin `ana` logueado. */
async function conAdmin(inicio?: Date) {
  const { app } = await crearAppDePrueba(inicio);
  await crearUsuarioDePrueba('ana', 'admin');
  const cookies = await sesionDe(app, 'ana');
  return { app, cookies };
}

type App = Awaited<ReturnType<typeof conAdmin>>['app'];

async function listar(app: App, cookies: Record<string, string>, query = '') {
  const res = await app.inject({ method: 'GET', url: `/api/proveedores${query}`, cookies });
  return z.array(proveedorListadoSchema).parse(res.json());
}

describe('alta y edición de proveedores', () => {
  it('guarda un proveedor que toma pedido lunes y jueves y entrega martes y viernes', async () => {
    const { app, cookies } = await conAdmin();

    const res = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      cookies,
      payload: {
        nombre: 'Distribuidora Sur',
        telefono: '11 5555-1234',
        diasPedido: ['jueves', 'lunes'],
        diasEntrega: ['martes', 'viernes'],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      nombre: 'Distribuidora Sur',
      telefono: '11 5555-1234',
      diasPedido: ['lunes', 'jueves'],
      diasEntrega: ['martes', 'viernes'],
      activo: true,
      productosActivos: 0,
    });
  });

  it('guarda un proveedor sin días fijos', async () => {
    const { app, cookies } = await conAdmin();

    const res = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      cookies,
      payload: { nombre: 'Panadería' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ diasPedido: [], diasEntrega: [], telefono: null });
  });

  it.each([
    { payload: { telefono: '123' }, caso: 'sin nombre' },
    { payload: { nombre: 'X', diasPedido: ['feriado'] }, caso: 'con un día inexistente' },
  ])('rechaza un proveedor $caso con 400', async ({ payload }) => {
    const { app, cookies } = await conAdmin();
    const res = await app.inject({ method: 'POST', url: '/api/proveedores', cookies, payload });
    expect(res.statusCode).toBe(400);
    expect(await prismaTest.proveedor.count()).toBe(0);
  });

  it('el admin edita los datos y los días', async () => {
    const { app, cookies } = await conAdmin();
    const p = await prismaTest.proveedor.create({ data: { nombre: 'Viejo' } });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/proveedores/${p.id}`,
      cookies,
      payload: { nombre: 'Nuevo', diasPedido: ['viernes'], notas: 'Pedir antes de las 10' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      nombre: 'Nuevo',
      diasPedido: ['viernes'],
      notas: 'Pedir antes de las 10',
    });
  });

  it('editar un proveedor inexistente responde 404', async () => {
    const { app, cookies } = await conAdmin();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/proveedores/0198a5b0-0000-7000-8000-000000000000',
      cookies,
      payload: { nombre: 'X' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('un empleado recibe 403 al crear o editar', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    const cookies = await sesionDe(app, 'juan');
    const p = await prismaTest.proveedor.create({ data: { nombre: 'Distri' } });

    const alta = await app.inject({
      method: 'POST',
      url: '/api/proveedores',
      cookies,
      payload: { nombre: 'X' },
    });
    const edicion = await app.inject({
      method: 'PATCH',
      url: `/api/proveedores/${p.id}`,
      cookies,
      payload: { nombre: 'X' },
    });

    expect(alta.statusCode).toBe(403);
    expect(edicion.statusCode).toBe(403);
  });
});

describe('lista de proveedores', () => {
  it('marca a los que toman pedido hoy (jueves) y los pone primero', async () => {
    const { app, cookies } = await conAdmin(JUEVES);
    await prismaTest.proveedor.createMany({
      data: [
        { nombre: 'Aguas', diasPedido: ['lunes'] },
        { nombre: 'Bebidas', diasPedido: ['lunes', 'jueves'] },
        { nombre: 'Golosinas', diasPedido: [] },
      ],
    });

    const lista = await listar(app, cookies);

    expect(lista.map((p) => [p.nombre, p.tomaPedidoHoy])).toEqual([
      ['Bebidas', true],
      ['Aguas', false],
      ['Golosinas', false],
    ]);
  });

  it('cerca de la medianoche usa el día de Argentina, no el de UTC', async () => {
    // Miércoles 21/10 22:00 en Argentina = jueves 22/10 01:00 UTC.
    const { app, cookies } = await conAdmin(new Date('2026-10-22T01:00:00Z'));
    await prismaTest.proveedor.createMany({
      data: [
        { nombre: 'De los miércoles', diasPedido: ['miercoles'] },
        { nombre: 'De los jueves', diasPedido: ['jueves'] },
      ],
    });

    const lista = await listar(app, cookies);

    expect(lista.find((p) => p.nombre === 'De los miércoles')?.tomaPedidoHoy).toBe(true);
    expect(lista.find((p) => p.nombre === 'De los jueves')?.tomaPedidoHoy).toBe(false);
  });

  it('cuenta solo los productos activos', async () => {
    const { app, cookies } = await conAdmin();
    const p = await prismaTest.proveedor.create({ data: { nombre: 'Distri' } });
    const base = { precio: '100', stockMinimo: 0, stockMaximo: 0, proveedorId: p.id };
    await prismaTest.producto.createMany({
      data: [
        { ...base, nombre: 'A', nombreBusqueda: 'a' },
        { ...base, nombre: 'B', nombreBusqueda: 'b' },
        { ...base, nombre: 'C', nombreBusqueda: 'c', activo: false },
      ],
    });

    const [proveedor] = await listar(app, cookies);

    expect(proveedor?.productosActivos).toBe(2);
  });
});

describe('desactivación de proveedores', () => {
  it('al desactivarlo, sus productos siguen asociados y no aparece entre las opciones', async () => {
    const { app, cookies } = await conAdmin();
    const p = await prismaTest.proveedor.create({ data: { nombre: 'Distri' } });
    const producto = await prismaTest.producto.create({
      data: {
        nombre: 'Agua',
        nombreBusqueda: 'agua',
        precio: '500',
        stockMinimo: 0,
        stockMaximo: 0,
        proveedorId: p.id,
      },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/proveedores/${p.id}`,
      cookies,
      payload: { activo: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().activo).toBe(false);
    const guardado = await prismaTest.producto.findUniqueOrThrow({ where: { id: producto.id } });
    expect(guardado.proveedorId).toBe(p.id);
    expect(await listar(app, cookies)).toEqual([]);
    expect((await listar(app, cookies, '?incluirInactivos=true')).map((x) => x.nombre)).toEqual([
      'Distri',
    ]);
  });
});
