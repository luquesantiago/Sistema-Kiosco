import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Inicio } from './Inicio.js';

const queryClient = new QueryClient();

const router = createBrowserRouter([{ path: '/', element: <Inicio /> }]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
