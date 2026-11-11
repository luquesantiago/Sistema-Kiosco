import {
  type ClienteMercadoPago,
  MercadoPagoNoDisponible,
  MercadoPagoRechazo,
  type SaldoLeido,
} from '../src/integrations/mercadopago/cliente.js';

/**
 * Cliente de Mercado Pago en memoria. Por defecto responde enseguida con
 * $250.000,00 disponibles y $40.000,00 a liberar; cada test cambia lo que necesita.
 * `cobro-mercado-pago` le suma las órdenes.
 */
export function crearMercadoPagoFalso() {
  const falso = {
    saldo: { disponible: '250000.00', aLiberar: '40000.00' } as SaldoLeido,
    /** Cuánto tarda en contestar (con timers falsos de Vitest se adelanta a mano). */
    demoraMs: 0,
    /**
     * Falla de las próximas consultas, después de la demora:
     * `'no_responde'` (red, timeout o 5xx) o un número de estado HTTP 4xx (rechazo).
     */
    falla: null as null | 'no_responde' | number,
    /** No contesta nunca (la promesa queda pendiente). */
    colgado: false,
    /** Cuántas veces se le pidió el saldo. */
    llamadas: 0,
  };

  const cliente: ClienteMercadoPago = {
    async saldo() {
      falso.llamadas += 1;
      if (falso.colgado) return new Promise<SaldoLeido>(() => {});
      if (falso.demoraMs > 0) {
        await new Promise((listo) => setTimeout(listo, falso.demoraMs));
      }
      if (falso.falla === 'no_responde') {
        throw new MercadoPagoNoDisponible('Mercado Pago no responde.');
      }
      if (typeof falso.falla === 'number') {
        // El código imita el detalle interno que manda MP: nunca tiene que llegar a la web.
        throw new MercadoPagoRechazo(falso.falla, 'detalle-interno-de-mp');
      }
      return { ...falso.saldo };
    },
  };

  return { falso, cliente };
}
