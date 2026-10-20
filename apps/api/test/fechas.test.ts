import { describe, expect, it } from 'vitest';
import {
  diaDeHoyEnArgentina,
  fechaEnArgentina,
  rangoDelDiaEnArgentina,
} from '../src/lib/fechas.js';

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

describe('rangoDelDiaEnArgentina', () => {
  it('el 20/10 en Argentina va de las 03:00 UTC del 20 a las 03:00 UTC del 21', () => {
    expect(rangoDelDiaEnArgentina('2026-10-20')).toEqual({
      desde: new Date('2026-10-20T03:00:00Z'),
      hasta: new Date('2026-10-21T03:00:00Z'),
    });
  });

  it('cruza fin de mes y de año', () => {
    expect(rangoDelDiaEnArgentina('2026-12-31').hasta).toEqual(new Date('2027-01-01T03:00:00Z'));
  });
});

describe('fechaEnArgentina', () => {
  it('a las 23:30 del 20/10 en Argentina (02:30 UTC del 21) sigue siendo el 20', () => {
    expect(fechaEnArgentina(new Date('2026-10-21T02:30:00Z'))).toBe('2026-10-20');
    expect(fechaEnArgentina(new Date('2026-10-21T03:00:00Z'))).toBe('2026-10-21');
  });
});
