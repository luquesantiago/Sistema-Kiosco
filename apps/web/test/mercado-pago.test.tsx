import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { hoyEnArgentina } from '../src/lib/fechas.js';
import { ADMIN, EMPLEADO, renderApp, simularApi } from './ayudas.js';

const HOY = hoyEnArgentina();
const PRIMERO_DEL_MES = `${HOY.slice(0, 8)}01`;

const LUZ = {
  id: '0198a5b0-0000-7000-8000-000000000601',
  tipo: 'gasto',
  categoria: 'servicios',
  cuenta: 'mercado_pago',
  turnoId: null,
  monto: '45000.00',
  motivo: 'luz de octubre',
  usuario: { id: ADMIN.id, nombre: ADMIN.nombre },
  creadoEn: '2026-10-20T23:15:00.000Z',
};

describe('pantalla de Mercado Pago', () => {
  it('lista los movimientos del mes y registra un gasto de Mercado Pago', async () => {
    let enviado: unknown;
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [`GET /caja/movimientos-mp?desde=${PRIMERO_DEL_MES}&hasta=${HOY}&pagina=1`]: [200, [LUZ]],
      'POST /caja/movimientos': (cuerpo) => {
        enviado = cuerpo;
        return [201, { ...LUZ, id: '0198a5b0-0000-7000-8000-000000000602' }];
      },
    });
    renderApp('/admin/mercado-pago');

    const lista = await screen.findByRole('list', { name: 'Movimientos de Mercado Pago' });
    expect(await within(lista).findByText('Gasto · Servicios · Mercado Pago')).toBeInTheDocument();
    expect(lista).toHaveTextContent('luz de octubre');

    const form = screen.getByRole('form', { name: 'Nuevo movimiento de Mercado Pago' });
    await userEvent.type(within(form).getByLabelText('Monto'), '12000');
    await userEvent.click(within(form).getByRole('radio', { name: 'Servicios' }));
    await userEvent.type(within(form).getByLabelText('Motivo'), 'internet');
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar' }));

    await waitFor(() =>
      expect(enviado).toEqual({
        tipo: 'gasto',
        categoria: 'servicios',
        cuenta: 'mercado_pago',
        monto: '12000.00',
        motivo: 'internet',
      }),
    );
  });

  it('un retiro no pide categoría y va como Mercado Pago', async () => {
    let enviado: unknown;
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [`GET /caja/movimientos-mp?desde=${PRIMERO_DEL_MES}&hasta=${HOY}&pagina=1`]: [200, []],
      'POST /caja/movimientos': (cuerpo) => {
        enviado = cuerpo;
        return [201, LUZ];
      },
    });
    renderApp('/admin/mercado-pago');

    expect(
      await screen.findByText('No hay movimientos de Mercado Pago en esas fechas.'),
    ).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Nuevo movimiento de Mercado Pago' });
    await userEvent.click(within(form).getByRole('radio', { name: 'Retiro' }));
    expect(within(form).queryByRole('group', { name: 'Categoría' })).not.toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText('Monto'), '100000');
    await userEvent.type(within(form).getByLabelText('Motivo'), 'a mi cuenta');
    await userEvent.click(within(form).getByRole('button', { name: 'Registrar' }));

    await waitFor(() =>
      expect(enviado).toEqual({
        tipo: 'retiro',
        cuenta: 'mercado_pago',
        monto: '100000.00',
        motivo: 'a mi cuenta',
      }),
    );
  });

  it('cambiar las fechas vuelve a pedir la lista', async () => {
    const fetchMock = simularApi({
      'GET /auth/sesion': [200, ADMIN],
      [`GET /caja/movimientos-mp?desde=${PRIMERO_DEL_MES}&hasta=${HOY}&pagina=1`]: [200, []],
      [`GET /caja/movimientos-mp?desde=2026-09-01&hasta=${HOY}&pagina=1`]: [200, [LUZ]],
    });
    renderApp('/admin/mercado-pago');

    const fechas = await screen.findByRole('group', { name: 'Fechas' });
    fireEvent.change(within(fechas).getByLabelText('Desde'), { target: { value: '2026-09-01' } });

    const lista = screen.getByRole('list', { name: 'Movimientos de Mercado Pago' });
    await waitFor(() => expect(lista).toHaveTextContent('luz de octubre'));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/caja/movimientos-mp?desde=2026-09-01&hasta=${HOY}&pagina=1`,
      expect.anything(),
    );
  });

  it('el panel de admin la enlaza y un empleado no entra', async () => {
    simularApi({ 'GET /auth/sesion': [200, ADMIN] });
    const { desmontar } = renderApp('/admin');
    expect(await screen.findByRole('link', { name: /Mercado Pago/ })).toHaveAttribute(
      'href',
      '/admin/mercado-pago',
    );
    desmontar();

    simularApi({
      'GET /auth/sesion': [200, EMPLEADO],
      'GET /caja/estado': [200, { turnoAbierto: null, montoSugerido: '0.00' }],
    });
    const { router } = renderApp('/admin/mercado-pago');
    await waitFor(() => expect(router.state.location.pathname).toBe('/venta'));
  });
});
