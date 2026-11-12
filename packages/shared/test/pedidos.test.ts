import { describe, expect, it } from 'vitest';
import { movimientoCajaEntradaSchema } from '../src/caja.js';
import {
  altaPedidoSchema,
  llegadaPedidoSchema,
  proximoDiaDeEntrega,
  recepcionSinPedidoSchema,
} from '../src/pedidos.js';

const PROVEEDOR = '0198a5b0-0000-7000-8000-000000000001';

describe('proximoDiaDeEntrega', () => {
  // 2026-10-20 es martes.
  it('el martes, con entregas los jueves, da el jueves', () => {
    expect(proximoDiaDeEntrega(['jueves'], '2026-10-20')).toBe('2026-10-22');
  });

  it('el jueves, con entregas los jueves, da el jueves siguiente', () => {
    expect(proximoDiaDeEntrega(['jueves'], '2026-10-22')).toBe('2026-10-29');
  });

  it('elige el más cercano entre varios días', () => {
    expect(proximoDiaDeEntrega(['lunes', 'miercoles'], '2026-10-20')).toBe('2026-10-21');
  });

  it('sin días de entrega da mañana, también a fin de mes', () => {
    expect(proximoDiaDeEntrega([], '2026-10-31')).toBe('2026-11-01');
  });
});

describe('esquemas de pedidos', () => {
  it('el total tiene que ser mayor que cero', () => {
    const base = { proveedorId: PROVEEDOR, llegaEl: '2026-10-22' };
    expect(altaPedidoSchema.safeParse({ ...base, totalPedido: '0' }).success).toBe(false);
    expect(altaPedidoSchema.parse({ ...base, totalPedido: '310.000' })).toMatchObject({
      totalPedido: '310000.00',
      nota: null,
    });
    expect(llegadaPedidoSchema.safeParse({ total: '0' }).success).toBe(false);
  });

  it('sin cuenta, la llegada queda debiendo', () => {
    expect(llegadaPedidoSchema.parse({ total: '100' })).toEqual({
      total: '100.00',
      notaRecepcion: null,
      cuenta: null,
    });
  });

  it('recibir sin pedido exige el proveedor', () => {
    expect(recepcionSinPedidoSchema.safeParse({ total: '12000' }).success).toBe(false);
  });

  it('un pago a proveedor no se registra como movimiento suelto', () => {
    expect(
      movimientoCajaEntradaSchema.safeParse({
        tipo: 'pago_proveedor',
        monto: '100',
        motivo: 'Coca',
      }).success,
    ).toBe(false);
  });
});
