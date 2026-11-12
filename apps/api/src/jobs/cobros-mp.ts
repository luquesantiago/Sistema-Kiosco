import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { ClienteMercadoPago } from '../integrations/mercadopago/cliente.js';
import type { Facturacion } from '../modules/facturacion/tipos.js';
import {
  actualizarCobro,
  INTERVALO_CONSULTA_MS,
  vencerVenta,
  type ContextoCobro,
} from '../modules/ventas/cobro.js';
import { iniciarCiclo } from './ciclo.js';

/**
 * Cada cuánto corre la pasada. El límite de 3 s por cobro lo pone `consultadoEn`, así
 * el vencimiento se aplica con precisión de 1 s.
 */
export const INTERVALO_MS = 1_000;

export interface OpcionesCobrosMp {
  prisma: PrismaClient;
  mercadoPago: ClienteMercadoPago;
  ahora: () => Date;
  facturacion?: Facturacion;
  /** Para anotar las fallas de un cobro sin cortar la pasada (sin log, la falla se propaga). */
  log?: Pick<FastifyBaseLogger, 'error'>;
}

/**
 * Una pasada de la consulta de respaldo y del vencimiento (design "Consulta de respaldo"):
 * 1. Consulta en MP los cobros esperando o cancelándose cuya última consulta fue hace
 *    3 s o más (o nunca), de a uno, y aplica su estado.
 * 2. Vence las ventas en espera con `venceEn` cumplido.
 * Sin cobros activos es una consulta por índice, sin llamadas a MP.
 */
export async function revisarCobros({
  prisma,
  mercadoPago,
  ahora,
  facturacion,
  log,
}: OpcionesCobrosMp): Promise<void> {
  const ctx: ContextoCobro = { prisma, mercadoPago, facturacion, ahora };
  const inicio = ahora();
  const limite = new Date(inicio.getTime() - INTERVALO_CONSULTA_MS);

  const cobros = await prisma.cobroMp.findMany({
    where: {
      estado: { in: ['en_espera', 'cancelando'] },
      ordenId: { not: null },
      OR: [{ consultadoEn: null }, { consultadoEn: { lte: limite } }],
    },
    orderBy: { creadoEn: 'asc' },
  });
  for (const cobro of cobros) {
    try {
      await actualizarCobro(ctx, cobro);
    } catch (error) {
      // Por ejemplo, la facturación falló al confirmar: se reintenta en la próxima consulta.
      if (!log) throw error;
      log.error({ err: error }, `No se pudo actualizar el cobro ${cobro.id}`);
    }
  }

  const vencidas = await prisma.venta.findMany({
    where: { estado: 'pendiente', venceEn: { lte: ahora() } },
    select: { id: true },
    orderBy: { numero: 'asc' },
  });
  for (const venta of vencidas) {
    try {
      await vencerVenta(ctx, venta.id);
    } catch (error) {
      if (!log) throw error;
      log.error({ err: error }, `No se pudo vencer la venta ${venta.id}`);
    }
  }
}

/** Arranca la consulta de respaldo cada 1 s. Solo la llama `server.ts`, con el Point configurado. */
export function iniciarCobrosMp(
  opciones: Omit<OpcionesCobrosMp, 'log'> & { log: FastifyBaseLogger },
): { detener: () => Promise<void>; despertar: () => void } {
  return iniciarCiclo({
    nombre: 'cobros de Mercado Pago',
    pasada: () => revisarCobros(opciones),
    intervaloMs: INTERVALO_MS,
    log: opciones.log,
  });
}
