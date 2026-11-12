import { z } from 'zod';
import { montoSalidaSchema } from './montos.js';
import { medioPagoSchema } from './ventas.js';

/**
 * Por qué no se pudo leer el saldo de Mercado Pago:
 * - `no_responde`: red, timeout de 10 s o error 5xx.
 * - `credenciales`: MP rechazó el token (401 o 403).
 * - `rechazo`: cualquier otro rechazo de MP.
 */
export const MOTIVOS_SALDO_NO_DISPONIBLE = ['no_responde', 'credenciales', 'rechazo'] as const;
export type MotivoSaldoNoDisponible = (typeof MOTIVOS_SALDO_NO_DISPONIBLE)[number];

/** El motivo en palabras, sin el prefijo (se usa también junto a un saldo desactualizado). */
export const NOMBRE_MOTIVO_SALDO: Record<MotivoSaldoNoDisponible, string> = {
  no_responde: 'Mercado Pago no responde',
  credenciales: 'Mercado Pago rechazó las credenciales',
  rechazo: 'Mercado Pago rechazó la consulta',
};

/** "Saldo no disponible: Mercado Pago no responde": el mismo texto en todas las pantallas. */
export function textoSaldoNoDisponible(motivo: MotivoSaldoNoDisponible): string {
  return `Saldo no disponible: ${NOMBRE_MOTIVO_SALDO[motivo]}`;
}

const motivoSchema = z.enum(MOTIVOS_SALDO_NO_DISPONIBLE);

/**
 * Saldo de la cuenta de Mercado Pago del kiosco, tal como lo informa MP (nunca
 * calculado). `desactualizado` es el último saldo bueno cuando MP no respondió o
 * rechazó la consulta; `leidoEn` es la hora de esa lectura.
 */
export const saldoMercadoPagoSchema = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('no_configurado') }),
  z.object({ estado: z.literal('no_disponible'), motivo: motivoSchema }),
  z.object({
    estado: z.literal('disponible'),
    disponible: montoSalidaSchema,
    aLiberar: montoSalidaSchema.nullable(),
    leidoEn: z.iso.datetime(),
    desactualizado: z.boolean(),
    motivo: motivoSchema.optional(),
  }),
]);
export type SaldoMercadoPago = z.infer<typeof saldoMercadoPagoSchema>;

// --- Cobro con el Point (cambio cobro-mercado-pago) ---

/** `status_detail` de un pago fallido → texto corto para el mostrador. */
const MOTIVOS_RECHAZO: Record<string, string> = {
  rejected_by_issuer: 'Tarjeta rechazada por el banco',
  insufficient_amount: 'Fondos insuficientes',
  card_disabled: 'Tarjeta bloqueada',
  bad_filled_card_data: 'Datos de la tarjeta incorrectos',
  high_risk: 'Mercado Pago lo rechazó por seguridad',
};

/** Motivo de un pago rechazado según el `status_detail` de Mercado Pago. */
export function motivoRechazoCobro(statusDetail: string | null): string {
  if (statusDetail === null || !Object.hasOwn(MOTIVOS_RECHAZO, statusDetail)) {
    return 'Pago rechazado';
  }
  return MOTIVOS_RECHAZO[statusDetail]!;
}

/** Motivos de un cobro que Mercado Pago no quiso crear (por el código propio del rechazo). */
export const MOTIVO_COBRO_NO_CREADO = {
  terminal_ocupada: 'El Point tiene otro cobro abierto: cancelalo en el Point y reintentá',
  monto_invalido: 'Mercado Pago no acepta ese monto',
} as const;

/** El texto que se muestra mientras Mercado Pago no responde (y solo se cobra en efectivo). */
export const TEXTO_MP_NO_RESPONDE =
  'Mercado Pago no responde. Por ahora cobrá solo en efectivo (F1) o reintentá en un rato.';

/** Cobros que el admin tiene que mirar en Administración → Mercado Pago. */
export const ESTADOS_COBRO_A_REVISAR = ['a_revisar', 'a_devolver', 'sin_devolver'] as const;
export type EstadoCobroARevisar = (typeof ESTADOS_COBRO_A_REVISAR)[number];

/** Por qué el cobro está en la lista (también va en el aviso al admin). */
export const MOTIVO_COBRO_A_REVISAR: Record<EstadoCobroARevisar, string> = {
  a_revisar: 'el Point pidió revisar el pago',
  a_devolver: 'se aprobó después de cancelar la venta',
  sin_devolver: 'el cliente se fue sin la devolución en efectivo',
};

export const cobroARevisarSchema = z.object({
  id: z.uuid(),
  ventaId: z.uuid(),
  ventaNumero: z.number().int(),
  estado: z.enum(ESTADOS_COBRO_A_REVISAR),
  monto: montoSalidaSchema,
  medio: medioPagoSchema,
  creadoEn: z.iso.datetime(),
  motivo: z.string(),
});
export type CobroARevisar = z.infer<typeof cobroARevisarSchema>;

/** Nota obligatoria al marcar revisado un cobro (`a_revisar` o `sin_devolver`). */
export const revisionCobroSchema = z.object({
  nota: z.string().trim().min(3, 'Escribí una nota (al menos 3 letras).').max(200),
});
export type RevisionCobro = z.input<typeof revisionCobroSchema>;
