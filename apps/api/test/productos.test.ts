import { cambioPrecioSchema, productoAdminSchema, productoVentaSchema } from '@kiosco/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limpiarBase, prismaTest } from './base.js';
import { crearAppDePrueba, crearUsuarioDePrueba, sesionDe } from './ayudas.js';

beforeEach(async () => {
  await limpiarBase();
});

const CODIGO = '7790001000012';

/** App con un admin `ana` y un empleado `juan` logueados, y un proveedor activo. */
async function preparar() {
  const { app } = await crearAppDePrueba();
  await crearUsuarioDePrueba('ana', 'admin');
  await crearUsuarioDePrueba('juan');
  const admin = await sesionDe(app, 'ana');
  const empleado = await sesionDe(app, 'juan');
  const proveedor = await prismaTest.proveedor.create({ data: { nombre: 'Distribuidora Sur' } });
  return { app, admin, empleado, proveedor };
}

type Contexto = Awaited<ReturnType<typeof preparar>>;

function crear(ctx: Contexto, datos: Record<string, unknown>) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/productos',
    cookies: ctx.admin,
    payload: { stockMinimo: 0, stockMaximo: 0, ...datos },
  });
}

async function crearOk(ctx: Contexto, datos: Record<string, unknown>) {
  const res = await crear(ctx, datos);
  if (res.statusCode !== 201) throw new Error(res.body);
  return productoAdminSchema.parse(res.json());
}

function editar(ctx: Contexto, id: string, cambios: Record<string, unknown>) {
  return ctx.app.inject({
    method: 'PATCH',
    url: `/api/productos/${id}`,
    cookies: ctx.admin,
    payload: cambios,
  });
}

async function buscar(ctx: Contexto, cookies: Record<string, string>, query: string) {
  const res = await ctx.app.inject({ method: 'GET', url: `/api/productos?${query}`, cookies });
  expect(res.statusCode).toBe(200);
  return res.json() as Record<string, unknown>[];
}

async function historial(ctx: Contexto, id: string) {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/productos/${id}/historial-precios`,
    cookies: ctx.admin,
  });
  expect(res.statusCode).toBe(200);
  return z.array(cambioPrecioSchema).parse(res.json());
}

describe('alta de producto', () => {
  it('alta completa: queda activo con esos datos y stock actual 0', async () => {
    const ctx = await preparar();

    const res = await crear(ctx, {
      nombre: 'Alfajor triple',
      codigoBarras: CODIGO,
      precio: 900,
      costo: '600',
      stockMinimo: 10,
      stockMaximo: 40,
      proveedorId: ctx.proveedor.id,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      nombre: 'Alfajor triple',
      codigoBarras: CODIGO,
      precio: '900.00',
      costo: '600.00',
      stockMinimo: 10,
      stockMaximo: 40,
      stockActual: 0,
      activo: true,
      proveedor: { id: ctx.proveedor.id, nombre: 'Distribuidora Sur' },
    });
  });

  it('un producto sin código de barras solo se encuentra por nombre', async () => {
    const ctx = await preparar();
    await crearOk(ctx, { nombre: 'Pan casero', precio: '1500' });
    await crearOk(ctx, { nombre: 'Facturas', precio: '800' });

    expect(await prismaTest.producto.count({ where: { codigoBarras: null } })).toBe(2);
    const resultado = await buscar(ctx, ctx.empleado, 'q=pan');
    expect(resultado.map((p) => p.nombre)).toEqual(['Pan casero']);
  });

  it.each([{ precio: 0 }, { precio: '-5' }, { precio: 100, stockMinimo: 10, stockMaximo: 5 }])(
    'rechaza %j con 400 y no crea nada',
    async (datos) => {
      const ctx = await preparar();
      const res = await crear(ctx, { nombre: 'X', ...datos });
      expect(res.statusCode).toBe(400);
      expect(await prismaTest.producto.count()).toBe(0);
    },
  );

  it('rechaza un proveedor desactivado con 400', async () => {
    const ctx = await preparar();
    const inactivo = await prismaTest.proveedor.create({
      data: { nombre: 'Viejo', activo: false },
    });

    const res = await crear(ctx, { nombre: 'X', precio: 100, proveedorId: inactivo.id });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.codigo).toBe('PROVEEDOR_INACTIVO');
    expect(await prismaTest.producto.count()).toBe(0);
  });

  it('un empleado no puede crear productos', async () => {
    const ctx = await preparar();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/productos',
      cookies: ctx.empleado,
      payload: { nombre: 'X', precio: 100, stockMinimo: 0, stockMaximo: 0 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('código de barras único', () => {
  it('un código repetido (con espacios) responde 409 indicando el producto', async () => {
    const ctx = await preparar();
    await crearOk(ctx, { nombre: 'Alfajor triple', codigoBarras: CODIGO, precio: 900 });

    const res = await crear(ctx, { nombre: 'Otro', codigoBarras: ` ${CODIGO} `, precio: 100 });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ codigo: 'CODIGO_EXISTENTE' });
    expect(res.json().error.mensaje).toContain('Alfajor triple');
  });

  it('también choca con un producto desactivado y al editar', async () => {
    const ctx = await preparar();
    const viejo = await crearOk(ctx, { nombre: 'Viejo', codigoBarras: CODIGO, precio: 900 });
    await editar(ctx, viejo.id, { activo: false });
    const otro = await crearOk(ctx, { nombre: 'Otro', precio: 100 });

    const res = await editar(ctx, otro.id, { codigoBarras: CODIGO });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('CODIGO_EXISTENTE');
  });

  it('guardar un producto con su propio código no choca', async () => {
    const ctx = await preparar();
    const p = await crearOk(ctx, { nombre: 'Alfajor', codigoBarras: CODIGO, precio: 900 });
    const res = await editar(ctx, p.id, { codigoBarras: CODIGO, nombre: 'Alfajor triple' });
    expect(res.statusCode).toBe(200);
  });
});

describe('edición y desactivación de productos', () => {
  it('un producto desactivado sigue para el admin y el empleado ya no lo encuentra', async () => {
    const ctx = await preparar();
    const p = await crearOk(ctx, { nombre: 'Alfajor triple', codigoBarras: CODIGO, precio: 900 });

    const res = await editar(ctx, p.id, { activo: false });

    expect(res.statusCode).toBe(200);
    expect(await buscar(ctx, ctx.empleado, `q=${CODIGO}`)).toEqual([]);
    expect(await buscar(ctx, ctx.empleado, 'q=alfajor')).toEqual([]);
    expect(await buscar(ctx, ctx.empleado, 'q=alfajor&incluirInactivos=true')).toEqual([]);
    const ficha = await ctx.app.inject({
      method: 'GET',
      url: `/api/productos/${p.id}`,
      cookies: ctx.admin,
    });
    expect(ficha.json()).toMatchObject({ nombre: 'Alfajor triple', activo: false });
  });

  it('el stock actual que llega en la edición se ignora', async () => {
    const ctx = await preparar();
    const p = await crearOk(ctx, { nombre: 'Agua', precio: 500 });

    const res = await editar(ctx, p.id, { nombre: 'Agua mineral', stockActual: 99 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ nombre: 'Agua mineral', stockActual: 0 });
  });

  it('valida el máximo contra el mínimo guardado', async () => {
    const ctx = await preparar();
    const p = await crearOk(ctx, { nombre: 'Agua', precio: 500, stockMinimo: 10, stockMaximo: 20 });

    const res = await editar(ctx, p.id, { stockMaximo: 5 });

    expect(res.statusCode).toBe(400);
  });

  it('conserva un proveedor desactivado, pero no deja asignar uno', async () => {
    const ctx = await preparar();
    const p = await crearOk(ctx, { nombre: 'Agua', precio: 500, proveedorId: ctx.proveedor.id });
    await prismaTest.proveedor.update({ where: { id: ctx.proveedor.id }, data: { activo: false } });
    const otro = await crearOk(ctx, { nombre: 'Soda', precio: 300 });

    const mismo = await editar(ctx, p.id, { proveedorId: ctx.proveedor.id, precio: 600 });
    const nuevo = await editar(ctx, otro.id, { proveedorId: ctx.proveedor.id });

    expect(mismo.statusCode).toBe(200);
    expect(nuevo.statusCode).toBe(400);
    expect(nuevo.json().error.codigo).toBe('PROVEEDOR_INACTIVO');
  });

  it('editar un producto inexistente responde 404', async () => {
    const ctx = await preparar();
    const res = await editar(ctx, '0198a5b0-0000-7000-8000-000000000000', { nombre: 'X' });
    expect(res.statusCode).toBe(404);
  });
});

describe('historial de cambios de precio', () => {
  it('un cambio manual de $900 a $1.000 queda con usuario, fecha y origen', async () => {
    const ctx = await preparar();
    const p = await crearOk(ctx, { nombre: 'Alfajor', precio: 900, costo: 600 });

    await editar(ctx, p.id, { precio: '1.000' });

    const cambios = await historial(ctx, p.id);
    expect(cambios).toHaveLength(1);
    expect(cambios[0]).toMatchObject({
      precioAnterior: '900.00',
      precioNuevo: '1000.00',
      costoAnterior: '600.00',
      costoNuevo: '600.00',
      origen: 'manual',
      usuario: { nombre: 'Nombre ana' },
    });
  });

  it('también registra los cambios de costo, del más reciente al más antiguo', async () => {
    const ctx = await preparar();
    const p = await crearOk(ctx, { nombre: 'Alfajor', precio: 900 });

    await editar(ctx, p.id, { costo: '600' });
    await editar(ctx, p.id, { precio: 950 });

    const cambios = await historial(ctx, p.id);
    expect(cambios.map((c) => [c.precioNuevo, c.costoNuevo])).toEqual([
      ['950.00', '600.00'],
      ['900.00', '600.00'],
    ]);
  });

  it('editar solo el nombre, o mandar el mismo precio, no agrega entradas', async () => {
    const ctx = await preparar();
    const p = await crearOk(ctx, { nombre: 'Alfajor', precio: 900 });

    await editar(ctx, p.id, { nombre: 'Alfajor triple' });
    await editar(ctx, p.id, { precio: '900,00' });

    expect(await historial(ctx, p.id)).toEqual([]);
  });
});

describe('búsqueda de productos', () => {
  it('con el lector, el empleado recibe el producto sin costo ni proveedor', async () => {
    const ctx = await preparar();
    await crearOk(ctx, {
      nombre: 'Alfajor triple',
      codigoBarras: CODIGO,
      precio: 900,
      costo: 600,
      proveedorId: ctx.proveedor.id,
    });

    const [producto, ...resto] = await buscar(ctx, ctx.empleado, `q=${CODIGO}`);

    expect(resto).toEqual([]);
    expect(productoVentaSchema.strict().parse(producto)).toMatchObject({
      nombre: 'Alfajor triple',
      codigoBarras: CODIGO,
      precio: '900.00',
      stockActual: 0,
    });
    expect(producto).not.toHaveProperty('costo');
    expect(producto).not.toHaveProperty('proveedor');
  });

  it('el código exacto gana sobre los nombres que lo contienen', async () => {
    const ctx = await preparar();
    await crearOk(ctx, { nombre: 'Gaseosa 500', codigoBarras: '500', precio: 900 });
    await crearOk(ctx, { nombre: 'Agua 500 ml', precio: 500 });

    const resultado = await buscar(ctx, ctx.empleado, 'q=500');

    expect(resultado.map((p) => p.nombre)).toEqual(['Gaseosa 500']);
  });

  it('busca por nombre sin acentos ni mayúsculas', async () => {
    const ctx = await preparar();
    await crearOk(ctx, { nombre: 'Café molido 250 g', precio: 3000 });
    await crearOk(ctx, { nombre: 'Té en saquitos', precio: 1200 });

    expect((await buscar(ctx, ctx.empleado, 'q=cafe')).map((p) => p.nombre)).toEqual([
      'Café molido 250 g',
    ]);
    expect((await buscar(ctx, ctx.empleado, 'q=MOLIDO')).map((p) => p.nombre)).toEqual([
      'Café molido 250 g',
    ]);
  });

  it('un código inexistente devuelve una lista vacía', async () => {
    const ctx = await preparar();
    expect(await buscar(ctx, ctx.empleado, 'q=0000000000000')).toEqual([]);
  });

  it('el admin ve costo, proveedor y estado, e incluye los desactivados si lo pide', async () => {
    const ctx = await preparar();
    await crearOk(ctx, {
      nombre: 'Alfajor',
      precio: 900,
      costo: 600,
      proveedorId: ctx.proveedor.id,
    });
    const viejo = await crearOk(ctx, { nombre: 'Alfajor viejo', precio: 500 });
    await editar(ctx, viejo.id, { activo: false });

    const activos = await buscar(ctx, ctx.admin, 'q=alfajor');
    const todos = await buscar(ctx, ctx.admin, 'q=alfajor&incluirInactivos=true');

    expect(z.array(productoAdminSchema).parse(activos)).toMatchObject([
      { nombre: 'Alfajor', costo: '600.00', proveedor: { nombre: 'Distribuidora Sur' } },
    ]);
    expect(todos.map((p) => [p.nombre, p.activo])).toEqual([
      ['Alfajor', true],
      ['Alfajor viejo', false],
    ]);
  });

  it('devuelve como máximo 50 por página', async () => {
    const ctx = await preparar();
    await prismaTest.producto.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        nombre: `Caramelo ${String(i).padStart(2, '0')}`,
        nombreBusqueda: `caramelo ${String(i).padStart(2, '0')}`,
        precio: '10',
        stockMinimo: 0,
        stockMaximo: 0,
      })),
    });

    const primera = await buscar(ctx, ctx.empleado, 'q=caramelo');
    const segunda = await buscar(ctx, ctx.empleado, 'q=caramelo&pagina=2');

    expect(primera).toHaveLength(50);
    expect(segunda.map((p) => p.nombre)).toEqual([
      'Caramelo 50',
      'Caramelo 51',
      'Caramelo 52',
      'Caramelo 53',
      'Caramelo 54',
    ]);
  });
});
