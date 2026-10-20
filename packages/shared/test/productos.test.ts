import { describe, expect, it } from 'vitest';
import { normalizarParaBusqueda } from '../src/busqueda.js';
import { montoPositivoSchema, montoSchema, textoAMonto } from '../src/montos.js';
import {
  altaProductoSchema,
  aumentoMasivoSchema,
  edicionProductoSchema,
  productoVentaSchema,
} from '../src/productos.js';
import { altaProveedorSchema, edicionProveedorSchema } from '../src/proveedores.js';

describe('normalizarParaBusqueda', () => {
  it.each([
    ['Café Molido 250 g', 'cafe molido 250 g'],
    ['  ALFAJOR   Triple ', 'alfajor triple'],
    ['Ñoquis de papá', 'noquis de papa'],
    ['Pingüino', 'pinguino'],
  ])('%j → %j', (texto, esperado) => {
    expect(normalizarParaBusqueda(texto)).toBe(esperado);
  });
});

describe('textoAMonto', () => {
  it.each([
    ['905', '905.00'],
    ['905,5', '905.50'],
    ['905.50', '905.50'],
    ['1.000', '1000.00'],
    ['1.000,50', '1000.50'],
    ['12.500', '12500.00'],
    ['$ 1500', '1500.00'],
    ['0,99', '0.99'],
    ['007', '7.00'],
  ])('%j → %j', (texto, esperado) => {
    expect(textoAMonto(texto)).toBe(esperado);
  });

  it.each(['', 'abc', '10,555', '-5', '1,2,3', '1.00.0', '12345678901'])('rechaza %j', (texto) => {
    expect(textoAMonto(texto)).toBeNull();
  });
});

describe('montoSchema', () => {
  it('acepta números y texto con coma', () => {
    expect(montoSchema.parse(900)).toBe('900.00');
    expect(montoSchema.parse(905.5)).toBe('905.50');
    expect(montoSchema.parse('905,5')).toBe('905.50');
  });

  it('el precio tiene que ser mayor que cero', () => {
    expect(montoPositivoSchema.safeParse('0').success).toBe(false);
    expect(montoPositivoSchema.safeParse('0,00').success).toBe(false);
    expect(montoPositivoSchema.safeParse(-1).success).toBe(false);
    expect(montoPositivoSchema.safeParse('0,01').success).toBe(true);
  });
});

describe('altaProductoSchema', () => {
  const valido = {
    nombre: 'Alfajor triple',
    codigoBarras: ' 7790001000012 ',
    precio: '900',
    costo: '600,00',
    stockMinimo: 10,
    stockMaximo: 40,
  };

  it('recorta el código y normaliza montos', () => {
    expect(altaProductoSchema.parse(valido)).toEqual({
      ...valido,
      codigoBarras: '7790001000012',
      precio: '900.00',
      costo: '600.00',
      proveedorId: null,
    });
  });

  it('un código vacío queda como null', () => {
    expect(altaProductoSchema.parse({ ...valido, codigoBarras: '  ' }).codigoBarras).toBeNull();
  });

  it.each([
    { precio: '0' },
    { precio: '-10' },
    { stockMinimo: 10, stockMaximo: 5 },
    { stockMinimo: 1.5 },
    { nombre: '' },
  ])('rechaza %j', (cambio) => {
    expect(altaProductoSchema.safeParse({ ...valido, ...cambio }).success).toBe(false);
  });
});

describe('edicionProductoSchema', () => {
  it('descarta el stock actual', () => {
    expect(edicionProductoSchema.parse({ nombre: 'X', stockActual: 50 })).toEqual({ nombre: 'X' });
  });

  it('rechaza una edición vacía', () => {
    expect(edicionProductoSchema.safeParse({ stockActual: 50 }).success).toBe(false);
  });
});

describe('productoVentaSchema', () => {
  it('no deja pasar costo ni proveedor', () => {
    const salida = productoVentaSchema.parse({
      id: '0198a5b0-0000-7000-8000-000000000001',
      codigoBarras: null,
      nombre: 'Agua',
      precio: '500.00',
      stockActual: 3,
      costo: '300.00',
      proveedor: { id: '0198a5b0-0000-7000-8000-000000000002', nombre: 'Distri' },
    });
    expect(salida).not.toHaveProperty('costo');
    expect(salida).not.toHaveProperty('proveedor');
  });
});

describe('aumentoMasivoSchema', () => {
  const valido = { proveedorId: null, porcentaje: 10, redondeo: 10 };

  it('acepta un aumento válido y el porcentaje con coma', () => {
    expect(aumentoMasivoSchema.parse(valido)).toEqual({ ...valido, incluirCosto: false });
    expect(aumentoMasivoSchema.parse({ ...valido, porcentaje: '7,5' }).porcentaje).toBe(7.5);
    expect(aumentoMasivoSchema.parse({ ...valido, porcentaje: -50 }).porcentaje).toBe(-50);
    expect(aumentoMasivoSchema.parse({ ...valido, porcentaje: 200 }).porcentaje).toBe(200);
  });

  it.each([{ porcentaje: 0 }, { porcentaje: -51 }, { porcentaje: 201 }, { porcentaje: 'diez' }])(
    'rechaza el porcentaje %j',
    (cambio) => {
      expect(aumentoMasivoSchema.safeParse({ ...valido, ...cambio }).success).toBe(false);
    },
  );

  it.each([0, 5, 1000])('rechaza el redondeo %j', (redondeo) => {
    expect(aumentoMasivoSchema.safeParse({ ...valido, redondeo }).success).toBe(false);
  });
});

describe('proveedores', () => {
  it('guarda varios días sin repetir y en orden de la semana', () => {
    const p = altaProveedorSchema.parse({
      nombre: 'Distribuidora Sur',
      diasPedido: ['jueves', 'lunes', 'jueves'],
      diasEntrega: ['viernes', 'martes'],
    });
    expect(p).toEqual({
      nombre: 'Distribuidora Sur',
      telefono: null,
      notas: null,
      diasPedido: ['lunes', 'jueves'],
      diasEntrega: ['martes', 'viernes'],
    });
  });

  it('rechaza un día inexistente o un proveedor sin nombre', () => {
    expect(altaProveedorSchema.safeParse({ nombre: 'X', diasPedido: ['feriado'] }).success).toBe(
      false,
    );
    expect(altaProveedorSchema.safeParse({ nombre: '  ' }).success).toBe(false);
  });

  it('un teléfono vacío en la edición queda como null', () => {
    expect(edicionProveedorSchema.parse({ telefono: '' })).toEqual({ telefono: null });
  });
});
