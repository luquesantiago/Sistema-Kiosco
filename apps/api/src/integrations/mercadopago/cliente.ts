import { MercadoPagoNoDisponible, MercadoPagoRechazo } from './errores.js';
import { crearLecturaDeSaldo } from './saldo-cuenta.js';

export { MercadoPagoNoDisponible, MercadoPagoRechazo };

/** Saldo tal como lo informa Mercado Pago, con 2 decimales. */
export interface SaldoLeido {
  disponible: string;
  /** `null` si Mercado Pago no informa lo que está a liberar. */
  aLiberar: string | null;
}

/**
 * Lo que el sistema usa de Mercado Pago. Los tests inyectan un cliente falso.
 * `cobro-mercado-pago` le suma las operaciones de órdenes.
 */
export interface ClienteMercadoPago {
  saldo(): Promise<SaldoLeido>;
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

  return {
    // El límite de tiempo es para toda la lectura, aunque haga más de un pedido.
    saldo: () => leerSaldo(AbortSignal.timeout(timeoutMs)),
  };
}
