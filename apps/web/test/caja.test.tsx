import type { EstadoCaja, TurnoDetalle, TurnoResumen } from '@kiosco/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, EMPLEADO, renderApp, simularApi } from './ayudas.js';

const TURNO_ID = '0198a5b0-0000-7000-8000-000000000401';
const OTRA = { id: '0198a5b0-0000-7000-8000-000000000003', nombre: 'Ana Empleada' };
const ALFAJOR = {
  id: '0198a5b0-0000-7000-8000-000000000201',
  codigoBarras: '111',
  nombre: 'Alfajor',
  precio: '900.00',
  stockActual: 5,
};

function turnoDe(responsable: { id: string; nombre: string }, esMio: boolean): EstadoCaja {
  return {
    turnoAbierto: { id: TURNO_ID, responsable, abiertoEn: '2026-10-20T10:00:00.000Z', esMio },
    montoSugerido: '0.00',
  };
}

const SIN_TURNO: EstadoCaja = { turnoAbierto: null, montoSugerido: '20000.00' };
const PROPIO = turnoDe({ id: EMPLEADO.id, nombre: EMPLEADO.nombre }, true);

const errorDeTurno = (codigo: string) =>
  [409, { error: { codigo, mensaje: 'No hay un turno abierto. Abrí el turno para seguir.' } }] as [
    number,
    unknown,
  ];

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

async function escanearAlfajor() {
  const campo = await screen.findByRole('combobox', { name: 'Escaneá o buscá un producto' });
  await userEvent.type(campo, '111{Enter}');
  await screen.findByText('Alfajor');
}

describe('abrir el turno antes de vender', () => {
  it('sin turno, pide abrirlo con el monto sugerido y Enter lo abre', async () => {
    let estado = SIN_TURNO;
    let enviado: unknown;
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /caja/estado': () => [200, estado],
      'POST /caja/turnos': (cuerpo) => {
        enviado = cuerpo;
        estado = PROPIO;
        return [201, estado];
      },
    });
    renderApp('/venta');

    const monto = await screen.findByRole('textbox', { name: 'Efectivo en la caja' });
    expect(monto).toHaveValue('20000,00');
    expect(monto).toHaveFocus();
    expect(screen.queryByRole('combobox', { name: /Escaneá/ })).not.toBeInTheDocument();

    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('combobox', { name: /Escaneá/ })).toBeInTheDocument();
    expect(enviado).toEqual({ montoInicial: '20000.00' });
  });

  it('se puede abrir con otro monto si el conteo no coincide', async () => {
    let enviado: unknown;
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /caja/estado': [200, SIN_TURNO],
      'POST /caja/turnos': (cuerpo) => {
        enviado = cuerpo;
        return [201, PROPIO];
      },
    });
    renderApp('/venta');

    await screen.findByRole('textbox', { name: 'Efectivo en la caja' });
    await userEvent.keyboard('19500{Enter}');

    await waitFor(() => expect(enviado).toEqual({ montoInicial: '19500.00' }));
  });

  it('con el turno de otro empleado abierto, ofrece cerrarlo y después abrir el propio', async () => {
    let estado = turnoDe(OTRA, false);
    let cierre: unknown;
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /caja/estado': () => [200, estado],
      [`POST /caja/turnos/${TURNO_ID}/cerrar`]: (cuerpo) => {
        cierre = cuerpo;
        estado = { turnoAbierto: null, montoSugerido: '40000.00' };
        return [200, { id: TURNO_ID, quedoEnCaja: '40000.00' }];
      },
    });
    renderApp('/venta');

    expect(
      await screen.findByRole('heading', { name: 'El turno de Ana Empleada está abierto' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar turno de Ana Empleada' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Cerrar turno de Ana Empleada' });
    await userEvent.type(within(dialogo).getByLabelText('Efectivo contado en la caja'), '40000');
    await userEvent.keyboard('{Enter}');

    const abrirMio = await screen.findByRole('button', { name: 'Abrir mi turno (Enter)' });
    expect(abrirMio).toHaveFocus();
    expect(cierre).toEqual({ montoContado: '40000.00', retiro: null, motivoRetiro: '' });
    await userEvent.keyboard('{Enter}');

    const monto = await screen.findByRole('textbox', { name: 'Efectivo en la caja' });
    expect(monto).toHaveValue('40000,00');
  });

  it('el admin vende en el turno abierto de un empleado sin que se le pida nada', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /caja/estado': [200, turnoDe(OTRA, false)],
    });
    renderApp('/venta');

    expect(await screen.findByRole('combobox', { name: /Escaneá/ })).toBeInTheDocument();
    expect(screen.getByText('Ana Empleada')).toBeInTheDocument();
  });

  it('si el turno se cerró mientras vendía, vuelve a pedir abrirlo sin perder el carrito', async () => {
    let estado: EstadoCaja = PROPIO;
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /caja/estado': () => [200, estado],
      'GET /productos?q=111&pagina=1': [200, [ALFAJOR]],
      'POST /ventas': () => {
        estado = SIN_TURNO;
        return errorDeTurno('SIN_TURNO_ABIERTO');
      },
      'POST /caja/turnos': () => {
        estado = PROPIO;
        return [201, PROPIO];
      },
    });
    renderApp('/venta');
    await escanearAlfajor();

    await userEvent.keyboard('{F2}');
    await userEvent.keyboard('{Enter}');

    await screen.findByRole('textbox', { name: 'Efectivo en la caja' });
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('Alfajor')).toBeInTheDocument();
  });
});

describe('cerrar el turno desde el mostrador', () => {
  it('con productos en el carrito, cerrar el turno no está disponible', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /caja/estado': [200, PROPIO],
      'GET /productos?q=111&pagina=1': [200, [ALFAJOR]],
    });
    renderApp('/venta');
    expect(await screen.findByRole('button', { name: 'Cerrar turno' })).toBeEnabled();

    await escanearAlfajor();

    expect(screen.getByRole('button', { name: 'Cerrar turno' })).toBeDisabled();
  });

  it('cierra contando y retirando, muestra lo que queda y ofrece cerrar la sesión', async () => {
    let cierre: unknown;
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /caja/estado': [200, PROPIO],
      [`POST /caja/turnos/${TURNO_ID}/cerrar`]: (cuerpo) => {
        cierre = cuerpo;
        return [200, { id: TURNO_ID, quedoEnCaja: '21500.00' }];
      },
      'POST /auth/salir': [204],
    });
    renderApp('/venta');

    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar turno' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Cerrar turno' });
    expect(within(dialogo).queryByText(/esperado/i)).not.toBeInTheDocument();
    await userEvent.type(within(dialogo).getByLabelText('Efectivo contado en la caja'), '51500');
    await userEvent.type(within(dialogo).getByLabelText('Retiro al cerrar (opcional)'), '30000');
    await userEvent.type(within(dialogo).getByLabelText('Motivo del retiro'), 'Al banco');
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByTestId('quedo-en-caja')).toHaveTextContent('21.500,00');
    expect(cierre).toEqual({
      montoContado: '51500.00',
      retiro: '30000.00',
      motivoRetiro: 'Al banco',
    });
    const salir = screen.getByRole('button', { name: 'Cerrar sesión (Enter)' });
    expect(salir).toHaveFocus();
  });

  it('un retiro sin motivo no se envía', async () => {
    const fetch = simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /caja/estado': [200, PROPIO],
    });
    renderApp('/venta');

    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar turno' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Cerrar turno' });
    await userEvent.type(within(dialogo).getByLabelText('Efectivo contado en la caja'), '100');
    await userEvent.type(within(dialogo).getByLabelText('Retiro al cerrar (opcional)'), '50');
    await userEvent.keyboard('{Enter}');

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('motivo del retiro');
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/cerrar'))).toBe(false);
  });
});

describe('movimientos de caja desde el mostrador', () => {
  it('F8 registra un gasto con categoría y el carrito intacto; el empleado no ve "Ingreso"', async () => {
    let movimiento: unknown;
    const registrados: unknown[] = [];
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /caja/estado': [200, PROPIO],
      'GET /productos?q=111&pagina=1': [200, [ALFAJOR]],
      'GET /caja/movimientos': () => [200, registrados],
      'POST /caja/movimientos': (cuerpo) => {
        movimiento = cuerpo;
        registrados.push({
          id: '0198a5b0-0000-7000-8000-000000000501',
          ...(cuerpo as object),
          usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
          creadoEn: '2026-10-20T13:15:00.000Z',
        });
        return [201, registrados[0]];
      },
    });
    renderApp('/venta');
    await escanearAlfajor();

    await userEvent.keyboard('{F8}');
    const dialogo = await screen.findByRole('dialog', { name: 'Caja' });
    expect(within(dialogo).queryByRole('radio', { name: 'Ingreso' })).not.toBeInTheDocument();
    expect(within(dialogo).getByRole('radio', { name: 'Gasto' })).toBeChecked();
    const categorias = within(dialogo).getByRole('group', { name: 'Categoría' });
    expect(
      within(categorias)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('value')),
    ).toEqual(['servicios', 'insumos', 'otro']);
    expect(within(categorias).queryByRole('radio', { checked: true })).not.toBeInTheDocument();
    const cuentas = within(dialogo).getByRole('group', { name: 'Sale de' });
    expect(within(cuentas).getByRole('radio', { name: 'Efectivo' })).toBeChecked();
    await userEvent.type(within(dialogo).getByLabelText('Monto'), '8000');
    await userEvent.type(within(dialogo).getByLabelText('Motivo'), 'bolsas');
    await userEvent.keyboard('{Enter}');
    expect(within(dialogo).getByRole('alert')).toHaveTextContent('Elegí la categoría del gasto.');
    expect(movimiento).toBeUndefined();

    await userEvent.click(within(categorias).getByRole('radio', { name: 'Insumos' }));
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Registrar (Enter)' }));

    await waitFor(() =>
      expect(movimiento).toEqual({
        tipo: 'gasto',
        categoria: 'insumos',
        cuenta: 'efectivo',
        monto: '8000.00',
        motivo: 'bolsas',
      }),
    );
    expect(await within(dialogo).findByText(/Gasto · Insumos: bolsas/)).toBeInTheDocument();
    expect(within(categorias).queryByRole('radio', { checked: true })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Alfajor')).toBeInTheDocument();
  });

  it('el empleado paga un gasto con Mercado Pago y no elige cuenta en los retiros', async () => {
    let movimiento: unknown;
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /caja/estado': [200, PROPIO],
      'GET /caja/movimientos': [200, []],
      'POST /caja/movimientos': (cuerpo) => {
        movimiento = cuerpo;
        return [201, {}];
      },
    });
    renderApp('/venta');

    await userEvent.click(await screen.findByRole('button', { name: 'Caja (F8)' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Caja' });
    await userEvent.click(within(dialogo).getByRole('radio', { name: 'Retiro' }));
    expect(within(dialogo).queryByRole('group', { name: 'Sale de' })).not.toBeInTheDocument();
    await userEvent.click(within(dialogo).getByRole('radio', { name: 'Gasto' }));

    await userEvent.type(within(dialogo).getByLabelText('Monto'), '6000');
    await userEvent.click(within(dialogo).getByRole('radio', { name: 'Insumos' }));
    await userEvent.click(within(dialogo).getByRole('radio', { name: 'Mercado Pago' }));
    await userEvent.type(within(dialogo).getByLabelText('Motivo'), 'bolsas');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Registrar (Enter)' }));

    await waitFor(() =>
      expect(movimiento).toMatchObject({ tipo: 'gasto', cuenta: 'mercado_pago' }),
    );
  });

  it('el admin puede registrar un ingreso y elige la cuenta también en los retiros', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /caja/estado': [200, turnoDe(OTRA, false)],
      'GET /caja/movimientos': [200, []],
    });
    renderApp('/venta');

    await userEvent.click(await screen.findByRole('button', { name: 'Caja (F8)' }));

    const dialogo = await screen.findByRole('dialog', { name: 'Caja' });
    expect(within(dialogo).getByRole('radio', { name: 'Ingreso' })).toBeInTheDocument();
    await userEvent.click(within(dialogo).getByRole('radio', { name: 'Retiro' }));
    expect(within(dialogo).getByRole('group', { name: 'Sale de' })).toBeInTheDocument();
  });

  it('muestra F8 en la referencia de atajos', async () => {
    simularApi({ 'GET /auth/sesion': [200, EMPLEADO], 'GET /caja/estado': [200, PROPIO] });
    renderApp('/venta');
    const pie = await screen.findByRole('contentinfo', { name: 'Atajos de teclado' });
    expect(pie).toHaveTextContent('F8 Caja');
  });
});

const CERRADO: TurnoResumen = {
  id: TURNO_ID,
  responsable: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
  cerradoPor: { id: OTRA.id, nombre: OTRA.nombre },
  abiertoEn: '2026-10-20T10:02:00.000Z',
  cerradoEn: '2026-10-20T16:05:00.000Z',
  montoSugerido: '20000.00',
  montoInicial: '19500.00',
  diferenciaApertura: '-500.00',
  diferencia: '-500.00',
};

describe('turnos para el admin', () => {
  it('lista los turnos con sus diferencias y quién cerró', async () => {
    const abierto: TurnoResumen = {
      ...CERRADO,
      id: '0198a5b0-0000-7000-8000-000000000402',
      responsable: OTRA,
      cerradoPor: null,
      cerradoEn: null,
      diferenciaApertura: '0.00',
      diferencia: null,
    };
    simularApi({ 'GET /auth/sesion': [200, ADMIN], 'GET /caja/turnos': [200, [abierto, CERRADO]] });
    renderApp('/admin/turnos');

    const lista = await screen.findByRole('list', { name: 'Turnos' });
    const [primero, segundo] = await within(lista).findAllByRole('listitem');
    expect(primero).toHaveTextContent('Abierto');
    expect(segundo).toHaveTextContent(/-\$\s?500,00/);
    expect(segundo).toHaveTextContent('cerró Ana Empleada');
    expect(segundo).toHaveTextContent('Diferencia de apertura');
  });

  it('el detalle muestra el esperado línea por línea', async () => {
    const detalle: TurnoDetalle = {
      ...CERRADO,
      resumen: {
        cantidadVentas: 84,
        porMedio: {
          efectivo: '50000.00',
          debito: '30000.00',
          credito: '0.00',
          mercado_pago: '0.00',
        },
        montoInicial: '19500.00',
        efectivoVendido: '50000.00',
        ingresos: '0.00',
        gastos: '8000.00',
        retiros: '10000.00',
        devoluciones: '0.00',
        esperado: '51500.00',
      },
      montoContado: '51000.00',
      retiroCierre: '30000.00',
      motivoRetiroCierre: 'Al banco',
      quedoEnCaja: '21000.00',
      movimientos: [
        {
          id: '0198a5b0-0000-7000-8000-000000000501',
          tipo: 'gasto',
          categoria: 'insumos',
          cuenta: 'efectivo',
          turnoId: TURNO_ID,
          monto: '8000.00',
          motivo: 'bolsas',
          usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
          creadoEn: '2026-10-20T13:15:00.000Z',
        },
        {
          id: '0198a5b0-0000-7000-8000-000000000502',
          tipo: 'gasto',
          categoria: 'servicios',
          cuenta: 'mercado_pago',
          turnoId: TURNO_ID,
          monto: '45000.00',
          motivo: 'luz',
          usuario: { id: ADMIN.id, nombre: ADMIN.nombre },
          creadoEn: '2026-10-20T14:15:00.000Z',
        },
      ],
      anulaciones: [],
    };
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [`GET /caja/turnos/${TURNO_ID}`]: [200, detalle],
    });
    renderApp(`/admin/turnos/${TURNO_ID}`);

    const efectivo = await screen.findByLabelText('Cálculo del esperado');
    expect(efectivo).toHaveTextContent(/Esperado\s*\$\s?51\.500,00/);
    expect(efectivo).toHaveTextContent(/Contado\s*\$\s?51\.000,00/);
    expect(efectivo).toHaveTextContent(/Diferencia\s*-\$\s?500,00/);
    expect(efectivo).toHaveTextContent('Retiro al cierre (Al banco)');
    expect(screen.getByRole('list', { name: 'Movimientos' })).toHaveTextContent(
      'Gasto · Insumos: bolsas',
    );
    expect(screen.getByRole('list', { name: 'Movimientos' })).toHaveTextContent(
      'Gasto · Servicios · Mercado Pago: luz',
    );
    expect(efectivo).toHaveTextContent('Devoluciones de anulaciones');
  });

  it('un empleado no entra a los turnos', async () => {
    simularApi({ 'GET /auth/sesion': [200, EMPLEADO], 'GET /caja/estado': [200, PROPIO] });
    const { router } = renderApp('/admin/turnos');
    await waitFor(() => expect(router.state.location.pathname).toBe('/venta'));
  });
});
