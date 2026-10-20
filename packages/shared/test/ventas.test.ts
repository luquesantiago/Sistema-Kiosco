import { describe, expect, it } from 'vitest';
import { formatear, multiplicar, restar, sonIguales, sumar } from '../src/decimales.js';
import { anulacionSchema, calcularVuelto, ventaEntradaSchema } from '../src/ventas.js';

const ID = '0198a5b0-0000-7000-8000-000000000001';

describe('cuentas con montos', () => {
  it('suma sin errores de coma flotante', () => {
    expect(sumar('0.10', '0.20')).toBe('0.30');
    expect(sumar('1000.10', '2000.20', '0.70')).toBe('3001.00');
    expect(sumar()).toBe('0.00');
  });

  it('multiplica, resta y formatea a dos decimales', () => {
    expect(multiplicar('900.00', 2)).toBe('1800.00');
    expect(multiplicar('333.33', 3)).toBe('999.99');
    expect(restar('5000', '3300')).toBe('1700.00');
    expect(formatear('905.5')).toBe('905.50');
    expect(formatear('0.005')).toBe('0.01');
  });

  it('un pago mixto cierra al centavo', () => {
    const total = sumar(multiplicar('333.33', 3), '0.01');
    expect(total).toBe('1000.00');
    expect(sonIguales(sumar('333.34', '666.66'), total)).toBe(true);
  });

  it('calcula el vuelto', () => {
    expect(calcularVuelto('3300.00', '5000.00')).toBe('1700.00');
    expect(calcularVuelto('3300.00', '3300.00')).toBe('0.00');
  });
});

describe('ventaEntradaSchema', () => {
  const valida = {
    items: [{ productoId: ID, cantidad: 2 }],
    pagos: [{ medio: 'debito', monto: '3300' }],
    totalEsperado: '3300',
  };

  it('acepta una venta con un pago que suma el total', () => {
    expect(ventaEntradaSchema.safeParse(valida).success).toBe(true);
  });

  it('acepta un pago mixto que cierra al centavo', () => {
    const r = ventaEntradaSchema.safeParse({
      ...valida,
      pagos: [
        { medio: 'efectivo', monto: '2000,50', montoRecibido: '2500' },
        { medio: 'debito', monto: '1299,50' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('un "Varios" sin descripción se llama "Varios" y con precio cero se rechaza', () => {
    const conVarios = ventaEntradaSchema.parse({
      ...valida,
      items: [{ varios: { precio: '500' }, cantidad: 1 }],
      pagos: [{ medio: 'efectivo', monto: '500' }],
      totalEsperado: '500',
    });
    expect(conVarios.items[0]).toEqual({
      varios: { descripcion: 'Varios', precio: '500.00' },
      cantidad: 1,
    });
    expect(
      ventaEntradaSchema.safeParse({
        ...valida,
        items: [{ varios: { precio: '0' }, cantidad: 1 }],
      }).success,
    ).toBe(false);
  });

  it.each([
    ['pagos que no suman el total', { pagos: [{ medio: 'debito', monto: '3000' }] }],
    [
      'un medio repetido',
      {
        pagos: [
          { medio: 'debito', monto: '1300' },
          { medio: 'debito', monto: '2000' },
        ],
      },
    ],
    [
      'un recibido menor que el efectivo',
      { pagos: [{ medio: 'efectivo', monto: '3300', montoRecibido: '3000' }] },
    ],
    [
      'un recibido en tarjeta',
      { pagos: [{ medio: 'credito', monto: '3300', montoRecibido: '5000' }] },
    ],
    ['sin ítems', { items: [] }],
    ['cantidad 0', { items: [{ productoId: ID, cantidad: 0 }] }],
    ['cantidad 1000', { items: [{ productoId: ID, cantidad: 1000 }] }],
  ])('rechaza %s', (_caso, cambio) => {
    expect(ventaEntradaSchema.safeParse({ ...valida, ...cambio }).success).toBe(false);
  });
});

describe('anulacionSchema', () => {
  it('exige un motivo de 3 a 200 caracteres', () => {
    expect(anulacionSchema.safeParse({ motivo: ' ok ' }).success).toBe(false);
    expect(anulacionSchema.safeParse({ motivo: 'cobré dos veces' }).success).toBe(true);
    expect(anulacionSchema.safeParse({ motivo: 'x'.repeat(201) }).success).toBe(false);
  });
});
