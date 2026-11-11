import { z } from 'zod';
import { montoSalidaSchema } from './montos.js';

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
