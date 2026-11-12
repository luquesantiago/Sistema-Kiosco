import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ejecutarMpTerminales } from '../src/cli/mp-terminales.js';

/*
 * Script `pnpm --filter api mp:terminales` (tarea 3.7 de cobro-mercado-pago), contra una
 * API de Mercado Pago de mentira en un puerto local: lista las terminales, pasa una a
 * modo PDV y nunca muestra el token.
 */

const TOKEN = 'APP_USR-token-secreto-de-prueba';
const TERMINAL = 'NEWLAND_N950__N950NCB801293324';

interface Pedido {
  metodo: string;
  url: string;
  autorizacion: string | undefined;
  cuerpo: unknown;
}

let servidor: Server | undefined;

async function mpFalso(
  manejador: (pedido: Pedido, res: ServerResponse) => void,
  pedidos: Pedido[] = [],
): Promise<string> {
  servidor = createServer((req: IncomingMessage, res) => {
    let texto = '';
    req.on('data', (parte: Buffer) => (texto += parte.toString()));
    req.on('end', () => {
      const pedido = {
        metodo: req.method ?? '',
        url: req.url ?? '',
        autorizacion: req.headers.authorization,
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

async function ejecutar(args: string[], baseUrl: string, { sinToken = false } = {}) {
  const salida: string[] = [];
  const codigo = await ejecutarMpTerminales(args, {
    token: sinToken ? undefined : TOKEN,
    baseUrl,
    escribir: (linea) => salida.push(linea),
  });
  return { codigo, salida: salida.join('\n') };
}

afterEach(async () => {
  servidor?.closeAllConnections();
  await new Promise((listo) => (servidor ? servidor.close(listo) : listo(undefined)));
  servidor = undefined;
});

describe('mp:terminales', () => {
  it('lista las terminales de la cuenta con su modo, sin mostrar el token', async () => {
    const pedidos: Pedido[] = [];
    const url = await mpFalso(
      (_p, res) =>
        responder(res, 200, {
          data: { terminals: [{ id: TERMINAL, pos_id: 1, operating_mode: 'STANDALONE' }] },
          paging: { total: 1, offset: 0, limit: 50 },
        }),
      pedidos,
    );

    const { codigo, salida } = await ejecutar([], url);

    expect(codigo).toBe(0);
    expect(pedidos).toMatchObject([{ metodo: 'GET', url: '/terminals/v1/list' }]);
    expect(pedidos[0]!.autorizacion).toBe(`Bearer ${TOKEN}`);
    expect(salida).toContain(`${TERMINAL} (modo STANDALONE)`);
    expect(salida).not.toContain(TOKEN);
  });

  it('--pdv <id> pasa esa terminal a modo integrado y dice qué cargar en MP_TERMINAL_ID', async () => {
    const pedidos: Pedido[] = [];
    const url = await mpFalso(
      (_p, res) => responder(res, 200, { terminals: [{ id: TERMINAL, operating_mode: 'PDV' }] }),
      pedidos,
    );

    const { codigo, salida } = await ejecutar(['--pdv', TERMINAL], url);

    expect(codigo).toBe(0);
    expect(pedidos).toMatchObject([
      {
        metodo: 'PATCH',
        url: '/terminals/v1/setup',
        cuerpo: { terminals: [{ id: TERMINAL, operating_mode: 'PDV' }] },
      },
    ]);
    expect(salida).toContain(`MP_TERMINAL_ID=${TERMINAL}`);
    expect(salida).not.toContain(TOKEN);
  });

  it('credenciales rechazadas: lo dice sin mostrar el token y sale con error', async () => {
    const url = await mpFalso((_p, res) => responder(res, 401, { message: 'invalid token' }));

    const { codigo, salida } = await ejecutar([], url);

    expect(codigo).toBe(1);
    expect(salida).toContain('MP_ACCESS_TOKEN');
    expect(salida).not.toContain(TOKEN);
  });

  it('sin MP_ACCESS_TOKEN no llama a Mercado Pago', async () => {
    const pedidos: Pedido[] = [];
    const url = await mpFalso((_p, res) => responder(res, 200, {}), pedidos);

    const { codigo, salida } = await ejecutar([], url, { sinToken: true });

    expect(codigo).toBe(1);
    expect(salida).toContain('Falta MP_ACCESS_TOKEN');
    expect(pedidos).toHaveLength(0);
  });
});
