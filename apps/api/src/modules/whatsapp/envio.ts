import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { type ClienteWhatsapp, WhatsappNoDisponible, WhatsappRechazo } from './cliente.js';

/** Al quinto envío fallado con WhatsApp conectado, el aviso queda en `error`. */
export const MAX_INTENTOS = 5;
/** Espera antes de cada reintento, según los intentos fallados hasta ahora. */
export const ESPERAS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
/** Pausa entre dos envíos seguidos: muchos mensajes juntos es lo que WhatsApp mira para bloquear. */
export const PAUSA_ENTRE_ENVIOS_MS = 3_000;
export const INTERVALO_MS = 15_000;
/** Tope por pasada; lo que quede sale en la siguiente. */
const AVISOS_POR_PASADA = 50;

export interface OpcionesEnvio {
  prisma: PrismaClient;
  whatsapp: ClienteWhatsapp;
  ahora: () => Date;
  pausaEntreEnviosMs?: number;
  /** Se consulta antes de cada envío: al detener el proceso, la pasada corta ahí. */
  seguir?: () => boolean;
}

const esperar = (ms: number) => new Promise((listo) => setTimeout(listo, ms));

/**
 * Una pasada por los avisos pendientes. Si WhatsApp no está disponible (o falta
 * el número de destino), no toca ningún aviso: esperan sin gastar intentos.
 */
export async function procesarPendientes({
  prisma,
  whatsapp,
  ahora,
  pausaEntreEnviosMs = PAUSA_ENTRE_ENVIOS_MS,
  seguir = () => true,
}: OpcionesEnvio): Promise<void> {
  const destino = await prisma.configuracionWhatsapp.findUnique({ where: { id: 1 } });
  if (!destino || !(await estaConectado(whatsapp))) return;

  const avisos = await prisma.notificacion.findMany({
    where: {
      estado: 'pendiente',
      OR: [{ proximoIntentoEn: null }, { proximoIntentoEn: { lte: ahora() } }],
    },
    orderBy: [{ creadaEn: 'asc' }, { id: 'asc' }],
    take: AVISOS_POR_PASADA,
  });

  for (const [i, aviso] of avisos.entries()) {
    if (i > 0) await esperar(pausaEntreEnviosMs);
    if (!seguir()) return;
    try {
      await whatsapp.enviarTexto(destino.chatId, aviso.texto);
    } catch (error) {
      if (error instanceof WhatsappNoDisponible) return;
      // Un rechazo con la sesión caída tampoco es culpa del aviso.
      if (!(error instanceof WhatsappRechazo) || !(await estaConectado(whatsapp))) return;
      const intentos = aviso.intentos + 1;
      await prisma.notificacion.update({
        where: { id: aviso.id },
        data:
          intentos >= MAX_INTENTOS
            ? { estado: 'error', intentos, error: error.message, proximoIntentoEn: null }
            : {
                intentos,
                error: error.message,
                proximoIntentoEn: new Date(ahora().getTime() + ESPERAS_MS[intentos - 1]!),
              },
      });
      continue;
    }
    await prisma.notificacion.update({
      where: { id: aviso.id },
      data: { estado: 'enviada', enviadaEn: ahora(), error: null, proximoIntentoEn: null },
    });
  }
}

async function estaConectado(whatsapp: ClienteWhatsapp): Promise<boolean> {
  try {
    return (await whatsapp.estado()).estado === 'conectado';
  } catch {
    return false;
  }
}

/**
 * Corre `procesarPendientes` cada `intervaloMs`. Con `setTimeout` encadenado
 * nunca hay dos pasadas a la vez, aunque una tarde más que el intervalo.
 */
export function iniciarEnvio(
  opciones: OpcionesEnvio & { intervaloMs?: number; log?: FastifyBaseLogger },
): { detener: () => Promise<void> } {
  const { intervaloMs = INTERVALO_MS, log, ...envio } = opciones;
  let detenido = false;
  let temporizador: NodeJS.Timeout | undefined;
  let enCurso: Promise<void> = Promise.resolve();

  const ciclo = () => {
    enCurso = procesarPendientes({ ...envio, seguir: () => !detenido })
      .catch((error: unknown) => log?.error({ err: error }, 'Falló el envío de avisos'))
      .finally(() => {
        if (!detenido) temporizador = setTimeout(ciclo, intervaloMs);
      });
  };
  temporizador = setTimeout(ciclo, 0);

  return {
    async detener() {
      detenido = true;
      clearTimeout(temporizador);
      await enCurso;
    },
  };
}
