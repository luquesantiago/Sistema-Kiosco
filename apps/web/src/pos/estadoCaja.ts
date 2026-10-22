import { CODIGOS_ERROR, type EstadoCaja } from '@kiosco/shared';
import { useQuery } from '@tanstack/react-query';
import { ErrorDeApi, pedir } from '../api/cliente.js';

export const CLAVE_ESTADO_CAJA = ['caja', 'estado'] as const;

/** Si hay un turno abierto, de quién es y cuánto sugerir al abrir. */
export function useEstadoCaja() {
  return useQuery({
    queryKey: CLAVE_ESTADO_CAJA,
    queryFn: () => pedir<EstadoCaja>('GET', '/caja/estado'),
  });
}

/** El servidor rechazó la operación porque cambió el turno (se cerró o es de otro). */
export function esErrorDeTurno(error: unknown): boolean {
  return (
    error instanceof ErrorDeApi &&
    (error.codigo === CODIGOS_ERROR.sinTurnoAbierto || error.codigo === CODIGOS_ERROR.turnoDeOtro)
  );
}
