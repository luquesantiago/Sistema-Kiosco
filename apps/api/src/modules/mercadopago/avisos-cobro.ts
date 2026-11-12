import { MOTIVO_COBRO_A_REVISAR, NOMBRE_MEDIO, type MedioPago } from '@kiosco/shared';
import { formatearHora, formatearPesos } from '../../lib/formato.js';

/** Qué tiene que hacer el admin con cada caso. */
const TITULO_Y_QUE_HACER = {
  a_devolver: ['*Cobro de Mercado Pago a devolver*', 'Se devuelve en efectivo desde la caja.'],
  a_revisar: ['*Cobro de Mercado Pago a revisar*', 'Revisalo en Administración → Mercado Pago.'],
  sin_devolver: [
    '*Cobro de Mercado Pago sin devolver*',
    'Resolvelo en Administración → Mercado Pago.',
  ],
} as const;

const nombreMedio = (medio: MedioPago) =>
  medio === 'mercado_pago' ? NOMBRE_MEDIO[medio] : NOMBRE_MEDIO[medio].toLowerCase();

/**
 * Aviso al admin de un cobro del Point que hay que mirar: entró el pago de una venta
 * cancelada, la terminal pidió revisar el pago o el cliente se fue sin la devolución.
 */
export function textoAvisoCobroARevisar({
  caso,
  monto,
  medio,
  ventaNumero,
  en,
}: {
  caso: keyof typeof TITULO_Y_QUE_HACER;
  monto: string;
  medio: MedioPago;
  ventaNumero: number;
  en: Date;
}): string {
  const [titulo, queHacer] = TITULO_Y_QUE_HACER[caso];
  return [
    titulo,
    `${formatearPesos(monto)} con ${nombreMedio(medio)}, de la venta #${ventaNumero}`,
    `Hora: ${formatearHora(en)}`,
    `Motivo: ${MOTIVO_COBRO_A_REVISAR[caso]}`,
    queHacer,
  ].join('\n');
}

/** Aviso al admin de la devolución en efectivo de un cobro de una venta cancelada. */
export function textoAvisoDevolucionCobro({
  monto,
  ventaNumero,
  devolvio,
  en,
}: {
  monto: string;
  ventaNumero: number;
  devolvio: string;
  en: Date;
}): string {
  return [
    '*Devolución en efectivo de un cobro de Mercado Pago*',
    `${formatearPesos(monto)} de la venta #${ventaNumero}`,
    `Devolvió: ${devolvio}`,
    `Hora: ${formatearHora(en)}`,
  ].join('\n');
}
