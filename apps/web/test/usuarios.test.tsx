import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, renderApp, simularApi } from './ayudas.js';

const LISTA = [
  { ...ADMIN, activo: true, ultimoIngreso: '2026-10-20T15:00:00.000Z' },
  {
    id: '0198a5b0-0000-7000-8000-000000000002',
    nombre: 'Juan Empleado',
    usuario: 'juan',
    rol: 'empleado',
    activo: false,
    ultimoIngreso: null,
  },
];

function tabla() {
  return screen.findByRole('table');
}

describe('pantalla de usuarios', () => {
  it('lista los usuarios con rol, estado y último ingreso', async () => {
    simularApi({ 'GET /auth/sesion': [200, ADMIN], 'GET /usuarios': [200, LISTA] });
    renderApp('/admin/usuarios');

    const t = await tabla();
    expect(await within(t).findByText('Juan Empleado')).toBeInTheDocument();
    expect(within(t).getByText('Desactivado')).toBeInTheDocument();
    expect(within(t).getByText('Nunca')).toBeInTheDocument();
    // El admin no puede desactivarse a sí mismo desde la pantalla.
    const filaAna = within(t).getByText('Ana Admin').closest('tr')!;
    expect(within(filaAna).queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
  });

  it('crea un usuario y vuelve a pedir la lista', async () => {
    let creado: unknown;
    let pedidosLista = 0;
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /usuarios': () => {
        pedidosLista++;
        return [200, LISTA];
      },
      'POST /usuarios': (cuerpo) => {
        creado = cuerpo;
        return [201, { ...LISTA[1], activo: true }];
      },
    });
    renderApp('/admin/usuarios');

    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo usuario' }));
    const form = screen.getByRole('form', { name: 'Nuevo usuario' });
    await userEvent.type(within(form).getByLabelText('Nombre'), 'María');
    await userEvent.type(within(form).getByLabelText('Usuario'), 'Maria');
    await userEvent.type(within(form).getByLabelText('Contraseña inicial'), '12345678');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear usuario' }));

    expect(await screen.findByRole('button', { name: 'Nuevo usuario' })).toBeInTheDocument();
    expect(creado).toEqual({
      nombre: 'María',
      usuario: 'maria',
      rol: 'empleado',
      contrasena: '12345678',
    });
    expect(pedidosLista).toBe(2);
  });

  it('muestra el error de usuario repetido', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /usuarios': [200, LISTA],
      'POST /usuarios': [
        409,
        { error: { codigo: 'USUARIO_EXISTENTE', mensaje: 'El usuario juan ya existe.' } },
      ],
    });
    renderApp('/admin/usuarios');

    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo usuario' }));
    const form = screen.getByRole('form', { name: 'Nuevo usuario' });
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Juan');
    await userEvent.type(within(form).getByLabelText('Usuario'), 'juan');
    await userEvent.type(within(form).getByLabelText('Contraseña inicial'), '12345678');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear usuario' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent('El usuario juan ya existe.');
  });

  it('valida la contraseña corta antes de llamar a la API', async () => {
    simularApi({ 'GET /auth/sesion': [200, ADMIN], 'GET /usuarios': [200, LISTA] });
    renderApp('/admin/usuarios');

    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo usuario' }));
    const form = screen.getByRole('form', { name: 'Nuevo usuario' });
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Juan');
    await userEvent.type(within(form).getByLabelText('Usuario'), 'juan2');
    await userEvent.type(within(form).getByLabelText('Contraseña inicial'), 'corta');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear usuario' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent('al menos 8 caracteres');
  });

  it('muestra el error de último admin al cambiar el rol', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /usuarios': [200, LISTA],
      [`PATCH /usuarios/${ADMIN.id}`]: [
        409,
        {
          error: { codigo: 'ULTIMO_ADMIN', mensaje: 'Tiene que quedar al menos un admin activo.' },
        },
      ],
    });
    renderApp('/admin/usuarios');

    const filaAna = (await within(await tabla()).findByText('Ana Admin')).closest('tr')!;
    await userEvent.click(within(filaAna).getByRole('button', { name: 'Editar' }));
    await userEvent.selectOptions(within(filaAna).getByLabelText('Rol'), 'empleado');
    await userEvent.click(within(filaAna).getByRole('button', { name: 'Guardar' }));

    expect(await within(filaAna).findByRole('alert')).toHaveTextContent(
      'Tiene que quedar al menos un admin activo.',
    );
  });
});
