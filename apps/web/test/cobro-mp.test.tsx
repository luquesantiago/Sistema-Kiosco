import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPLEADO, renderApp, simularApi } from './ayudas.js';

/*
 * Mostrador con el Point integrado (cambio cobro-mercado-pago): pantalla de espera
 * del cobro, pago mixto, retomar al recargar, aviso de devolución pendiente y
 * cierre del turno bloqueado.
 *
 * Textos exigidos tal cual (spec o design): "Pasá la tarjeta por el Point", "Mostrale el
 * QR del Point al cliente", "Rechazado: tarjeta rechazada por el banco", "Cancelando en
 * el Point…", "El cliente llegó a pagar: la venta quedó cobrada", el texto de "Mercado
 * Pago no responde", "Cobrá $X en efectivo · vuelto $Y", "Entró un pago de $X de un
 * cobro cancelado (venta #N): devolvé $X en efectivo", "Ya devolví $X" y "El cliente ya
 * se fue". Los montos se aceptan con o sin el espacio que pone `formatearPesos`.
 *
 * Supuestos (el design no los fija; se eligió lo más simple):
 * - `GET /caja/estado` trae `pointHabilitado: true` y `devolucionesPendientes` solo con el
 *   Point configurado; sin eso el mostrador funciona como antes y no pide
 *   `GET /ventas/en-espera`.
 * - La pantalla de espera es un diálogo llamado "Cobro en el Point". Sus botones se
 *   llaman "Reintentar (Enter)", "Cobrar de otra forma" y "Cancelar (Esc)"; Cancelar pide
 *   confirmación con `window.confirm`, como vaciar el carrito.
 * - El estado del cobro se pide cada 1 s a `GET /ventas/:id/cobro`; con el cobro
 *   `creando` (la creación no tuvo respuesta) se muestra el texto de "no responde".
 * - Reintentar es `POST /ventas/:id/cobro/reintentar` (responde el cobro); Cobrar de otra
 *   forma y Cancelar son `POST /ventas/:id/cancelar` (responde la venta).
 * - El pago mixto con el Point suma un campo "Paga con (opcional)" para el efectivo.
 * - El aviso de devolución es un diálogo modal con los dos botones; el estado de la caja
 *   se vuelve a pedir cada 5 s.
 */

const ALFAJOR = {
  id: '0198a5b0-0000-7000-8000-000000000201',
  codigoBarras: '111',
  nombre: 'Alfajor',
  precio: '900.00',
  stockActual: 5,
};
const GASEOSA = {
  id: '0198a5b0-0000-7000-8000-000000000202',
  codigoBarras: '222',
  nombre: 'Gaseosa',
  precio: '1500.00',
  stockActual: 5,
};
const VINO = {
  id: '0198a5b0-0000-7000-8000-000000000203',
  codigoBarras: '333',
  nombre: 'Vino',
  precio: '2000.00',
  stockActual: 5,
};

const busqueda = (q: string) => `GET /productos?q=${q}&pagina=1`;

const TURNO_ID = '0198a5b0-0000-7000-8000-000000000401';
const VENTA_ID = '0198a5b0-0000-7000-8000-000000000301';
const COBRO_ID = '0198a5b0-0000-7000-8000-000000000501';
const OTRA = { id: '0198a5b0-0000-7000-8000-000000000003', nombre: 'Ana Empleada' };

const TEXTO_NO_RESPONDE =
  'Mercado Pago no responde. Por ahora cobrá solo en efectivo (F1) o reintentá en un rato.';

type Respuesta = [number, unknown];
type Manejadores = Record<string, Respuesta | ((cuerpo: unknown) => Respuesta)>;

interface Devolucion {
  cobroId: string;
  monto: string;
  ventaNumero: number;
}

function estadoConPoint(devolucionesPendientes: Devolucion[] = [], esMio = true) {
  return {
    turnoAbierto: {
      id: TURNO_ID,
      responsable: esMio ? { id: EMPLEADO.id, nombre: EMPLEADO.nombre } : OTRA,
      abiertoEn: '2026-11-09T13:00:00.000Z',
      esMio,
    },
    montoSugerido: '0.00',
    pointHabilitado: true,
    devolucionesPendientes,
  };
}

const ESTADO_POINT = estadoConPoint();

function cobroMp(estado: string, cambios: Record<string, unknown> = {}) {
  return {
    id: COBRO_ID,
    ventaId: VENTA_ID,
    intento: 1,
    medio: 'debito',
    monto: '3300.00',
    estado,
    motivo: null,
    cancelacionPedida: false,
    ...cambios,
  };
}

interface Pago {
  medio: string;
  monto: string;
  montoRecibido: string | null;
  vuelto: string | null;
}

/** La venta de 2 alfajores y 1 gaseosa ($3.300), con los pagos y el estado dados. */
function venta(
  estado: string,
  {
    pagos = [{ medio: 'debito', monto: '3300.00', montoRecibido: null, vuelto: null }] as Pago[],
    cobro = null as unknown,
    total = '3300.00',
    items = [
      {
        productoId: ALFAJOR.id,
        descripcion: 'Alfajor',
        cantidad: 2,
        precioUnitario: '900.00',
        subtotal: '1800.00',
      },
      {
        productoId: GASEOSA.id,
        descripcion: 'Gaseosa',
        cantidad: 1,
        precioUnitario: '1500.00',
        subtotal: '1500.00',
      },
    ] as unknown[],
  } = {},
) {
  return {
    id: VENTA_ID,
    numero: 120,
    creadaEn: '2026-11-09T13:00:00.000Z',
    usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
    total,
    estado,
    medios: pagos.map((p) => p.medio),
    importeFacturado: '0.00',
    items,
    pagos,
    anulacion: null,
    cancelacion: null,
    facturas: [],
    sinFacturar: total,
    puedePedirFactura: false,
    emisor: null,
    cobro,
  };
}

const BASE: Manejadores = {
  'GET /auth/sesion': [200, EMPLEADO],
  'GET /caja/estado': [200, ESTADO_POINT],
  'GET /ventas/en-espera': [200, null],
  [busqueda('111')]: [200, [ALFAJOR]],
  [busqueda('222')]: [200, [GASEOSA]],
  [busqueda('333')]: [200, [VINO]],
};

/**
 * API de un cobro por el Point: `POST /ventas` deja la venta en espera con el cobro
 * inicial y `GET /ventas/:id/cobro` devuelve `cobro.actual`, que cada test cambia.
 */
function apiDeCobro(inicial: ReturnType<typeof cobroMp>, extra: Manejadores = {}) {
  const cobro = { actual: inicial };
  const enviados: unknown[] = [];
  const fetchMock = simularApi({
    ...BASE,
    'POST /ventas': (cuerpo) => {
      enviados.push(cuerpo);
      return [201, venta('pendiente', { cobro: cobro.actual })];
    },
    [`GET /ventas/${VENTA_ID}/cobro`]: () => [200, cobro.actual],
    [`GET /ventas/${VENTA_ID}`]: () => [
      200,
      venta(cobro.actual.estado === 'aprobado' ? 'pagada' : 'pendiente', { cobro: cobro.actual }),
    ],
    ...extra,
  });
  return { cobro, enviados, fetchMock };
}

function llamadas(fetchMock: ReturnType<typeof simularApi>, metodo: string, url: string) {
  return fetchMock.mock.calls.filter(
    ([u, init]) => String(u) === `/api${url}` && (init?.method ?? 'GET') === metodo,
  );
}

/** `$ 3.300,00` con o sin espacio. */
const pesos = (texto: string) => `\\$\\s?${texto.replace(/\./g, '\\.')}`;

let usuario: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('print', vi.fn());
  // El reloj falso avanza con el real (para que Testing Library pueda esperar) y además
  // se adelanta a mano para los sondeos de 1 s y 5 s.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
});

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

async function avanzar(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

async function escaner() {
  return screen.findByRole('combobox', { name: 'Escaneá o buscá un producto' });
}

function filas() {
  return within(screen.getByRole('table', { name: 'Carrito' }))
    .getAllByRole('row')
    .slice(1);
}

async function escanear(codigos: string[], total: string) {
  const campo = await escaner();
  for (const codigo of codigos) {
    await usuario.type(campo, `${codigo}{Enter}`);
    await waitFor(() => expect(campo).toHaveValue(''));
  }
  await waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent(total));
  return campo;
}

/** 2 alfajores y 1 gaseosa ($3.300). */
const armarCarritoTipico = () => escanear(['111', '222', '111'], '3.300,00');

/** Carrito típico, la tecla del medio y Enter: queda la pantalla de espera. */
async function cobrarConPoint(tecla = '{F2}') {
  await armarCarritoTipico();
  await usuario.keyboard(tecla);
  await screen.findByRole('dialog', { name: /^Cobro en / });
  await usuario.keyboard('{Enter}');
  return screen.findByRole('dialog', { name: 'Cobro en el Point' });
}

describe('pantalla de espera del cobro', () => {
  it('débito: F2 y Enter mandan el cobro al Point y muestran monto, medio e instrucción', async () => {
    const { enviados } = apiDeCobro(cobroMp('en_espera'));
    renderApp('/venta');

    const espera = await cobrarConPoint('{F2}');

    expect(espera).toHaveTextContent(new RegExp(pesos('3.300,00')));
    expect(espera).toHaveTextContent('Débito');
    expect(espera).toHaveTextContent('Pasá la tarjeta por el Point');
    expect(enviados).toEqual([
      expect.objectContaining({ pagos: [{ medio: 'debito', monto: '3300.00' }] }),
    ]);
    // El carrito no se pierde mientras espera.
    expect(filas()).toHaveLength(2);
  });

  it('Mercado Pago (F4): pide mostrarle al cliente el QR del Point', async () => {
    apiDeCobro(cobroMp('en_espera', { medio: 'mercado_pago' }));
    renderApp('/venta');

    const espera = await cobrarConPoint('{F4}');

    expect(espera).toHaveTextContent('Mostrale el QR del Point al cliente');
    expect(espera).toHaveTextContent('Mercado Pago');
  });

  it('el estado se pide solo, cada 1 segundo, sin que el empleado toque nada', async () => {
    const { fetchMock } = apiDeCobro(cobroMp('en_espera'));
    renderApp('/venta');
    await cobrarConPoint();
    const antes = llamadas(fetchMock, 'GET', `/ventas/${VENTA_ID}/cobro`).length;

    await avanzar(3_000);

    expect(llamadas(fetchMock, 'GET', `/ventas/${VENTA_ID}/cobro`).length).toBeGreaterThanOrEqual(
      antes + 2,
    );
  });

  it('pago aprobado: a más tardar 5 s después muestra la venta cobrada, vacía el carrito y deja el escaneo listo', async () => {
    const { cobro } = apiDeCobro(cobroMp('en_espera'));
    renderApp('/venta');
    await cobrarConPoint();

    cobro.actual = cobroMp('aprobado');
    await avanzar(5_000);

    const ultima = await screen.findByRole('region', { name: 'Última venta' });
    expect(ultima).toHaveTextContent('Venta #120 cobrada');
    expect(screen.queryByRole('dialog', { name: 'Cobro en el Point' })).not.toBeInTheDocument();
    expect(screen.getByText('Escaneá un producto para empezar.')).toBeInTheDocument();
    expect(await escaner()).toHaveFocus();
  });

  it('tarjeta rechazada: muestra el motivo y ofrece Reintentar, Cobrar de otra forma y Cancelar', async () => {
    const { cobro } = apiDeCobro(cobroMp('en_espera'));
    renderApp('/venta');
    const espera = await cobrarConPoint();

    cobro.actual = cobroMp('rechazado', { motivo: 'Tarjeta rechazada por el banco' });
    await avanzar(1_000);

    await waitFor(() =>
      expect(espera).toHaveTextContent('Rechazado: tarjeta rechazada por el banco'),
    );
    for (const nombre of [/Reintentar/, /Cobrar de otra forma/, /Cancelar/]) {
      expect(within(espera).getByRole('button', { name: nombre })).toBeEnabled();
    }
  });

  it('cobro vencido en el Point: lo dice y ofrece reintentar', async () => {
    const { cobro } = apiDeCobro(cobroMp('en_espera'));
    renderApp('/venta');
    const espera = await cobrarConPoint();

    cobro.actual = cobroMp('vencido');
    await avanzar(1_000);

    await waitFor(() => expect(espera).toHaveTextContent(/venci/i));
    expect(within(espera).getByRole('button', { name: /Reintentar/ })).toBeEnabled();
  });

  it('Reintentar con Enter después de un rechazo: manda un cobro nuevo por el mismo monto y vuelve a esperar', async () => {
    const reintentos: unknown[] = [];
    const { cobro } = apiDeCobro(cobroMp('en_espera'), {
      [`POST /ventas/${VENTA_ID}/cobro/reintentar`]: (cuerpo) => {
        reintentos.push(cuerpo);
        cobro.actual = cobroMp('en_espera', { intento: 2 });
        return [200, cobro.actual];
      },
    });
    renderApp('/venta');
    const espera = await cobrarConPoint();
    cobro.actual = cobroMp('rechazado', { motivo: 'Tarjeta rechazada por el banco' });
    await avanzar(1_000);
    await waitFor(() => expect(espera).toHaveTextContent(/Rechazado/));

    await usuario.keyboard('{Enter}');

    await waitFor(() => expect(reintentos).toHaveLength(1));
    await waitFor(() => expect(espera).not.toHaveTextContent(/Rechazado/));
    expect(espera).toHaveTextContent('Pasá la tarjeta por el Point');
    expect(espera).toHaveTextContent(new RegExp(pesos('3.300,00')));
  });

  it('Cobrar de otra forma: cancela la venta en espera y vuelve al carrito con los mismos productos', async () => {
    const cancelaciones: unknown[] = [];
    const { cobro } = apiDeCobro(cobroMp('en_espera'), {
      [`POST /ventas/${VENTA_ID}/cancelar`]: () => {
        cancelaciones.push(true);
        cobro.actual = cobroMp('cancelado');
        return [200, venta('cancelada', { cobro: cobro.actual })];
      },
    });
    renderApp('/venta');
    const espera = await cobrarConPoint();
    cobro.actual = cobroMp('rechazado', { motivo: 'Tarjeta rechazada por el banco' });
    await avanzar(1_000);
    await waitFor(() => expect(espera).toHaveTextContent(/Rechazado/));

    await usuario.click(within(espera).getByRole('button', { name: /Cobrar de otra forma/ }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Cobro en el Point' })).not.toBeInTheDocument(),
    );
    expect(cancelaciones).toHaveLength(1);
    expect(filas().map((f) => f.textContent)).toEqual([
      expect.stringMatching(/Alfajor.*2/),
      expect.stringMatching(/Gaseosa.*1/),
    ]);
    expect(screen.getByTestId('total')).toHaveTextContent('3.300,00');
    expect(screen.queryByRole('region', { name: 'Última venta' })).not.toBeInTheDocument();
  });

  it('Cancelar con Esc y confirmación, con el cobro en el Point: "Cancelando en el Point…" hasta que MP confirma, y vuelve al carrito', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const { cobro } = apiDeCobro(cobroMp('en_espera'), {
      [`POST /ventas/${VENTA_ID}/cancelar`]: () => {
        cobro.actual = cobroMp('cancelando', { cancelacionPedida: true });
        return [200, venta('pendiente', { cobro: cobro.actual })];
      },
    });
    renderApp('/venta');
    const espera = await cobrarConPoint();

    await usuario.keyboard('{Escape}');

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(espera).toHaveTextContent('Cancelando en el Point…'));

    cobro.actual = cobroMp('cancelado', { cancelacionPedida: true });
    await avanzar(1_000);

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Cobro en el Point' })).not.toBeInTheDocument(),
    );
    expect(filas()).toHaveLength(2);
    expect(screen.getByTestId('total')).toHaveTextContent('3.300,00');
  });

  it('Esc sin confirmar no cancela: sigue esperando', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    const { fetchMock } = apiDeCobro(cobroMp('en_espera'));
    renderApp('/venta');
    const espera = await cobrarConPoint();

    await usuario.keyboard('{Escape}');

    expect(window.confirm).toHaveBeenCalled();
    expect(llamadas(fetchMock, 'POST', `/ventas/${VENTA_ID}/cancelar`)).toHaveLength(0);
    expect(espera).toBeInTheDocument();
  });

  it('el cliente pagó mientras se cancelaba: avisa y muestra la venta cobrada', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const { cobro } = apiDeCobro(cobroMp('en_espera'), {
      [`POST /ventas/${VENTA_ID}/cancelar`]: () => {
        cobro.actual = cobroMp('cancelando', { cancelacionPedida: true });
        return [200, venta('pendiente', { cobro: cobro.actual })];
      },
    });
    renderApp('/venta');
    const espera = await cobrarConPoint();
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(espera).toHaveTextContent('Cancelando en el Point…'));

    cobro.actual = cobroMp('aprobado', { cancelacionPedida: true });
    await avanzar(1_000);

    expect(
      await screen.findByText('El cliente llegó a pagar: la venta quedó cobrada'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Última venta' })).toHaveTextContent(
      'Venta #120 cobrada',
    );
  });

  it('Mercado Pago no responde al enviar el cobro: el texto exacto con Reintentar, Cobrar de otra forma y Cancelar', async () => {
    apiDeCobro(cobroMp('creando'));
    renderApp('/venta');

    const espera = await cobrarConPoint();

    await waitFor(() => expect(espera).toHaveTextContent(TEXTO_NO_RESPONDE));
    for (const nombre of [/Reintentar/, /Cobrar de otra forma/, /Cancelar/]) {
      expect(within(espera).getByRole('button', { name: nombre })).toBeEnabled();
    }
  });

  it('Mercado Pago caído: Cobrar de otra forma vuelve al carrito con el aviso y no hay forma de registrar el débito a mano', async () => {
    const { cobro, fetchMock } = apiDeCobro(cobroMp('creando'), {
      [`POST /ventas/${VENTA_ID}/cancelar`]: () => {
        cobro.actual = cobroMp('cancelado');
        return [200, venta('cancelada', { cobro: cobro.actual })];
      },
    });
    renderApp('/venta');
    const espera = await cobrarConPoint();
    await waitFor(() => expect(espera).toHaveTextContent(TEXTO_NO_RESPONDE));

    await usuario.click(within(espera).getByRole('button', { name: /Cobrar de otra forma/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(TEXTO_NO_RESPONDE);
    expect(filas()).toHaveLength(2);

    // Volver a cobrar con débito pasa otra vez por el Point: no hay un registro manual.
    cobro.actual = cobroMp('creando');
    await usuario.keyboard('{F2}');
    const dialogo = await screen.findByRole('dialog', { name: 'Cobro en Débito' });
    expect(
      within(dialogo).queryByRole('button', { name: /a mano|manual|sin (el )?Point/i }),
    ).not.toBeInTheDocument();
    expect(within(dialogo).queryByRole('checkbox')).not.toBeInTheDocument();
    await usuario.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Cobro en el Point' });
    expect(llamadas(fetchMock, 'POST', '/ventas')).toHaveLength(2);
  });

  it('la terminal pide revisar el pago: pide mirar el Point y solo ofrece Cancelar', async () => {
    const { cobro } = apiDeCobro(cobroMp('en_espera'));
    renderApp('/venta');
    const espera = await cobrarConPoint();

    cobro.actual = cobroMp('a_revisar');
    await avanzar(1_000);

    await waitFor(() => expect(espera).toHaveTextContent(/mir(á|ar) el Point/i));
    expect(within(espera).getByRole('button', { name: /Cancelar/ })).toBeEnabled();
    expect(within(espera).queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument();
    expect(
      within(espera).queryByRole('button', { name: /Cobrar de otra forma/ }),
    ).not.toBeInTheDocument();
  });

  it('el servidor rechaza un segundo cobro (TERMINAL_OCUPADA): muestra el motivo sin registrar la venta', async () => {
    simularApi({
      ...BASE,
      'POST /ventas': [
        409,
        {
          error: {
            codigo: 'TERMINAL_OCUPADA',
            mensaje: 'El Point está ocupado con otro cobro: terminalo o cancelalo.',
          },
        },
      ],
    });
    renderApp('/venta');
    await armarCarritoTipico();

    await usuario.keyboard('{F3}');
    const dialogo = await screen.findByRole('dialog', { name: 'Cobro en Crédito' });
    await usuario.keyboard('{Enter}');

    await waitFor(() =>
      expect(dialogo).toHaveTextContent(
        'El Point está ocupado con otro cobro: terminalo o cancelalo.',
      ),
    );
    expect(filas()).toHaveLength(2);
  });
});

describe('sin el Point configurado', () => {
  it('F2 y Enter registran la venta con débito como antes, sin pantalla de espera ni ventas en espera', async () => {
    let enviado: { pagos: unknown } | undefined;
    const fetchMock = simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /caja/estado': [
        200,
        { ...ESTADO_POINT, pointHabilitado: undefined, devolucionesPendientes: undefined },
      ],
      [busqueda('111')]: [200, [ALFAJOR]],
      [busqueda('222')]: [200, [GASEOSA]],
      'POST /ventas': (cuerpo) => {
        enviado = cuerpo as { pagos: unknown };
        return [201, venta('pagada')];
      },
    });
    renderApp('/venta');
    await armarCarritoTipico();

    await usuario.keyboard('{F2}');
    await screen.findByRole('dialog', { name: 'Cobro en Débito' });
    await usuario.keyboard('{Enter}');

    expect(await screen.findByRole('region', { name: 'Última venta' })).toHaveTextContent(
      'Venta #120 cobrada',
    );
    expect(enviado?.pagos).toEqual([{ medio: 'debito', monto: '3300.00' }]);
    expect(screen.queryByRole('dialog', { name: 'Cobro en el Point' })).not.toBeInTheDocument();
    expect(llamadas(fetchMock, 'GET', '/ventas/en-espera')).toHaveLength(0);
  });
});

describe('pago mixto con el Point', () => {
  it('con una parte en débito, crédito y Mercado Pago quedan deshabilitados con la explicación', async () => {
    simularApi(BASE);
    renderApp('/venta');
    await armarCarritoTipico();

    await usuario.keyboard('{F6}');
    const dialogo = await screen.findByRole('dialog', { name: 'Pago mixto' });
    await usuario.type(within(dialogo).getByLabelText('Débito'), '1300');

    expect(within(dialogo).getByLabelText('Crédito')).toBeDisabled();
    expect(within(dialogo).getByLabelText('Mercado Pago')).toBeDisabled();
    expect(within(dialogo).getByLabelText('Efectivo')).toBeEnabled();
    expect(dialogo).toHaveTextContent(/solo una parte se cobra con el Point/i);
  });

  it('el Point primero y después el efectivo: al aprobarse muestra "Cobrá $2.000 en efectivo · vuelto $3.000"', async () => {
    const enviados: unknown[] = [];
    const pagosMixtos = [
      { medio: 'efectivo', monto: '2000.00', montoRecibido: '5000.00', vuelto: '3000.00' },
      { medio: 'debito', monto: '3000.00', montoRecibido: null, vuelto: null },
    ];
    const itemsMixtos = [
      {
        productoId: GASEOSA.id,
        descripcion: 'Gaseosa',
        cantidad: 2,
        precioUnitario: '1500.00',
        subtotal: '3000.00',
      },
      {
        productoId: VINO.id,
        descripcion: 'Vino',
        cantidad: 1,
        precioUnitario: '2000.00',
        subtotal: '2000.00',
      },
    ];
    const cobro = { actual: cobroMp('en_espera', { monto: '3000.00' }) };
    const ventaMixta = (estado: string) =>
      venta(estado, {
        pagos: pagosMixtos,
        cobro: cobro.actual,
        total: '5000.00',
        items: itemsMixtos,
      });
    simularApi({
      ...BASE,
      'POST /ventas': (cuerpo) => {
        enviados.push(cuerpo);
        return [201, ventaMixta('pendiente')];
      },
      [`GET /ventas/${VENTA_ID}/cobro`]: () => [200, cobro.actual],
      [`GET /ventas/${VENTA_ID}`]: () => [
        200,
        ventaMixta(cobro.actual.estado === 'aprobado' ? 'pagada' : 'pendiente'),
      ],
    });
    renderApp('/venta');
    await escanear(['222', '222', '333'], '5.000,00');

    await usuario.keyboard('{F6}');
    const dialogo = await screen.findByRole('dialog', { name: 'Pago mixto' });
    await usuario.type(within(dialogo).getByLabelText('Débito'), '3000');
    await usuario.type(within(dialogo).getByLabelText('Efectivo'), '2000');
    await usuario.type(within(dialogo).getByLabelText('Paga con (opcional)'), '5000');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Confirmar (Enter)' }));

    // El Point cobra solo su parte.
    const espera = await screen.findByRole('dialog', { name: 'Cobro en el Point' });
    expect(espera).toHaveTextContent(new RegExp(pesos('3.000,00')));
    expect(enviados).toEqual([
      expect.objectContaining({
        pagos: expect.arrayContaining([
          { medio: 'debito', monto: '3000.00' },
          { medio: 'efectivo', monto: '2000.00', montoRecibido: '5000.00' },
        ]),
      }),
    ]);

    cobro.actual = cobroMp('aprobado', { monto: '3000.00' });
    await avanzar(1_000);

    const ultima = await screen.findByRole('region', { name: 'Última venta' });
    await waitFor(() =>
      expect(ultima).toHaveTextContent(
        new RegExp(`Cobrá ${pesos('2.000,00')} en efectivo · vuelto ${pesos('3.000,00')}`),
      ),
    );
  });
});

describe('retomar un cobro en espera', () => {
  it('al recargar con un cobro esperando en el Point, vuelve a la pantalla de espera con su estado', async () => {
    simularApi({
      ...BASE,
      'GET /ventas/en-espera': [
        200,
        venta('pendiente', { cobro: cobroMp('rechazado', { motivo: 'Fondos insuficientes' }) }),
      ],
      [`GET /ventas/${VENTA_ID}/cobro`]: [
        200,
        cobroMp('rechazado', { motivo: 'Fondos insuficientes' }),
      ],
    });
    renderApp('/venta');

    const espera = await screen.findByRole('dialog', { name: 'Cobro en el Point' });
    expect(espera).toHaveTextContent(new RegExp(pesos('3.300,00')));
    await waitFor(() => expect(espera).toHaveTextContent('Rechazado: fondos insuficientes'));
  });

  it('después de recargar, Cobrar de otra forma devuelve el carrito de esa venta', async () => {
    const cobro = { actual: cobroMp('en_espera') };
    let enEspera: unknown = null;
    simularApi({
      ...BASE,
      'GET /ventas/en-espera': () => [200, enEspera],
      'POST /ventas': () => {
        enEspera = venta('pendiente', { cobro: cobro.actual });
        return [201, enEspera];
      },
      [`GET /ventas/${VENTA_ID}/cobro`]: () => [200, cobro.actual],
      [`POST /ventas/${VENTA_ID}/cancelar`]: () => {
        cobro.actual = cobroMp('cancelado');
        enEspera = null;
        return [200, venta('cancelada', { cobro: cobro.actual })];
      },
    });
    const primera = renderApp('/venta');
    await cobrarConPoint();
    primera.desmontar();

    renderApp('/venta');
    const espera = await screen.findByRole('dialog', { name: 'Cobro en el Point' });
    cobro.actual = cobroMp('rechazado', { motivo: 'Tarjeta rechazada por el banco' });
    await avanzar(1_000);
    await usuario.click(
      await within(espera).findByRole('button', { name: /Cobrar de otra forma/ }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Cobro en el Point' })).not.toBeInTheDocument(),
    );
    expect(filas()).toHaveLength(2);
    expect(screen.getByTestId('total')).toHaveTextContent('3.300,00');
  });

  it('con una venta en espera no deja empezar otro cobro: indica que primero hay que terminarlo o cancelarlo', async () => {
    const { fetchMock } = apiDeCobro(cobroMp('en_espera'));
    renderApp('/venta');
    await cobrarConPoint();

    await usuario.keyboard('{F3}');

    expect(
      await screen.findByText(/primero (hay que )?termin(á|ar) o cancel(á|ar) el cobro en espera/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Cobro en Crédito' })).not.toBeInTheDocument();
    expect(llamadas(fetchMock, 'POST', '/ventas')).toHaveLength(1);
  });
});

describe('ticket de una venta en espera', () => {
  it('F9 no imprime una venta que no quedó pagada', async () => {
    const { cobro } = apiDeCobro(cobroMp('en_espera'), {
      [`POST /ventas/${VENTA_ID}/cancelar`]: () => {
        cobro.actual = cobroMp('cancelado');
        return [200, venta('cancelada', { cobro: cobro.actual })];
      },
    });
    renderApp('/venta');
    const espera = await cobrarConPoint();
    cobro.actual = cobroMp('rechazado', { motivo: 'Tarjeta rechazada por el banco' });
    await avanzar(1_000);
    await usuario.click(
      await within(espera).findByRole('button', { name: /Cobrar de otra forma/ }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Cobro en el Point' })).not.toBeInTheDocument(),
    );

    await act(async () => {
      await usuario.keyboard('{F9}');
    });

    expect(window.print).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Imprimir ticket/ })).not.toBeInTheDocument();
  });
});

describe('aviso de devolución pendiente en el mostrador', () => {
  const DEVOLUCION: Devolucion = { cobroId: COBRO_ID, monto: '3000.00', ventaNumero: 120 };
  const TEXTO_AVISO = new RegExp(
    `Entró un pago de ${pesos('3.000,00')} de un cobro cancelado \\(venta #120\\): devolvé ${pesos('3.000,00')} en efectivo`,
  );

  /** El aviso: el diálogo modal que tiene el botón "El cliente ya se fue". */
  async function aviso() {
    const boton = await screen.findByRole('button', { name: 'El cliente ya se fue' });
    const modal = boton.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]');
    expect(modal).not.toBeNull();
    expect(modal).toHaveTextContent(TEXTO_AVISO);
    return modal!;
  }

  const sinAviso = () =>
    expect(screen.queryByRole('button', { name: 'El cliente ya se fue' })).not.toBeInTheDocument();

  function apiConDevolucion(extra: Manejadores = {}) {
    const caja = { pendientes: [DEVOLUCION] };
    const fetchMock = simularApi({
      ...BASE,
      'GET /caja/estado': () => [200, estadoConPoint(caja.pendientes)],
      ...extra,
    });
    return { caja, fetchMock };
  }

  it('aparece encima de todo con el texto y los dos botones, y no se cierra con Esc ni dejándolo de lado', async () => {
    const { fetchMock } = apiConDevolucion();
    renderApp('/venta');

    const modal = await aviso();
    expect(
      within(modal).getByRole('button', { name: new RegExp(`^Ya devolví ${pesos('3.000,00')}$`) }),
    ).toBeInTheDocument();

    await usuario.keyboard('{Escape}');
    await usuario.click(document.body);
    await aviso();

    // El escaneo está bloqueado: lo que se tipea no busca productos.
    await usuario.keyboard('111{Enter}');
    expect(llamadas(fetchMock, 'GET', '/productos?q=111&pagina=1')).toHaveLength(0);
    expect(screen.queryByText('Alfajor')).not.toBeInTheDocument();
  });

  it('Ya devolví $3.000: lo confirma sin mandar monto, el aviso se cierra y el escaneo vuelve a estar listo', async () => {
    const enviados: unknown[] = [];
    const { caja } = apiConDevolucion({
      [`POST /mercado-pago/cobros/${COBRO_ID}/devolucion`]: (cuerpo) => {
        enviados.push(cuerpo);
        caja.pendientes = [];
        return [200, cobroMp('devuelto', { monto: '3000.00' })];
      },
    });
    renderApp('/venta');
    const modal = await aviso();

    await usuario.click(within(modal).getByRole('button', { name: /^Ya devolví/ }));

    await waitFor(sinAviso);
    expect(enviados).toHaveLength(1);
    expect(enviados[0] ?? {}).not.toHaveProperty('monto');
    expect(await escaner()).toHaveFocus();
  });

  it('El cliente ya se fue: el aviso se cierra sin registrar la devolución', async () => {
    const { caja, fetchMock } = apiConDevolucion({
      [`POST /mercado-pago/cobros/${COBRO_ID}/sin-devolver`]: () => {
        caja.pendientes = [];
        return [200, cobroMp('sin_devolver', { monto: '3000.00' })];
      },
    });
    renderApp('/venta');
    const modal = await aviso();

    await usuario.click(within(modal).getByRole('button', { name: 'El cliente ya se fue' }));

    await waitFor(sinAviso);
    expect(
      llamadas(fetchMock, 'POST', `/mercado-pago/cobros/${COBRO_ID}/sin-devolver`),
    ).toHaveLength(1);
    expect(llamadas(fetchMock, 'POST', `/mercado-pago/cobros/${COBRO_ID}/devolucion`)).toHaveLength(
      0,
    );
  });

  it('aparece a más tardar 5 s después de detectarse el pago, mientras se está vendiendo', async () => {
    const { caja } = apiConDevolucion();
    caja.pendientes = [];
    renderApp('/venta');
    await escaner();
    sinAviso();

    caja.pendientes = [DEVOLUCION];
    await avanzar(5_000);

    await aviso();
  });

  it('pendiente de un día sin turno: apenas el empleado abre su turno ve el aviso', async () => {
    let estado: unknown = { turnoAbierto: null, montoSugerido: '20000.00' };
    simularApi({
      ...BASE,
      'GET /caja/estado': () => [200, estado],
      'POST /caja/turnos': () => {
        estado = estadoConPoint([DEVOLUCION]);
        return [201, estado];
      },
    });
    renderApp('/venta');

    await screen.findByRole('textbox', { name: 'Efectivo en la caja' });
    await usuario.keyboard('{Enter}');

    await aviso();
  });
});

describe('cierre del turno con un cobro en espera o una devolución pendiente', () => {
  /** El empleado se encuentra el turno de otra persona abierto e intenta cerrarlo. */
  async function intentarCerrarTurnoDeOtra(
    respuesta: Respuesta,
    estado = estadoConPoint([], false),
  ) {
    const cierres: unknown[] = [];
    simularApi({
      ...BASE,
      'GET /caja/estado': [200, estado],
      [`POST /caja/turnos/${TURNO_ID}/cerrar`]: (cuerpo) => {
        cierres.push(cuerpo);
        return respuesta;
      },
    });
    renderApp('/venta');
    await usuario.click(
      await screen.findByRole('button', { name: 'Cerrar turno de Ana Empleada' }),
    );
    const dialogo = await screen.findByRole('dialog', { name: 'Cerrar turno de Ana Empleada' });
    return { dialogo, cierres };
  }

  it.each([
    [
      'COBRO_EN_ESPERA',
      'Hay un cobro con Mercado Pago en espera (venta #120): esperalo o cancelalo',
    ],
    ['DEVOLUCION_PENDIENTE', 'Antes de cerrar, devolvé $3.000 en efectivo de un cobro cancelado'],
  ])(
    'el servidor responde 409 %s: muestra el motivo y deshabilita Cerrar',
    async (codigo, mensaje) => {
      const { dialogo, cierres } = await intentarCerrarTurnoDeOtra([
        409,
        { error: { codigo, mensaje } },
      ]);
      await usuario.type(within(dialogo).getByLabelText('Efectivo contado en la caja'), '52000');
      await usuario.keyboard('{Enter}');

      await waitFor(() => expect(dialogo).toHaveTextContent(mensaje));
      expect(cierres).toHaveLength(1);
      expect(within(dialogo).getByRole('button', { name: 'Cerrar turno (Enter)' })).toBeDisabled();
    },
  );

  it('con una devolución pendiente lo avisa antes de pedir el conteo y no deja cerrar', async () => {
    const { dialogo, cierres } = await intentarCerrarTurnoDeOtra(
      [200, { id: TURNO_ID, quedoEnCaja: '52000.00' }],
      estadoConPoint([{ cobroId: COBRO_ID, monto: '3000.00', ventaNumero: 120 }], false),
    );

    expect(dialogo).toHaveTextContent(
      new RegExp(
        `Antes de cerrar, devolvé ${pesos('3.000(,00)?')} en efectivo de un cobro cancelado`,
      ),
    );
    expect(within(dialogo).getByRole('button', { name: 'Cerrar turno (Enter)' })).toBeDisabled();
    expect(cierres).toHaveLength(0);
  });
});
