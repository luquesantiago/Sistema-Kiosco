import { describe, expect, it } from 'vitest';
import { sumarDias } from '../src/lib/fechas.js';

/*
 * `sumarDias(fecha, n)` para el plazo de facturación (cambio facturacion-arca,
 * tarea 2.4). Va en un archivo propio para no tocar `fechas.test.ts`.
 */
describe('sumarDias', () => {
  it.each([
    ['2026-11-10', -5, '2026-11-05'],
    ['2026-11-01', -5, '2026-10-27'],
    ['2026-01-02', -5, '2025-12-28'],
    ['2025-12-30', 3, '2026-01-02'],
    ['2028-03-01', -1, '2028-02-29'],
    ['2026-11-10', 0, '2026-11-10'],
    // Bordes agregados en la revisión: febrero de año no bisiesto, fin de mes de 31 y
    // de 30 días, el año completo y que el resultado no dependa de la hora del proceso.
    ['2027-03-01', -1, '2027-02-28'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2027-02-28', 1, '2027-03-01'],
    ['2026-03-05', -5, '2026-02-28'],
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-11-30', 1, '2026-12-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2026-11-10', 365, '2027-11-10'],
    ['2028-11-10', -366, '2027-11-10'],
  ])('%s %s días → %s', (fecha, n, esperada) => {
    expect(sumarDias(fecha, n)).toBe(esperada);
  });

  it('el plazo de 5 días hacia atrás desde cualquier día de un mes cae en el día correcto', () => {
    // Cuenta propia del test, día por día, para todo noviembre de 2026.
    for (let dia = 1; dia <= 30; dia++) {
      const fecha = `2026-11-${String(dia).padStart(2, '0')}`;
      const esperada =
        dia > 5 ? `2026-11-${String(dia - 5).padStart(2, '0')}` : `2026-10-${26 + dia}`;
      expect(sumarDias(fecha, -5), fecha).toBe(esperada);
    }
  });
});
