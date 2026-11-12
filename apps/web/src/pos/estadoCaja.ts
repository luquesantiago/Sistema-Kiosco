import { CODIGOS_ERROR, type EstadoCaja } from '@kiosco/shared';
import { useQuery } from '@tanstack/react-query';
import { ErrorDeApi, pedir } from '../api/cliente.js';

export const CLAVE_ESTADO_CAJA = ['caja', 'estado'] as const;

/** Con el Point, la pantalla de venta pide el estado cada 5 s (devoluciones pendientes). */
const SONDEO_ESTADO_MS = 5_000;

/**
 * Si hay un turno abierto, de quién es y cuánto sugerir al abrir. Con `sondear` y el
 * Point configurado, se vuelve a pedir cada 5 s mientras haya un turno abierto.
 */
export function useEstadoCaja({ sondear = false }: { sondear?: boolean } = {}) {
  return useQuery({
    queryKey: CLAVE_ESTADO_CAJA,
    queryFn: () => pedir<EstadoCaja>('GET', '/caja/estado'),
    refetchInterval: (query) =>
      sondear && query.state.data?.pointHabilitado && query.state.data.turnoAbierto
        ? SONDEO_ESTADO_MS
        : false,
  });
}

/** El servidor rechazó la operación porque cambió el turno (se cerró o es de otro). */
export function esErrorDeTurno(error: unknown): boolean {
  return (
    error instanceof ErrorDeApi &&
    (error.codigo === CODIGOS_ERROR.sinTurnoAbierto || error.codigo === CODIGOS_ERROR.turnoDeOtro)
  );
}
