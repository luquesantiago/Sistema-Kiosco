import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatearFechaHora, hoyEnArgentina } from '../src/lib/fechas.js';
import { ADMIN, EMPLEADO, renderApp, simularApi } from './ayudas.js';

/*
 * Pantallas de listados y del admin del cambio cobro-mercado-pago: ventas en espera
 * y canceladas en Ventas, "Cobros a revisar" en Administración → Mercado Pago y la
 * línea "Devoluciones" del detalle de un turno.
 *
 * Textos exigidos tal cual: "En espera", "Cobro no realizado", "Venció la espera",
 * "Devolución en efectivo pendiente" y "Devoluciones".
 * Supuestos (el design no los fija):
 * - El detalle de la venta trae `cancelacion: { en, motivo }` y se muestra la fecha con
 *   `formatearFechaHora`, como la de la anulación.
 * - "Cobros a revisar" es una región con ese nombre, con un ítem de lista por cobro; los
 *   que se pueden revisar tienen un campo "Nota" y un botón "Marcar revisado" que se
 *   habilita con 3 letras o más (la nota es obligatoria, de 3 a 200 caracteres).
 * - `GET /mercado-pago/cobros-a-revisar` devuelve `{ id, ventaId, ventaNumero, estado,
 *   monto, medio, creadoEn, motivo }`.
 */

const HOY = hoyEnArgentina();
const PRIMERO_DEL_MES = `${HOY.slice(0, 8)}01`;

const BASE_RESUMEN = {
  creadaEn: '2026-11-09T13:00:00.000Z',
  usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
  total: '3300.00',
  medios: ['debito'],
  importeFacturado: '0.00',
};
const PAGADA = { ...BASE_RESUMEN, id: '0198a5b0-0000-7000-8000-000000000301', numero: 120, estado: 'pagada' };
const EN_ESPERA = { ...BASE_RESUMEN, id: '0198a5b0-0000-7000-8000-000000000302', numero: 121, estado: 'pendiente' };
const CANCELADA = { ...BASE_RESUMEN, id: '0198a5b0-0000-7000-8000-000000000303', numero: 122, estado: 'cancelada' };

const CANCELADA_EN = '2026-11-09T13:10:00.000Z';

function detalle(resumen: typeof PAGADA, cambios: Record<string, unknown> = {}) {
  return {
    ...resumen,
    items: [
      { productoId: null, descripcion: 'Recarga', cantidad: 1, precioUnitario: '3300.00', subtotal: '3300.00' },
    ],
    pagos: [{ medio: 'debito', monto: '3300.00', montoRecibido: null, vuelto: null }],
    anulacion: null,
    cancelacion: null,
    facturas: [],
    sinFacturar: '3300.00',
    puedePedirFactura: false,
    emisor: null,
    cobro: null,
    ...cambios,
  };
}

beforeEach(() => {
  vi.stubGlobal('print', vi.fn());
});

describe('ventas en espera y canceladas en el listado', () => {
  it('el listado muestra "En espera" y "Cobro no realizado"', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /ventas?pagina=1': [200, [CANCELADA, EN_ESPERA, PAGADA]],
    });
    renderApp('/ventas');

    const tabla = await screen.findByRole('table');
    const fila = (numero: string) => within(tabla).getByRole('link', { name: numero }).closest('tr')!;
    expect(fila('#121')).toHaveTextContent('En espera');
    expect(fila('#122')).toHaveTextContent('Cobro no realizado');
    expect(fila('#120')).not.toHaveTextContent(/En espera|Cobro no realizado/);
  });

  it('el admin revisa una venta cancelada por vencimiento: estado, motivo y fecha, sin ticket ni anulación', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [`GET /ventas/${CANCELADA.id}`]: [
        200,
        detalle(CANCELADA, { cancelacion: { en: CANCELADA_EN, motivo: 'Venció la espera' } }),
      ],
    });
    renderApp(`/ventas/${CANCELADA.id}`);

    await screen.findByRole('heading', { name: 'Venta #122' });
    expect(screen.getByText('Cobro no realizado')).toBeInTheDocument();
    const motivo = screen.getByText(/Venció la espera/);
    expect(motivo).toHaveTextContent(formatearFechaHora(CANCELADA_EN));
    expect(screen.queryByRole('button', { name: 'Reimprimir ticket' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anular venta' })).not.toBeInTheDocument();
  });

  it('una venta en espera se ve "En espera" y su ticket no se puede imprimir', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      [`GET /ventas/${EN_ESPERA.id}`]: [200, detalle(EN_ESPERA)],
    });
    renderApp(`/ventas/${EN_ESPERA.id}`);

    await screen.findByRole('heading', { name: 'Venta #121' });
    expect(screen.getByText('En espera')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reimprimir ticket' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anular venta' })).not.toBeInTheDocument();
  });
});

describe('cobros a revisar para el admin', () => {
  const A_REVISAR = {
    id: '0198a5b0-0000-7000-8000-000000000501',
    ventaId: EN_ESPERA.id,
    ventaNumero: 121,
    estado: 'a_revisar',
    monto: '3300.00',
    medio: 'credito',
    creadoEn: '2026-11-09T13:00:00.000Z',
    motivo: 'el Point pidió revisar el pago',
  };
  const A_DEVOLVER = {
    ...A_REVISAR,
    id: '0198a5b0-0000-7000-8000-000000000502',
    ventaId: CANCELADA.id,
    ventaNumero: 120,
    estado: 'a_devolver',
    monto: '3000.00',
    medio: 'debito',
    motivo: 'se aprobó después de cancelar la venta',
  };
  const SIN_DEVOLVER = {
    ...A_REVISAR,
    id: '0198a5b0-0000-7000-8000-000000000503',
    ventaNumero: 119,
    estado: 'sin_devolver',
    monto: '1500.00',
    medio: 'mercado_pago',
    motivo: 'el cliente se fue sin la devolución en efectivo',
  };

  function pantalla(lista: { actual: unknown[] }, revisados: unknown[] = []) {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /mercado-pago/saldo': [200, { estado: 'no_configurado' }],
      [`GET /caja/movimientos-mp?desde=${PRIMERO_DEL_MES}&hasta=${HOY}&pagina=1`]: [200, []],
      'GET /mercado-pago/cobros-a-revisar': () => [200, lista.actual],
      [`POST /mercado-pago/cobros/${SIN_DEVOLVER.id}/revisado`]: (cuerpo) => {
        revisados.push(cuerpo);
        lista.actual = lista.actual.filter((c) => (c as { id: string }).id !== SIN_DEVOLVER.id);
        return [200, { ...SIN_DEVOLVER, notaRevision: 'devuelto por la app' }];
      },
    });
    renderApp('/admin/mercado-pago');
  }

  async function itemDe(ventaNumero: number) {
    const region = await screen.findByRole('region', { name: 'Cobros a revisar' });
    const items = await within(region).findAllByRole('listitem');
    const item = items.find((i) => i.textContent?.includes(`#${ventaNumero}`));
    if (!item) throw new Error(`No está el cobro de la venta #${ventaNumero}`);
    return item;
  }

  it('muestra cada cobro con monto, medio, venta y motivo', async () => {
    pantalla({ actual: [A_REVISAR, A_DEVOLVER, SIN_DEVOLVER] });

    const revisar = await itemDe(121);
    expect(revisar).toHaveTextContent(/\$\s?3\.300,00/);
    expect(revisar).toHaveTextContent('Crédito');
    expect(revisar).toHaveTextContent('el Point pidió revisar el pago');
    expect(await itemDe(119)).toHaveTextContent('Mercado Pago');
  });

  it('la devolución pendiente figura como "Devolución en efectivo pendiente", sin la opción de revisarla', async () => {
    pantalla({ actual: [A_REVISAR, A_DEVOLVER, SIN_DEVOLVER] });

    const devolucion = await itemDe(120);

    expect(devolucion).toHaveTextContent('Devolución en efectivo pendiente');
    expect(devolucion).toHaveTextContent(/\$\s?3\.000,00/);
    expect(within(devolucion).queryByRole('button', { name: 'Marcar revisado' })).not.toBeInTheDocument();
    expect(within(await itemDe(121)).getByRole('button', { name: 'Marcar revisado' })).toBeInTheDocument();
  });

  it('el admin resuelve un cobro que no se pudo devolver: la nota es obligatoria y después deja de figurar', async () => {
    const revisados: unknown[] = [];
    pantalla({ actual: [A_REVISAR, A_DEVOLVER, SIN_DEVOLVER] }, revisados);
    const item = await itemDe(119);
    const boton = within(item).getByRole('button', { name: 'Marcar revisado' });

    expect(boton).toBeDisabled();
    await userEvent.type(within(item).getByLabelText('Nota'), 'ok');
    expect(boton).toBeDisabled();
    await userEvent.clear(within(item).getByLabelText('Nota'));
    await userEvent.type(within(item).getByLabelText('Nota'), 'devuelto por la app');
    expect(boton).toBeEnabled();
    await userEvent.click(boton);

    await waitFor(() => expect(revisados).toEqual([{ nota: 'devuelto por la app' }]));
    const region = screen.getByRole('region', { name: 'Cobros a revisar' });
    await waitFor(() => expect(region).not.toHaveTextContent('#119'));
    expect(region).toHaveTextContent('#120');
  });
});

describe('detalle del turno', () => {
  it('la línea del esperado se llama "Devoluciones" e incluye la devolución de un cobro', async () => {
    const turnoId = '0198a5b0-0000-7000-8000-000000000401';
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [`GET /caja/turnos/${turnoId}`]: [
        200,
        {
          id: turnoId,
          responsable: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
          cerradoPor: null,
          abiertoEn: '2026-11-09T13:00:00.000Z',
          cerradoEn: null,
          montoSugerido: '52000.00',
          montoInicial: '52000.00',
          diferenciaApertura: '0.00',
          diferencia: null,
          resumen: {
            cantidadVentas: 0,
            porMedio: { efectivo: '0.00', debito: '0.00', credito: '0.00', mercado_pago: '0.00' },
            montoInicial: '52000.00',
            efectivoVendido: '0.00',
            ingresos: '0.00',
            gastos: '0.00',
            retiros: '0.00',
            pagosProveedor: '0.00',
            devoluciones: '3000.00',
            esperado: '49000.00',
          },
          montoContado: null,
          retiroCierre: null,
          motivoRetiroCierre: null,
          quedoEnCaja: null,
          movimientos: [
            {
              id: '0198a5b0-0000-7000-8000-000000000601',
              tipo: 'devolucion_cobro',
              categoria: null,
              cuenta: 'efectivo',
              turnoId,
              monto: '3000.00',
              motivo: 'Devolución de cobro de Mercado Pago · venta #120',
              usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
              creadoEn: '2026-11-09T13:17:00.000Z',
            },
          ],
          anulaciones: [],
        },
      ],
    });
    renderApp(`/admin/turnos/${turnoId}`);

    const efectivo = await screen.findByLabelText('Cálculo del esperado');
    expect(efectivo).toHaveTextContent(/Devoluciones\s*−?\s*\$\s?3\.000,00/);
    expect(efectivo).not.toHaveTextContent('Devoluciones de anulaciones');
    expect(efectivo).toHaveTextContent(/Esperado\s*\$\s?49\.000,00/);
    expect(screen.getByRole('list', { name: 'Movimientos' })).toHaveTextContent(
      'Devolución de cobro de Mercado Pago · venta #120',
    );
  });
});
