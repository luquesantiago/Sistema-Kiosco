import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { configurarAlNoAutenticado } from '../src/api/cliente.js';
import { rutas } from '../src/app/rutas.js';
import { hoyEnArgentina } from '../src/lib/fechas.js';
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
  const { unmount } = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, desmontar: unmount };
}

/** Dashboard de hoy sin movimientos, para las pantallas que abren el panel de admin. */
export function dashboardVacio(): Record<string, Respuesta> {
  const hoy = hoyEnArgentina();
  const cero = '0.00';
  const rango = { desde: hoy, hasta: hoy };
  return {
    [`GET /dashboard?desde=${hoy}&hasta=${hoy}`]: [
      200,
      {
        periodo: rango,
        anterior: rango,
        ahora: {
          efectivoEnCaja: cero,
          turnoAbierto: false,
          pendiente: {
            total: cero,
            porLlegar: { cantidad: 0, total: cero },
            deben: { cantidad: 0, total: cero },
          },
        },
        ventas: { total: cero, cantidad: 0, anterior: cero, variacion: null },
        ganancia: { total: cero, anterior: cero, variacion: null, margen: null },
        sinCosto: cero,
        gastos: { total: cero, porCategoria: { servicios: cero, insumos: cero, otro: cero } },
        resultado: cero,
        serie: { agrupacion: 'hora', puntos: [] },
        medios: { efectivo: cero, debito: cero, credito: cero, mercado_pago: cero },
        masVendidos: { unidades: [], importe: [], ganancia: [] },
        movimientos: {
          pagosProveedor: { total: cero, efectivo: cero, mercadoPago: cero },
          retiros: cero,
          ingresos: cero,
          diferencias: { total: cero, turnos: 0 },
          anuladas: { cantidad: 0, total: cero },
        },
      },
    ],
  };
}
