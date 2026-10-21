import { describe, expect, it } from 'vitest';
import { esperarBase } from '../src/lib/esperar-base.js';

describe('esperarBase', () => {
  it('sigue intentando hasta que la base responde', async () => {
    let llamadas = 0;
    const verificar = async () => {
      llamadas++;
      if (llamadas < 3) throw new Error('the database system is starting up');
    };

    expect(await esperarBase(verificar, { intentos: 5, pausaMs: 1 })).toBe(true);
    expect(llamadas).toBe(3);
  });

  it('devuelve false si la base no responde en ningún intento', async () => {
    let llamadas = 0;
    const verificar = async () => {
      llamadas++;
      throw new Error('connection refused');
    };

    expect(await esperarBase(verificar, { intentos: 4, pausaMs: 1 })).toBe(false);
    expect(llamadas).toBe(4);
  });
});
