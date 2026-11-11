import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, dashboardVacio, EMPLEADO, renderApp, simularApi } from './ayudas.js';

/*
 * Administración → Facturación (specs/facturacion: "Estado de la facturación
 * para el admin" y "Reintento manual de una factura").
 *
 * Contrato que asume este test:
 * - `/admin/facturacion` con el título "Facturación", el estado de ARCA, el
 *   entorno ("HOMOLOGACIÓN" bien visible), el punto de venta, el último número
 *   y una tabla "Facturas trabadas" con venta, importe, estado, intentos y motivo.
 * - **Reintentar** solo en las de error que se pueden reintentar (no tope ni plazo).
 * - En el panel, un cartel "N factura(s) con error" con el enlace "Ir a Facturación".
 */

const FACTURA_ID = (n: number) => `0198a5b0-0000-7000-8000-00000000070${n}`;

function factura(n: number, datos: Record<string, unknown>) {
  return {
    id: FACTURA_ID(n),
    ventaId: `0198a5b0-0000-7000-8000-00000000030${n}`,
    ventaNumero: 119 + n,
    parte: 'electronica',
    importe: '3300.00',
    estado: 'pendiente',
    intentos: 0,
    codigoError: null,
    error: null,
    ...datos,
  };
}

const PENDIENTE = factura(1, { importe: '100.00' });
const EN_CURSO = factura(2, { importe: '200.00', estado: 'en_curso' });
const TOPE = factura(3, {
  importe: '10000000.00',
  estado: 'error',
  codigoError: 'tope',
  error: 'Alcanza el tope para no identificar al cliente.',
});
const RECHAZADA = factura(4, {
  importe: '3300.00',
  estado: 'error',
  intentos: 5,
  codigoError: 'rechazo_arca',
  error: 'ARCA rechazó el comprobante: 10016.',
});

const ESTADO = {
  estado: 'disponible',
  entorno: 'homologacion',
  puntoVenta: 5,
  ultimoNumero: 42,
  pendientes: 2,
  enError: 2,
  facturas: [PENDIENTE, EN_CURSO, TOPE, RECHAZADA],
};

function filaDeVenta(tabla: HTMLElement, numero: number) {
  return within(tabla).getByText(`#${numero}`).closest('tr')!;
}

describe('pantalla de Facturación', () => {
  it('muestra estado, entorno, punto de venta, último número y las facturas trabadas con su motivo', async () => {
    simularApi({ 'GET /auth/sesion': [200, ADMIN], 'GET /facturacion': [200, ESTADO] });
    renderApp('/admin/facturacion');

    expect(await screen.findByRole('heading', { name: 'Facturación' })).toBeInTheDocument();
    expect(screen.getByText(/HOMOLOGACIÓN/)).toBeInTheDocument();
    expect(screen.getByText(/disponible/i)).toBeInTheDocument();
    expect(document.body).toHaveTextContent(/Punto de venta:?\s*0*5/);
    expect(document.body).toHaveTextContent(/42/);

    const tabla = screen.getByRole('table', { name: 'Facturas trabadas' });
    expect(within(tabla).getAllByRole('row')).toHaveLength(1 + 4);
    expect(filaDeVenta(tabla, 120)).toHaveTextContent(/100,00/);
    expect(filaDeVenta(tabla, 120)).toHaveTextContent(/pendiente/i);
    expect(filaDeVenta(tabla, 121)).toHaveTextContent(/en curso/i);
    expect(filaDeVenta(tabla, 122)).toHaveTextContent(/10\.000\.000,00/);
    expect(filaDeVenta(tabla, 122)).toHaveTextContent(
      'Alcanza el tope para no identificar al cliente.',
    );
    expect(filaDeVenta(tabla, 123)).toHaveTextContent('ARCA rechazó el comprobante: 10016.');
    expect(filaDeVenta(tabla, 123)).toHaveTextContent('5');
  });

  it('Reintentar aparece solo en la rechazada (no en la del tope) y la deja pendiente', async () => {
    let estado = ESTADO;
    const fetchMock = simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /facturacion': () => [200, estado],
      [`POST /facturas/${RECHAZADA.id}/reintentar`]: () => {
        const reintentada = { ...RECHAZADA, estado: 'pendiente', intentos: 0, codigoError: null, error: null };
        estado = {
          ...estado,
          pendientes: 3,
          enError: 1,
          facturas: [PENDIENTE, EN_CURSO, TOPE, reintentada],
        };
        return [200, reintentada];
      },
    });
    const usuario = userEvent.setup();
    renderApp('/admin/facturacion');

    const tabla = await screen.findByRole('table', { name: 'Facturas trabadas' });
    for (const numero of [120, 121, 122]) {
      expect(
        within(filaDeVenta(tabla, numero)).queryByRole('button', { name: 'Reintentar' }),
      ).toBeNull();
    }
    await usuario.click(
      within(filaDeVenta(tabla, 123)).getByRole('button', { name: 'Reintentar' }),
    );

    await waitFor(() =>
      expect(
        filaDeVenta(screen.getByRole('table', { name: 'Facturas trabadas' }), 123),
      ).toHaveTextContent(/pendiente/i),
    );
    expect(
      fetchMock.mock.calls.filter(([url, init]) =>
        url === `/api/facturas/${RECHAZADA.id}/reintentar` && init?.method === 'POST',
      ),
    ).toHaveLength(1);
  });

  it.each([
    ['no_disponible', /no disponible/i],
    ['autenticacion_bloqueada', /autenticación bloqueada/i],
  ])('estado %s: lo informa', async (estado, texto) => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /facturacion': [200, { ...ESTADO, estado }],
    });
    renderApp('/admin/facturacion');

    expect(await screen.findByText(texto)).toBeInTheDocument();
  });

  it('en producción no muestra la marca de homologación', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /facturacion': [200, { ...ESTADO, entorno: 'produccion' }],
    });
    renderApp('/admin/facturacion');

    await screen.findByRole('table', { name: 'Facturas trabadas' });
    expect(screen.queryByText(/HOMOLOGACIÓN/)).not.toBeInTheDocument();
  });

  it('sin facturación configurada lo dice y no muestra tabla', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /facturacion': [200, { estado: 'no_configurado' }],
    });
    renderApp('/admin/facturacion');

    expect(await screen.findByText(/no está configurada/i)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Facturas trabadas' })).not.toBeInTheDocument();
  });

  it('un empleado no tiene acceso', async () => {
    simularApi({ 'GET /auth/sesion': [200, EMPLEADO] });
    const { router } = renderApp('/admin/facturacion');

    await waitFor(() => expect(router.state.location.pathname).not.toBe('/admin/facturacion'));
    expect(screen.queryByRole('heading', { name: 'Facturación' })).not.toBeInTheDocument();
  });
});

describe('Facturación en el panel del admin', () => {
  function panel(estadoFacturacion: unknown) {
    return simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /facturacion': [200, estadoFacturacion],
      'GET /whatsapp': [
        200,
        { estado: 'conectado', cuenta: { numero: '1100000000' }, destino: { numero: '1123456789' }, pendientes: 0 },
      ],
      'GET /health': [200, { estado: 'ok', baseDeDatos: 'ok', hora: new Date().toISOString() }],
      ...dashboardVacio(),
    });
  }

  it('con 1 factura con error muestra el cartel con la cantidad y el enlace a Facturación', async () => {
    panel({ ...ESTADO, enError: 1, facturas: [PENDIENTE, TOPE] });
    renderApp('/admin');

    const cartel = (await screen.findByText(/1 factura con error/)).closest('[role="alert"]');
    expect(cartel).not.toBeNull();
    expect(within(cartel as HTMLElement).getByRole('link', { name: 'Ir a Facturación' })).toHaveAttribute(
      'href',
      '/admin/facturacion',
    );
  });

  it('la entrada "Facturación" está en la lista del panel', async () => {
    panel({ ...ESTADO, enError: 0, facturas: [] });
    renderApp('/admin');

    await screen.findByRole('heading', { name: 'Administración' });
    expect(screen.getByRole('link', { name: /^Facturación/ })).toHaveAttribute(
      'href',
      '/admin/facturacion',
    );
  });

  it.each([
    ['sin facturas con error', { ...ESTADO, enError: 0, facturas: [PENDIENTE] }],
    ['sin facturación configurada', { estado: 'no_configurado' }],
  ])('no muestra el cartel %s', async (_caso, estado) => {
    const fetchMock = panel(estado);
    renderApp('/admin');

    await screen.findByRole('heading', { name: 'Administración' });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/facturacion', expect.anything()),
    );
    expect(screen.queryByText(/con error/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ir a Facturación' })).not.toBeInTheDocument();
  });
});
