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
 *
 * `despertar()` adelanta la próxima pasada: si no hay una corriendo, la corre
 * ya; si hay una, agenda una sola más para cuando termine.
 */
export function iniciarCiclo({ nombre, pasada, intervaloMs, log }: OpcionesCiclo): {
  detener: () => Promise<void>;
  despertar: () => void;
} {
  let detenido = false;
  let temporizador: NodeJS.Timeout | undefined;
  let enCurso: Promise<void> = Promise.resolve();
  let corriendo = false;
  let otraAlTerminar = false;

  const vuelta = () => {
    corriendo = true;
    enCurso = Promise.resolve()
      .then(pasada)
      .then(
        () => undefined,
        (error: unknown) => log.error({ err: error }, `Falló la tarea ${nombre}`),
      )
      .finally(() => {
        corriendo = false;
        if (detenido) return;
        const espera = otraAlTerminar ? 0 : intervaloMs;
        otraAlTerminar = false;
        temporizador = setTimeout(vuelta, espera);
      });
  };
  temporizador = setTimeout(vuelta, 0);

  return {
    async detener() {
      detenido = true;
      clearTimeout(temporizador);
      await enCurso;
    },
    despertar() {
      if (detenido) return;
      if (corriendo) {
        otraAlTerminar = true;
        return;
      }
      clearTimeout(temporizador);
      temporizador = setTimeout(vuelta, 0);
    },
  };
}
