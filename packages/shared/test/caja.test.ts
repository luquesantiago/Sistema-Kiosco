import { describe, expect, it } from 'vitest';
import {
  aperturaSchema,
  cierreSchema,
  movimientoCajaEntradaSchema,
  nombreMovimientoCaja,
} from '../src/caja.js';

describe('aperturaSchema', () => {
  it('acepta un monto escrito con coma o con punto de miles, también $0', () => {
    expect(aperturaSchema.parse({ montoInicial: '20.000' })).toEqual({ montoInicial: '20000.00' });
    expect(aperturaSchema.parse({ montoInicial: '0' })).toEqual({ montoInicial: '0.00' });
  });

  it('rechaza un monto inválido', () => {
    expect(aperturaSchema.safeParse({ montoInicial: 'veinte' }).success).toBe(false);
  });
});

describe('cierreSchema', () => {
  it('sin retiro', () => {
    expect(cierreSchema.parse({ montoContado: '51500' })).toEqual({
      montoContado: '51500.00',
      retiro: null,
      motivoRetiro: null,
    });
  });

  it('un retiro de $0 cuenta como sin retiro y no pide motivo', () => {
    expect(cierreSchema.parse({ montoContado: '100', retiro: '0' })).toMatchObject({
      retiro: null,
      motivoRetiro: null,
    });
  });

  it('con retiro exige motivo', () => {
    expect(cierreSchema.safeParse({ montoContado: '51500', retiro: '30000' }).success).toBe(false);
    expect(
      cierreSchema.parse({ montoContado: '51500', retiro: '30000', motivoRetiro: ' Al banco ' }),
    ).toEqual({ montoContado: '51500.00', retiro: '30000.00', motivoRetiro: 'Al banco' });
  });

  it('el retiro no puede superar lo contado, pero puede ser igual', () => {
    const base = { montoContado: '1000', motivoRetiro: 'todo' };
    expect(cierreSchema.safeParse({ ...base, retiro: '1000.01' }).success).toBe(false);
    expect(cierreSchema.safeParse({ ...base, retiro: '1000' }).success).toBe(true);
  });
});

describe('movimientoCajaEntradaSchema', () => {
  it('acepta un gasto con categoría y motivo', () => {
    expect(
      movimientoCajaEntradaSchema.parse({
        tipo: 'gasto',
        categoria: 'insumos',
        monto: '8000',
        motivo: 'Hielo',
      }),
    ).toEqual({
      tipo: 'gasto',
      categoria: 'insumos',
      cuenta: 'efectivo',
      monto: '8000.00',
      motivo: 'Hielo',
    });
  });

  it('acepta un retiro sin categoría', () => {
    expect(
      movimientoCajaEntradaSchema.parse({ tipo: 'retiro', monto: '100', motivo: 'Al banco' }),
    ).toEqual({ tipo: 'retiro', cuenta: 'efectivo', monto: '100.00', motivo: 'Al banco' });
  });

  it.each([
    ['monto cero', { tipo: 'gasto', categoria: 'otro', monto: '0', motivo: 'Hielo' }],
    ['sin motivo', { tipo: 'retiro', monto: '100', motivo: '  ' }],
    ['tipo desconocido', { tipo: 'prestamo', monto: '100', motivo: 'algo' }],
    ['un gasto sin categoría', { tipo: 'gasto', monto: '100', motivo: 'Hielo' }],
    [
      'un gasto de proveedor',
      { tipo: 'gasto', categoria: 'proveedor', monto: '100', motivo: 'Coca' },
    ],
    [
      'una cuenta desconocida',
      { tipo: 'gasto', categoria: 'otro', cuenta: 'banco', monto: '100', motivo: 'Hielo' },
    ],
    [
      'un retiro con categoría',
      { tipo: 'retiro', categoria: 'otro', monto: '100', motivo: 'Al banco' },
    ],
  ])('rechaza %s', (_caso, entrada) => {
    expect(movimientoCajaEntradaSchema.safeParse(entrada).success).toBe(false);
  });
});

describe('nombreMovimientoCaja', () => {
  it('suma la categoría solo a los gastos', () => {
    expect(nombreMovimientoCaja({ tipo: 'gasto', categoria: 'insumos', cuenta: 'efectivo' })).toBe(
      'Gasto · Insumos',
    );
    expect(nombreMovimientoCaja({ tipo: 'retiro', categoria: null, cuenta: 'efectivo' })).toBe(
      'Retiro',
    );
  });

  it('suma la cuenta cuando es Mercado Pago', () => {
    expect(
      nombreMovimientoCaja({ tipo: 'gasto', categoria: 'insumos', cuenta: 'mercado_pago' }),
    ).toBe('Gasto · Insumos · Mercado Pago');
    expect(nombreMovimientoCaja({ tipo: 'retiro', categoria: null, cuenta: 'mercado_pago' })).toBe(
      'Retiro · Mercado Pago',
    );
  });
});

describe('cuenta de un movimiento', () => {
  it('acepta un gasto de Mercado Pago', () => {
    expect(
      movimientoCajaEntradaSchema.parse({
        tipo: 'gasto',
        categoria: 'servicios',
        cuenta: 'mercado_pago',
        monto: '45000',
        motivo: 'luz',
      }),
    ).toMatchObject({ cuenta: 'mercado_pago' });
  });
});
