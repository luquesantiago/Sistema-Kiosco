import type { FastifyBaseLogger } from 'fastify';
import { type OpcionesEmision, procesarFacturas } from '../modules/facturacion/emision.js';
import type { EstadoArca } from '../modules/facturacion/tipos.js';
import { iniciarCiclo } from './ciclo.js';

/** Cada cuánto se revisa la cola de facturas; `despertar()` la adelanta al vender. */
export const INTERVALO_MS = 10_000;

/**
 * Emite las facturas pendientes por detrás de las ventas. Solo la arranca
 * `server.ts`, y solo con la configuración de ARCA: nunca corre en los tests
 * (que llaman a `procesarFacturas`). Guarda el estado de ARCA que vio la
 * última pasada, para `GET /api/facturacion`.
 */
export function iniciarEmisionFacturas(
  opciones: Omit<OpcionesEmision, 'log'> & { log: FastifyBaseLogger; intervaloMs?: number },
): { detener: () => Promise<void>; despertar: () => void; estado: () => EstadoArca } {
  const { intervaloMs = INTERVALO_MS, ...emision } = opciones;
  let ultimoEstado: EstadoArca = 'disponible';
  const ciclo = iniciarCiclo({
    nombre: 'emisión de facturas',
    pasada: async () => {
      ultimoEstado = await procesarFacturas(emision);
    },
    intervaloMs,
    log: emision.log,
  });
  return { ...ciclo, estado: () => ultimoEstado };
}
