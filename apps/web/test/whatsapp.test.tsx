import type { EstadoWhatsappRespuesta, Notificacion } from '@kiosco/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN, EMPLEADO, renderApp, simularApi } from './ayudas.js';

const CONECTADO: EstadoWhatsappRespuesta = {
  estado: 'conectado',
  cuenta: { numero: '1100000000' },
  destino: { numero: '1123456789' },
  pendientes: 0,
};

const QR = { imagen: 'data:image/png;base64,UVI=' };

function error(codigo: string, mensaje: string) {
  return { error: { codigo, mensaje } };
}

describe('pantalla de WhatsApp', () => {
  it('muestra el QR mientras espera y pasa a conectado al escanearlo', async () => {
    let estado: EstadoWhatsappRespuesta = { ...CONECTADO, estado: 'desvinculado', cuenta: null };
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /whatsapp': () => [200, estado],
      'POST /whatsapp/vincular': () => {
        estado = { ...estado, estado: 'esperando_qr' };
        return [200, estado];
      },
      'GET /whatsapp/qr': [200, QR],
    });
    const usuario = userEvent.setup();
    renderApp('/admin/whatsapp');

    await usuario.click(await screen.findByRole('button', { name: 'Vincular WhatsApp' }));
    expect(await screen.findByRole('img', { name: 'QR para vincular WhatsApp' })).toHaveAttribute(
      'src',
      QR.imagen,
    );

    estado = CONECTADO;
    expect(
      await screen.findByText(/con el chip 11 0000-0000/, {}, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /QR/ })).not.toBeInTheDocument();
  });

  it('si el QR se vence ofrece generar uno nuevo', async () => {
    const estado: EstadoWhatsappRespuesta = { ...CONECTADO, estado: 'desvinculado', cuenta: null };
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /whatsapp': () => [200, estado],
      'POST /whatsapp/vincular': () => [200, { ...estado, estado: 'desvinculado' }],
    });
    const usuario = userEvent.setup();
    renderApp('/admin/whatsapp');

    await usuario.click(await screen.findByRole('button', { name: 'Vincular WhatsApp' }));

    expect(await screen.findByRole('button', { name: 'Generar QR nuevo' })).toBeInTheDocument();
    expect(screen.getByText(/se venció/)).toBeInTheDocument();
  });

  it('rechaza el número con 15 y muestra el motivo', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /whatsapp': [200, { ...CONECTADO, destino: null }],
      'PUT /whatsapp/destino': [
        422,
        error('NUMERO_CON_15', 'Cargá el número sin el 15: código de área sin 0 y número.'),
      ],
    });
    const usuario = userEvent.setup();
    renderApp('/admin/whatsapp');

    await usuario.type(await screen.findByLabelText(/Número/), '11 15 2345-6789');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('sin el 15');
  });

  it('rechaza un número sin WhatsApp', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /whatsapp': [200, CONECTADO],
      'PUT /whatsapp/destino': [422, error('NUMERO_SIN_WHATSAPP', 'Ese número no tiene WhatsApp.')],
    });
    const usuario = userEvent.setup();
    renderApp('/admin/whatsapp');

    await usuario.type(await screen.findByLabelText(/Cambiar el número/), '11 9999-9999');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('no tiene WhatsApp');
    expect(screen.getByText(/Los avisos llegan al 11 2345-6789/)).toBeInTheDocument();
  });

  it('guarda el número y manda la prueba', async () => {
    const fetchMock = simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /whatsapp': [200, { ...CONECTADO, destino: null }],
      'PUT /whatsapp/destino': [200, CONECTADO],
      'POST /whatsapp/prueba': [204],
    });
    const usuario = userEvent.setup();
    renderApp('/admin/whatsapp');

    const prueba = await screen.findByRole('button', { name: 'Mandar prueba' });
    expect(prueba).toBeDisabled();
    await usuario.type(screen.getByLabelText(/Número/), '+54 9 11 2345-6789');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Los avisos llegan al 11 2345-6789/)).toBeInTheDocument();
    await usuario.click(prueba);

    expect(await screen.findByRole('status')).toHaveTextContent('Mensaje de prueba enviado');
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(put![1]!.body as string)).toEqual({ numero: '+54 9 11 2345-6789' });
  });

  it('una prueba fallida muestra el motivo', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /whatsapp': [200, CONECTADO],
      'POST /whatsapp/prueba': [
        502,
        error('WHATSAPP_FALLO', 'WhatsApp rechazó el pedido (HTTP 500).'),
      ],
    });
    const usuario = userEvent.setup();
    renderApp('/admin/whatsapp');

    await usuario.click(await screen.findByRole('button', { name: 'Mandar prueba' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('rechazó el pedido');
  });

  it('desvincular pide confirmación', async () => {
    const fetchMock = simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /whatsapp': [200, CONECTADO],
      'POST /whatsapp/desvincular': [200, { ...CONECTADO, estado: 'desvinculado', cuenta: null }],
    });
    const usuario = userEvent.setup();
    renderApp('/admin/whatsapp');

    await usuario.click(await screen.findByRole('button', { name: 'Desvincular' }));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/whatsapp/desvincular', expect.anything());
    await usuario.click(screen.getByRole('button', { name: 'Sí, desvincular' }));

    expect(await screen.findByRole('button', { name: 'Vincular WhatsApp' })).toBeInTheDocument();
  });

  it('un empleado no tiene acceso', async () => {
    simularApi({ 'GET /auth/sesion': [200, EMPLEADO] });
    const { router } = renderApp('/admin/whatsapp');

    await waitFor(() => expect(router.state.location.pathname).not.toBe('/admin/whatsapp'));
    expect(screen.queryByRole('heading', { name: 'WhatsApp' })).not.toBeInTheDocument();
  });
});

describe('cartel de WhatsApp en el panel del admin', () => {
  it('con el chip desvinculado avisa cuántos avisos esperan', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /whatsapp': [200, { ...CONECTADO, estado: 'desvinculado', cuenta: null, pendientes: 3 }],
      'GET /health': [200, { estado: 'ok', baseDeDatos: 'ok', hora: new Date().toISOString() }],
    });
    renderApp('/admin');

    const cartel = await screen.findByRole('alert');
    expect(cartel).toHaveTextContent('WhatsApp no está vinculado');
    expect(cartel).toHaveTextContent('Hay 3 avisos esperando envío');
    expect(within(cartel).getByRole('link', { name: 'Ir a WhatsApp' })).toHaveAttribute(
      'href',
      '/admin/whatsapp',
    );
  });

  it('avisa si falta el número', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /whatsapp': [200, { ...CONECTADO, destino: null }],
      'GET /health': [200, { estado: 'ok', baseDeDatos: 'ok', hora: new Date().toISOString() }],
    });
    renderApp('/admin');

    expect(await screen.findByRole('alert')).toHaveTextContent('Falta cargar el número');
  });

  for (const [caso, estado] of [
    ['todo funcionando', CONECTADO],
    ['sin WhatsApp configurado', { ...CONECTADO, estado: 'no_configurado', cuenta: null }],
  ] as const) {
    it(`no se muestra con ${caso}`, async () => {
      const fetchMock = simularApi({
        'GET /auth/sesion': [200, ADMIN],
        'GET /whatsapp': [200, estado],
        'GET /health': [200, { estado: 'ok', baseDeDatos: 'ok', hora: new Date().toISOString() }],
      });
      renderApp('/admin');

      await screen.findByRole('heading', { name: 'Administración' });
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith('/api/whatsapp', expect.anything()),
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  }
});

describe('avisos con su envío', () => {
  const BASE: Notificacion = {
    id: '0198a5b0-0000-7000-8000-000000000401',
    tipo: 'gasto_caja',
    destino: 'admin',
    texto: 'Gasto de $8.000',
    estado: 'error',
    creadaEn: '2026-10-20T19:00:00.000Z',
    enviadaEn: null,
    error: 'WhatsApp rechazó el pedido (HTTP 500).',
    intentos: 5,
  };

  it('muestra el motivo del error y al reintentar pasa a pendiente', async () => {
    let aviso = BASE;
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /notificaciones': () => [200, [aviso]],
      [`POST /notificaciones/${BASE.id}/reintentar`]: () => {
        aviso = { ...BASE, estado: 'pendiente', intentos: 0, error: null };
        return [200, aviso];
      },
    });
    const usuario = userEvent.setup();
    renderApp('/admin/avisos');

    expect(await screen.findByText(/Motivo: WhatsApp rechazó el pedido/)).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Pendiente de envío')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('muestra cuándo se envió', async () => {
    simularApi({
      'GET /auth/sesion': [200, ADMIN],
      'GET /notificaciones': [
        200,
        [
          {
            ...BASE,
            estado: 'enviada',
            enviadaEn: '2026-10-20T19:00:10.000Z',
            error: null,
            intentos: 0,
          },
        ],
      ],
    });
    renderApp('/admin/avisos');

    expect(await screen.findByText(/^Enviado \d/)).toBeInTheDocument();
  });
});
