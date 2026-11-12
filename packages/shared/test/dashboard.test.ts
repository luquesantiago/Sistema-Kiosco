import { describe, expect, it } from 'vitest';
import { periodoAnterior, rangoDelPeriodo, variacion } from '../src/dashboard.js';

// 2026-10-22 es jueves.
const JUEVES = '2026-10-22';

describe('rangoDelPeriodo', () => {
  it.each([
    ['hoy', { desde: JUEVES, hasta: JUEVES }],
    ['ayer', { desde: '2026-10-21', hasta: '2026-10-21' }],
    ['semana', { desde: '2026-10-19', hasta: JUEVES }],
    ['mes', { desde: '2026-10-01', hasta: JUEVES }],
    ['mes_anterior', { desde: '2026-09-01', hasta: '2026-09-30' }],
  ] as const)('%s', (periodo, rango) => {
    expect(rangoDelPeriodo(periodo, JUEVES)).toEqual(rango);
  });

  it('la semana de un domingo empieza el lunes anterior; en enero, el mes anterior es diciembre', () => {
    expect(rangoDelPeriodo('semana', '2026-10-25')).toEqual({
      desde: '2026-10-19',
      hasta: '2026-10-25',
    });
    expect(rangoDelPeriodo('mes_anterior', '2027-01-10')).toEqual({
      desde: '2026-12-01',
      hasta: '2026-12-31',
    });
  });
});

describe('periodoAnterior', () => {
  it.each([
    ['un día: el día antes', JUEVES, JUEVES, '2026-10-21', '2026-10-21'],
    ['un rango: el mismo largo justo antes', '2026-10-19', JUEVES, '2026-10-15', '2026-10-18'],
    ['mes empezado: los mismos días', '2026-10-01', JUEVES, '2026-09-01', '2026-09-22'],
    ['recortado al último día', '2028-03-01', '2028-03-30', '2028-02-01', '2028-02-29'],
    ['mes completo: el anterior completo', '2026-09-01', '2026-09-30', '2026-08-01', '2026-08-31'],
    [
      'marzo completo contra febrero bisiesto',
      '2028-03-01',
      '2028-03-31',
      '2028-02-01',
      '2028-02-29',
    ],
  ])('%s', (_caso, desde, hasta, desdeAnt, hastaAnt) => {
    expect(periodoAnterior({ desde, hasta })).toEqual({ desde: desdeAnt, hasta: hastaAnt });
  });
});

describe('variacion', () => {
  it('redondea el porcentaje y no compara contra cero', () => {
    expect(variacion('108000.00', '100000.00')).toBe(8);
    expect(variacion('90000.00', '100000.00')).toBe(-10);
    expect(variacion('100.00', '0.00')).toBeNull();
  });
});
