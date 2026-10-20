import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, EMPLEADO, renderApp, simularApi, SIN_SESION } from './ayudas.js';

describe('layout y menú por rol', () => {
  it('el empleado no ve el menú de usuarios y no puede entrar a /admin', async () => {
    simularApi({ 'GET /auth/sesion': [200, EMPLEADO] });
    const { router } = renderApp('/admin/usuarios');

    await waitFor(() => expect(router.state.location.pathname).toBe('/venta'));
    const menu = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(menu).queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'Venta' })).toBeInTheDocument();
    expect(within(menu).getByText('Juan Empleado')).toBeInTheDocument();
  });

  it('el admin ve Usuarios y entra al panel de administración', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /health': [200, { estado: 'ok', baseDeDatos: 'ok', hora: new Date().toISOString() }],
    });
    const { router } = renderApp('/');

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    const menu = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(menu).getByRole('link', { name: 'Usuarios' })).toBeInTheDocument();
    expect(await screen.findByText('Base de datos ok')).toBeInTheDocument();
  });

  it('Salir cierra la sesión y vuelve al ingreso', async () => {
    const fetchMock = simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'POST /auth/salir': [204],
    });
    const { router } = renderApp('/venta');

    await userEvent.click(await screen.findByRole('button', { name: 'Salir' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/ingresar'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/salir', expect.anything());
  });

  it('si la sesión vence mientras se usa, vuelve al ingreso', async () => {
    // La sesión era válida al cargar, pero el siguiente pedido ya recibe 401.
    simularApi({ 'GET /auth/sesion': [200, ADMIN], 'GET /usuarios': SIN_SESION });
    const { router } = renderApp('/admin/usuarios');

    await waitFor(() => expect(router.state.location.pathname).toBe('/ingresar'));
    expect(await screen.findByLabelText('Usuario')).toBeInTheDocument();
  });
});
