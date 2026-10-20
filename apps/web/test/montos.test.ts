import { describe, expect, it } from 'vitest';
import { entradaAMonto, formatearPesos, montoParaEditar } from '../src/lib/montos.js';

/** Intl usa espacios duros entre el signo y el número. */
const sinEspaciosDuros = (texto: string) => texto.replace(/\s/g, ' ');

describe('formatearPesos', () => {
  it.each([
    ['1000.00', '$ 1.000,00'],
    ['905.50', '$ 905,50'],
    ['0.99', '$ 0,99'],
    ['1234567.80', '$ 1.234.567,80'],
  ])('%s → %s', (monto, esperado) => {
    expect(sinEspaciosDuros(formatearPesos(monto))).toBe(esperado);
  });
});

describe('montoParaEditar', () => {
  it('usa coma decimal y deja vacío lo que no tiene valor', () => {
    expect(montoParaEditar('905.50')).toBe('905,50');
    expect(montoParaEditar(null)).toBe('');
  });
});

describe('entradaAMonto', () => {
  it.each([
    ['905', '905.00'],
    ['905,5', '905.50'],
    ['1.000', '1000.00'],
    ['1.000,50', '1000.50'],
    [' 1500 ', '1500.00'],
  ])('%j → %j', (texto, esperado) => {
    expect(entradaAMonto(texto)).toBe(esperado);
  });

  it.each(['', 'mil', '10,555'])('rechaza %j', (texto) => {
    expect(entradaAMonto(texto)).toBeNull();
  });
});
