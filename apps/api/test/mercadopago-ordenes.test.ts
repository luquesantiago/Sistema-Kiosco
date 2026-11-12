import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ClienteMercadoPago,
  clienteMercadoPago,
  MercadoPagoNoDisponible,
  MercadoPagoRechazo,
} from '../src/integrations/mercadopago/cliente.js';
import type { OrdenPoint, PedidoOrden, ResultadoCancelacion } from './mercadopago-falso.js';

/*
 * Órdenes Point de la Orders API en el cliente HTTP real (tarea 2.4), contra una API
 * de Mercado Pago de mentira en un puerto local. El contrato de las operaciones
 * (nombres, tipos y traducción) está en `mercadopago-falso.ts`.
 *
 * Supuestos (el design los nombra pero la documentación de MP no los muestra completos;
 * se confirman en las tareas 8.1 y 8.2):
 * - Los errores de MP vienen como `{ errors: [{ code, message }] }`.
 * - El motivo de un pago fallido se toma del `status_detail` de la orden; en estos tests
 *   el pago (`transactions.payments[0]`) trae el mismo, así sirve cualquiera de los dos.
 * - `tipoInformado` sale de `transactions.payments[0].payment_method.type`.
 */

type ClienteConOrdenes = ClienteMercadoPago & {
  crearOrden(pedido: PedidoOrden): Promise<OrdenPoint>;
  consultarOrden(ordenId: string): Promise<OrdenPoint>;
  cancelarOrden(ordenId: string): Promise<ResultadoCancelacion>;
};

const TOKEN = 'APP_USR-token-secreto-de-prueba';
const TERMINAL = 'NEWLAND_N950__N950NCB801293324';
const ORDEN = 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3';

const PEDIDO: PedidoOrden = {
  claveIdempotencia: '0198a5b0-0000-7000-8000-00000000c0b1',
  referenciaExterna: 'venta-120-1',
  monto: '1500.00',
  medio: 'debito',
  terminalId: TERMINAL,
};

interface Pedido {
  metodo: string;
  url: string;
  encabezados: IncomingMessage['headers'];
  cuerpo: unknown;
}

type Manejador = (pedido: Pedido, res: ServerResponse) => void;

let servidor: Server | undefined;

/** Levanta una API de Mercado Pago de mentira y anota cada pedido. */
async function mpFalso(manejador: Manejador, pedidos: Pedido[] = []): Promise<string> {
  servidor = createServer((req, res) => {
    let texto = '';
    req.on('data', (parte: Buffer) => (texto += parte.toString()));
    req.on('end', () => {
      const pedido = {
        metodo: req.method ?? '',
        url: req.url ?? '',
        encabezados: req.headers,
        cuerpo: texto ? (JSON.parse(texto) as unknown) : undefined,
      };
      pedidos.push(pedido);
      manejador(pedido, res);
    });
  });
  await new Promise<void>((listo) => servidor!.listen(0, '127.0.0.1', listo));
  return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}

function responder(res: ServerResponse, status: number, cuerpo?: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(cuerpo === undefined ? undefined : JSON.stringify(cuerpo));
}

/** Una orden como la devuelve MP, con el pago y su medio. */
function orden(status: string, statusDetail: string, tipo: string | null = null) {
  return {
    id: ORDEN,
    type: 'point',
    external_reference: PEDIDO.referenciaExterna,
    status,
    status_detail: statusDetail,
    transactions: {
      payments: [
        {
          id: 'PAY01JQ4S4KY8HWQ6NA5PXB65B3D3',
          amount: '1500.00',
          status,
          status_detail: statusDetail,
          ...(tipo ? { payment_method: { type: tipo, id: 'visa' } } : {}),
        },
      ],
    },
    config: { point: { terminal_id: TERMINAL, print_on_terminal: 'no_ticket' } },
  };
}

function cliente(url: string, timeoutMs?: number) {
  return clienteMercadoPago(TOKEN, {
    baseUrl: url,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }) as ClienteConOrdenes;
}

afterEach(async () => {
  servidor?.closeAllConnections();
  await new Promise((listo) => (servidor ? servidor.close(listo) : listo(undefined)));
  servidor = undefined;
});

describe('crearOrden', () => {
  it('manda la orden Point con el monto, la terminal, la clave de idempotencia y el token', async () => {
    const pedidos: Pedido[] = [];
    const url = await mpFalso(
      (_p, res) => responder(res, 201, orden('created', 'created')),
      pedidos,
    );

    const creada = await cliente(url).crearOrden(PEDIDO);

    expect(creada).toEqual({
      id: ORDEN,
      estado: 'en_espera',
      detalle: 'created',
      tipoInformado: null,
      referenciaExterna: 'venta-120-1',
    });
    expect(pedidos).toHaveLength(1);
    const [pedido] = pedidos;
    expect(pedido).toMatchObject({ metodo: 'POST', url: '/v1/orders' });
    expect(pedido!.encabezados.authorization).toBe(`Bearer ${TOKEN}`);
    expect(pedido!.encabezados['x-idempotency-key']).toBe(PEDIDO.claveIdempotencia);
    expect(pedido!.cuerpo).toMatchObject({
      type: 'point',
      external_reference: 'venta-120-1',
      expiration_time: 'PT3M',
      transactions: { payments: [{ amount: '1500.00' }] },
      config: {
        point: { terminal_id: TERMINAL, print_on_terminal: 'no_ticket' },
        payment_method: { default_type: 'debit_card' },
      },
    });
  });

  it.each([
    ['debito', 'debit_card'],
    ['credito', 'credit_card'],
    ['mercado_pago', 'qr'],
  ] as const)('el medio %s se pide a la terminal como %s', async (medio, tipo) => {
    const pedidos: Pedido[] = [];
    const url = await mpFalso(
      (_p, res) => responder(res, 201, orden('created', 'created')),
      pedidos,
    );

    await cliente(url).crearOrden({ ...PEDIDO, medio });

    expect(pedidos[0]!.cuerpo).toMatchObject({
      config: { payment_method: { default_type: tipo } },
    });
  });

  it.each(['0.01', '1500.50', '99999999.99'])(
    'el monto "%s" viaja tal cual, como texto',
    async (monto) => {
      const pedidos: Pedido[] = [];
      const url = await mpFalso(
        (_p, res) => responder(res, 201, orden('created', 'created')),
        pedidos,
      );

      await cliente(url).crearOrden({ ...PEDIDO, monto });

      expect(pedidos[0]!.cuerpo).toMatchObject({ transactions: { payments: [{ amount: monto }] } });
    },
  );

  it('409 already_queued_order_for_terminal es un rechazo "terminal_ocupada"', async () => {
    const url = await mpFalso((_p, res) =>
      responder(res, 409, {
        errors: [{ code: 'already_queued_order_for_terminal', message: 'detalle interno de MP' }],
      }),
    );

    const falla = await cliente(url)
      .crearOrden(PEDIDO)
      .catch((e: unknown) => e);

    expect(falla).toBeInstanceOf(MercadoPagoRechazo);
    expect(falla).toMatchObject({ status: 409, codigo: 'terminal_ocupada' });
    expect((falla as Error).message).not.toContain('detalle interno');
    expect((falla as Error).message).not.toContain(TOKEN);
  });

  it('400 por el monto (minimum_amount_not_met) es un rechazo "monto_invalido"', async () => {
    const url = await mpFalso((_p, res) =>
      responder(res, 400, { errors: [{ code: 'minimum_amount_not_met', message: 'min' }] }),
    );

    const falla = await cliente(url)
      .crearOrden({ ...PEDIDO, monto: '0.01' })
      .catch((e: unknown) => e);

    expect(falla).toBeInstanceOf(MercadoPagoRechazo);
    expect(falla).toMatchObject({ status: 400, codigo: 'monto_invalido' });
  });

  it.each([500, 502, 599])('MP responde %i: no disponible', async (status) => {
    const url = await mpFalso((_p, res) => responder(res, status, { message: 'error' }));

    await expect(cliente(url).crearOrden(PEDIDO)).rejects.toThrow(MercadoPagoNoDisponible);
  });

  it('sin red: no disponible', async () => {
    await expect(cliente('http://127.0.0.1:9').crearOrden(PEDIDO)).rejects.toThrow(
      MercadoPagoNoDisponible,
    );
  });
});

/**
 * El límite de 10 s es el mismo `timeoutMs` del cliente (sus bordes con el valor por
 * defecto ya se prueban en `mercadopago-cliente.test.ts`); acá se usa uno chico para no
 * sumar esperas reales: responde antes del límite, o no responde nunca.
 */
describe('timeout de las operaciones de órdenes', () => {
  function mpQueTarda(ms: number) {
    return mpFalso((_p, res) => {
      setTimeout(() => {
        if (!res.writableEnded && !res.destroyed) responder(res, 201, orden('created', 'created'));
      }, ms);
    });
  }

  it('crear: responde dentro del límite → la orden', async () => {
    const url = await mpQueTarda(100);

    expect((await cliente(url, 1_000).crearOrden(PEDIDO)).id).toBe(ORDEN);
  });

  it('crear: no responde dentro del límite → no disponible', async () => {
    const url = await mpQueTarda(5_000);

    await expect(cliente(url, 300).crearOrden(PEDIDO)).rejects.toThrow(MercadoPagoNoDisponible);
  });

  it('consultar: no responde dentro del límite → no disponible', async () => {
    const url = await mpQueTarda(5_000);

    await expect(cliente(url, 300).consultarOrden(ORDEN)).rejects.toThrow(MercadoPagoNoDisponible);
  });

  it('cancelar: no responde dentro del límite → no disponible', async () => {
    const url = await mpQueTarda(5_000);

    await expect(cliente(url, 300).cancelarOrden(ORDEN)).rejects.toThrow(MercadoPagoNoDisponible);
  });
});

describe('consultarOrden: estados de MP traducidos', () => {
  it.each([
    ['created', 'created', 'en_espera'],
    ['at_terminal', 'at_terminal', 'en_espera'],
    ['action_required', 'waiting_payment', 'en_espera'],
    ['at_terminal', 'cancellation_requested', 'cancelando'],
    ['processed', 'accredited', 'aprobado'],
    ['failed', 'insufficient_amount', 'rechazado'],
    ['failed', 'rejected_by_issuer', 'rechazado'],
    ['expired', 'expired', 'vencido'],
    ['canceled', 'canceled', 'cancelado'],
    ['action_required', 'check_on_terminal', 'a_revisar'],
    ['refunded', 'refunded', 'a_revisar'],
  ])('%s/%s → %s', async (status, detalle, estado) => {
    const pedidos: Pedido[] = [];
    const url = await mpFalso((_p, res) => responder(res, 200, orden(status, detalle)), pedidos);

    const leida = await cliente(url).consultarOrden(ORDEN);

    expect(leida).toMatchObject({ id: ORDEN, estado, referenciaExterna: 'venta-120-1' });
    expect(pedidos[0]).toMatchObject({ metodo: 'GET', url: `/v1/orders/${ORDEN}` });
    expect(pedidos[0]!.encabezados.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('un pago fallido trae su status_detail como detalle', async () => {
    const url = await mpFalso((_p, res) =>
      responder(res, 200, orden('failed', 'insufficient_amount')),
    );

    expect((await cliente(url).consultarOrden(ORDEN)).detalle).toBe('insufficient_amount');
  });

  it('un pago aprobado trae el tipo de pago que informó MP', async () => {
    const url = await mpFalso((_p, res) =>
      responder(res, 200, orden('processed', 'accredited', 'credit_card')),
    );

    expect(await cliente(url).consultarOrden(ORDEN)).toMatchObject({
      estado: 'aprobado',
      tipoInformado: 'credit_card',
    });
  });
});

describe('cancelarOrden', () => {
  it.each([
    [200, 'cancelada'],
    [202, 'pedida'],
    [409, 'no_cancelable'],
  ] as const)('MP responde %i → %s', async (status, resultado) => {
    const pedidos: Pedido[] = [];
    const url = await mpFalso(
      (_p, res) =>
        responder(
          res,
          status,
          status === 409
            ? { errors: [{ code: 'cannot_cancel_order', message: 'processed' }] }
            : orden(status === 200 ? 'canceled' : 'at_terminal', 'cancellation_requested'),
        ),
      pedidos,
    );

    expect(await cliente(url).cancelarOrden(ORDEN)).toBe(resultado);
    expect(pedidos[0]).toMatchObject({ metodo: 'POST', url: `/v1/orders/${ORDEN}/cancel` });
    expect(pedidos[0]!.encabezados['x-allow-cancelable-status']).toBe('at_terminal');
  });

  it('MP responde 500 al cancelar: no disponible', async () => {
    const url = await mpFalso((_p, res) => responder(res, 500, {}));

    await expect(cliente(url).cancelarOrden(ORDEN)).rejects.toThrow(MercadoPagoNoDisponible);
  });
});
