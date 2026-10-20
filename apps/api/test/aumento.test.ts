import { vistaPreviaAumentoSchema } from '@kiosco/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '../src/generated/prisma/client.js';
import {
  aplicarAumento,
  calcularCostoAumentado,
  calcularPrecioAumentado,
} from '../src/modules/productos/servicio.js';
import { limpiarBase, prismaTest } from './base.js';
import { crearAppDePrueba, crearUsuarioDePrueba, sesionDe } from './ayudas.js';

const D = (valor: string) => new Prisma.Decimal(valor);

describe('cálculo del aumento', () => {
  it('$905 +10% con redondeo a $10 da $1.000 (995,50 hacia arriba)', () => {
    expect(calcularPrecioAumentado(D('905'), 10, 10).toFixed(2)).toBe('1000.00');
  });

  it.each([
    ['1000', 10, 1, '1100.00'],
    ['999', 10, 50, '1100.00'],
    ['1000', 15, 100, '1200.00'],
    ['1000', -10, 10, '900.00'],
    ['333.33', 7.5, 1, '359.00'],
  ])('%s %s%% redondeando a $%s da %s', (precio, porcentaje, redondeo, esperado) => {
    expect(calcularPrecioAumentado(D(precio), porcentaje, redondeo).toFixed(2)).toBe(esperado);
  });

  it('nunca queda en cero: el mínimo es un redondeo', () => {
    expect(calcularPrecioAumentado(D('0.50'), -50, 100).toFixed(2)).toBe('100.00');
    expect(calcularPrecioAumentado(D('0.10'), -50, 1).toFixed(2)).toBe('1.00');
  });

  it('el costo se aumenta sin redondeo comercial, a 2 decimales (mitad hacia arriba)', () => {
    expect(calcularCostoAumentado(D('600'), 10).toFixed(2)).toBe('660.00');
    expect(calcularCostoAumentado(D('333.33'), 7.5).toFixed(2)).toBe('358.33');
    // 0,05 × 1,10 = 0,055 → 0,06
    expect(calcularCostoAumentado(D('0.05'), 10).toFixed(2)).toBe('0.06');
  });
});

describe('aumento masivo en la API', () => {
  beforeEach(async () => {
    await limpiarBase();
  });

  async function preparar() {
    const { app } = await crearAppDePrueba();
    const ana = await crearUsuarioDePrueba('ana', 'admin');
    const cookies = await sesionDe(app, 'ana');
    const sur = await prismaTest.proveedor.create({ data: { nombre: 'Sur' } });
    const norte = await prismaTest.proveedor.create({ data: { nombre: 'Norte' } });
    const base = { stockMinimo: 0, stockMaximo: 0 };
    const crear = (nombre: string, datos: Partial<Prisma.ProductoUncheckedCreateInput>) =>
      prismaTest.producto.create({
        data: { ...base, nombre, nombreBusqueda: nombre.toLowerCase(), precio: '0', ...datos },
      });
    const productos = {
      alfajor: await crear('Alfajor', { precio: '905', costo: '600', proveedorId: sur.id }),
      chicle: await crear('Chicle', { precio: '100', proveedorId: sur.id }),
      viejo: await crear('Viejo', { precio: '500', proveedorId: sur.id, activo: false }),
      agua: await crear('Agua', { precio: '1000', proveedorId: norte.id }),
    };
    return { app, cookies, ana, sur, norte, productos };
  }

  type Ctx = Awaited<ReturnType<typeof preparar>>;

  function pedir(ctx: Ctx, ruta: string, payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: 'POST',
      url: `/api/productos/aumento${ruta}`,
      cookies: ctx.cookies,
      payload,
    });
  }

  async function precios() {
    const productos = await prismaTest.producto.findMany({ orderBy: { nombre: 'asc' } });
    return Object.fromEntries(productos.map((p) => [p.nombre, p.precio.toFixed(2)]));
  }

  it('la vista previa muestra precio actual y nuevo sin modificar nada', async () => {
    const ctx = await preparar();
    const antes = await precios();

    const res = await pedir(ctx, '/vista-previa', {
      proveedorId: ctx.sur.id,
      porcentaje: 10,
      redondeo: 10,
      incluirCosto: true,
    });

    expect(res.statusCode).toBe(200);
    expect(vistaPreviaAumentoSchema.parse(res.json())).toEqual([
      {
        id: ctx.productos.alfajor.id,
        nombre: 'Alfajor',
        precioActual: '905.00',
        precioNuevo: '1000.00',
        costoActual: '600.00',
        costoNuevo: '660.00',
      },
      {
        id: ctx.productos.chicle.id,
        nombre: 'Chicle',
        precioActual: '100.00',
        precioNuevo: '110.00',
        costoActual: null,
        costoNuevo: null,
      },
    ]);
    expect(await precios()).toEqual(antes);
    expect(await prismaTest.cambioPrecio.count()).toBe(0);
  });

  it('al confirmar, cambia solo los activos del proveedor y deja el historial', async () => {
    const ctx = await preparar();

    const res = await pedir(ctx, '', { proveedorId: ctx.sur.id, porcentaje: 10, redondeo: 10 });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ actualizados: 2 });
    expect(await precios()).toEqual({
      Agua: '1000.00',
      Alfajor: '1000.00',
      Chicle: '110.00',
      Viejo: '500.00',
    });
    const alfajor = await prismaTest.producto.findUniqueOrThrow({
      where: { id: ctx.productos.alfajor.id },
    });
    // Sin incluirCosto, el costo queda igual.
    expect(alfajor.costo?.toFixed(2)).toBe('600.00');
    const historial = await prismaTest.cambioPrecio.findMany({ orderBy: { precioNuevo: 'asc' } });
    expect(
      historial.map((c) => [c.productoId, c.origen, c.precioAnterior.toFixed(2), c.usuarioId]),
    ).toEqual([
      [ctx.productos.chicle.id, 'aumento_masivo', '100.00', ctx.ana.id],
      [ctx.productos.alfajor.id, 'aumento_masivo', '905.00', ctx.ana.id],
    ]);
  });

  it('sin proveedor aplica a todos los activos y omite los que no cambian', async () => {
    const ctx = await preparar();

    const previa = await pedir(ctx, '/vista-previa', {
      proveedorId: null,
      porcentaje: -0.5,
      redondeo: 100,
    });

    // -0,5%: Agua 995 → 1000 (no cambia), Alfajor 900,48 → 1000, Chicle 99,50 → 100 (no cambia).
    expect(previa.json().map((p: { nombre: string }) => p.nombre)).toEqual(['Alfajor']);

    const res = await pedir(ctx, '', { proveedorId: null, porcentaje: -0.5, redondeo: 100 });
    expect(res.json()).toEqual({ actualizados: 1 });
    expect(await prismaTest.cambioPrecio.count()).toBe(1);
  });

  it('rechaza un porcentaje fuera de rango o un redondeo inválido', async () => {
    const ctx = await preparar();
    for (const payload of [
      { proveedorId: null, porcentaje: 0, redondeo: 10 },
      { proveedorId: null, porcentaje: 250, redondeo: 10 },
      { proveedorId: null, porcentaje: 10, redondeo: 5 },
    ]) {
      expect((await pedir(ctx, '', payload)).statusCode).toBe(400);
    }
    expect(await prismaTest.cambioPrecio.count()).toBe(0);
  });

  it('si falla a mitad del aumento, ningún precio queda modificado', async () => {
    await preparar();
    const antes = await precios();

    // Un usuario inexistente hace fallar el historial después de actualizar los productos.
    await expect(
      aplicarAumento(
        prismaTest,
        { proveedorId: null, porcentaje: 10, redondeo: 10, incluirCosto: true },
        '0198a5b0-0000-7000-8000-000000000000',
      ),
    ).rejects.toThrow();

    expect(await precios()).toEqual(antes);
    expect(await prismaTest.cambioPrecio.count()).toBe(0);
  });
});
