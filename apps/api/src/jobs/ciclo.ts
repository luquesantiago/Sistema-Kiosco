import type { FastifyBaseLogger } from 'fastify';

export interface OpcionesCiclo {
  /** Para el log: qué tarea falló. */
  nombre: string;
  pasada: () => Promise<unknown>;
  intervaloMs: number;
  log: FastifyBaseLogger;
}

/**
 * Corre `pasada` al arrancar y después cada `intervaloMs`, contados desde que
 * termina la anterior: con `setTimeout` encadenado nunca hay dos pasadas a la
 * vez. Un error va al log y no corta el ciclo. `detener()` espera la pasada en curso.
 */
export function iniciarCiclo({ nombre, pasada, intervaloMs, log }: OpcionesCiclo): {
  detener: () => Promise<void>;
} {
  let detenido = false;
  let temporizador: NodeJS.Timeout | undefined;
  let enCurso: Promise<void> = Promise.resolve();

  const vuelta = () => {
    enCurso = Promise.resolve()
      .then(pasada)
      .then(
        () => undefined,
        (error: unknown) => log.error({ err: error }, `Falló la tarea ${nombre}`),
      )
      .finally(() => {
        if (!detenido) temporizador = setTimeout(vuelta, intervaloMs);
      });
  };
  temporizador = setTimeout(vuelta, 0);

  return {
    async detener() {
      detenido = true;
      clearTimeout(temporizador);
      await enCurso;
    },
  };
}
