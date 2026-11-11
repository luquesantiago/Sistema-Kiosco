import { rangoDelPeriodo, type EstadoCaja } from '@kiosco/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hoyEnArgentina } from '../src/lib/fechas.js';
import { ADMIN, dashboardVacio, EMPLEADO, renderApp, simularApi } from './ayudas.js';

/**
 * Saldo de Mercado Pago en las tres pantallas (cambio saldo-mercado-pago):
 * Administración → Mercado Pago, el dashboard y Caja (F8) del mostrador.
 *
 * Textos exigidos tal cual (vienen del spec o del design): "actualizado a las HH:MM",
 * "Saldo no disponible: Mercado Pago no responde", "Saldo no disponible: Mercado Pago
 * rechazó las credenciales", "Mercado Pago no configurado", "a liberar", el botón
 * "Actualizar" y la línea de F8 "Mercado Pago: $ 250.000,00 (10:00)".
 * Supuestos (el design no los fija): la marca de desactualizado contiene la palabra
 * "desactualizado"; en Administración → Mercado Pago la tarjeta es una región con
 * nombre accesible "Saldo de Mercado Pago".
 */

const HOY = hoyEnArgentina();
const PRIMERO_DEL_MES = `${HOY.slice(0, 8)}01`;
const SALDO = 'GET /mercado-pago/saldo';
type Respuesta = [number, unknown];

/** 10:00 y 09:58 en Argentina. */
const DIEZ = '2026-11-11T13:00:00.000Z';
const NUEVE_58 = '2026-11-11T12:58:00.000Z';

const FRESCO = {
  estado: 'disponible',
  disponible: '250000.00',
  aLiberar: '40000.00',
  leidoEn: DIEZ,
  desactualizado: false,
};
const DESACTUALIZADO = {
  ...FRESCO,
  leidoEn: NUEVE_58,
  desactualizado: true,
  motivo: 'no_responde',
};
const NO_CONFIGURADO = { estado: 'no_configurado' };

const TEXTO_NO_RESPONDE = 'Saldo no disponible: Mercado Pago no responde';
const TEXTO_CREDENCIALES = 'Saldo no disponible: Mercado Pago rechazó las credenciales';

/**
 * Desactualizado: además del monto, la hora y la marca, se ve el motivo (decisión del
 * dueño). Para el rechazo genérico el spec no fija texto: solo que no hable de credenciales
 * ni diga que no responde.
 */
const MOTIVOS_DESACTUALIZADO = [
  {
    motivo: 'no_responde',
    verificar: (el: HTMLElement) => expect(el).toHaveTextContent('Mercado Pago no responde'),
  },
  {
    motivo: 'credenciales',
    verificar: (el: HTMLElement) =>
      expect(el).toHaveTextContent('Mercado Pago rechazó las credenciales'),
  },
  {
    motivo: 'rechazo',
    verificar: (el: HTMLElement) => {
      expect(el).not.toHaveTextContent(/credenciales/);
      expect(el).not.toHaveTextContent('Mercado Pago no responde');
    },
  },
];

/** `$ 250.000,00` con el espacio (común o duro) que pone Intl. */
const pesos = (texto: string) => new RegExp(`\\$\\s?${texto.replace(/\./g, '\\.')}`);

function llamadasAlSaldo(fetchMock: ReturnType<typeof simularApi>) {
  return fetchMock.mock.calls.filter(([url]) => String(url) === '/api/mercado-pago/saldo')
    .length;
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Administración → Mercado Pago
// ---------------------------------------------------------------------------

function pantallaMp(saldo: Respuesta | (() => Respuesta | Promise<Respuesta>)) {
  return simularApi({
    'GET /auth/sesion': [200, ADMIN],
    [`GET /caja/movimientos-mp?desde=${PRIMERO_DEL_MES}&hasta=${HOY}&pagina=1`]: [200, []],
    [SALDO]: saldo,
  });
}

async function tarjetaSaldo() {
  return screen.findByRole('region', { name: 'Saldo de Mercado Pago' });
}

describe('Administración → Mercado Pago: tarjeta del saldo', () => {
  it('saldo fresco: disponible en grande, a liberar debajo y la hora, arriba del formulario', async () => {
    pantallaMp([200, FRESCO]);
    renderApp('/admin/mercado-pago');

    const tarjeta = await tarjetaSaldo();
    await waitFor(() => expect(tarjeta).toHaveTextContent(pesos('250.000,00')));
    expect(tarjeta).toHaveTextContent(/250\.000,00.*a liberar.*40\.000,00/i);
    expect(tarjeta).toHaveTextContent('actualizado a las 10:00');
    expect(tarjeta).not.toHaveTextContent(/desactualizado/i);

    const form = screen.getByRole('form', { name: 'Nuevo movimiento de Mercado Pago' });
    expect(tarjeta.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(MOTIVOS_DESACTUALIZADO)(
    'desactualizado por $motivo: el saldo de las 09:58, la marca y el motivo',
    async ({ motivo, verificar }) => {
      pantallaMp([200, { ...DESACTUALIZADO, motivo }]);
      renderApp('/admin/mercado-pago');

      const tarjeta = await tarjetaSaldo();
      await waitFor(() => expect(tarjeta).toHaveTextContent('actualizado a las 09:58'));
      expect(tarjeta).toHaveTextContent(pesos('250.000,00'));
      expect(tarjeta).toHaveTextContent(/desactualizado/i);
      verificar(tarjeta);
    },
  );

  it.each([
    { motivo: 'no_responde', texto: TEXTO_NO_RESPONDE },
    { motivo: 'credenciales', texto: TEXTO_CREDENCIALES },
  ])('no disponible por $motivo: "$texto", sin montos', async ({ motivo, texto }) => {
    pantallaMp([200, { estado: 'no_disponible', motivo }]);
    renderApp('/admin/mercado-pago');

    const tarjeta = await tarjetaSaldo();
    await waitFor(() => expect(tarjeta).toHaveTextContent(texto));
    expect(tarjeta).not.toHaveTextContent('$');
  });

  it('no disponible por otro rechazo: dice "Saldo no disponible" y no habla de credenciales', async () => {
    pantallaMp([200, { estado: 'no_disponible', motivo: 'rechazo' }]);
    renderApp('/admin/mercado-pago');

    const tarjeta = await tarjetaSaldo();
    await waitFor(() => expect(tarjeta).toHaveTextContent(/Saldo no disponible/));
    expect(tarjeta).not.toHaveTextContent(/credenciales/);
    expect(tarjeta).not.toHaveTextContent('$');
  });

  it('no configurado: "Mercado Pago no configurado" y los movimientos funcionan igual', async () => {
    pantallaMp([200, NO_CONFIGURADO]);
    renderApp('/admin/mercado-pago');

    const tarjeta = await tarjetaSaldo();
    await waitFor(() => expect(tarjeta).toHaveTextContent('Mercado Pago no configurado'));
    expect(
      await screen.findByText('No hay movimientos de Mercado Pago en esas fechas.'),
    ).toBeInTheDocument();
  });

  it.each([
    { aLiberar: '40000.00', esperado: /a liberar.*\$\s?40\.000,00/i },
    { aLiberar: '0.00', esperado: /a liberar.*\$\s?0,00/i },
  ])('a liberar $aLiberar se muestra', async ({ aLiberar, esperado }) => {
    pantallaMp([200, { ...FRESCO, aLiberar }]);
    renderApp('/admin/mercado-pago');

    const tarjeta = await tarjetaSaldo();
    await waitFor(() => expect(tarjeta).toHaveTextContent(esperado));
  });

  it('sin a liberar (null) no aparece la línea "a liberar"', async () => {
    pantallaMp([200, { ...FRESCO, aLiberar: null }]);
    renderApp('/admin/mercado-pago');

    const tarjeta = await tarjetaSaldo();
    await waitFor(() => expect(tarjeta).toHaveTextContent(pesos('250.000,00')));
    expect(tarjeta).not.toHaveTextContent(/a liberar/i);
  });

  it.each([
    { disponible: '0.00', texto: '0,00' },
    { disponible: '0.01', texto: '0,01' },
    { disponible: '1234.50', texto: '1.234,50' },
    { disponible: '1234.56', texto: '1.234,56' },
    { disponible: '99999999.99', texto: '99.999.999,99' },
  ])('el disponible $disponible se muestra como $ $texto', async ({ disponible, texto }) => {
    pantallaMp([200, { ...FRESCO, disponible, aLiberar: null }]);
    renderApp('/admin/mercado-pago');

    const tarjeta = await tarjetaSaldo();
    await waitFor(() => expect(tarjeta).toHaveTextContent(pesos(texto)));
  });

  // La hora se corta a los minutos (no se redondea) y va en hora de Argentina.
  it.each([
    { leidoEn: '2026-11-11T12:58:59.999Z', hora: '09:58' },
    { leidoEn: '2026-11-11T12:59:00.000Z', hora: '09:59' },
  ])('leído a las $leidoEn dice "actualizado a las $hora"', async ({ leidoEn, hora }) => {
    pantallaMp([200, { ...FRESCO, leidoEn }]);
    renderApp('/admin/mercado-pago');

    const tarjeta = await tarjetaSaldo();
    await waitFor(() => expect(tarjeta).toHaveTextContent(`actualizado a las ${hora}`));
  });

  it('"Actualizar" vuelve a pedir el saldo a la API y muestra lo nuevo', async () => {
    const respuestas: Respuesta[] = [
      [200, FRESCO],
      [200, { ...FRESCO, disponible: '260000.00', leidoEn: '2026-11-11T13:01:00.000Z' }],
    ];
    const fetchMock = pantallaMp(() => respuestas.shift() ?? respuestas[0]!);
    renderApp('/admin/mercado-pago');

    const tarjeta = await tarjetaSaldo();
    await waitFor(() => expect(tarjeta).toHaveTextContent(pesos('250.000,00')));
    expect(llamadasAlSaldo(fetchMock)).toBe(1);

    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Actualizar' }));

    await waitFor(() => expect(tarjeta).toHaveTextContent(pesos('260.000,00')));
    expect(tarjeta).toHaveTextContent('actualizado a las 10:01');
    expect(llamadasAlSaldo(fetchMock)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Dashboard del admin
// ---------------------------------------------------------------------------

const [CLAVE_HOY, [, VACIO]] = Object.entries(dashboardVacio())[0] as [string, [number, object]];
const DASHBOARD = {
  ...VACIO,
  ahora: {
    ...(VACIO as { ahora: object }).ahora,
    efectivoEnCaja: '90000.00',
    turnoAbierto: true,
  },
};

function pantallaDashboard(
  saldo: Respuesta | (() => Respuesta | Promise<Respuesta>),
  otros: Record<string, Respuesta> = {},
) {
  return simularApi({
    'GET /auth/sesion': [200, ADMIN],
    'GET /whatsapp': [200, { estado: 'no_configurado' }],
    'GET /health': [200, { estado: 'ok', baseDeDatos: 'ok', hora: new Date().toISOString() }],
    [CLAVE_HOY]: [200, DASHBOARD],
    [SALDO]: saldo,
    ...otros,
  });
}

describe('dashboard: saldo de Mercado Pago en "Ahora"', () => {
  it('muestra $ 250.000,00 con "actualizado a las 10:00" junto al efectivo en caja', async () => {
    pantallaDashboard([200, FRESCO]);
    renderApp('/admin');

    const ahora = await screen.findByRole('region', { name: 'Ahora' });
    await waitFor(() => expect(ahora).toHaveTextContent(pesos('250.000,00')));
    expect(ahora).toHaveTextContent('actualizado a las 10:00');
    expect(ahora).toHaveTextContent(/Efectivo en caja.*90\.000,00/);
  });

  it.each(MOTIVOS_DESACTUALIZADO)(
    'desactualizado por $motivo: el saldo de las 09:58, la marca y el motivo',
    async ({ motivo, verificar }) => {
      pantallaDashboard([200, { ...DESACTUALIZADO, motivo }]);
      renderApp('/admin');

      const ahora = await screen.findByRole('region', { name: 'Ahora' });
      await waitFor(() => expect(ahora).toHaveTextContent('actualizado a las 09:58'));
      expect(ahora).toHaveTextContent(pesos('250.000,00'));
      expect(ahora).toHaveTextContent(/desactualizado/i);
      verificar(ahora);
    },
  );

  it('no disponible: "Saldo no disponible" y el resto del dashboard igual', async () => {
    pantallaDashboard([200, { estado: 'no_disponible', motivo: 'no_responde' }]);
    renderApp('/admin');

    const ahora = await screen.findByRole('region', { name: 'Ahora' });
    await waitFor(() => expect(ahora).toHaveTextContent('Saldo no disponible'));
    expect(ahora).toHaveTextContent(/Efectivo en caja.*90\.000,00/);
    expect(screen.getByRole('region', { name: 'Ventas y resultado' })).toBeInTheDocument();
  });

  it('no configurado: "Mercado Pago no configurado" y el resto del dashboard igual', async () => {
    pantallaDashboard([200, NO_CONFIGURADO]);
    renderApp('/admin');

    const ahora = await screen.findByRole('region', { name: 'Ahora' });
    await waitFor(() => expect(ahora).toHaveTextContent('Mercado Pago no configurado'));
    expect(ahora).toHaveTextContent(/Efectivo en caja.*90\.000,00/);
  });

  it('si la consulta del saldo falla (error de la API), el resto del dashboard se muestra', async () => {
    const fetchMock = pantallaDashboard([
      500,
      { error: { codigo: 'ERROR_INTERNO', mensaje: 'Algo salió mal.' } },
    ]);
    renderApp('/admin');

    await waitFor(() => expect(llamadasAlSaldo(fetchMock)).toBeGreaterThanOrEqual(1));
    const ahora = await screen.findByRole('region', { name: 'Ahora' });
    expect(ahora).toHaveTextContent(/Efectivo en caja.*90\.000,00/);
    expect(screen.getByRole('region', { name: 'Ventas y resultado' })).toBeInTheDocument();
  });

  it('si la consulta del saldo no termina nunca, el resto del dashboard se muestra igual', async () => {
    const fetchMock = pantallaDashboard(() => new Promise<Respuesta>(() => {}));
    renderApp('/admin');

    const ahora = await screen.findByRole('region', { name: 'Ahora' });
    expect(ahora).toHaveTextContent(/Efectivo en caja.*90\.000,00/);
    expect(screen.getByRole('region', { name: 'Ventas y resultado' })).toBeInTheDocument();
    // El saldo se pide aparte de GET /dashboard.
    await waitFor(() => expect(llamadasAlSaldo(fetchMock)).toBe(1));
  });

  it('pasar de "Hoy" a "Mes anterior" no vuelve a pedir el saldo y sigue mostrando el actual', async () => {
    const anterior = rangoDelPeriodo('mes_anterior', HOY);
    const urlAnterior = `/dashboard?desde=${anterior.desde}&hasta=${anterior.hasta}`;
    const espia = pantallaDashboard([200, FRESCO], {
      [`GET ${urlAnterior}`]: [200, { ...DASHBOARD, periodo: anterior }],
    });
    renderApp('/admin');

    const ahora = await screen.findByRole('region', { name: 'Ahora' });
    await waitFor(() => expect(ahora).toHaveTextContent(pesos('250.000,00')));
    expect(llamadasAlSaldo(espia)).toBe(1);

    await userEvent.click(screen.getByRole('button', { name: 'Mes anterior' }));
    await waitFor(() => expect(espia).toHaveBeenCalledWith(`/api${urlAnterior}`, expect.anything()));

    const ahoraDespues = await screen.findByRole('region', { name: 'Ahora' });
    await waitFor(() => expect(ahoraDespues).toHaveTextContent(pesos('250.000,00')));
    expect(ahoraDespues).toHaveTextContent('actualizado a las 10:00');
    expect(llamadasAlSaldo(espia)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Caja (F8) del mostrador
// ---------------------------------------------------------------------------

const TURNO_ID = '0198a5b0-0000-7000-8000-000000000401';
const PROPIO: EstadoCaja = {
  turnoAbierto: {
    id: TURNO_ID,
    responsable: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
    abiertoEn: '2026-11-11T12:00:00.000Z',
    esMio: true,
  },
  montoSugerido: '0.00',
};
const DE_OTRA: EstadoCaja = {
  turnoAbierto: {
    id: TURNO_ID,
    responsable: { id: '0198a5b0-0000-7000-8000-000000000003', nombre: 'Ana Empleada' },
    abiertoEn: '2026-11-11T12:00:00.000Z',
    esMio: false,
  },
  montoSugerido: '0.00',
};

function mostrador(
  saldo: Respuesta | (() => Respuesta | Promise<Respuesta>),
  usuario: typeof EMPLEADO | typeof ADMIN = EMPLEADO,
  estado: EstadoCaja = PROPIO,
  otros: Record<string, Respuesta | ((cuerpo: unknown) => Respuesta)> = {},
) {
  return simularApi({
    'GET /auth/sesion': [200, usuario],
    'GET /caja/estado': [200, estado],
    'GET /caja/movimientos': [200, []],
    [SALDO]: saldo,
    ...otros,
  });
}

const BOLSAS = {
  id: '0198a5b0-0000-7000-8000-000000000501',
  tipo: 'gasto',
  categoria: 'insumos',
  cuenta: 'efectivo',
  turnoId: TURNO_ID,
  monto: '8000.00',
  motivo: 'bolsas',
  usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
  creadoEn: '2026-11-11T13:15:00.000Z',
};

async function abrirCaja(usuario = userEvent) {
  await usuario.click(await screen.findByRole('button', { name: 'Caja (F8)' }));
  return screen.findByRole('dialog', { name: 'Caja' });
}

/** "Mercado Pago: $ 250.000,00 (10:00)" (el design fija esta línea). */
const lineaF8 = (monto: string, hora: string) =>
  new RegExp(`Mercado Pago:\\s*\\$\\s?${monto.replace(/\./g, '\\.')}\\s*\\(${hora}\\)`);

describe('Caja (F8): saldo de Mercado Pago', () => {
  it('el empleado ve "Mercado Pago: $ 250.000,00 (10:00)" arriba de sus movimientos, sin el esperado', async () => {
    mostrador([200, FRESCO]);
    renderApp('/venta');

    const dialogo = await abrirCaja();
    await waitFor(() => expect(dialogo).toHaveTextContent(lineaF8('250.000,00', '10:00')));
    expect(within(dialogo).queryByText(/esperado/i)).not.toBeInTheDocument();

    const linea = within(dialogo).getByText(/Mercado Pago:/);
    const movimientos = within(dialogo).getByRole('list', { name: 'Movimientos del turno' });
    expect(
      linea.compareDocumentPosition(movimientos) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('con centavos: "Mercado Pago: $ 1.234,56 (10:00)"', async () => {
    mostrador([200, { ...FRESCO, disponible: '1234.56' }]);
    renderApp('/venta');

    const dialogo = await abrirCaja();
    await waitFor(() => expect(dialogo).toHaveTextContent(lineaF8('1.234,56', '10:00')));
  });

  it.each(MOTIVOS_DESACTUALIZADO)(
    'desactualizado por $motivo: el saldo con "actualizado a las 09:58", la marca y el motivo',
    async ({ motivo, verificar }) => {
      mostrador([200, { ...DESACTUALIZADO, motivo }]);
      renderApp('/venta');

      const dialogo = await abrirCaja();
      await waitFor(() => expect(dialogo).toHaveTextContent('actualizado a las 09:58'));
      expect(dialogo).toHaveTextContent(pesos('250.000,00'));
      expect(dialogo).toHaveTextContent(/desactualizado/i);
      verificar(dialogo);
    },
  );

  it('no disponible: el mismo texto que las otras pantallas', async () => {
    mostrador([200, { estado: 'no_disponible', motivo: 'no_responde' }]);
    renderApp('/venta');

    const dialogo = await abrirCaja();
    await waitFor(() => expect(dialogo).toHaveTextContent(TEXTO_NO_RESPONDE));
  });

  it('no configurado: la caja funciona igual y no muestra la línea del saldo', async () => {
    const fetchMock = mostrador([200, NO_CONFIGURADO]);
    renderApp('/venta');

    const dialogo = await abrirCaja();
    await waitFor(() => expect(llamadasAlSaldo(fetchMock)).toBe(1));
    // Se deja asentar la respuesta antes de mirar que no haya línea.
    await within(dialogo).findByText('Ninguno.');
    expect(dialogo).not.toHaveTextContent(/Mercado Pago:/);
    expect(dialogo).not.toHaveTextContent(/no configurado/i);
    expect(within(dialogo).getByRole('button', { name: 'Registrar (Enter)' })).toBeEnabled();
  });

  it.each([
    {
      caso: 'responde con error',
      saldo: (): Respuesta | Promise<Respuesta> => [
        500,
        { error: { codigo: 'ERROR_INTERNO', mensaje: 'Algo salió mal.' } },
      ],
    },
    { caso: 'no termina nunca', saldo: () => new Promise<Respuesta>(() => {}) },
  ])(
    'si la consulta del saldo $caso, los movimientos se ven y se puede registrar sin esperar',
    async ({ saldo }) => {
      let movimiento: unknown;
      const fetchMock = mostrador(saldo, EMPLEADO, PROPIO, {
        'GET /caja/movimientos': [200, [BOLSAS]],
        'POST /caja/movimientos': (cuerpo) => {
          movimiento = cuerpo;
          return [201, { ...BOLSAS, id: '0198a5b0-0000-7000-8000-000000000502' }];
        },
      });
      renderApp('/venta');

      const dialogo = await abrirCaja();
      await waitFor(() => expect(llamadasAlSaldo(fetchMock)).toBe(1));
      expect(
        await within(dialogo).findByText(/Gasto · Insumos: bolsas/),
      ).toBeInTheDocument();

      await userEvent.click(within(dialogo).getByRole('radio', { name: 'Insumos' }));
      await userEvent.type(within(dialogo).getByLabelText('Monto'), '500');
      await userEvent.type(within(dialogo).getByLabelText('Motivo'), 'hielo');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Registrar (Enter)' }));

      await waitFor(() =>
        expect(movimiento).toEqual({
          tipo: 'gasto',
          categoria: 'insumos',
          cuenta: 'efectivo',
          monto: '500.00',
          motivo: 'hielo',
        }),
      );
      expect(dialogo).not.toHaveTextContent(pesos('250.000,00'));
    },
  );

  it('el admin, en el turno abierto de otra persona, también ve el saldo', async () => {
    mostrador([200, FRESCO], ADMIN, DE_OTRA);
    renderApp('/venta');

    const dialogo = await abrirCaja();
    await waitFor(() => expect(dialogo).toHaveTextContent(lineaF8('250.000,00', '10:00')));
  });

  it('con la caja abierta, el saldo se vuelve a pedir solo a los 60 s y no antes', async () => {
    // El reloj falso avanza con el real para que Testing Library pueda esperar; se adelanta
    // 59 s (y no 59,999) para dejar margen al tiempo real que corre entre pasos.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = mostrador([200, FRESCO]);
    renderApp('/venta');
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const dialogo = await abrirCaja(usuario);
    await waitFor(() => expect(dialogo).toHaveTextContent(lineaF8('250.000,00', '10:00')));
    const alAbrir = llamadasAlSaldo(fetchMock);
    expect(alAbrir).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(llamadasAlSaldo(fetchMock)).toBe(alAbrir);

    await vi.advanceTimersByTimeAsync(1_000);
    await waitFor(() => expect(llamadasAlSaldo(fetchMock)).toBe(alAbrir + 1));
  });

  it('el empleado ve el saldo en F8 pero no entra al dashboard', async () => {
    mostrador([200, FRESCO]);
    const { router } = renderApp('/admin');

    await waitFor(() => expect(router.state.location.pathname).toBe('/venta'));
    const dialogo = await abrirCaja();
    await waitFor(() => expect(dialogo).toHaveTextContent(lineaF8('250.000,00', '10:00')));
    expect(screen.queryByRole('region', { name: 'Ahora' })).not.toBeInTheDocument();
  });
});
