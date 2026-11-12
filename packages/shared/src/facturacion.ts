import { z } from 'zod';
import { montoSalidaSchema } from './montos.js';

/*
 * Factura C electrónica de ARCA (cambio facturacion-arca). Lo que comparten la
 * API y la web: los esquemas de la factura y del estado de la facturación, el
 * QR y el formato del número impreso.
 */

export const ESTADOS_FACTURA = [
  'pendiente',
  'en_curso',
  'autorizada',
  'error',
  'cancelada',
] as const;
export type EstadoFactura = (typeof ESTADOS_FACTURA)[number];

/** `electronica`: débito, crédito y MP (se factura sola); `efectivo`: a pedido del cliente. */
export const PARTES_FACTURA = ['electronica', 'efectivo'] as const;
export type ParteFactura = (typeof PARTES_FACTURA)[number];

export const ENTORNOS_ARCA = ['homologacion', 'produccion'] as const;
export type EntornoArca = (typeof ENTORNOS_ARCA)[number];

/** Factura en el detalle de una venta. `numero` va formateado ("00005-00000042"). */
export const facturaVentaSchema = z.object({
  id: z.uuid(),
  parte: z.enum(PARTES_FACTURA),
  estado: z.enum(ESTADOS_FACTURA),
  numero: z.string().nullable(),
  /** Fecha del comprobante "AAAA-MM-DD", fijada al mandarla a ARCA. */
  fecha: z.iso.date().nullable(),
  importe: montoSalidaSchema,
  cae: z.string().nullable(),
  caeVencimiento: z.iso.date().nullable(),
  /** Solo en las autorizadas. */
  qrUrl: z.string().nullable(),
});
export type FacturaVenta = z.infer<typeof facturaVentaSchema>;

/** Datos del emisor para el ticket; salen de las variables `ARCA_*` de la API. */
export const emisorSchema = z.object({
  nombreFantasia: z.string(),
  razonSocial: z.string(),
  cuit: z.string(),
  domicilio: z.string(),
  iibb: z.string(),
  inicioActividades: z.iso.date(),
  entorno: z.enum(ENTORNOS_ARCA),
});
export type Emisor = z.infer<typeof emisorSchema>;

export const ESTADOS_FACTURACION = [
  'no_configurado',
  'disponible',
  'no_disponible',
  'autenticacion_bloqueada',
] as const;
export type EstadoConexionArca = (typeof ESTADOS_FACTURACION)[number];

/** Factura trabada (pendiente, en curso o con error) para la pantalla del admin. */
export const facturaListadoSchema = z.object({
  id: z.uuid(),
  ventaId: z.uuid(),
  ventaNumero: z.number().int(),
  parte: z.enum(PARTES_FACTURA),
  importe: montoSalidaSchema,
  estado: z.enum(ESTADOS_FACTURA),
  intentos: z.number().int(),
  codigoError: z.string().nullable(),
  error: z.string().nullable(),
  creadaEn: z.iso.datetime(),
});
export type FacturaListado = z.infer<typeof facturaListadoSchema>;

/** `GET /api/facturacion`. Sin configuración solo viene `estado: 'no_configurado'`. */
export const estadoFacturacionSchema = z.object({
  estado: z.enum(ESTADOS_FACTURACION),
  entorno: z.enum(ENTORNOS_ARCA).optional(),
  puntoVenta: z.number().int().optional(),
  /** Último número autorizado del punto de venta según la base (0 si no hay). */
  ultimoNumero: z.number().int().optional(),
  pendientes: z.number().int().optional(),
  enError: z.number().int().optional(),
  facturas: z.array(facturaListadoSchema).optional(),
});
export type EstadoFacturacion = z.infer<typeof estadoFacturacionSchema>;

/** Códigos de error que no se reintentan: reintentarlos daría el mismo resultado. */
export const ERRORES_FACTURA_NO_REINTENTABLES = ['tope', 'fuera_de_plazo'] as const;

/** "00005-00000042": punto de venta con 5 dígitos y número con 8. */
export function formatearNumeroComprobante(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(5, '0')}-${String(numero).padStart(8, '0')}`;
}

/** Dirección de ARCA para el QR de los comprobantes (RG 4892/2020, normativo, verificar). */
export const URL_QR = 'https://www.afip.gob.ar/fe/qr/';

export interface DatosQrFactura {
  /** "AAAA-MM-DD". */
  fecha: string;
  cuit: string;
  ptoVta: number;
  tipoCmp: number;
  nroCmp: number;
  /** Con 2 decimales, como lo devuelve la API ("3300.50"). */
  importe: string;
  /** CAE de 14 dígitos. */
  cae: string;
}

const LETRAS_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 estándar (con `+`, `/` y `=`) de un texto ASCII; sirve igual en el navegador y en Node. */
function base64(texto: string): string {
  let salida = '';
  for (let i = 0; i < texto.length; i += 3) {
    const a = texto.charCodeAt(i);
    const b = i + 1 < texto.length ? texto.charCodeAt(i + 1) : NaN;
    const c = i + 2 < texto.length ? texto.charCodeAt(i + 2) : NaN;
    const bloque = (a << 16) | ((b || 0) << 8) | (c || 0);
    salida += LETRAS_BASE64[(bloque >> 18) & 63]! + LETRAS_BASE64[(bloque >> 12) & 63]!;
    salida += Number.isNaN(b) ? '=' : LETRAS_BASE64[(bloque >> 6) & 63]!;
    salida += Number.isNaN(c) ? '=' : LETRAS_BASE64[bloque & 63]!;
  }
  return salida;
}

/**
 * URL del QR de una factura autorizada (RG 4892/2020, normativo, verificar):
 * `URL_QR` + "?p=" + la base64 estándar del JSON, con las claves en el orden de
 * la norma. Consumidor final sin identificar: documento 99 y número 0.
 * El CUIT y el CAE se escriben como números sin pasar por `number` (el CAE
 * tiene 14 dígitos); el importe sí, para que "3300.50" quede 3300.5.
 */
export function urlQrFactura({
  fecha,
  cuit,
  ptoVta,
  tipoCmp,
  nroCmp,
  importe,
  cae,
}: DatosQrFactura): string {
  if (!/^\d+$/.test(cuit) || !/^\d+$/.test(cae)) {
    throw new Error('El CUIT y el CAE del QR tienen que ser solo dígitos.');
  }
  const json =
    `{"ver":1,"fecha":${JSON.stringify(fecha)},"cuit":${cuit},"ptoVta":${ptoVta},` +
    `"tipoCmp":${tipoCmp},"nroCmp":${nroCmp},"importe":${Number(importe)},"moneda":"PES",` +
    `"ctz":1,"tipoDocRec":99,"nroDocRec":0,"tipoCodAut":"E","codAut":${cae}}`;
  return `${URL_QR}?p=${base64(json)}`;
}
