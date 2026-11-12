import { describe, expect, it } from 'vitest';
import { NOMBRE_MOVIMIENTO_CAJA, nombreMovimientoCaja, TIPOS_MOVIMIENTO_CAJA } from '../src/caja.js';
import { CODIGOS_ERROR } from '../src/errores.js';
import { motivoRechazoCobro } from '../src/mercadopago.js';
import { ESTADOS_VENTA, pagoEntradaSchema, TIPOS_NOTIFICACION } from '../src/ventas.js';

/*
 * Lo que `cobro-mercado-pago` suma a shared (tarea 2.2). Supuesto (el design pide
 * "los textos de los motivos de rechazo" sin nombrar la función):
 *   motivoRechazoCobro(statusDetail: string | null): string  — en `mercadopago.ts`.
 */

describe('motivo de un pago rechazado por Mercado Pago', () => {
  it.each([
    ['rejected_by_issuer', 'Tarjeta rechazada por el banco'],
    ['insufficient_amount', 'Fondos insuficientes'],
    ['card_disabled', 'Tarjeta bloqueada'],
    ['bad_filled_card_data', 'Datos de la tarjeta incorrectos'],
    ['high_risk', 'Mercado Pago lo rechazó por seguridad'],
  ])('%s → "%s"', (detalle, texto) => {
    expect(motivoRechazoCobro(detalle)).toBe(texto);
  });

  it.each([
    ['un detalle desconocido', 'processing_error'],
    ['un detalle vacío', ''],
    ['sin detalle', null],
    ['el detalle en mayúsculas (no es el código de MP)', 'INSUFFICIENT_AMOUNT'],
  ])('%s → "Pago rechazado"', (_caso, detalle) => {
    expect(motivoRechazoCobro(detalle)).toBe('Pago rechazado');
  });
});

describe('estados, tipos y códigos nuevos', () => {
  it('los estados de venta suman pendiente y cancelada al final', () => {
    expect(ESTADOS_VENTA).toEqual(['pagada', 'anulada', 'pendiente', 'cancelada']);
  });

  it('los avisos suman cobro_mp_a_revisar y devolucion_cobro_mp', () => {
    expect(TIPOS_NOTIFICACION).toEqual(
      expect.arrayContaining(['cobro_mp_a_revisar', 'devolucion_cobro_mp']),
    );
  });

  it('el movimiento devolucion_cobro existe y tiene nombre propio en los listados', () => {
    expect(TIPOS_MOVIMIENTO_CAJA).toContain('devolucion_cobro');
    const nombre = (NOMBRE_MOVIMIENTO_CAJA as Record<string, string>).devolucion_cobro;
    expect(nombre).toMatch(/devoluci/i);
    expect(
      nombreMovimientoCaja({
        tipo: 'devolucion_cobro' as (typeof TIPOS_MOVIMIENTO_CAJA)[number],
        categoria: null,
        cuenta: 'efectivo',
      }),
    ).toBe(nombre);
  });

  it('los códigos de error nuevos', () => {
    expect(Object.values(CODIGOS_ERROR)).toEqual(
      expect.arrayContaining([
        'TERMINAL_OCUPADA',
        'UN_SOLO_MEDIO_ELECTRONICO',
        'VENTA_NO_EN_ESPERA',
        'COBRO_EN_ESPERA',
        'DEVOLUCION_PENDIENTE',
        'DEVOLUCION_YA_CONFIRMADA',
        'MP_NO_DISPONIBLE',
      ]),
    );
  });
});

describe('monto de un pago (lo que llega a la terminal)', () => {
  it.each([
    ['0', false],
    ['0.00', false],
    ['0.005', false],
    ['0,005', false],
    ['0.01', true],
    ['1500.5', true],
    ['1500.505', false],
  ])('"%s" → válido: %s', (monto, valido) => {
    expect(pagoEntradaSchema.safeParse({ medio: 'debito', monto }).success).toBe(valido);
  });

  it('0.005 como número tampoco es válido (no se lee como $5 con punto de miles)', () => {
    expect(pagoEntradaSchema.safeParse({ medio: 'debito', monto: 0.005 }).success).toBe(false);
  });

  it('el punto de miles sigue funcionando cuando el primer grupo no es 0', () => {
    expect(pagoEntradaSchema.parse({ medio: 'debito', monto: '1.500' }).monto).toBe('1500.00');
  });
});
