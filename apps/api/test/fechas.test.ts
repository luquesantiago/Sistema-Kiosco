import { describe, expect, it } from 'vitest';
import { diaDeHoyEnArgentina } from '../src/lib/fechas.js';

describe('diaDeHoyEnArgentina', () => {
  it('el miércoles 22:00 de Argentina (jueves 01:00 UTC) es miércoles', () => {
    expect(diaDeHoyEnArgentina(new Date('2026-10-22T01:00:00Z'))).toBe('miercoles');
  });

  it('el jueves 00:00 de Argentina ya es jueves', () => {
    expect(diaDeHoyEnArgentina(new Date('2026-10-22T03:00:00Z'))).toBe('jueves');
  });

  it('recorre los siete días', () => {
    const dias = Array.from({ length: 7 }, (_, i) =>
      diaDeHoyEnArgentina(new Date(Date.UTC(2026, 9, 19 + i, 15))),
    );
    expect(dias).toEqual([
      'lunes',
      'martes',
      'miercoles',
      'jueves',
      'viernes',
      'sabado',
      'domingo',
    ]);
  });
});
