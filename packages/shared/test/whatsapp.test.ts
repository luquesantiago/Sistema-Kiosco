import { describe, expect, it } from 'vitest';
import { formatearNumero, normalizarNumeroArgentino } from '../src/whatsapp.js';

describe('normalizarNumeroArgentino', () => {
  it('acepta los formatos habituales y deja 10 dígitos', () => {
    for (const texto of [
      '+54 9 11 2345-6789',
      '11 2345-6789',
      '011 2345 6789',
      '5491123456789',
      '54 11 2345 6789',
      '(011) 2345-6789',
    ]) {
      expect(normalizarNumeroArgentino(texto), texto).toEqual({ ok: true, numero: '1123456789' });
    }
  });

  it('acepta códigos de área de 3 y 4 dígitos', () => {
    expect(normalizarNumeroArgentino('0351 234-5678')).toEqual({ ok: true, numero: '3512345678' });
    expect(normalizarNumeroArgentino('2966 12-3456')).toEqual({ ok: true, numero: '2966123456' });
  });

  it('rechaza el número con 15 con un motivo propio', () => {
    expect(normalizarNumeroArgentino('11 15 2345-6789')).toEqual({ ok: false, motivo: 'con_15' });
    expect(normalizarNumeroArgentino('0351 15 234-5678')).toEqual({ ok: false, motivo: 'con_15' });
  });

  it('rechaza largos inválidos', () => {
    expect(normalizarNumeroArgentino('2345-6789')).toEqual({ ok: false, motivo: 'invalido' });
    expect(normalizarNumeroArgentino('11 2345-67890')).toEqual({ ok: false, motivo: 'invalido' });
    expect(normalizarNumeroArgentino('sin número')).toEqual({ ok: false, motivo: 'invalido' });
  });
});

describe('formatearNumero', () => {
  it('separa el área solo para el 11', () => {
    expect(formatearNumero('1123456789')).toBe('11 2345-6789');
    expect(formatearNumero('3512345678')).toBe('351234-5678');
  });
});
