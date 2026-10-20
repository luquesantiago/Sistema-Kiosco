import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { configurarAlNoAutenticado } from '../src/api/cliente.js';
import { rutas } from '../src/app/rutas.js';
import { CLAVE_SESION } from '../src/app/sesion.js';

type Respuesta = [status: number, cuerpo?: unknown];
type Manejador = (cuerpo: unknown) => Respuesta;

/** Simula la API: claves como `GET /auth/sesion`. Devuelve el mock de fetch. */
export function simularApi(manejadores: Record<string, Manejador | Respuesta>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const clave = `${init?.method ?? 'GET'} ${url.replace(/^\/api/, '')}`;
    const manejador = manejadores[clave];
    if (!manejador) throw new Error(`Pedido no simulado: ${clave}`);
    const cuerpo = init?.body ? JSON.parse(init.body as string) : undefined;
    const [status, datos] = typeof manejador === 'function' ? manejador(cuerpo) : manejador;
    return new Response(datos === undefined ? null : JSON.stringify(datos), { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const ADMIN = {
  id: '0198a5b0-0000-7000-8000-000000000001',
  nombre: 'Ana Admin',
  usuario: 'ana',
  rol: 'admin',
} as const;
export const EMPLEADO = {
  id: '0198a5b0-0000-7000-8000-000000000002',
  nombre: 'Juan Empleado',
  usuario: 'juan',
  rol: 'empleado',
} as const;

export const SIN_SESION: Respuesta = [
  401,
  { error: { codigo: 'NO_AUTENTICADO', mensaje: 'Tu sesión venció. Ingresá de nuevo.' } },
];

/** Renderiza la app completa en la ruta indicada. */
export function renderApp(ruta: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  configurarAlNoAutenticado(() => queryClient.setQueryData(CLAVE_SESION, null));
  const router = createMemoryRouter(rutas, { initialEntries: [ruta] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}
