import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { configurarAlNoAutenticado } from '../api/cliente.js';
import { rutas } from './rutas.js';
import { CLAVE_SESION } from './sesion.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

// Si la sesión vence a mitad del turno, cualquier 401 vuelve a la pantalla de ingreso.
configurarAlNoAutenticado(() => queryClient.setQueryData(CLAVE_SESION, null));

const router = createBrowserRouter(rutas);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
