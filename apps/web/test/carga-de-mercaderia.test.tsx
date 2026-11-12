import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, EMPLEADO, renderApp, simularApi } from './ayudas.js';

const SUR = { id: '0198a5b0-0000-7000-8000-000000000101', nombre: 'Distribuidora Sur' };
const GASEOSA = {
  id: '0198a5b0-0000-7000-8000-000000000201',
  codigoBarras: '7790001',
  nombre: 'Gaseosa cola',
  costo: '900.00',
};
const ALFAJOR = {
  id: '0198a5b0-0000-7000-8000-000000000202',
  codigoBarras: null,
  nombre: 'Alfajor triple',
  costo: null,
};

/** Pedido que llegó y falta cargar. */
const PEDIDO = {
  id: '0198a5b0-0000-7000-8000-000000000701',
  numero: 12,
  proveedor: SUR,
  totalPedido: '310000.00',
  total: '310000.00',
  llegaEl: '2026-10-22',
  nota: null,
  estado: 'llego',
  cuentaPago: 'efectivo',
  cerradoEn: null,
  creado: { usuario: { id: ADMIN.id, nombre: ADMIN.nombre }, en: '2026-10-20T12:00:00.000Z' },
  recibido: {
    usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
    en: '2026-10-22T13:00:00.000Z',
  },
  notaRecepcion: null,
  cancelado: null,
  carga: null,
  pago: {
    usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
    en: '2026-10-22T13:00:00.000Z',
    cuenta: 'efectivo',
    monto: '310000.00',
  },
};

const busqueda = (q: string) => `GET /pedidos/productos?q=${q}`;
const DETALLE = `GET /pedidos/${PEDIDO.id}`;
const CARGA = `POST /pedidos/${PEDIDO.id}/carga`;

function escaner() {
  return screen.findByRole('combobox', { name: 'Escaneá o buscá un producto' });
}

describe('carga de la mercadería de un pedido', () => {
  it('escanear dos veces el mismo producto deja una fila con cantidad 2', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      [DETALLE]: [200, PEDIDO],
      [busqueda('7790001')]: [200, [GASEOSA]],
    });
    renderApp(`/pedidos/${PEDIDO.id}`);

    const campo = await escaner();
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
      [DETALLE]: [200, PEDIDO],
      [busqueda('7790001')]: [200, [GASEOSA]],
      [busqueda('0000')]: [200, []],
    });
    renderApp(`/pedidos/${PEDIDO.id}`);

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
      [DETALLE]: [200, PEDIDO],
      [busqueda('a')]: [200, [GASEOSA, ALFAJOR]],
    });
    renderApp(`/pedidos/${PEDIDO.id}`);

    const campo = await escaner();
    await userEvent.type(campo, 'a{Enter}');
    const opciones = within(await screen.findByRole('listbox')).getAllByRole('option');
    expect(opciones[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}{Enter}');

    const tabla = await screen.findByRole('table', { name: 'Productos del ingreso' });
    expect(within(tabla).getByText('Alfajor triple')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('el empleado ve el costo precargado, lo corrige y confirma con Ctrl+Enter', async () => {
    let enviado: unknown;
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      [DETALLE]: [200, PEDIDO],
      [busqueda('7790001')]: [200, [GASEOSA]],
      [CARGA]: (cuerpo) => {
        enviado = cuerpo;
        return [
          200,
          {
            ...PEDIDO,
            estado: 'cargado',
            cerradoEn: '2026-10-22T13:40:00.000Z',
            carga: {
              usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
              en: '2026-10-22T13:40:00.000Z',
              ingresoId: '0198a5b0-0000-7000-8000-000000000301',
              cantidadProductos: 1,
            },
          },
        ];
      },
    });
    renderApp(`/pedidos/${PEDIDO.id}`);

    const campo = await escaner();
    await userEvent.type(campo, '7790001{Enter}');
    const tabla = await screen.findByRole('table', { name: 'Productos del ingreso' });
    const costo = within(tabla).getByLabelText('Costo de Gaseosa cola');
    expect(costo).toHaveValue('900,00');
    await userEvent.clear(costo);
    await userEvent.type(costo, '950');
    const cantidad = within(tabla).getByLabelText('Cantidad de Gaseosa cola');
    await userEvent.clear(cantidad);
    await userEvent.type(cantidad, '24');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() =>
      expect(enviado).toEqual({
        nota: '',
        items: [{ productoId: GASEOSA.id, cantidad: 24, costoUnitario: '950' }],
      }),
    );
    // Ya cargado: el detalle lo muestra y desaparece el formulario de carga.
    expect(await screen.findByText(/1 producto el/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Carga de mercadería' })).not.toBeInTheDocument();
    expect(screen.getByText('Cerrado')).toBeInTheDocument();
  });

  it('el admin también ve el costo y deja vacío lo que no cambia', async () => {
    let enviado: { items: unknown[] } | undefined;
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [DETALLE]: [200, PEDIDO],
      [busqueda('Alfajor')]: [200, [ALFAJOR]],
      [CARGA]: (cuerpo) => {
        enviado = cuerpo as { items: unknown[] };
        return [200, { ...PEDIDO, estado: 'cargado' }];
      },
    });
    renderApp(`/pedidos/${PEDIDO.id}`);

    await userEvent.type(await escaner(), 'Alfajor{Enter}');
    await userEvent.keyboard('{Enter}');
    const tabla = await screen.findByRole('table', { name: 'Productos del ingreso' });
    expect(within(tabla).getByLabelText('Costo de Alfajor triple')).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar carga' }));

    await waitFor(() => expect(enviado?.items).toEqual([{ productoId: ALFAJOR.id, cantidad: 1 }]));
  });

  it('Pedidos aparece en el menú del empleado en lugar del ingreso suelto', async () => {
    simularApi({ 'GET /auth/sesion': [200, EMPLEADO] });
    renderApp('/venta');

    const menu = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(menu).getByRole('link', { name: 'Pedidos' })).toHaveAttribute('href', '/pedidos');
    expect(
      within(menu).queryByRole('link', { name: 'Ingreso de mercadería' }),
    ).not.toBeInTheDocument();
  });
});
