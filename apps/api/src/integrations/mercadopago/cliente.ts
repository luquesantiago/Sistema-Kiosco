import { MercadoPagoNoDisponible, MercadoPagoRechazo } from './errores.js';
import { crearOperacionesDeOrdenes, type PedirOrden } from './ordenes.js';
import { crearLecturaDeSaldo } from './saldo-cuenta.js';

export { MercadoPagoNoDisponible, MercadoPagoRechazo };
export type {
  EstadoOrden,
  MedioPoint,
  OrdenPoint,
  PedidoOrden,
  ResultadoCancelacion,
} from './ordenes.js';
import type { OrdenPoint, PedidoOrden, ResultadoCancelacion } from './ordenes.js';

/** Saldo tal como lo informa Mercado Pago, con 2 decimales. */
export interface SaldoLeido {
  disponible: string;
  /** `null` si Mercado Pago no informa lo que está a liberar. */
  aLiberar: string | null;
}

/** Lo que el sistema usa de Mercado Pago. Los tests inyectan un cliente falso. */
export interface ClienteMercadoPago {
  saldo(): Promise<SaldoLeido>;
  /** `POST /v1/orders` (tipo `point`): manda el cobro a la terminal. */
  crearOrden(pedido: PedidoOrden): Promise<OrdenPoint>;
  /** `GET /v1/orders/{id}`: el estado real del cobro. */
  consultarOrden(ordenId: string): Promise<OrdenPoint>;
  /** `POST /v1/orders/{id}/cancel`, también con la orden en la pantalla del Point. */
  cancelarOrden(ordenId: string): Promise<ResultadoCancelacion>;
}

/** GET autenticado a la API de Mercado Pago que devuelve el JSON de la respuesta. */
export type PedirMercadoPago = (ruta: string, signal: AbortSignal) => Promise<unknown>;

const URL_MP = 'https://api.mercadopago.com';
const TIMEOUT_MS = 10_000;

/** Descarta el cuerpo sin leerlo, para liberar la conexión. */
async function descartar(res: Response) {
  try {
    await res.body?.cancel();
  } catch {
    // Nada que hacer: la conexión se cierra igual.
  }
}

/**
 * Cliente HTTP de Mercado Pago, sin el SDK oficial (suma peso y oculta los
 * errores que hay que distinguir). El token solo viaja en el encabezado.
 */
export function clienteMercadoPago(
  accessToken: string,
  { baseUrl = URL_MP, timeoutMs = TIMEOUT_MS }: { baseUrl?: string; timeoutMs?: number } = {},
): ClienteMercadoPago {
  const base = baseUrl.replace(/\/$/, '');

  const pedir: PedirMercadoPago = async (ruta, signal) => {
    let res: Response;
    try {
      res = await fetch(`${base}${ruta}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal,
      });
    } catch {
      throw new MercadoPagoNoDisponible('Mercado Pago no responde.');
    }
    if (res.status >= 500) {
      await descartar(res);
      throw new MercadoPagoNoDisponible('Mercado Pago no responde.');
    }
    if (!res.ok) {
      await descartar(res);
      throw new MercadoPagoRechazo(res.status);
    }
    try {
      return await res.json();
    } catch {
      // Se cortó mientras llegaba el cuerpo (timeout) o llegó algo que no es JSON.
      if (signal.aborted) throw new MercadoPagoNoDisponible('Mercado Pago no responde.');
      throw new MercadoPagoRechazo(res.status, 'respuesta_invalida');
    }
  };

  const leerSaldo = crearLecturaDeSaldo(pedir);

  /** Pedido de órdenes: devuelve el estado HTTP y el JSON (o null), sin tirar por un 4xx. */
  const pedirOrden: PedirOrden = async (metodo, ruta, { cuerpo, encabezados = {} } = {}) => {
    const signal = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...encabezados,
        },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal,
      });
    } catch {
      throw new MercadoPagoNoDisponible('Mercado Pago no responde.');
    }
    if (res.status >= 500) {
      await descartar(res);
      throw new MercadoPagoNoDisponible('Mercado Pago no responde.');
    }
    let texto: string;
    try {
      texto = await res.text();
    } catch {
      throw new MercadoPagoNoDisponible('Mercado Pago no responde.');
    }
    let datos: unknown = null;
    if (texto) {
      try {
        datos = JSON.parse(texto);
      } catch {
        if (res.ok) throw new MercadoPagoRechazo(res.status, 'respuesta_invalida');
      }
    }
    return { status: res.status, datos };
  };

  return {
    // El límite de tiempo es para toda la lectura, aunque haga más de un pedido.
    saldo: () => leerSaldo(AbortSignal.timeout(timeoutMs)),
    ...crearOperacionesDeOrdenes(pedirOrden),
  };
}
