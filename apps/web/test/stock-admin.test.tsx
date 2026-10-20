import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, EMPLEADO, renderApp, simularApi } from './ayudas.js';

const GASEOSA = {
  id: '0198a5b0-0000-7000-8000-000000000201',
  codigoBarras: '7790001',
  nombre: 'Gaseosa cola',
  precio: '1500.00',
  stockActual: 20,
  costo: '900.00',
  proveedor: null,
  stockMinimo: 0,
  stockMaximo: 0,
  activo: true,
};
const ALFAJOR = {
  ...GASEOSA,
  id: '0198a5b0-0000-7000-8000-000000000202',
  codigoBarras: '7790002',
  nombre: 'Alfajor triple',
};

const busqueda = (q: string) => `GET /productos?q=${q}&pagina=1`;

async function elegirGaseosa() {
  await userEvent.type(
    await screen.findByRole('combobox', { name: 'Buscá el producto' }),
    '7790001{Enter}',
  );
  await screen.findByRole('heading', { name: 'Gaseosa cola' });
}

describe('stock del admin', () => {
  it('un ajuste con motivo "Otro" sin nota no llega a la API', async () => {
    const fetchMock = simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [busqueda('7790001')]: [200, [GASEOSA]],
    });
    renderApp('/admin/stock');
    await elegirGaseosa();

    const form = screen.getByRole('form', { name: 'Ajuste de stock' });
    await userEvent.selectOptions(within(form).getByLabelText('Motivo'), 'otro');
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar ajuste' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Con el motivo "Otro" tenés que escribir una nota.',
    );
    expect(fetchMock).not.toHaveBeenCalledWith('/api/stock/ajustes', expect.anything());
  });

  it('registra un ajuste por rotura restando y actualiza el stock', async () => {
    let enviado: unknown;
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [busqueda('7790001')]: [200, [GASEOSA]],
      'POST /stock/ajustes': (cuerpo) => {
        enviado = cuerpo;
        return [
          201,
          {
            id: '0198a5b0-0000-7000-8000-000000000401',
            tipo: 'ajuste',
            motivo: 'rotura',
            cantidad: -2,
            stockResultante: 18,
            nota: null,
            ingresoId: null,
            creadoEn: '2026-10-20T15:00:00.000Z',
            usuario: { id: ADMIN.id, nombre: ADMIN.nombre },
          },
        ];
      },
    });
    renderApp('/admin/stock');
    await elegirGaseosa();

    const form = screen.getByRole('form', { name: 'Ajuste de stock' });
    const cantidad = within(form).getByLabelText('Cantidad');
    await userEvent.clear(cantidad);
    await userEvent.type(cantidad, '2');
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar ajuste' }));

    expect(await within(form).findByRole('status')).toHaveTextContent('Ajuste registrado: -2.');
    expect(enviado).toEqual({ productoId: GASEOSA.id, cantidad: -2, motivo: 'rotura', nota: null });
    expect(screen.getByText('18')).toBeInTheDocument();
  });

  it('muestra el resultado del conteo', async () => {
    let enviado: unknown;
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [busqueda('7790001')]: [200, [GASEOSA]],
      'POST /stock/conteos': (cuerpo) => {
        enviado = cuerpo;
        return [200, { diferencia: -3, stockActual: 17 }];
      },
    });
    renderApp('/admin/stock');
    await elegirGaseosa();

    await userEvent.click(screen.getByRole('button', { name: 'Contar' }));
    const form = screen.getByRole('form', { name: 'Conteo' });
    await userEvent.type(within(form).getByLabelText('Cantidad contada'), '17');
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar conteo' }));

    expect(await within(form).findByRole('status')).toHaveTextContent(
      'Diferencia -3: el stock quedó en 17.',
    );
    expect(enviado).toEqual({ productoId: GASEOSA.id, cantidadContada: 17 });
  });

  it('muestra los movimientos del producto', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [busqueda('7790001')]: [200, [GASEOSA]],
      [`GET /stock/productos/${GASEOSA.id}/movimientos?pagina=1`]: [
        200,
        [
          {
            id: '0198a5b0-0000-7000-8000-000000000402',
            tipo: 'ajuste',
            motivo: 'rotura',
            cantidad: -2,
            stockResultante: 18,
            nota: 'Se cayó el pack',
            ingresoId: null,
            creadoEn: '2026-10-20T15:00:00.000Z',
            usuario: { id: ADMIN.id, nombre: ADMIN.nombre },
          },
          {
            id: '0198a5b0-0000-7000-8000-000000000401',
            tipo: 'compra',
            motivo: null,
            cantidad: 20,
            stockResultante: 20,
            nota: null,
            ingresoId: '0198a5b0-0000-7000-8000-000000000301',
            creadoEn: '2026-10-20T14:00:00.000Z',
            usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
          },
        ],
      ],
    });
    renderApp('/admin/stock');
    await elegirGaseosa();

    await userEvent.click(screen.getByRole('button', { name: 'Ver movimientos' }));

    const lista = await screen.findByRole('list', { name: 'Movimientos' });
    const items = within(lista).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Ajuste · Rotura');
    expect(items[0]).toHaveTextContent('Se cayó el pack');
    expect(items[0]).toHaveTextContent('Queda 18');
    expect(items[1]).toHaveTextContent('Ingreso');
    expect(items[1]).toHaveTextContent('Juan Empleado');
    expect(items[1]).toHaveTextContent('+20');
  });
});

describe('ventas sin sistema', () => {
  it('carga varios productos y descuenta todo junto', async () => {
    let enviado: unknown;
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [busqueda('7790001')]: [200, [GASEOSA]],
      [busqueda('7790002')]: [200, [ALFAJOR]],
      'POST /stock/ventas-sin-sistema': (cuerpo) => {
        enviado = cuerpo;
        return [201, { productos: 2 }];
      },
    });
    renderApp('/admin/stock/ventas-sin-sistema');

    const campo = await screen.findByRole('combobox', { name: 'Escaneá o buscá un producto' });
    await userEvent.type(campo, '7790001{Enter}');
    await screen.findByText('Gaseosa cola');
    await userEvent.type(campo, '7790001{Enter}');
    await userEvent.type(campo, '7790002{Enter}');
    await screen.findByText('Alfajor triple');
    const alfajor = screen.getByLabelText('Cantidad de Alfajor triple');
    await userEvent.clear(alfajor);
    await userEvent.type(alfajor, '5');
    await userEvent.type(screen.getByLabelText('Nota (opcional)'), 'Corte de luz');
    await userEvent.click(screen.getByRole('button', { name: 'Descontar del stock' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Se descontó el stock de 2 productos.',
    );
    expect(enviado).toEqual({
      nota: 'Corte de luz',
      items: [
        { productoId: GASEOSA.id, cantidad: 2 },
        { productoId: ALFAJOR.id, cantidad: 5 },
      ],
    });
  });
});

describe('ingresos de mercadería (admin)', () => {
  const INGRESO = {
    id: '0198a5b0-0000-7000-8000-000000000301',
    creadoEn: '2026-10-20T15:00:00.000Z',
    proveedor: { id: '0198a5b0-0000-7000-8000-000000000101', nombre: 'Distribuidora Sur' },
    usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
    nota: 'Remito 123',
    cantidadProductos: 2,
  };

  it('la lista lleva al detalle con productos, cantidades, costos y quién lo cargó', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /stock/ingresos?pagina=1': [200, [INGRESO]],
      [`GET /stock/ingresos/${INGRESO.id}`]: [
        200,
        {
          ...INGRESO,
          items: [
            {
              producto: { id: GASEOSA.id, nombre: 'Gaseosa cola', codigoBarras: '7790001' },
              cantidad: 24,
              costoUnitario: '950.00',
            },
            {
              producto: { id: ALFAJOR.id, nombre: 'Alfajor triple', codigoBarras: null },
              cantidad: 12,
              costoUnitario: null,
            },
          ],
        },
      ],
    });
    renderApp('/admin/stock/ingresos');

    const tabla = await screen.findByRole('table');
    expect(within(tabla).getByText('Juan Empleado')).toBeInTheDocument();
    await userEvent.click(within(tabla).getByRole('link'));

    const detalle = await screen.findByRole('table', { name: 'Productos recibidos' });
    expect(screen.getByText('Juan Empleado')).toBeInTheDocument();
    const filaGaseosa = within(detalle).getByText('Gaseosa cola').closest('tr')!;
    expect(filaGaseosa).toHaveTextContent('24');
    expect(filaGaseosa).toHaveTextContent(/950,00/);
    const filaAlfajor = within(detalle).getByText('Alfajor triple').closest('tr')!;
    expect(filaAlfajor).toHaveTextContent('12');
    expect(filaAlfajor).toHaveTextContent('Sin cambios');
  });
});
