import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, EMPLEADO, renderApp, simularApi } from './ayudas.js';
import {
  facturaAutorizada,
  facturaSinAutorizar,
  PAGOS_MIXTOS,
  VENTA_ID,
  ventaDetalle,
} from './factura-datos.js';

/*
 * Listado y detalle de ventas con facturas (specs/punto-de-venta: "Factura desde
 * el listado de ventas"; specs/ventas: "Facturas en el detalle de la venta" y
 * "Anulación de una venta con factura autorizada").
 *
 * Contrato que asume este test:
 * - En el detalle, cada factura con su número (o "En trámite") e importe; "Sin
 *   facturar: $Y" si queda algo; el botón **Pedir factura** si `puedePedirFactura`.
 * - Antes de confirmar la anulación, el formulario lista las facturas autorizadas
 *   con su importe y dice que la nota de crédito se hace por fuera.
 * - En el listado, la marca "Factura" (todo facturado) o "Factura parcial".
 */

const MIXTA_CON_AUTOMATICA = ventaDetalle({
  total: '5000.00',
  pagos: PAGOS_MIXTOS,
  facturas: [facturaAutorizada(42, '3000.00')],
  sinFacturar: '2000.00',
  puedePedirFactura: true,
});

beforeEach(() => {
  vi.stubGlobal('print', vi.fn());
});

describe('facturas en el detalle', () => {
  it('venta mixta con la automática autorizada: muestra la factura de $3.000, $2.000 sin facturar y ofrece pedir la del efectivo', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      [`GET /ventas/${VENTA_ID}`]: [200, MIXTA_CON_AUTOMATICA],
    });
    renderApp(`/ventas/${VENTA_ID}`);

    const facturas = await screen.findByRole('list', { name: 'Facturas' });
    expect(facturas).toHaveTextContent('00005-00000042');
    expect(facturas).toHaveTextContent(/3\.000,00/);
    expect(facturas).toHaveTextContent('76451234567892');
    expect(facturas).toHaveTextContent('20/11/2026');
    expect(screen.getByText(/Sin facturar: \$\s?2\.000,00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pedir factura' })).toBeInTheDocument();
  });

  it('pedir factura desde el detalle la deja en trámite', async () => {
    let detalle = ventaDetalle({
      pagos: [{ medio: 'efectivo', monto: '3300.00' }],
      puedePedirFactura: true,
    });
    const fetchMock = simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      [`GET /ventas/${VENTA_ID}`]: () => [200, detalle],
      [`POST /ventas/${VENTA_ID}/factura`]: () => {
        const factura = facturaSinAutorizar('3300.00', 'efectivo');
        detalle = { ...detalle, facturas: [factura], puedePedirFactura: false };
        return [201, factura];
      },
    });
    const usuario = userEvent.setup();
    renderApp(`/ventas/${VENTA_ID}`);
    // "Venta sin factura": el detalle indica que no tiene (vale "Sin factura" o "Sin facturar: $ 3.300,00").
    expect((await screen.findAllByText(/Sin factura/)).length).toBeGreaterThan(0);

    await usuario.click(await screen.findByRole('button', { name: 'Pedir factura' }));

    const facturas = await screen.findByRole('list', { name: 'Facturas' });
    await waitFor(() => expect(facturas).toHaveTextContent('En trámite'));
    expect(facturas).toHaveTextContent(/3\.300,00/);
    expect(screen.queryByRole('button', { name: 'Pedir factura' })).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
  });

  it('si el admin la pide fuera de plazo (422), muestra el motivo', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [`GET /ventas/${VENTA_ID}`]: [
        200,
        ventaDetalle({ pagos: [{ medio: 'efectivo', monto: '3300.00' }], puedePedirFactura: true }),
      ],
      [`POST /ventas/${VENTA_ID}/factura`]: [
        422,
        {
          error: {
            codigo: 'FACTURA_FUERA_DE_PLAZO',
            mensaje: 'Ya pasaron más de 5 días: ARCA no deja facturar esta venta.',
          },
        },
      ],
    });
    const usuario = userEvent.setup();
    renderApp(`/ventas/${VENTA_ID}`);

    await usuario.click(await screen.findByRole('button', { name: 'Pedir factura' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya pasaron más de 5 días: ARCA no deja facturar esta venta.',
    );
  });

  it('venta 100% en débito con la factura en trámite: la muestra y no ofrece pedir otra', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      [`GET /ventas/${VENTA_ID}`]: [
        200,
        ventaDetalle({ facturas: [facturaSinAutorizar('3300.00')] }),
      ],
    });
    renderApp(`/ventas/${VENTA_ID}`);

    const facturas = await screen.findByRole('list', { name: 'Facturas' });
    expect(facturas).toHaveTextContent('En trámite');
    expect(screen.queryByRole('button', { name: 'Pedir factura' })).not.toBeInTheDocument();
  });

  it('reimprimir una venta con factura autorizada imprime su bloque fiscal', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      [`GET /ventas/${VENTA_ID}`]: [
        200,
        ventaDetalle({ facturas: [facturaAutorizada(42, '3300.00')], sinFacturar: '0.00' }),
      ],
    });
    const usuario = userEvent.setup();
    renderApp(`/ventas/${VENTA_ID}`);

    await usuario.click(await screen.findByRole('button', { name: 'Reimprimir ticket' }));

    expect(window.print).toHaveBeenCalledTimes(1);
    const ticket = screen.getByTestId('ticket');
    expect(within(ticket).getAllByTestId('bloque-factura')).toHaveLength(1);
    expect(ticket).toHaveTextContent('00005-00000042');
  });
});

describe('aviso antes de anular una venta facturada', () => {
  it('lista las dos facturas vigentes con su importe y dice que la nota de crédito se hace por fuera', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      [`GET /ventas/${VENTA_ID}`]: [
        200,
        ventaDetalle({
          total: '5000.00',
          pagos: PAGOS_MIXTOS,
          facturas: [facturaAutorizada(42, '3000.00'), facturaAutorizada(43, '2000.00', 'efectivo')],
          sinFacturar: '0.00',
        }),
      ],
    });
    const usuario = userEvent.setup();
    renderApp(`/ventas/${VENTA_ID}`);

    await usuario.click(await screen.findByRole('button', { name: 'Anular venta' }));

    const form = screen.getByRole('form', { name: 'Anular venta' });
    expect(form).toHaveTextContent(/Factura C 00005-00000042.*3\.000,00/);
    expect(form).toHaveTextContent(/Factura C 00005-00000043.*2\.000,00/);
    expect(form).toHaveTextContent(/vigente/);
    expect(form).toHaveTextContent(/nota de crédito/);
    expect(form).toHaveTextContent(/por fuera/);
  });

  it('con la automática autorizada y la del efectivo en trámite, avisa solo por la autorizada', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      [`GET /ventas/${VENTA_ID}`]: [
        200,
        ventaDetalle({
          total: '5000.00',
          pagos: PAGOS_MIXTOS,
          facturas: [facturaAutorizada(42, '3000.00'), facturaSinAutorizar('2000.00', 'efectivo')],
          sinFacturar: '2000.00',
        }),
      ],
    });
    const usuario = userEvent.setup();
    renderApp(`/ventas/${VENTA_ID}`);

    await usuario.click(await screen.findByRole('button', { name: 'Anular venta' }));

    const form = screen.getByRole('form', { name: 'Anular venta' });
    expect(form).toHaveTextContent('00005-00000042');
    expect(form).not.toHaveTextContent(/2\.000,00/);
  });

  it('sin facturas autorizadas no avisa nada de facturas', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      [`GET /ventas/${VENTA_ID}`]: [
        200,
        ventaDetalle({ facturas: [facturaSinAutorizar('3300.00')] }),
      ],
    });
    const usuario = userEvent.setup();
    renderApp(`/ventas/${VENTA_ID}`);

    await usuario.click(await screen.findByRole('button', { name: 'Anular venta' }));

    const form = screen.getByRole('form', { name: 'Anular venta' });
    expect(form).not.toHaveTextContent(/Factura C/);
    expect(form).not.toHaveTextContent(/nota de crédito/);
  });
});

describe('marca de factura en el listado', () => {
  const resumen = (numero: number, total: string, importeFacturado: string) => ({
    id: `0198a5b0-0000-7000-8000-0000000003${numero}`,
    numero,
    creadaEn: '2026-11-10T13:00:00.000Z',
    usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
    total,
    estado: 'pagada',
    medios: ['debito'],
    importeFacturado,
  });

  it('"Factura" si está todo facturado, "Factura parcial" si falta una parte y nada si no tiene', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /ventas?pagina=1': [
        200,
        [
          resumen(12, '3300.00', '3300.00'),
          resumen(11, '5000.00', '3000.00'),
          resumen(10, '3300.00', '0.00'),
          resumen(13, '5000.00', '0.01'),
        ],
      ],
    });
    renderApp('/ventas');

    const tabla = await screen.findByRole('table');
    const fila = (numero: number) =>
      within(tabla).getByRole('link', { name: `#${numero}` }).closest('tr')!;
    expect(within(fila(12)).getByText('Factura', { exact: true })).toBeInTheDocument();
    expect(fila(12)).not.toHaveTextContent('Factura parcial');
    expect(within(fila(11)).getByText('Factura parcial')).toBeInTheDocument();
    expect(within(fila(13)).getByText('Factura parcial')).toBeInTheDocument();
    expect(fila(10)).not.toHaveTextContent(/Factura/);
  });
});
