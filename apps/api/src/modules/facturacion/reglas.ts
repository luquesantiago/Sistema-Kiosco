/*
 * Datos normativos de la Factura C. Son el único lugar de estos valores: si
 * cambia la norma, se cambian acá (y sus tests de borde los leen de acá).
 * Todos son a verificar con el manual de WSFEv1 vigente o con el contador.
 */

/**
 * Tope para facturar a consumidor final sin identificarlo (RG 5700/2025). Se
 * evalúa por factura: una de este importe o más no se emite.
 */
export const TOPE_CONSUMIDOR_FINAL = '10000000.00';

/**
 * Días hacia atrás que ARCA acepta para la fecha de una factura de concepto
 * productos (RG 4291/2018, art. sobre la fecha de emisión de comprobantes).
 */
export const DIAS_ATRAS_MAXIMO = 5;

/** Factura C (tabla de tipos de comprobante de WSFEv1). */
export const TIPO_FACTURA_C = 11;
/** Concepto 1: productos. */
export const CONCEPTO_PRODUCTOS = 1;
/** Documento 99 número 0: consumidor final sin identificar (RG 4291/2018). */
export const DOC_TIPO_SIN_IDENTIFICAR = 99;
/** Condición frente al IVA del receptor: 5 = consumidor final (RG 5616/2024). */
export const CONDICION_IVA_CONSUMIDOR_FINAL = 5;
/** Número más alto de un comprobante: 8 dígitos. */
export const NUMERO_MAXIMO = 99_999_999;

export { URL_QR } from '@kiosco/shared';
