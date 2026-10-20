import { describe, expect, it } from 'vitest';
import {
  ajusteStockSchema,
  conteoStockSchema,
  ingresoMercaderiaSchema,
  ventasSinSistemaSchema,
} from '../src/stock.js';

const ID = '0198a5b0-0000-7000-8000-000000000001';

describe('ajusteStockSchema', () => {
  const valido = { productoId: ID, cantidad: -2, motivo: 'rotura' };

  it('acepta un ajuste con motivo y la nota es opcional', () => {
    expect(ajusteStockSchema.parse(valido)).toEqual({ ...valido, nota: null });
  });

  it('el motivo "otro" exige una nota', () => {
    expect(ajusteStockSchema.safeParse({ ...valido, motivo: 'otro' }).success).toBe(false);
    expect(ajusteStockSchema.safeParse({ ...valido, motivo: 'otro', nota: '  ' }).success).toBe(
      false,
    );
    expect(ajusteStockSchema.parse({ ...valido, motivo: 'otro', nota: 'Se mojó' }).nota).toBe(
      'Se mojó',
    );
  });

  it.each([{ cantidad: 0 }, { cantidad: 1.5 }, { motivo: 'regalo' }, { motivo: undefined }])(
    'rechaza %j',
    (cambio) => {
      expect(ajusteStockSchema.safeParse({ ...valido, ...cambio }).success).toBe(false);
    },
  );
});

describe('conteoStockSchema', () => {
  it('acepta cero y rechaza negativos o decimales', () => {
    expect(conteoStockSchema.safeParse({ productoId: ID, cantidadContada: 0 }).success).toBe(true);
    expect(conteoStockSchema.safeParse({ productoId: ID, cantidadContada: -1 }).success).toBe(
      false,
    );
    expect(conteoStockSchema.safeParse({ productoId: ID, cantidadContada: 2.5 }).success).toBe(
      false,
    );
  });
});

describe('ventasSinSistemaSchema', () => {
  it('exige al menos un producto con cantidad mayor que cero', () => {
    expect(ventasSinSistemaSchema.safeParse({ items: [] }).success).toBe(false);
    expect(
      ventasSinSistemaSchema.safeParse({ items: [{ productoId: ID, cantidad: 0 }] }).success,
    ).toBe(false);
    expect(ventasSinSistemaSchema.parse({ items: [{ productoId: ID, cantidad: 3 }] })).toEqual({
      nota: null,
      items: [{ productoId: ID, cantidad: 3 }],
    });
  });
});

describe('ingresoMercaderiaSchema', () => {
  const item = { productoId: ID, cantidad: 24 };

  it('acepta un ingreso sin proveedor ni costos', () => {
    expect(ingresoMercaderiaSchema.parse({ items: [item] })).toEqual({
      proveedorId: null,
      nota: null,
      items: [item],
    });
  });

  it('normaliza el costo con coma', () => {
    const parsed = ingresoMercaderiaSchema.parse({ items: [{ ...item, costoUnitario: '650,5' }] });
    expect(parsed.items[0]?.costoUnitario).toBe('650.50');
  });

  it.each([
    { items: [] },
    { items: [{ ...item, cantidad: 0 }] },
    { items: [{ ...item, cantidad: -3 }] },
    { items: [{ ...item, cantidad: 100_001 }] },
    { items: Array.from({ length: 201 }, () => item) },
  ])('rechaza ingresos inválidos (%#)', (datos) => {
    expect(ingresoMercaderiaSchema.safeParse(datos).success).toBe(false);
  });

  it('acepta hasta 200 ítems', () => {
    const datos = { items: Array.from({ length: 200 }, () => item) };
    expect(ingresoMercaderiaSchema.safeParse(datos).success).toBe(true);
  });
});
