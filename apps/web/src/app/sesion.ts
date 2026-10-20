import type { Ingreso, UsuarioSesion } from '@kiosco/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorDeApi, pedir } from '../api/cliente.js';

export const CLAVE_SESION = ['sesion'] as const;

async function obtenerSesion(): Promise<UsuarioSesion | null> {
  try {
    return await pedir<UsuarioSesion>('GET', '/auth/sesion');
  } catch (error) {
    if (error instanceof ErrorDeApi && error.status === 401) return null;
    throw error;
  }
}

/** Usuario de la sesión actual: undefined mientras carga, null si no hay sesión. */
export function useSesion() {
  // Se vuelve a consultar al volver a la ventana (como mucho una vez por minuto),
  // para notar pronto una sesión vencida o un usuario desactivado.
  return useQuery({
    queryKey: CLAVE_SESION,
    queryFn: obtenerSesion,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useIngresar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (datos: Ingreso) => pedir<UsuarioSesion>('POST', '/auth/ingresar', datos),
    onSuccess: (usuario) => {
      queryClient.clear();
      queryClient.setQueryData(CLAVE_SESION, usuario);
    },
  });
}

export function useSalir() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => pedir<void>('POST', '/auth/salir'),
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(CLAVE_SESION, null);
    },
  });
}
