import type { FastifyBaseLogger } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iniciarCiclo } from '../src/jobs/ciclo.js';

/*
 * `despertar()` de `iniciarCiclo` (cambio facturacion-arca, tarea 5.2). Va en
 * un archivo propio para no tocar `ciclo.test.ts`, que sigue cubriendo el resto.
 */

const INTERVALO = 10_000;
const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as FastifyBaseLogger;

let ciclo: ReturnType<typeof iniciarCiclo> | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  if (ciclo) {
    const detenido = ciclo.detener();
    await vi.runAllTimersAsync();
    await detenido;
  }
  ciclo = undefined;
  vi.useRealTimers();
});

describe('despertar', () => {
  it('entre pasadas, adelanta la próxima sin esperar el intervalo', async () => {
    const pasada = vi.fn(async () => {});
    ciclo = iniciarCiclo({ nombre: 'prueba', pasada, intervaloMs: INTERVALO, log });
    await vi.advanceTimersByTimeAsync(0);
    expect(pasada).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    ciclo.despertar();
    await vi.advanceTimersByTimeAsync(0);

    expect(pasada).toHaveBeenCalledTimes(2);
    // Y el intervalo vuelve a contar desde esa pasada.
    await vi.advanceTimersByTimeAsync(INTERVALO - 1);
    expect(pasada).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(pasada).toHaveBeenCalledTimes(3);
  });

  it('durante una pasada, varios despertar() agendan una sola más al terminar, sin superponerse', async () => {
    const estado = { llamadas: 0, enCurso: 0, maximo: 0 };
    const pasada = async () => {
      estado.llamadas++;
      estado.enCurso++;
      estado.maximo = Math.max(estado.maximo, estado.enCurso);
      await new Promise((listo) => setTimeout(listo, 500));
      estado.enCurso--;
    };
    ciclo = iniciarCiclo({ nombre: 'prueba', pasada, intervaloMs: INTERVALO, log });
    await vi.advanceTimersByTimeAsync(100);
    expect(estado.llamadas).toBe(1);

    ciclo.despertar();
    ciclo.despertar();
    ciclo.despertar();
    // La primera termina a los 500 ms y la siguiente arranca enseguida, no a los 10 s.
    await vi.advanceTimersByTimeAsync(450);
    expect(estado.llamadas).toBe(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(estado.llamadas).toBe(2);
    expect(estado.maximo).toBe(1);
  });

  // Bordes agregados en la revisión.
  it('despertar() 1 ms antes del intervalo: corre una pasada y la que estaba agendada no se suma', async () => {
    const pasada = vi.fn(async () => {});
    ciclo = iniciarCiclo({ nombre: 'prueba', pasada, intervaloMs: INTERVALO, log });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(INTERVALO - 1);
    ciclo.despertar();
    await vi.advanceTimersByTimeAsync(0);
    expect(pasada).toHaveBeenCalledTimes(2);

    // Donde estaba la pasada original (1 ms después) ya no hay ninguna.
    await vi.advanceTimersByTimeAsync(1);
    expect(pasada).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(INTERVALO - 1);
    expect(pasada).toHaveBeenCalledTimes(3);
  });

  it('dos despertar() seguidos entre pasadas corren una sola pasada', async () => {
    const pasada = vi.fn(async () => {});
    ciclo = iniciarCiclo({ nombre: 'prueba', pasada, intervaloMs: INTERVALO, log });
    await vi.advanceTimersByTimeAsync(0);

    ciclo.despertar();
    ciclo.despertar();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVALO - 1);

    expect(pasada).toHaveBeenCalledTimes(2);
  });

  it('despertar() durante una pasada que falla: la que se agenda corre igual y el error va al log', async () => {
    const error = vi.fn();
    const conLog = { error, warn: vi.fn(), info: vi.fn() } as unknown as FastifyBaseLogger;
    let llamadas = 0;
    const pasada = async () => {
      llamadas++;
      await new Promise((listo) => setTimeout(listo, 500));
      if (llamadas === 1) throw new Error('falló');
    };
    ciclo = iniciarCiclo({ nombre: 'prueba', pasada, intervaloMs: INTERVALO, log: conLog });
    await vi.advanceTimersByTimeAsync(100);

    ciclo.despertar();
    await vi.advanceTimersByTimeAsync(450);

    expect(llamadas).toBe(2);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('después de detener() no hace nada', async () => {
    const pasada = vi.fn(async () => {});
    const c = iniciarCiclo({ nombre: 'prueba', pasada, intervaloMs: INTERVALO, log });
    await vi.advanceTimersByTimeAsync(0);
    await c.detener();

    c.despertar();
    await vi.advanceTimersByTimeAsync(10 * INTERVALO);

    expect(pasada).toHaveBeenCalledTimes(1);
  });
});
