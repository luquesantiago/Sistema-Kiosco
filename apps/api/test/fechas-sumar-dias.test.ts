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
  ])('%s %s días → %s', (fecha, n, esperada) => {
    expect(sumarDias(fecha, n)).toBe(esperada);
  });
});
