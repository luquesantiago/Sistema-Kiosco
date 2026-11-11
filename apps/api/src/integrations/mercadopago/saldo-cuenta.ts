import { formatear } from '@kiosco/shared';
import type { PedirMercadoPago, SaldoLeido } from './cliente.js';
import { MercadoPagoRechazo } from './errores.js';

/*
 * ÚNICO lugar donde se lee el saldo de la API de Mercado Pago (opción A del design
 * de saldo-mercado-pago):
 *
 *   GET /users/me                                        → { id }
 *   GET /users/{id}/mercadopago_account/balance          → { available_balance,
 *                                                           unavailable_balance?, total_amount }
 *
 * OJO: este recurso NO figura en la documentación oficial vigente de Mercado Pago.
 * Es un recurso histórico que todavía usan clientes de la comunidad, y hay que
 * probarlo con credenciales reales (tarea 6.1). Si responde 403/404 o no trae el
 * saldo, se pasa al plan B (ver design.md) cambiando solo este archivo:
 *   - B-manual: en vez de llamar a MP, `crearLecturaDeSaldo` devuelve el saldo de
 *     referencia que carga el admin más los movimientos de MP desde esa hora
 *     (necesita su propio cambio, con tabla y pantalla).
 *   - B-reporte: pedir el reporte "Dinero liberado" (`/v1/account/release_report`)
 *     y tomar `initial_available_balance` más los movimientos.
 * La interfaz `ClienteMercadoPago.saldo()`, la caché, la ruta y las pantallas no cambian.
 */

interface Usuario {
  id: number | string;
}

interface Balance {
  available_balance?: unknown;
  unavailable_balance?: unknown;
}

/** Número JSON de MP → "250000.00", pasando por Decimal desde el texto (sin `toFixed`). */
function monto(valor: unknown): string | null {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null;
  return formatear(String(valor));
}

/**
 * Devuelve la lectura del saldo para un cliente. El `id` del usuario de
 * `/users/me` se pide la primera vez y queda en memoria.
 */
export function crearLecturaDeSaldo(pedir: PedirMercadoPago) {
  let usuarioId: string | null = null;

  return async (signal: AbortSignal): Promise<SaldoLeido> => {
    if (usuarioId === null) {
      const usuario = (await pedir('/users/me', signal)) as Usuario | null;
      if (usuario?.id === undefined || usuario.id === null) {
        throw new MercadoPagoRechazo(200, 'sin_usuario');
      }
      usuarioId = String(usuario.id);
    }

    const balance = (await pedir(
      `/users/${encodeURIComponent(usuarioId)}/mercadopago_account/balance`,
      signal,
    )) as Balance | null;
    const disponible = monto(balance?.available_balance);
    if (disponible === null) throw new MercadoPagoRechazo(200, 'sin_saldo');
    return { disponible, aLiberar: monto(balance?.unavailable_balance) };
  };
}
