import { proximoDiaDeEntrega } from '@kiosco/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { hoyEnArgentina } from '../src/lib/fechas.js';
import { ADMIN, EMPLEADO, renderApp, simularApi } from './ayudas.js';

const HOY = hoyEnArgentina();
const COCA = { id: '0198a5b0-0000-7000-8000-000000000101', nombre: 'Coca-Cola' };
const quien = (u: { id: string; nombre: string }, en = '2026-10-20T12:00:00.000Z') => ({
  usuario: { id: u.id, nombre: u.nombre },
  en,
});

const POR_LLEGAR = {
  id: '0198a5b0-0000-7000-8000-000000000701',
  numero: 12,
  proveedor: COCA,
  totalPedido: '310000.00',
  total: null,
  llegaEl: HOY,
  nota: '4 packs',
  estado: 'por_llegar',
  cuentaPago: null,
  cerradoEn: null,
  creado: quien(ADMIN),
  recibido: null,
  notaRecepcion: null,
  cancelado: null,
  carga: null,
  pago: null,
};
const DEBE = {
  ...POR_LLEGAR,
  id: '0198a5b0-0000-7000-8000-000000000702',
  numero: 11,
  proveedor: { id: '0198a5b0-0000-7000-8000-000000000102', nombre: 'Pepsi' },
  totalPedido: '210000.00',
  total: '210000.00',
  llegaEl: '2026-10-01',
  estado: 'cargado',
  recibido: quien(EMPLEADO),
};
/** Lo que devuelve la lista: el detalle sin quién hizo qué. */
function resumen(p: typeof POR_LLEGAR | typeof DEBE) {
  const {
    id,
    numero,
    proveedor,
    totalPedido,
    total,
    llegaEl,
    nota,
    estado,
    cuentaPago,
    cerradoEn,
  } = p;
  return {
    id,
    numero,
    proveedor,
    totalPedido,
    total,
    llegaEl,
    nota,
    estado,
    cuentaPago,
    cerradoEn,
  };
}

describe('lista de pedidos', () => {
  it('el empleado ve los abiertos con sus insignias y no puede crear pedidos', async () => {
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /pedidos?vista=abiertos': [200, [resumen(POR_LLEGAR), resumen(DEBE)]],
    });
    renderApp('/pedidos');

    const lista = await screen.findByRole('list', { name: 'Pedidos' });
    const [coca, pepsi] = await within(lista).findAllByRole('listitem');
    expect(coca).toHaveTextContent('#12 · Coca-Cola');
    expect(coca).toHaveTextContent('Hoy llega');
    expect(pepsi).toHaveTextContent('Debe');
    expect(screen.queryByRole('link', { name: 'Nuevo pedido' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Recibir sin pedido' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Vista' })).not.toBeInTheDocument();
  });
});

describe('nuevo pedido', () => {
  it('precarga la fecha con el próximo día de entrega del proveedor', async () => {
    let enviado: unknown;
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /proveedores': [
        200,
        [
          {
            ...COCA,
            telefono: null,
            notas: null,
            diasPedido: ['martes'],
            diasEntrega: ['jueves'],
            activo: true,
            tomaPedidoHoy: false,
            productosActivos: 3,
          },
        ],
      ],
      'POST /pedidos': (cuerpo) => {
        enviado = cuerpo;
        return [201, POR_LLEGAR];
      },
      [`GET /pedidos/${POR_LLEGAR.id}`]: [200, POR_LLEGAR],
    });
    const { router } = renderApp('/admin/pedidos/nuevo');

    await userEvent.selectOptions(
      await screen.findByLabelText('Proveedor'),
      await screen.findByRole('option', { name: 'Coca-Cola' }),
    );
    const esperado = proximoDiaDeEntrega(['jueves'], HOY);
    expect(screen.getByLabelText('Llega')).toHaveValue(esperado);
    await userEvent.type(screen.getByLabelText('Total a pagar'), '310000');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar pedido' }));

    await waitFor(() =>
      expect(enviado).toEqual({
        proveedorId: COCA.id,
        totalPedido: '310000.00',
        llegaEl: esperado,
        nota: '',
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${POR_LLEGAR.id}`));
  });
});

describe('detalle de un pedido', () => {
  it('el empleado marca que llegó pagando en efectivo; no ve editar ni cancelar', async () => {
    let enviado: unknown;
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      [`GET /pedidos/${POR_LLEGAR.id}`]: [200, POR_LLEGAR],
      [`POST /pedidos/${POR_LLEGAR.id}/llego`]: (cuerpo) => {
        enviado = cuerpo;
        return [
          200,
          {
            ...POR_LLEGAR,
            estado: 'llego',
            total: '280000.00',
            cuentaPago: 'efectivo',
            recibido: quien(EMPLEADO),
            pago: { ...quien(EMPLEADO), cuenta: 'efectivo', monto: '280000.00' },
          },
        ];
      },
    });
    renderApp(`/pedidos/${POR_LLEGAR.id}`);

    const form = await screen.findByRole('form', { name: 'Llegó el pedido' });
    expect(screen.queryByText('Editar o cancelar')).not.toBeInTheDocument();
    const total = within(form).getByLabelText('Total');
    expect(total).toHaveValue('310000,00');
    await userEvent.clear(total);
    await userEvent.type(total, '280000');
    await userEvent.type(within(form).getByLabelText(/Nota/), 'faltaron 2 packs');
    await userEvent.click(within(form).getByRole('button', { name: 'Llegó' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Elegí cómo se paga.');
    await userEvent.click(within(form).getByRole('radio', { name: 'Efectivo' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Llegó' }));

    await waitFor(() =>
      expect(enviado).toEqual({
        total: '280000.00',
        notaRecepcion: 'faltaron 2 packs',
        cuenta: 'efectivo',
      }),
    );
    // Llegó y pagado: lo que sigue es cargar la mercadería.
    expect(await screen.findByRole('form', { name: 'Carga de mercadería' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Pagar el pedido' })).not.toBeInTheDocument();
  });

  it('"Queda debiendo" no manda cuenta y después se paga con Mercado Pago', async () => {
    const envios: unknown[] = [];
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      [`GET /pedidos/${DEBE.id}`]: [
        200,
        { ...DEBE, estado: 'por_llegar', total: null, recibido: null },
      ],
      [`POST /pedidos/${DEBE.id}/llego`]: (cuerpo) => {
        envios.push(cuerpo);
        return [200, DEBE];
      },
      [`POST /pedidos/${DEBE.id}/pago`]: (cuerpo) => {
        envios.push(cuerpo);
        return [
          200,
          { ...DEBE, cuentaPago: 'mercado_pago', cerradoEn: '2026-10-22T12:00:00.000Z' },
        ];
      },
    });
    renderApp(`/pedidos/${DEBE.id}`);

    const llegada = await screen.findByRole('form', { name: 'Llegó el pedido' });
    await userEvent.click(within(llegada).getByRole('radio', { name: 'Queda debiendo' }));
    await userEvent.click(within(llegada).getByRole('button', { name: 'Llegó' }));
    const pago = await screen.findByRole('form', { name: 'Pagar el pedido' });
    await userEvent.click(within(pago).getByRole('radio', { name: 'Mercado Pago' }));
    await userEvent.click(within(pago).getByRole('button', { name: 'Pagar' }));

    await waitFor(() => expect(envios).toHaveLength(2));
    expect(envios[0]).toMatchObject({ cuenta: null });
    expect(envios[1]).toEqual({ cuenta: 'mercado_pago', total: '210000.00' });
    expect(await screen.findByText('Cerrado')).toBeInTheDocument();
  });

  it('el admin puede cancelar un pedido por llegar', async () => {
    let enviado: unknown;
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [`GET /pedidos/${POR_LLEGAR.id}`]: [200, POR_LLEGAR],
      [`POST /pedidos/${POR_LLEGAR.id}/cancelar`]: (cuerpo) => {
        enviado = cuerpo;
        return [
          200,
          { ...POR_LLEGAR, estado: 'cancelado', cancelado: { ...quien(ADMIN), motivo: 'no vino' } },
        ];
      },
    });
    renderApp(`/pedidos/${POR_LLEGAR.id}`);

    await userEvent.click(await screen.findByText('Editar o cancelar'));
    const form = screen.getByRole('form', { name: 'Cancelar el pedido' });
    await userEvent.type(within(form).getByLabelText('Motivo de la cancelación'), 'no vino');
    await userEvent.click(within(form).getByRole('button', { name: 'Cancelar pedido' }));

    await waitFor(() => expect(enviado).toEqual({ motivo: 'no vino' }));
    expect(await screen.findByText('Canceló Ana Admin: no vino')).toBeInTheDocument();
  });
});

describe('recordatorios en el POS', () => {
  it('muestra los que llegan hoy y los que falta cargar, sin tomar el foco', async () => {
    const faltaCargar = {
      ...resumen(POR_LLEGAR),
      id: '0198a5b0-0000-7000-8000-000000000703',
      proveedor: { id: '0198a5b0-0000-7000-8000-000000000103', nombre: 'Panadería' },
      estado: 'llego',
    };
    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /caja/estado': [
        200,
        {
          turnoAbierto: {
            id: '0198a5b0-0000-7000-8000-000000000401',
            responsable: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
            abiertoEn: '2026-10-20T10:00:00.000Z',
            esMio: true,
          },
          montoSugerido: '0.00',
        },
      ],
      'GET /pedidos?vista=abiertos': [200, [faltaCargar, resumen(POR_LLEGAR), resumen(DEBE)]],
    });
    renderApp('/venta');

    const recordatorios = await screen.findByRole('list', { name: 'Pedidos para atender' });
    const enlaces = within(recordatorios).getAllByRole('link');
    expect(enlaces).toHaveLength(2);
    expect(enlaces[0]).toHaveTextContent('Panadería: falta cargar');
    expect(enlaces[1]).toHaveTextContent(/^Hoy llega: Coca-Cola \(\$\s?310\.000,00\)$/);
    expect(enlaces[0]).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('combobox', { name: 'Escaneá o buscá un producto' })).toHaveFocus();
  });
});
