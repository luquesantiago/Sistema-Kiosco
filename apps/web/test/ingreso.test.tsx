import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, EMPLEADO, renderApp, simularApi, SIN_SESION } from './ayudas.js';

describe('ingreso', () => {
  it('sin sesión redirige al ingreso y después vuelve a la ruta pedida', async () => {
    simularApi({
      'GET /auth/sesion': SIN_SESION,
      'POST /auth/ingresar': [200, ADMIN],
      'GET /usuarios': [200, []],
    });
    const { router } = renderApp('/admin/usuarios');

    const usuario = await screen.findByLabelText('Usuario');
    expect(router.state.location.pathname).toBe('/ingresar');
    expect(usuario).toHaveFocus();

    await userEvent.type(usuario, 'ana');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'clave-segura{Enter}');

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/usuarios'));
    expect(await screen.findByRole('heading', { name: 'Usuarios' })).toBeInTheDocument();
  });

  it('muestra el mensaje de error de la API si las credenciales son incorrectas', async () => {
    simularApi({
      'GET /auth/sesion': SIN_SESION,
      'POST /auth/ingresar': [
        401,
        {
          error: { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'Usuario o contraseña incorrectos.' },
        },
      ],
    });
    renderApp('/ingresar');

    await userEvent.type(await screen.findByLabelText('Usuario'), 'juan');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos.');
  });

  it('muestra el mensaje de bloqueo temporal', async () => {
    simularApi({
      'GET /auth/sesion': SIN_SESION,
      'POST /auth/ingresar': [
        429,
        { error: { codigo: 'INGRESO_BLOQUEADO', mensaje: 'Demasiados intentos fallidos.' } },
      ],
    });
    renderApp('/ingresar');

    await userEvent.type(await screen.findByLabelText('Usuario'), 'juan');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiados intentos fallidos.');
  });

  it('el empleado entra a la venta', async () => {
    simularApi({ 'GET /auth/sesion': SIN_SESION, 'POST /auth/ingresar': [200, EMPLEADO] });
    const { router } = renderApp('/ingresar');

    await userEvent.type(await screen.findByLabelText('Usuario'), 'juan');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'clave-segura{Enter}');

    await waitFor(() => expect(router.state.location.pathname).toBe('/venta'));
  });
});
