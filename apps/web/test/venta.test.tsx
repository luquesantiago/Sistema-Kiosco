import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPLEADO, renderApp, simularApi } from './ayudas.js';

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
const CHICLE = {
  ...ALFAJOR,
  id: '0198a5b0-0000-7000-8000-000000000203',
  codigoBarras: null,
  nombre: 'Chicle de menta',
  precio: '300.00',
};

const busqueda = (q: string) => `GET /productos?q=${q}&pagina=1`;

const TURNO_ID = '0198a5b0-0000-7000-8000-000000000401';
const TURNO_PROPIO = {
  turnoAbierto: {
    id: TURNO_ID,
    responsable: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
    abiertoEn: '2026-10-20T10:00:00.000Z',
    esMio: true,
  },
  montoSugerido: '0.00',
};

const BASE = {
  'GET /auth/sesion': [200, EMPLEADO],
  'GET /caja/estado': [200, TURNO_PROPIO],
  [busqueda('111')]: [200, [ALFAJOR]],
  [busqueda('222')]: [200, [GASEOSA]],
  [busqueda('999')]: [200, []],
  [busqueda('chicle')]: [200, [CHICLE]],
} as Record<string, [number, unknown]>;

function ventaRegistrada(cuerpo: unknown, extra: Record<string, unknown> = {}) {
  const { pagos } = cuerpo as { pagos: { medio: string; monto: string; montoRecibido?: string }[] };
  return {
    id: '0198a5b0-0000-7000-8000-000000000301',
    numero: 120,
    creadaEn: '2026-10-20T18:42:00.000Z',
    usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
    total: '3300.00',
    estado: 'pagada',
    medios: pagos.map((p) => p.medio),
    items: [
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
    ],
    pagos: pagos.map((p) => ({
      medio: p.medio,
      monto: p.monto,
      montoRecibido: p.montoRecibido ?? null,
      vuelto: p.montoRecibido ? '1700.00' : null,
    })),
    anulacion: null,
    ...extra,
  };
}

async function escaner() {
  return screen.findByRole('combobox', { name: 'Escaneá o buscá un producto' });
}

/** Escanea 111, 222 y 111: 2 alfajores y 1 gaseosa ($3.300). */
async function armarCarritoTipico() {
  const campo = await escaner();
  for (const codigo of ['111', '222', '111']) {
    await userEvent.type(campo, `${codigo}{Enter}`);
    await waitFor(() => expect(campo).toHaveValue(''));
  }
  await waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('3.300,00'));
  return campo;
}

function filas() {
  return within(screen.getByRole('table', { name: 'Carrito' }))
    .getAllByRole('row')
    .slice(1);
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('print', vi.fn());
});

afterEach(() => {
  sessionStorage.clear();
});

describe('escaneo y carrito', () => {
  it('escanear alfajor, gaseosa y alfajor deja 2 + 1 y el campo enfocado', async () => {
    simularApi(BASE);
    renderApp('/venta');

    const campo = await armarCarritoTipico();

    expect(filas().map((f) => f.textContent)).toEqual([
      expect.stringMatching(/Alfajor.*2.*1\.800,00/),
      expect.stringMatching(/Gaseosa.*1.*1\.500,00/),
    ]);
    expect(campo).toHaveFocus();
  });

  it('un código desconocido avisa sin borrar el carrito', async () => {
    simularApi(BASE);
    renderApp('/venta');
    const campo = await escaner();
    await userEvent.type(campo, '111{Enter}');
    await screen.findByText('Alfajor');

    await userEvent.type(campo, '999{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('No existe un producto con "999"');
    expect(filas()).toHaveLength(1);
  });

  it('busca por nombre y elige con flechas y Enter', async () => {
    simularApi(BASE);
    renderApp('/venta');

    await userEvent.type(await escaner(), 'chicle{Enter}');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(filas()[0]).toHaveTextContent('Chicle de menta'));
  });

  it('F7 agrega un "Varios" con el precio escrito', async () => {
    simularApi(BASE);
    renderApp('/venta');
    await escaner();

    await userEvent.keyboard('{F7}');
    const dialogo = await screen.findByRole('dialog', { name: 'Agregar "Varios"' });
    await userEvent.type(within(dialogo).getByLabelText('Precio'), '500{Enter}');

    await waitFor(() => expect(filas()[0]).toHaveTextContent(/Varios.*500,00/));
    expect(await escaner()).toHaveFocus();
  });

  it('flechas, + y Supr editan el carrito; Ctrl+Supr vacía con confirmación', async () => {
    simularApi(BASE);
    renderApp('/venta');
    await armarCarritoTipico();

    await userEvent.keyboard('{ArrowDown}');
    expect(filas()[1]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('+');
    expect(filas()[1]).toHaveTextContent(/Gaseosa.*2/);
    await userEvent.keyboard('{Delete}');
    expect(filas()).toHaveLength(1);
    expect(screen.getByTestId('total')).toHaveTextContent('1.800,00');

    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    await userEvent.keyboard('{Control>}{Delete}{/Control}');
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByText('Escaneá un producto para empezar.')).toBeInTheDocument();
  });

  it('el carrito vuelve después de recargar la página', async () => {
    simularApi(BASE);
    const primera = renderApp('/venta');
    await armarCarritoTipico();
    primera.desmontar();

    renderApp('/venta');

    await waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('3.300,00'));
    expect(filas()).toHaveLength(2);
  });

  it('muestra la referencia de atajos', async () => {
    simularApi(BASE);
    renderApp('/venta');

    const pie = await screen.findByRole('contentinfo', { name: 'Atajos de teclado' });
    for (const texto of ['Efectivo', 'Varios', 'Quitar', 'Vaciar', 'Imprimir ticket']) {
      expect(within(pie).getByText(texto, { exact: false })).toBeInTheDocument();
    }
  });
});

describe('cobro', () => {
  it('efectivo con vuelto: F1, 5000, ve $1.700 y Enter registra la venta', async () => {
    let enviado: unknown;
    simularApi({
      ...BASE,
      'POST /ventas': (cuerpo) => {
        enviado = cuerpo;
        return [201, ventaRegistrada(cuerpo)];
      },
    });
    renderApp('/venta');
    await armarCarritoTipico();

    await userEvent.keyboard('{F1}');
    const dialogo = await screen.findByRole('dialog', { name: 'Cobro en Efectivo' });
    await userEvent.type(within(dialogo).getByLabelText('Paga con (opcional)'), '5000');
    expect(within(dialogo).getByRole('status')).toHaveTextContent('1.700,00');
    await userEvent.keyboard('{Enter}');

    const ultima = await screen.findByRole('region', { name: 'Última venta' });
    expect(ultima).toHaveTextContent('Venta #120 cobrada');
    expect(ultima).toHaveTextContent('Vuelto: $ 1.700,00');
    expect(enviado).toEqual({
      items: [
        { productoId: ALFAJOR.id, cantidad: 2 },
        { productoId: GASEOSA.id, cantidad: 1 },
      ],
      pagos: [{ medio: 'efectivo', monto: '3300.00', montoRecibido: '5000.00' }],
      totalEsperado: '3300.00',
    });
    expect(screen.getByText('Escaneá un producto para empezar.')).toBeInTheDocument();
    expect(await escaner()).toHaveFocus();
    expect(window.print).not.toHaveBeenCalled();
  });

  it('débito en dos teclas: F2 y Enter', async () => {
    let enviado: { pagos: unknown } | undefined;
    simularApi({
      ...BASE,
      'POST /ventas': (cuerpo) => {
        enviado = cuerpo as { pagos: unknown };
        return [201, ventaRegistrada(cuerpo)];
      },
    });
    renderApp('/venta');
    await armarCarritoTipico();

    await userEvent.keyboard('{F2}');
    await screen.findByRole('dialog', { name: 'Cobro en Débito' });
    await userEvent.keyboard('{Enter}');

    await screen.findByRole('region', { name: 'Última venta' });
    expect(enviado?.pagos).toEqual([{ medio: 'debito', monto: '3300.00' }]);
  });

  it('pago mixto: muestra lo que falta y habilita al completar', async () => {
    let enviado: { pagos: unknown } | undefined;
    simularApi({
      ...BASE,
      'POST /ventas': (cuerpo) => {
        enviado = cuerpo as { pagos: unknown };
        return [201, ventaRegistrada(cuerpo)];
      },
    });
    renderApp('/venta');
    await armarCarritoTipico();

    await userEvent.keyboard('{F6}');
    const dialogo = await screen.findByRole('dialog', { name: 'Pago mixto' });
    const confirmar = within(dialogo).getByRole('button', { name: 'Confirmar (Enter)' });
    await userEvent.type(within(dialogo).getByLabelText('Efectivo'), '2000');
    expect(within(dialogo).getByRole('status')).toHaveTextContent('Falta asignar $ 1.300,00');
    expect(confirmar).toBeDisabled();
    await userEvent.type(within(dialogo).getByLabelText('Débito'), '1300');
    expect(within(dialogo).getByRole('status')).toHaveTextContent('Falta asignar $ 0,00');
    expect(confirmar).toBeEnabled();
    await userEvent.click(confirmar);

    await screen.findByRole('region', { name: 'Última venta' });
    expect(enviado?.pagos).toEqual([
      { medio: 'efectivo', monto: '2000.00' },
      { medio: 'debito', monto: '1300.00' },
    ]);
  });

  it('si cambiaron los precios, actualiza el carrito y no registra la venta', async () => {
    simularApi({
      ...BASE,
      'POST /ventas': [
        409,
        {
          error: {
            codigo: 'PRECIOS_CAMBIARON',
            mensaje: 'Cambiaron precios.',
            detalle: [
              { productoId: ALFAJOR.id, precio: '1000.00' },
              { productoId: GASEOSA.id, precio: '1500.00' },
            ],
          },
        },
      ],
    });
    renderApp('/venta');
    await armarCarritoTipico();

    await userEvent.keyboard('{F2}');
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Cambiaron precios');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('total')).toHaveTextContent('3.500,00');
    expect(filas()[0]).toHaveClass('bg-amber-100');
    expect(screen.queryByRole('region', { name: 'Última venta' })).not.toBeInTheDocument();
  });

  it('con el carrito vacío, F1 avisa en vez de cobrar', async () => {
    simularApi(BASE);
    renderApp('/venta');
    await escaner();

    await userEvent.keyboard('{F1}');

    expect(await screen.findByRole('alert')).toHaveTextContent('El carrito está vacío.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ticket', () => {
  it('se imprime solo con F9 y tiene número, ítems, total, pagos, vuelto y la leyenda', async () => {
    simularApi({ ...BASE, 'POST /ventas': (cuerpo) => [201, ventaRegistrada(cuerpo)] });
    renderApp('/venta');
    await armarCarritoTipico();
    await userEvent.keyboard('{F1}');
    const dialogo = await screen.findByRole('dialog');
    await userEvent.type(within(dialogo).getByLabelText('Paga con (opcional)'), '5000{Enter}');
    await screen.findByRole('region', { name: 'Última venta' });
    expect(window.print).not.toHaveBeenCalled();

    await act(async () => {
      await userEvent.keyboard('{F9}');
    });

    expect(window.print).toHaveBeenCalledTimes(1);
    const ticket = screen.getByTestId('ticket');
    for (const texto of [
      'Venta #120',
      'Alfajor',
      'Gaseosa',
      'TOTAL',
      '3.300,00',
      'Efectivo',
      'Vuelto',
      '1.700,00',
      'No válido como factura',
    ]) {
      expect(ticket).toHaveTextContent(texto);
    }
  });
});
