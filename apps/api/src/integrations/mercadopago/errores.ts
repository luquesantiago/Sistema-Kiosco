/** Mercado Pago no respondió (red, timeout o error 5xx). No es culpa del pedido. */
export class MercadoPagoNoDisponible extends Error {}

/**
 * Mercado Pago respondió que no (4xx, o una respuesta que no se entiende). Con
 * 401 y 403 son las credenciales. El mensaje nunca lleva el token ni el cuerpo
 * de la respuesta, que puede traer detalles internos.
 */
export class MercadoPagoRechazo extends Error {
  constructor(
    readonly status: number,
    /** Código propio corto (no viene de la respuesta de MP). */
    readonly codigo?: string,
  ) {
    super(`Mercado Pago rechazó el pedido (HTTP ${status}).`);
  }
}
