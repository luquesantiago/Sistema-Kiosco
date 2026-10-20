import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EstadoSistema } from '../src/admin/EstadoSistema.js';

function simularHealth(status: number, cuerpo: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(cuerpo), { status })),
  );
}

function renderEstado() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EstadoSistema />
    </QueryClientProvider>,
  );
}

describe('EstadoSistema', () => {
  it('muestra API y base ok', async () => {
    simularHealth(200, { estado: 'ok', baseDeDatos: 'ok', hora: new Date().toISOString() });
    renderEstado();

    expect(await screen.findByText('API ok')).toBeInTheDocument();
    expect(screen.getByText('Base de datos ok')).toBeInTheDocument();
  });

  it('muestra la base con error cuando el estado es degradado', async () => {
    simularHealth(503, {
      estado: 'degradado',
      baseDeDatos: 'error',
      hora: new Date().toISOString(),
    });
    renderEstado();

    expect(await screen.findByText('Base de datos con error')).toBeInTheDocument();
  });

  it('avisa si no puede conectar con la API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Bad Gateway', { status: 502 })),
    );
    renderEstado();

    expect(await screen.findByText('No se pudo conectar con la API.')).toBeInTheDocument();
  });
});
