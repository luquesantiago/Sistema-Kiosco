import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, renderApp, simularApi } from './ayudas.js';

const CODIGO = '7790001000012';
const PROVEEDOR = {
  id: '0198a5b0-0000-7000-8000-000000000101',
  nombre: 'Distribuidora Sur',
  telefono: null,
  notas: null,
  diasPedido: [],
  diasEntrega: [],
  activo: true,
  tomaPedidoHoy: false,
  productosActivos: 1,
};
const ALFAJOR = {
  id: '0198a5b0-0000-7000-8000-000000000201',
  codigoBarras: CODIGO,
  nombre: 'Alfajor triple',
  precio: '900.00',
  stockActual: 7,
  costo: '600.00',
  proveedor: { id: PROVEEDOR.id, nombre: PROVEEDOR.nombre },
  stockMinimo: 10,
  stockMaximo: 40,
  activo: true,
};

const comunes: Record<string, [number, unknown]> = {
  'GET /auth/sesion': [200, ADMIN],
  'GET /proveedores': [200, [PROVEEDOR]],
};

describe('lista de productos', () => {
  it('busca con el lector (código + Enter) y muestra el resultado', async () => {
    simularApi({
      ...comunes,
      'GET /productos?q=&pagina=1': [200, []],
      [`GET /productos?q=${CODIGO}&pagina=1`]: [200, [ALFAJOR]],
    });
    renderApp('/admin/productos');

    const busqueda = await screen.findByLabelText('Buscar por código o nombre');
    expect(busqueda).toHaveFocus();
    await userEvent.type(busqueda, `${CODIGO}{Enter}`);

    const tabla = await screen.findByRole('table');
    expect(within(tabla).getByRole('link', { name: 'Alfajor triple' })).toHaveAttribute(
      'href',
      `/admin/productos/${ALFAJOR.id}`,
    );
    expect(within(tabla).getByText(/900,00/)).toBeInTheDocument();
  });

  it('abierta con ?sinCosto=1 muestra el filtro activo y pide solo los productos sin costo', async () => {
    const fetchMock = simularApi({
      ...comunes,
      'GET /productos?q=&pagina=1&sinCosto=true': [200, [{ ...ALFAJOR, costo: null }]],
    });
    renderApp('/admin/productos?sinCosto=1');

    expect(await screen.findByRole('checkbox', { name: 'Sin costo' })).toBeChecked();
    await screen.findByRole('table');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/productos?q=&pagina=1&sinCosto=true',
      expect.anything(),
    );
  });

  it('alta rápida: un código escaneado que no existe abre el alta con el código cargado', async () => {
    let creado: unknown;
    simularApi({
      ...comunes,
      'GET /productos?q=&pagina=1': [200, [ALFAJOR]],
      'GET /productos?q=7791234567890&pagina=1': [200, []],
      'POST /productos': (cuerpo) => {
        creado = cuerpo;
        return [201, { ...ALFAJOR, nombre: 'Turrón' }];
      },
    });
    const { router } = renderApp('/admin/productos');

    await userEvent.type(
      await screen.findByLabelText('Buscar por código o nombre'),
      '7791234567890{Enter}',
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Crear producto con este código' }),
    );

    const form = await screen.findByRole('form', { name: 'Nuevo producto' });
    expect(within(form).getByLabelText('Código de barras')).toHaveValue('7791234567890');
    expect(within(form).getByLabelText('Nombre')).toHaveFocus();
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Turrón');
    await userEvent.type(within(form).getByLabelText('Precio de venta'), '1.500,50');
    await userEvent.selectOptions(within(form).getByLabelText('Proveedor'), PROVEEDOR.id);
    await userEvent.click(within(form).getByRole('button', { name: 'Crear producto' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/productos'));
    expect(await screen.findByRole('status')).toHaveTextContent('Producto creado: Turrón');
    expect(creado).toEqual({
      nombre: 'Turrón',
      codigoBarras: '7791234567890',
      precio: '1500.50',
      costo: null,
      stockMinimo: 0,
      stockMaximo: 0,
      proveedorId: PROVEEDOR.id,
    });
  });

  it('una búsqueda por nombre sin resultados no ofrece crear con código', async () => {
    simularApi({
      ...comunes,
      'GET /productos?q=&pagina=1': [200, []],
      'GET /productos?q=chocolate&pagina=1': [200, []],
    });
    renderApp('/admin/productos');

    await userEvent.type(
      await screen.findByLabelText('Buscar por código o nombre'),
      'chocolate{Enter}',
    );

    expect(await screen.findByText('No hay productos para "chocolate".')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Crear producto con este código' }),
    ).not.toBeInTheDocument();
  });
});

describe('alta de producto', () => {
  it('muestra el error de código repetido', async () => {
    simularApi({
      ...comunes,
      'POST /productos': [
        409,
        {
          error: {
            codigo: 'CODIGO_EXISTENTE',
            mensaje: `El código ${CODIGO} ya lo usa el producto "Alfajor triple".`,
          },
        },
      ],
    });
    renderApp('/admin/productos/nuevo');

    const form = await screen.findByRole('form', { name: 'Nuevo producto' });
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Otro');
    await userEvent.type(within(form).getByLabelText('Código de barras'), CODIGO);
    await userEvent.type(within(form).getByLabelText('Precio de venta'), '100');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear producto' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'ya lo usa el producto "Alfajor triple"',
    );
  });

  it('valida el precio antes de llamar a la API', async () => {
    simularApi(comunes);
    renderApp('/admin/productos/nuevo');

    const form = await screen.findByRole('form', { name: 'Nuevo producto' });
    await userEvent.type(within(form).getByLabelText('Nombre'), 'Otro');
    await userEvent.type(within(form).getByLabelText('Precio de venta'), '0');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear producto' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent('mayor que cero');
  });
});

describe('ficha de producto', () => {
  const HISTORIAL = [
    {
      id: '0198a5b0-0000-7000-8000-000000000301',
      precioAnterior: '800.00',
      precioNuevo: '900.00',
      costoAnterior: '600.00',
      costoNuevo: '600.00',
      origen: 'aumento_masivo',
      creadoEn: '2026-10-20T15:00:00.000Z',
      usuario: { id: ADMIN.id, nombre: ADMIN.nombre },
    },
  ];

  it('muestra los datos, el stock actual y el historial de precios', async () => {
    simularApi({
      ...comunes,
      [`GET /productos/${ALFAJOR.id}`]: [200, ALFAJOR],
      [`GET /productos/${ALFAJOR.id}/historial-precios`]: [200, HISTORIAL],
    });
    renderApp(`/admin/productos/${ALFAJOR.id}`);

    const form = await screen.findByRole('form', { name: 'Editar producto' });
    expect(within(form).getByLabelText('Precio de venta')).toHaveValue('900,00');
    expect(within(form).getByLabelText('Proveedor')).toHaveValue(PROVEEDOR.id);
    expect(screen.getByText('7')).toBeInTheDocument();
    const historial = await screen.findByRole('list', { name: 'Cambios de precio' });
    expect(within(historial).getByText(/800,00 → .*900,00/)).toBeInTheDocument();
    expect(within(historial).getByText(/Ana Admin · Aumento masivo/)).toBeInTheDocument();
  });

  it('guarda un precio nuevo con coma y desactiva el producto', async () => {
    const cambios: unknown[] = [];
    simularApi({
      ...comunes,
      [`GET /productos/${ALFAJOR.id}`]: [200, ALFAJOR],
      [`GET /productos/${ALFAJOR.id}/historial-precios`]: [200, []],
      [`PATCH /productos/${ALFAJOR.id}`]: (cuerpo) => {
        cambios.push(cuerpo);
        return [200, ALFAJOR];
      },
    });
    renderApp(`/admin/productos/${ALFAJOR.id}`);

    const form = await screen.findByRole('form', { name: 'Editar producto' });
    const precio = within(form).getByLabelText('Precio de venta');
    await userEvent.clear(precio);
    await userEvent.type(precio, '1.000');
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Cambios guardados');

    await userEvent.click(screen.getByRole('button', { name: 'Desactivar producto' }));
    await waitFor(() => expect(cambios).toHaveLength(2));

    expect(cambios[0]).toMatchObject({ precio: '1000.00', costo: '600.00', stockMinimo: 10 });
    expect(cambios[0]).not.toHaveProperty('stockActual');
    expect(cambios[1]).toEqual({ activo: false });
  });
});
