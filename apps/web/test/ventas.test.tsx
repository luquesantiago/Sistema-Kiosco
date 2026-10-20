import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hoyEnArgentina } from '../src/lib/fechas.js';
import { ADMIN, EMPLEADO, renderApp, simularApi } from './ayudas.js';

const RESUMEN = {
  id: '0198a5b0-0000-7000-8000-000000000301',
  numero: 120,
  creadaEn: '2026-10-20T18:42:00.000Z',
  usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
  total: '3300.00',
  estado: 'pagada',
  medios: ['efectivo'],
};
const ANULADA = {
  ...RESUMEN,
  id: '0198a5b0-0000-7000-8000-000000000302',
  numero: 119,
  estado: 'anulada',
  medios: ['debito'],
};
const DETALLE = {
  ...RESUMEN,
  items: [
    {
      productoId: '0198a5b0-0000-7000-8000-000000000201',
      descripcion: 'Alfajor',
      cantidad: 2,
      precioUnitario: '900.00',
      subtotal: '1800.00',
    },
    {
      productoId: null,
      descripcion: 'Caramelos',
      cantidad: 1,
      precioUnitario: '1500.00',
      subtotal: '1500.00',
    },
  ],
  pagos: [{ medio: 'efectivo', monto: '3300.00', montoRecibido: '5000.00', vuelto: '1700.00' }],
  anulacion: null,
};

beforeEach(() => {
  vi.stubGlobal('print', vi.fn());
});

describe('listado de ventas', () => {
  it('el empleado ve las de hoy, sin selector de fechas, y las anuladas tachadas', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /ventas?pagina=1': [200, [RESUMEN, ANULADA]],
    });
    renderApp('/ventas');

    const tabla = await screen.findByRole('table');
    expect(screen.getByRole('heading', { name: 'Ventas de hoy' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Fechas' })).not.toBeInTheDocument();
    expect(within(tabla).getByRole('link', { name: '#119' })).toHaveClass('line-through');
    expect(within(tabla).getByText('Anulada')).toBeInTheDocument();
    expect(within(tabla).getByRole('link', { name: '#120' })).not.toHaveClass('line-through');
  });

  it('el admin elige fechas', async () => {
    const hoy = hoyEnArgentina();
    const fetchMock = simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [`GET /ventas?pagina=1&desde=${hoy}&hasta=${hoy}`]: [200, [RESUMEN]],
    });
    renderApp('/ventas');

    const fechas = await screen.findByRole('group', { name: 'Fechas' });
    expect(within(fechas).getByLabelText('Desde')).toHaveValue(hoy);
    await screen.findByRole('table');
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/ventas?pagina=1&desde=${hoy}&hasta=${hoy}`,
      expect.anything(),
    );
  });
});

describe('detalle de una venta', () => {
  it('muestra ítems y pagos, y reimprime solo cuando se pide', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      [`GET /ventas/${RESUMEN.id}`]: [200, DETALLE],
    });
    renderApp(`/ventas/${RESUMEN.id}`);

    const items = await screen.findByRole('table', { name: 'Ítems de la venta' });
    expect(within(items).getByText('Caramelos')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Pagos' })).toHaveTextContent('vuelto $ 1.700,00');
    expect(window.print).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Reimprimir ticket' }));

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('ticket')).toHaveTextContent('Venta #120');
  });

  it('la anulación pide motivo antes de enviarse', async () => {
    let enviado: unknown;
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      [`GET /ventas/${RESUMEN.id}`]: [200, DETALLE],
      [`POST /ventas/${RESUMEN.id}/anular`]: (cuerpo) => {
        enviado = cuerpo;
        return [
          200,
          {
            ...DETALLE,
            estado: 'anulada',
            anulacion: {
              en: '2026-10-20T19:00:00.000Z',
              por: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
              motivo: 'cobré dos veces',
            },
          },
        ];
      },
    });
    renderApp(`/ventas/${RESUMEN.id}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Anular venta' }));
    const form = screen.getByRole('form', { name: 'Anular venta' });
    const confirmar = within(form).getByRole('button', { name: 'Confirmar anulación' });
    expect(confirmar).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('Motivo de la anulación'), 'cobré dos veces');
    await userEvent.click(confirmar);

    expect(await screen.findByText(/por Juan Empleado: cobré dos veces/)).toBeInTheDocument();
    expect(enviado).toEqual({ motivo: 'cobré dos veces' });
    expect(screen.queryByRole('button', { name: 'Anular venta' })).not.toBeInTheDocument();
  });
});

describe('avisos', () => {
  it('el admin ve los avisos con su estado y texto', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /notificaciones': [
        200,
        [
          {
            id: '0198a5b0-0000-7000-8000-000000000401',
            tipo: 'anulacion_venta',
            destino: 'admin',
            texto: '*Venta #120 anulada*\nAnuló: Juan\nMotivo: cobré dos veces',
            estado: 'pendiente',
            creadaEn: '2026-10-20T19:00:00.000Z',
            enviadaEn: null,
            error: null,
          },
        ],
      ],
    });
    renderApp('/admin/avisos');

    expect(await screen.findByText('Pendiente de envío')).toBeInTheDocument();
    const lista = screen.getByRole('list', { name: 'Avisos' });
    expect(within(lista).getByText(/Venta #120 anulada/)).toBeInTheDocument();
    expect(within(lista).getByText(/Motivo: cobré dos veces/)).toBeInTheDocument();
  });

  it('Ventas y Avisos aparecen en el menú según el rol', async () => {
    simularApi({ 'GET /auth/sesion': [200, EMPLEADO] });
    renderApp('/venta');

    const menu = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(menu).getByRole('link', { name: 'Ventas' })).toBeInTheDocument();
    expect(within(menu).queryByRole('link', { name: 'Avisos' })).not.toBeInTheDocument();
  });
});
