import type { FastifyBaseLogger } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iniciarCiclo } from '../src/jobs/ciclo.js';

/*
 * `iniciarCiclo({ nombre, pasada, intervaloMs, log })` → `{ detener(): Promise<void> }`.
 * Con timers falsos de Vitest: nada espera de verdad. El intervalo se cuenta
 * desde que termina una pasada (setTimeout encadenado), como `iniciarEnvio`.
 */

const INTERVALO = 60_000;

function logFalso() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as FastifyBaseLogger & {
    error: ReturnType<typeof vi.fn>;
  };
}

/** Pasada que tarda `ms` (en el reloj falso) y cuenta cuántas corren a la vez. */
function pasadaLenta(ms: number) {
  const estado = { llamadas: 0, enCurso: 0, maximo: 0 };
  const pasada = async () => {
    estado.llamadas++;
    estado.enCurso++;
    estado.maximo = Math.max(estado.maximo, estado.enCurso);
    await new Promise((listo) => setTimeout(listo, ms));
    estado.enCurso--;
  };
  return { estado, pasada };
}

let ciclo: { detener: () => Promise<void> } | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  // Detener con los timers falsos activos: si quedara una pasada lenta en curso, se la deja terminar.
  if (ciclo) {
    const detenido = ciclo.detener();
    await vi.runAllTimersAsync();
    await detenido;
  }
  ciclo = undefined;
  vi.useRealTimers();
});

describe('iniciarCiclo', () => {
  it('la primera pasada corre al arrancar, sin esperar el intervalo', async () => {
    const pasada = vi.fn(async () => {});

    ciclo = iniciarCiclo({ nombre: 'prueba', pasada, intervaloMs: INTERVALO, log: logFalso() });
    await vi.advanceTimersByTimeAsync(0);

    expect(pasada).toHaveBeenCalledTimes(1);
  });

  it('la segunda pasada corre al cumplirse el intervalo, ni un milisegundo antes', async () => {
    const pasada = vi.fn(async () => {});
    ciclo = iniciarCiclo({ nombre: 'prueba', pasada, intervaloMs: INTERVALO, log: logFalso() });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(INTERVALO - 1);
    expect(pasada).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(pasada).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(INTERVALO);
    expect(pasada).toHaveBeenCalledTimes(3);
  });

  it('dos pasadas nunca se superponen, aunque una tarde más que el intervalo', async () => {
    // Cada pasada tarda 250 ms y el intervalo es de 100 ms.
    const { estado, pasada } = pasadaLenta(250);

    ciclo = iniciarCiclo({ nombre: 'prueba', pasada, intervaloMs: 100, log: logFalso() });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(estado.maximo).toBe(1);
    // Arranca en 0, 350, 700, 1050, 1400, 1750: el intervalo cuenta desde que termina la anterior.
    expect(estado.llamadas).toBe(6);
  });

  it('un error en una pasada va al log y no corta el ciclo', async () => {
    const log = logFalso();
    const pasada = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('se cayó la base'))
      .mockResolvedValue(undefined);

    ciclo = iniciarCiclo({ nombre: 'prueba', pasada, intervaloMs: INTERVALO, log });
    await vi.advanceTimersByTimeAsync(0);

    expect(log.error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVALO);
    expect(pasada).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('detener() espera la pasada en curso y después no corre ninguna más', async () => {
    let terminar!: () => void;
    let terminada = false;
    const pasada = vi.fn(
      () =>
        new Promise<void>((listo) => {
          terminar = () => {
            terminada = true;
            listo();
          };
        }),
    );
    const c = iniciarCiclo({ nombre: 'prueba', pasada, intervaloMs: INTERVALO, log: logFalso() });
    await vi.advanceTimersByTimeAsync(0);
    expect(pasada).toHaveBeenCalledTimes(1);

    let detenido = false;
    const deteniendo = c.detener().then(() => {
      detenido = true;
    });
    await vi.advanceTimersByTimeAsync(10 * INTERVALO);
    expect(detenido).toBe(false);

    terminar();
    await deteniendo;
    expect(terminada).toBe(true);
    expect(detenido).toBe(true);

    await vi.advanceTimersByTimeAsync(10 * INTERVALO);
    expect(pasada).toHaveBeenCalledTimes(1);
  });

  it('detenido entre pasadas, no corre la siguiente', async () => {
    const pasada = vi.fn(async () => {});
    const c = iniciarCiclo({ nombre: 'prueba', pasada, intervaloMs: INTERVALO, log: logFalso() });
    await vi.advanceTimersByTimeAsync(0);

    await c.detener();
    await vi.advanceTimersByTimeAsync(10 * INTERVALO);

    expect(pasada).toHaveBeenCalledTimes(1);
  });
});
