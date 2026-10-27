import { rangoDelPeriodo } from '@kiosco/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { hoyEnArgentina } from '../src/lib/fechas.js';
import { ADMIN, dashboardVacio, renderApp, simularApi } from './ayudas.js';

const HOY = hoyEnArgentina();
const [CLAVE_HOY, [, VACIO]] = Object.entries(dashboardVacio())[0] as [string, [number, object]];
const AYER = rangoDelPeriodo('ayer', HOY);

const producto = (nombre: string, unidades: number, importe: string, ganancia: string | null) => ({
  productoId: `0198a5b0-0000-7000-8000-00000000020${unidades % 10}`,
  nombre,
  unidades,
  importe,
  ganancia,
});

const CON_DATOS = {
  ...VACIO,
  anterior: AYER,
  ahora: {
    efectivoEnCaja: '90000.00',
    turnoAbierto: true,
    pendiente: {
      total: '520000.00',
      porLlegar: { cantidad: 2, total: '310000.00' },
      deben: { cantidad: 3, total: '210000.00' },
    },
  },
  ventas: { total: '108000.00', cantidad: 64, anterior: '100000.00', variacion: 8 },
  ganancia: { total: '30000.00', anterior: '0.00', variacion: null, margen: 30 },
  sinCosto: '12000.00',
  gastos: {
    total: '20000.00',
    porCategoria: { servicios: '15000.00', insumos: '5000.00', otro: '0.00' },
  },
  resultado: '10000.00',
  masVendidos: {
    unidades: [
      producto('Chicle', 40, '8000.00', null),
      producto('Gaseosa', 12, '18000.00', '6000.00'),
    ],
    importe: [
      producto('Gaseosa', 12, '18000.00', '6000.00'),
      producto('Chicle', 40, '8000.00', null),
    ],
    ganancia: [producto('Gaseosa', 12, '18000.00', '6000.00')],
  },
  movimientos: {
    ...(VACIO as { movimientos: object }).movimientos,
    diferencias: { total: '-1200.00', turnos: 2 },
  },
};

function base(datos: object = CON_DATOS) {
  return {
    'GET /auth/sesion': [200, ADMIN] as [number, unknown],
    'GET /whatsapp': [200, { estado: 'no_configurado' }] as [number, unknown],
    'GET /health': [200, { estado: 'ok', baseDeDatos: 'ok', hora: new Date().toISOString() }] as [
      number,
      unknown,
    ],
    [CLAVE_HOY]: [200, datos] as [number, unknown],
  };
}

describe('dashboard del admin', () => {
  it('arranca en Hoy con efectivo, pendiente, ventas comparadas y resultado', async () => {
    simularApi(base());
    renderApp('/admin');

    const ahora = await screen.findByRole('region', { name: 'Ahora' });
    expect(screen.getByRole('button', { name: 'Hoy' })).toHaveAttribute('aria-pressed', 'true');
    expect(ahora).toHaveTextContent(/Efectivo en caja.*90\.000,00/);
    expect(within(ahora).getByRole('link', { name: /Pendiente de pagar/ })).toHaveAttribute(
      'href',
      '/pedidos',
    );
    const ventas = screen.getByRole('region', { name: 'Ventas y resultado' });
    expect(ventas).toHaveTextContent('+8% vs. ayer');
    // La ganancia no tiene con qué compararse: no se muestra porcentaje.
    expect(within(ventas).getAllByText(/vs\./)).toHaveLength(1);
    expect(ventas).toHaveTextContent('Ganancia (30%)');
    expect(within(ventas).getByRole('link', { name: /vendidos sin costo/ })).toHaveAttribute(
      'href',
      '/admin/productos?sinCosto=1',
    );
    expect(ventas).toHaveTextContent(/Resultado.*10\.000,00/);
    expect(screen.queryByText(/Mercado Pago:/)).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Plata que se movió' })).getByRole('link', {
        name: /Diferencias de caja \(2\)/,
      }),
    ).toHaveAttribute('href', '/admin/turnos');
  });

  it('elegir "Semana" pide las fechas de la semana', async () => {
    const semana = rangoDelPeriodo('semana', HOY);
    const fetchMock = simularApi({
      ...base(),
      [`GET /dashboard?desde=${semana.desde}&hasta=${semana.hasta}`]: [200, CON_DATOS],
    });
    renderApp('/admin');

    await userEvent.click(await screen.findByRole('button', { name: 'Semana' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/dashboard?desde=${semana.desde}&hasta=${semana.hasta}`,
        expect.anything(),
      ),
    );
    expect(screen.getByRole('button', { name: 'Semana' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('el orden de los más vendidos cambia sin volver a pedir', async () => {
    const fetchMock = simularApi(base());
    renderApp('/admin');

    const bloque = await screen.findByRole('region', { name: 'Más vendidos' });
    const nombres = () =>
      within(within(bloque).getByRole('list', { name: 'Más vendidos' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent);
    expect(nombres()[0]).toMatch(/1\. Chicle.*40 u\./);
    const pedidos = fetchMock.mock.calls.length;

    await userEvent.click(within(bloque).getByRole('radio', { name: 'Ganancia' }));

    expect(nombres()).toHaveLength(1);
    expect(nombres()[0]).toMatch(/1\. Gaseosa/);
    expect(fetchMock.mock.calls.length).toBe(pedidos);
  });
});
