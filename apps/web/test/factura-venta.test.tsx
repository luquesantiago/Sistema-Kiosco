import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPLEADO, renderApp, simularApi } from './ayudas.js';
import {
  facturaAutorizada,
  facturaSinAutorizar,
  PAGOS_MIXTOS,
  VENTA_ID,
  ventaDetalle,
} from './factura-datos.js';

/*
 * Pantalla de venta con facturación (specs/punto-de-venta: "Pedir factura desde
 * el mostrador" e "Imprimir con la factura en trámite").
 *
 * Contrato que asume este test:
 * - `GET /caja/estado` suma `facturacionHabilitada` (design, tarea 4.3).
 * - La franja "Última venta" ofrece un botón **Pedir factura** o, en una venta
 *   mixta, **Facturar efectivo ($ 2.000,00)**, y F10 hace lo mismo.
 * - Muestra "Factura en trámite" o "Factura 00005-00000042" por cada factura.
 * - F9 con una factura en trámite consulta `GET /ventas/:id` cada 1 s hasta 5 s.
 *
 * El archivo no se llama `Venta.test.tsx` (como dice tasks.md) porque en Windows
 * chocaría con el `venta.test.tsx` existente.
 */

const PRODUCTO = {
  id: '0198a5b0-0000-7000-8000-000000000201',
  codigoBarras: '111',
  nombre: 'Gaseosa grande',
  precio: '3300.00',
  stockActual: 5,
};

const TURNO_PROPIO = {
  turnoAbierto: {
    id: '0198a5b0-0000-7000-8000-000000000401',
    responsable: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
    abiertoEn: '2026-11-10T10:00:00.000Z',
    esMio: true,
  },
  montoSugerido: '0.00',
};

type Respuesta = [number, unknown?];
type Manejador = ((cuerpo: unknown) => Respuesta | Promise<Respuesta>) | Respuesta;

function mostrador(
  venta: ReturnType<typeof ventaDetalle>,
  extra: Record<string, Manejador> = {},
  facturacionHabilitada = true,
) {
  return simularApi({
    'GET /auth/sesion': [200, EMPLEADO],
    'GET /caja/estado': [200, { ...TURNO_PROPIO, facturacionHabilitada }],
    'GET /productos?q=111&pagina=1': [200, [PRODUCTO]],
    'POST /ventas': [201, venta],
    ...extra,
  });
}

async function escaner() {
  return screen.findByRole('combobox', { name: 'Escaneá o buscá un producto' });
}

/** Escanea un producto y cobra con F2 + Enter; devuelve la franja de la última venta. */
async function cobrar(usuario = userEvent.setup()) {
  const campo = await escaner();
  await usuario.type(campo, '111{Enter}');
  await waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('3.300,00'));
  await usuario.keyboard('{F2}');
  await screen.findByRole('dialog');
  await usuario.keyboard('{Enter}');
  return screen.findByRole('region', { name: 'Última venta' });
}

const llamadas = (fetchMock: ReturnType<typeof simularApi>, metodo: string, url: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === metodo)
    .length;

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('print', vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

describe('pedir factura con F10', () => {
  const EN_EFECTIVO = ventaDetalle({
    pagos: [{ medio: 'efectivo', monto: '3300.00' }],
    puedePedirFactura: true,
  });

  it('después de cobrar en efectivo, F10 pide la factura, muestra que está en trámite y el escaneo sigue enfocado', async () => {
    const fetchMock = mostrador(EN_EFECTIVO, {
      [`POST /ventas/${VENTA_ID}/factura`]: [201, facturaSinAutorizar('3300.00', 'efectivo')],
      [`GET /ventas/${VENTA_ID}`]: [
        200,
        { ...EN_EFECTIVO, facturas: [facturaSinAutorizar('3300.00', 'efectivo')], puedePedirFactura: false },
      ],
    });
    renderApp('/venta');
    const ultima = await cobrar();
    expect(within(ultima).getByRole('button', { name: /Pedir factura/ })).toBeInTheDocument();
    const campo = await escaner();
    expect(campo).toHaveFocus();

    // F10 no tiene que llegar al navegador (abre la barra de menú).
    const noPrevenido = fireEvent.keyDown(campo, { key: 'F10' });

    expect(noPrevenido).toBe(false);
    await waitFor(() => expect(ultima).toHaveTextContent('Factura en trámite'));
    expect(llamadas(fetchMock, 'POST', `/api/ventas/${VENTA_ID}/factura`)).toBe(1);
    expect(campo).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Ya pedida: F10 no la vuelve a pedir.
    fireEvent.keyDown(campo, { key: 'F10' });
    await act(async () => {});
    expect(llamadas(fetchMock, 'POST', `/api/ventas/${VENTA_ID}/factura`)).toBe(1);
  });

  it('el botón Pedir factura hace lo mismo y deja el foco en el escaneo', async () => {
    const fetchMock = mostrador(EN_EFECTIVO, {
      [`POST /ventas/${VENTA_ID}/factura`]: [201, facturaSinAutorizar('3300.00', 'efectivo')],
      [`GET /ventas/${VENTA_ID}`]: [
        200,
        { ...EN_EFECTIVO, facturas: [facturaSinAutorizar('3300.00', 'efectivo')], puedePedirFactura: false },
      ],
    });
    const usuario = userEvent.setup();
    renderApp('/venta');
    const ultima = await cobrar(usuario);

    await usuario.click(within(ultima).getByRole('button', { name: /Pedir factura/ }));

    await waitFor(() => expect(ultima).toHaveTextContent('Factura en trámite'));
    expect(llamadas(fetchMock, 'POST', `/api/ventas/${VENTA_ID}/factura`)).toBe(1);
    expect(await escaner()).toHaveFocus();
  });

  it('la referencia de atajos incluye F10', async () => {
    mostrador(EN_EFECTIVO);
    renderApp('/venta');

    const pie = await screen.findByRole('contentinfo', { name: 'Atajos de teclado' });
    expect(within(pie).getByText('F10')).toBeInTheDocument();
    expect(pie).toHaveTextContent(/F10\s*Pedir factura/);
  });
});

describe('qué ofrece la franja de la última venta', () => {
  it('venta mixta: muestra la automática de $3.000 y ofrece "Facturar efectivo ($ 2.000,00)"', async () => {
    mostrador(
      ventaDetalle({
        total: '5000.00',
        pagos: PAGOS_MIXTOS,
        facturas: [facturaSinAutorizar('3000.00')],
        sinFacturar: '5000.00',
        puedePedirFactura: true,
      }),
    );
    renderApp('/venta');

    const ultima = await cobrar();

    expect(ultima).toHaveTextContent('Factura en trámite');
    expect(ultima).toHaveTextContent(/3\.000,00/);
    expect(
      within(ultima).getByRole('button', { name: /Facturar efectivo \(\$\s?2\.000(,00)?\)/ }),
    ).toBeInTheDocument();
    expect(within(ultima).queryByRole('button', { name: /^Pedir factura/ })).not.toBeInTheDocument();
  });

  it('con la factura autorizada muestra su número', async () => {
    mostrador(
      ventaDetalle({ facturas: [facturaAutorizada(42, '3300.00')], sinFacturar: '0.00' }),
    );
    renderApp('/venta');

    const ultima = await cobrar();

    expect(ultima).toHaveTextContent('Factura 00005-00000042');
  });

  it.each([
    [
      'venta 100% en débito',
      ventaDetalle({ facturas: [facturaSinAutorizar('3300.00')] }),
      true,
    ],
    [
      'el efectivo ya tiene factura',
      ventaDetalle({
        pagos: [{ medio: 'efectivo', monto: '3300.00' }],
        facturas: [facturaSinAutorizar('3300.00', 'efectivo')],
      }),
      true,
    ],
    [
      'la facturación no está configurada',
      ventaDetalle({
        pagos: [{ medio: 'efectivo', monto: '3300.00' }],
        emisor: null,
        puedePedirFactura: false,
      }),
      false,
    ],
    [
      'la caja dice que no hay facturación aunque la venta tenga efectivo sin facturar',
      ventaDetalle({ pagos: [{ medio: 'efectivo', monto: '3300.00' }], puedePedirFactura: true }),
      false,
    ],
  ] as const)('%s: no ofrece pedir factura y F10 no hace nada', async (_caso, venta, habilitada) => {
    const fetchMock = mostrador(venta, {}, habilitada);
    renderApp('/venta');

    const ultima = await cobrar();
    fireEvent.keyDown(await escaner(), { key: 'F10' });
    await act(async () => {});

    expect(within(ultima).queryByRole('button', { name: /Pedir factura|Facturar efectivo/ })).toBeNull();
    expect(llamadas(fetchMock, 'POST', `/api/ventas/${VENTA_ID}/factura`)).toBe(0);
  });

  it('sin facturación configurada, la referencia de atajos no ofrece F10', async () => {
    mostrador(ventaDetalle(), {}, false);
    renderApp('/venta');

    const pie = await screen.findByRole('contentinfo', { name: 'Atajos de teclado' });
    expect(pie).not.toHaveTextContent('F10');
  });
});

describe('F9 con la factura en trámite', () => {
  const EN_DEBITO = ventaDetalle({ facturas: [facturaSinAutorizar('3300.00')] });
  const AUTORIZADA = ventaDetalle({
    facturas: [facturaAutorizada(42, '3300.00')],
    sinFacturar: '0.00',
  });

  /** Cobra con los timers falsos (avanzan solos con el reloj real) y presiona F9. */
  async function cobrarYPresionarF9(autorizaALosMs: number | null) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let presionadoEn = Number.POSITIVE_INFINITY;
    mostrador(EN_DEBITO, {
      [`GET /ventas/${VENTA_ID}`]: () => [
        200,
        autorizaALosMs !== null && Date.now() - presionadoEn >= autorizaALosMs
          ? AUTORIZADA
          : EN_DEBITO,
      ],
    });
    renderApp('/venta');
    await cobrar(userEvent.setup({ advanceTimers: vi.advanceTimersByTime }));
    presionadoEn = Date.now();
    fireEvent.keyDown(await escaner(), { key: 'F9' });
  }

  it('si se autoriza a los 3 s, imprime el ticket con el bloque fiscal de esa factura', async () => {
    await cobrarYPresionarF9(3_000);

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(window.print).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    const ticket = screen.getByTestId('ticket');
    expect(within(ticket).getAllByTestId('bloque-factura')).toHaveLength(1);
    expect(ticket).toHaveTextContent('FACTURA C');
    expect(ticket).not.toHaveTextContent('Factura en trámite');
  });

  it('si a los 5 s sigue sin autorizar, imprime con "Factura en trámite: $3.300,00 – pedila de nuevo desde Ventas"', async () => {
    await cobrarYPresionarF9(null);

    await act(() => vi.advanceTimersByTimeAsync(4_000));
    expect(window.print).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    const ticket = screen.getByTestId('ticket');
    expect(ticket).toHaveTextContent(
      /Factura en trámite: \$\s?3\.300,00 – pedila de nuevo desde Ventas/,
    );
    expect(within(ticket).queryAllByTestId('bloque-factura')).toEqual([]);
  });

  it('con la factura ya autorizada imprime en el momento, sin esperar', async () => {
    mostrador(AUTORIZADA);
    renderApp('/venta');
    await cobrar();

    await act(async () => {
      fireEvent.keyDown(await escaner(), { key: 'F9' });
    });

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('ticket')).toHaveTextContent('FACTURA C');
  });
});
