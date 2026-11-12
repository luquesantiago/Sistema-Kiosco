import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import { fechaEnArgentina, rangoDelDiaEnArgentina } from '../lib/fechas.js';
import { textoAvisoReposicion } from '../modules/reposicion/aviso.js';
import { calcularReposicion } from '../modules/reposicion/servicio.js';
import { iniciarCiclo } from './ciclo.js';

/** El aviso del día se genera desde las 12:00 de Argentina... */
export const HORA_AVISO = 12;
/** ...y, si el sistema estaba apagado, hasta las 18:59:59. */
export const HORA_LIMITE_RECUPERACION = 19;
export const INTERVALO_MS = 60_000;
const TAREA = 'aviso_reposicion';
const HORA_MS = 60 * 60 * 1000;

export interface OpcionesAvisoReposicion {
  prisma: PrismaClient;
  ahora: () => Date;
}

/**
 * Una pasada de la tarea diaria: si está en horario y todavía no hay aviso de
 * hoy, lo genera. La fila de `ejecuciones_tarea` (única por tarea y día) es la
 * que garantiza un solo aviso por día, aunque dos pasadas coincidan.
 */
export async function generarAvisoDelDia({
  prisma,
  ahora,
}: OpcionesAvisoReposicion): Promise<'fuera_de_horario' | 'ya_generado' | 'generado'> {
  const instante = ahora();
  const fecha = fechaEnArgentina(instante);
  const { desde } = rangoDelDiaEnArgentina(fecha);
  const t = instante.getTime();
  if (t < desde.getTime() + HORA_AVISO * HORA_MS) return 'fuera_de_horario';
  if (t >= desde.getTime() + HORA_LIMITE_RECUPERACION * HORA_MS) return 'fuera_de_horario';

  const dia = new Date(`${fecha}T00:00:00Z`);
  // Evita calcular la reposición cada minuto de la tarde.
  const ejecucion = await prisma.ejecucionTarea.findUnique({
    where: { tarea_fecha: { tarea: TAREA, fecha: dia } },
  });
  if (ejecucion) return 'ya_generado';

  const texto = textoAvisoReposicion(await calcularReposicion(prisma, instante));
  try {
    await prisma.$transaction([
      // Solo el aviso de reposición más reciente queda pendiente.
      prisma.notificacion.updateMany({
        where: { tipo: 'reposicion', estado: 'pendiente' },
        data: { estado: 'reemplazada', proximoIntentoEn: null },
      }),
      prisma.ejecucionTarea.create({
        data: {
          tarea: TAREA,
          fecha: dia,
          ejecutadaEn: instante,
          notificacion: {
            create: { tipo: 'reposicion', destino: 'admin', texto, creadaEn: instante },
          },
        },
      }),
    ]);
  } catch (error) {
    // Otra pasada generó el aviso de hoy primero: la transacción entera se deshizo.
    if ((error as { code?: string }).code === 'P2002') return 'ya_generado';
    throw error;
  }
  return 'generado';
}

/** Revisa cada minuto si hay que generar el aviso de reposición del día. */
export function iniciarAvisoReposicion(
  opciones: OpcionesAvisoReposicion & { log: FastifyBaseLogger },
): { detener: () => Promise<void> } {
  const { log, ...aviso } = opciones;
  return iniciarCiclo({
    nombre: 'aviso de reposición',
    pasada: () => generarAvisoDelDia(aviso),
    intervaloMs: INTERVALO_MS,
    log,
  });
}
