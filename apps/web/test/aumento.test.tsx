import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, renderApp, simularApi } from './ayudas.js';

const SUR = {
  id: '0198a5b0-0000-7000-8000-000000000101',
  nombre: 'Distribuidora Sur',
  telefono: null,
  notas: null,
  diasPedido: [],
  diasEntrega: [],
  activo: true,
  tomaPedidoHoy: false,
  productosActivos: 2,
};
const PREVIA = [
  {
    id: '0198a5b0-0000-7000-8000-000000000201',
    nombre: 'Alfajor triple',
    precioActual: '905.00',
    precioNuevo: '1000.00',
    costoActual: '600.00',
    costoNuevo: '600.00',
  },
  {
    id: '0198a5b0-0000-7000-8000-000000000202',
    nombre: 'Chicle',
    precioActual: '100.00',
    precioNuevo: '110.00',
    costoActual: null,
    costoNuevo: null,
  },
];

describe('aumento masivo de precios', () => {
  it('la confirmación aparece solo después de la vista previa y muestra el resultado', async () => {
    const pedidos: { ruta: string; cuerpo: unknown }[] = [];
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /proveedores': [200, [SUR]],
      'POST /productos/aumento/vista-previa': (cuerpo) => {
        pedidos.push({ ruta: 'vista-previa', cuerpo });
        return [200, PREVIA];
      },
      'POST /productos/aumento': (cuerpo) => {
        pedidos.push({ ruta: 'aplicar', cuerpo });
        return [200, { actualizados: 2 }];
      },
    });
    renderApp('/admin/productos/aumento');

    const form = await screen.findByRole('form', { name: 'Aumento de precios' });
    await within(form).findByRole('option', { name: 'Proveedor: Distribuidora Sur' });
    expect(screen.queryByRole('button', { name: 'Confirmar aumento' })).not.toBeInTheDocument();

    await userEvent.selectOptions(within(form).getByLabelText('Productos'), SUR.id);
    await userEvent.type(within(form).getByLabelText('Porcentaje'), '10');
    await userEvent.selectOptions(within(form).getByLabelText('Redondear hacia arriba a'), '10');
    await userEvent.click(within(form).getByRole('button', { name: 'Ver vista previa' }));

    const previa = await screen.findByRole('region', { name: 'Vista previa' });
    const filaAlfajor = within(previa).getByText('Alfajor triple').closest('tr')!;
    expect(within(filaAlfajor).getByText(/905,00/)).toBeInTheDocument();
    expect(within(filaAlfajor).getByText(/1\.000,00/)).toBeInTheDocument();
    expect(pedidos.map((p) => p.ruta)).toEqual(['vista-previa']);

    await userEvent.click(within(previa).getByRole('button', { name: 'Confirmar aumento' }));

    expect(await screen.findByRole('status')).toHaveTextContent('se actualizaron 2 precios');
    expect(screen.queryByRole('region', { name: 'Vista previa' })).not.toBeInTheDocument();
    expect(pedidos).toEqual([
      {
        ruta: 'vista-previa',
        cuerpo: { proveedorId: SUR.id, porcentaje: 10, redondeo: 10, incluirCosto: false },
      },
      {
        ruta: 'aplicar',
        cuerpo: { proveedorId: SUR.id, porcentaje: 10, redondeo: 10, incluirCosto: false },
      },
    ]);
  });

  it('si se cambia el formulario después de la vista previa, hay que volver a verla', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /proveedores': [200, [SUR]],
      'POST /productos/aumento/vista-previa': [200, PREVIA],
    });
    renderApp('/admin/productos/aumento');

    const form = await screen.findByRole('form', { name: 'Aumento de precios' });
    await userEvent.type(within(form).getByLabelText('Porcentaje'), '10');
    await userEvent.click(within(form).getByRole('button', { name: 'Ver vista previa' }));
    expect(await screen.findByRole('button', { name: 'Confirmar aumento' })).toBeInTheDocument();

    await userEvent.type(within(form).getByLabelText('Porcentaje'), '0');

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Confirmar aumento' })).not.toBeInTheDocument(),
    );
  });

  it('valida el porcentaje antes de pedir la vista previa', async () => {
    simularApi({ 'GET /auth/sesion': [200, ADMIN], 'GET /proveedores': [200, [SUR]] });
    renderApp('/admin/productos/aumento');

    const form = await screen.findByRole('form', { name: 'Aumento de precios' });
    await userEvent.type(within(form).getByLabelText('Porcentaje'), '250');
    await userEvent.click(within(form).getByRole('button', { name: 'Ver vista previa' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent('entre -50 y 200');
  });
});
