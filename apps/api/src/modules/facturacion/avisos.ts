import { formatearFechaHora, formatearPesos } from '../../lib/formato.js';

/*
 * Textos de los avisos de facturación para el admin, legibles en WhatsApp.
 * Se crean en la misma transacción que el paso de la factura a `error`.
 */

export interface DatosAvisoFacturaConError {
  ventaNumero: number;
  ventaCreadaEn: Date;
  importe: string;
  /** Qué pasó, ya en palabras (ver `motivoDeError`). */
  motivo: string;
}

/** Una factura quedó en `error`: el admin la revisa en Administración → Facturación. */
export function textoAvisoFacturaConError({
  ventaNumero,
  ventaCreadaEn,
  importe,
  motivo,
}: DatosAvisoFacturaConError): string {
  return [
    '*Factura con error*',
    `Venta #${ventaNumero} del ${formatearFechaHora(ventaCreadaEn)}`,
    `Importe: ${formatearPesos(importe)}`,
    `Motivo: ${motivo}`,
    'Revisala en Administración → Facturación.',
  ].join('\n');
}

/** Motivos legibles de cada `codigoError`: van en la factura (`error`) y en el aviso. */
export const MOTIVOS = {
  tope: (tope: string) =>
    `No se emitió: alcanza el tope de ${formatearPesos(tope)} para facturar sin identificar al cliente.`,
  fueraDePlazo: (dias: number) =>
    `No se emitió: la venta tiene más de ${dias} días y ARCA ya no deja facturarla.`,
  rechazoArca: (intentos: number, mensaje: string) =>
    `ARCA la rechazó ${intentos} veces. Último motivo: ${mensaje}`,
  numeracionAgotada: (puntoVenta: string) =>
    `Se agotó la numeración del punto de venta ${puntoVenta}: hay que dar de alta otro.`,
  numeracionInconsistente: (numero: string) =>
    `ARCA ya tiene el ${numero} con otros datos (¿se facturó a mano en este punto de venta?). ` +
    'No se emite ninguna factura más hasta que la reintentes.',
};

/** ARCA autorizó la factura de una venta que se anuló mientras se emitía. */
export function textoAvisoFacturaDeVentaAnulada({
  ventaNumero,
  numero,
  importe,
}: {
  ventaNumero: number;
  /** Formateado: "00005-00000042". */
  numero: string;
  importe: string;
}): string {
  return [
    '*Factura de una venta anulada*',
    `La venta #${ventaNumero} se anuló mientras se emitía su factura y ARCA la autorizó igual.`,
    `Factura C ${numero} por ${formatearPesos(importe)}: sigue vigente.`,
    'Hay que hacer la nota de crédito por fuera del sistema.',
  ].join('\n');
}
