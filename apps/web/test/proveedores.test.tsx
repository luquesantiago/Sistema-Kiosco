import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, renderApp, simularApi } from './ayudas.js';

const SUR = {
  id: '0198a5b0-0000-7000-8000-000000000101',
  nombre: 'Distribuidora Sur',
  telefono: '11 5555-1234',
  notas: null,
  diasPedido: ['lunes', 'jueves'],
  diasEntrega: ['martes', 'viernes'],
  activo: true,
  tomaPedidoHoy: true,
  productosActivos: 12,
};
const NORTE = {
  ...SUR,
  id: '0198a5b0-0000-7000-8000-000000000102',
  nombre: 'Bebidas Norte',
  telefono: null,
  diasPedido: ['miercoles'],
  diasEntrega: [],
  tomaPedidoHoy: false,
  productosActivos: 0,
};

const LISTA_URL = 'GET /proveedores?incluirInactivos=true';

describe('pantalla de proveedores', () => {
  it('muestra el teléfono para llamar y marca a los que toman pedido hoy', async () => {
    simularApi({ 'GET /auth/sesion': [200, ADMIN], [LISTA_URL]: [200, [SUR, NORTE]] });
    renderApp('/admin/proveedores');

    const tabla = await screen.findByRole('table');
    const filaSur = (await within(tabla).findByText('Distribuidora Sur')).closest('tr')!;
    const filaNorte = within(tabla).getByText('Bebidas Norte').closest('tr')!;

    expect(within(filaSur).getByText('Toma pedido hoy')).toBeInTheDocument();
    expect(within(filaNorte).queryByText('Toma pedido hoy')).not.toBeInTheDocument();
    expect(within(filaSur).getByRole('link', { name: '11 5555-1234' })).toHaveAttribute(
      'href',
      'tel:1155551234',
    );
    expect(within(filaSur).getByText('Lun, Jue')).toBeInTheDocument();
    expect(within(filaNorte).getByText('Sin teléfono')).toBeInTheDocument();
  });

  it('crea un proveedor con varios días de pedido y de entrega', async () => {
    let creado: unknown;
    let pedidosLista = 0;
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [LISTA_URL]: () => {
        pedidosLista++;
        return [200, [SUR]];
      },
      'POST /proveedores': (cuerpo) => {
        creado = cuerpo;
        return [201, NORTE];
      },
    });
    renderApp('/admin/proveedores');

    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo proveedor' }));
    const form = screen.getByRole('form', { name: 'Nuevo proveedor' });
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Golosinas Centro');
    await userEvent.type(within(form).getByLabelText('Teléfono'), '351 444 5555');
    const pedido = within(form).getByRole('group', { name: 'Días de pedido' });
    await userEvent.click(within(pedido).getByLabelText('Jueves'));
    await userEvent.click(within(pedido).getByLabelText('Lunes'));
    const entrega = within(form).getByRole('group', { name: 'Días de entrega' });
    await userEvent.click(within(entrega).getByLabelText('Martes'));
    await userEvent.click(within(entrega).getByLabelText('Viernes'));
    await userEvent.click(within(form).getByRole('button', { name: 'Crear proveedor' }));

    expect(await screen.findByRole('button', { name: 'Nuevo proveedor' })).toBeInTheDocument();
    expect(creado).toEqual({
      nombre: 'Golosinas Centro',
      telefono: '351 444 5555',
      notas: '',
      diasPedido: ['lunes', 'jueves'],
      diasEntrega: ['martes', 'viernes'],
    });
    expect(pedidosLista).toBe(2);
  });

  it('desactiva un proveedor', async () => {
    let cambio: unknown;
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [LISTA_URL]: [200, [SUR]],
      [`PATCH /proveedores/${SUR.id}`]: (cuerpo) => {
        cambio = cuerpo;
        return [200, { ...SUR, activo: false }];
      },
    });
    renderApp('/admin/proveedores');

    const tabla = await screen.findByRole('table');
    const fila = (await within(tabla).findByText('Distribuidora Sur')).closest('tr')!;
    await userEvent.click(within(fila).getByRole('button', { name: 'Desactivar' }));

    await screen.findByRole('table');
    expect(cambio).toEqual({ activo: false });
  });
});
