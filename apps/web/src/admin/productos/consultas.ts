import type { CambioPrecio, ProductoAdmin } from '@kiosco/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pedir } from '../../api/cliente.js';
import { CLAVE_PROVEEDORES } from '../Proveedores.js';

export const CLAVE_PRODUCTOS = ['productos'] as const;

export function useBusquedaProductos(
  q: string,
  pagina: number,
  incluirInactivos: boolean,
  sinCosto = false,
) {
  const params = new URLSearchParams({ q, pagina: String(pagina) });
  if (incluirInactivos) params.set('incluirInactivos', 'true');
  if (sinCosto) params.set('sinCosto', 'true');
  return useQuery({
    queryKey: [...CLAVE_PRODUCTOS, 'busqueda', { q, pagina, incluirInactivos, sinCosto }],
    // El admin siempre recibe la ficha completa.
    queryFn: () => pedir<ProductoAdmin[]>('GET', `/productos?${params}`),
  });
}

export function useProducto(id: string) {
  return useQuery({
    queryKey: [...CLAVE_PRODUCTOS, id],
    queryFn: () => pedir<ProductoAdmin>('GET', `/productos/${id}`),
  });
}

export function useHistorialPrecios(id: string) {
  return useQuery({
    queryKey: [...CLAVE_PRODUCTOS, id, 'historial'],
    queryFn: () => pedir<CambioPrecio[]>('GET', `/productos/${id}/historial-precios`),
  });
}

/** Cambio en el catálogo: invalida productos y proveedores (que cuentan productos activos). */
export function useCambioDeProductos<T, R>(accion: (datos: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: accion,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CLAVE_PRODUCTOS });
      await queryClient.invalidateQueries({ queryKey: CLAVE_PROVEEDORES });
    },
  });
}
