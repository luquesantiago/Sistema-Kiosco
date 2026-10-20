import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, EMPLEADO, renderApp, simularApi } from './ayudas.js';

const SUR = { id: '0198a5b0-0000-7000-8000-000000000101', nombre: 'Distribuidora Sur' };
const GASEOSA = {
  id: '0198a5b0-0000-7000-8000-000000000201',
  codigoBarras: '7790001',
  nombre: 'Gaseosa cola',
  precio: '1500.00',
  stockActual: 3,
};
const GASEOSA_ADMIN = {
  ...GASEOSA,
  costo: '900.00',
  proveedor: SUR,
  stockMinimo: 0,
  stockMaximo: 0,
  activo: true,
};
const ALFAJOR = {
  id: '0198a5b0-0000-7000-8000-000000000202',
  codigoBarras: null,
  nombre: 'Alfajor triple',
  precio: '900.00',
  stockActual: 0,
};

const busqueda = (q: string) => `GET /productos?q=${q}&pagina=1`;

function escaner() {
  return screen.findByRole('combobox', { name: 'Escaneá o buscá un producto' });
}

describe('ingreso de mercadería', () => {
  it('escanear dos veces el mismo producto deja una fila con cantidad 2', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /stock/proveedores': [200, [SUR]],
      [busqueda('7790001')]: [200, [GASEOSA]],
    });
    renderApp('/stock/ingreso');

    const campo = await escaner();
    expect(campo).toHaveFocus();
    await userEvent.type(campo, '7790001{Enter}');
    await screen.findByText('Gaseosa cola');
    await userEvent.type(campo, '7790001{Enter}');

    const tabla = screen.getByRole('table', { name: 'Productos del ingreso' });
    await waitFor(() =>
      expect(within(tabla).getByLabelText('Cantidad de Gaseosa cola')).toHaveValue(2),
    );
    expect(within(tabla).getAllByRole('row')).toHaveLength(2);
    expect(campo).toHaveFocus();
  });

  it('un código inexistente avisa sin perder la lista', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /stock/proveedores': [200, [SUR]],
      [busqueda('7790001')]: [200, [GASEOSA]],
      [busqueda('0000')]: [200, []],
    });
    renderApp('/stock/ingreso');

    const campo = await escaner();
    await userEvent.type(campo, '7790001{Enter}');
    await screen.findByText('Gaseosa cola');
    await userEvent.type(campo, '0000{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No existe un producto con "0000". Pedile al admin que lo cargue',
    );
    expect(screen.getByText('Gaseosa cola')).toBeInTheDocument();
  });

  it('busca por nombre y elige con las flechas y Enter', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /stock/proveedores': [200, []],
      [busqueda('a')]: [200, [GASEOSA, ALFAJOR]],
    });
    renderApp('/stock/ingreso');

    const campo = await escaner();
    await userEvent.type(campo, 'a{Enter}');
    const opciones = within(await screen.findByRole('listbox')).getAllByRole('option');
    expect(opciones[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}{Enter}');

    const tabla = await screen.findByRole('table', { name: 'Productos del ingreso' });
    expect(within(tabla).getByText('Alfajor triple')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('el empleado no ve la columna de costo y confirma con Ctrl+Enter', async () => {
    let enviado: unknown;
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /stock/proveedores': [200, [SUR]],
      [busqueda('7790001')]: [200, [GASEOSA]],
      'POST /stock/ingresos': (cuerpo) => {
        enviado = cuerpo;
        return [
          201,
          {
            id: '0198a5b0-0000-7000-8000-000000000301',
            creadoEn: '2026-10-20T15:00:00.000Z',
            proveedor: SUR,
            usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
            nota: null,
            cantidadProductos: 1,
          },
        ];
      },
    });
    renderApp('/stock/ingreso');

    await userEvent.selectOptions(
      await screen.findByLabelText('Proveedor (opcional)'),
      await screen.findByRole('option', { name: 'Distribuidora Sur' }),
    );
    const campo = await escaner();
    await userEvent.type(campo, '7790001{Enter}');
    const tabla = await screen.findByRole('table', { name: 'Productos del ingreso' });
    expect(within(tabla).queryByText('Costo unitario')).not.toBeInTheDocument();
    const cantidad = within(tabla).getByLabelText('Cantidad de Gaseosa cola');
    await userEvent.clear(cantidad);
    await userEvent.type(cantidad, '24');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ingreso registrado: 1 producto, 24 unidades.',
    );
    expect(enviado).toEqual({
      proveedorId: SUR.id,
      nota: '',
      items: [{ productoId: GASEOSA.id, cantidad: 24 }],
    });
    expect(screen.queryByRole('table', { name: 'Productos del ingreso' })).not.toBeInTheDocument();
  });

  it('el admin ve el costo precargado y lo envía', async () => {
    let enviado: { items: unknown[] } | undefined;
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /stock/proveedores': [200, [SUR]],
      [busqueda('7790001')]: [200, [GASEOSA_ADMIN]],
      'POST /stock/ingresos': (cuerpo) => {
        enviado = cuerpo as { items: unknown[] };
        return [
          201,
          {
            id: '0198a5b0-0000-7000-8000-000000000301',
            creadoEn: '2026-10-20T15:00:00.000Z',
            proveedor: null,
            usuario: { id: ADMIN.id, nombre: ADMIN.nombre },
            nota: null,
            cantidadProductos: 1,
          },
        ];
      },
    });
    renderApp('/stock/ingreso');

    await userEvent.type(await escaner(), '7790001{Enter}');
    const tabla = await screen.findByRole('table', { name: 'Productos del ingreso' });
    const costo = within(tabla).getByLabelText('Costo de Gaseosa cola');
    expect(costo).toHaveValue('900,00');
    await userEvent.clear(costo);
    await userEvent.type(costo, '950');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar ingreso' }));

    await screen.findByRole('status');
    expect(enviado?.items).toEqual([{ productoId: GASEOSA.id, cantidad: 1, costoUnitario: '950' }]);
  });

  it('aparece en el menú del empleado', async () => {
    simularApi({ 'GET /auth/sesion': [200, EMPLEADO] });
    renderApp('/venta');

    const menu = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(menu).getByRole('link', { name: 'Ingreso de mercadería' })).toHaveAttribute(
      'href',
      '/stock/ingreso',
    );
  });
});
