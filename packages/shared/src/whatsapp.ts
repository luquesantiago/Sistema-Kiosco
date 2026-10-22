import { z } from 'zod';

/**
 * Estado de la conexión con WhatsApp, ya traducido desde WAHA:
 * - `no_configurado`: la API no tiene `WAHA_URL` (desarrollo o instalación incompleta).
 * - `no_disponible`: WAHA no responde.
 */
export const ESTADOS_WHATSAPP = [
  'no_configurado',
  'desvinculado',
  'esperando_qr',
  'conectado',
  'no_disponible',
] as const;
export type EstadoWhatsapp = (typeof ESTADOS_WHATSAPP)[number];

const numeroSchema = z.object({ numero: z.string() });

export const estadoWhatsappSchema = z.object({
  estado: z.enum(ESTADOS_WHATSAPP),
  /** Número del chip vinculado, solo si está `conectado`. */
  cuenta: numeroSchema.nullable(),
  /** Número que recibe los avisos, si ya se cargó. */
  destino: numeroSchema.nullable(),
  /** Avisos que esperan envío. */
  pendientes: z.number().int(),
});
export type EstadoWhatsappRespuesta = z.infer<typeof estadoWhatsappSchema>;

/** El número se normaliza en el servidor, para responder con un código de error preciso. */
export const destinoWhatsappEntradaSchema = z.object({
  numero: z.string().trim().min(1, 'Escribí el número.').max(30),
});
export type DestinoWhatsappEntrada = z.input<typeof destinoWhatsappEntradaSchema>;

export const qrWhatsappSchema = z.object({
  /** Imagen lista para un `<img src>` (`data:image/png;base64,...`). */
  imagen: z.string(),
});
export type QrWhatsapp = z.infer<typeof qrWhatsappSchema>;

export type NumeroNormalizado =
  { ok: true; numero: string } | { ok: false; motivo: 'con_15' | 'invalido' };

/**
 * Lleva un celular argentino a 10 dígitos (código de área sin 0 y número sin
 * 15). Acepta `+54`, el `9` de los celulares y el `0` del área, con espacios o
 * guiones. El 15 no se quita solo: según el largo del código de área (2 a 4
 * dígitos) cae en otra posición, así que se le pide a quien carga el número.
 */
export function normalizarNumeroArgentino(texto: string): NumeroNormalizado {
  let digitos = texto.replace(/\D/g, '');
  if (digitos.startsWith('54')) digitos = digitos.slice(2);
  if (digitos.startsWith('9')) digitos = digitos.slice(1);
  if (digitos.startsWith('0')) digitos = digitos.slice(1);
  if (digitos.length === 10) return { ok: true, numero: digitos };
  if (digitos.length === 12 && digitos.includes('15')) return { ok: false, motivo: 'con_15' };
  return { ok: false, motivo: 'invalido' };
}

/** Número de WhatsApp internacional (sin `+`) para un número de 10 dígitos. */
export function numeroInternacional(numero: string): string {
  return `549${numero}`;
}

/**
 * Número para mostrar. El código de área solo se separa para el 11 (AMBA): el
 * resto tiene 3 o 4 dígitos y no se puede saber sin una tabla de áreas.
 */
export function formatearNumero(numero: string): string {
  if (numero.length !== 10) return numero;
  const resto = numero.startsWith('11') ? numero.slice(2) : numero;
  const conGuion = `${resto.slice(0, -4)}-${resto.slice(-4)}`;
  return numero.startsWith('11') ? `11 ${conGuion}` : conGuion;
}
