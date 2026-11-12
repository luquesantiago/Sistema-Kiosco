import type { EntornoArca } from '@kiosco/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { type OpcionesWsaa, pedirTicket } from './wsaa.js';

/** El único servicio que usa el kiosco: factura electrónica. */
export const SERVICIO_WSFE = 'wsfe';

/** Un ticket que vence en 60 s o menos no se usa: podría vencer durante el pedido. */
export const MARGEN_VENCIMIENTO_MS = 60_000;

/**
 * Ticket de acceso para el WSFE. Reutiliza el guardado en la base mientras
 * falten más de 60 s para que venza (sobrevive a un reinicio: ARCA no da otro
 * mientras haya uno vigente). Si no, pide uno nuevo y lo guarda. Homologación
 * y producción tienen cada uno el suyo.
 *
 * Solo lo llama la tarea de emisión, así que nunca hay dos pedidos de ticket en carrera.
 */
export async function obtenerTicket(
  prisma: PrismaClient,
  entorno: EntornoArca,
  ahora: Date,
  wsaa: OpcionesWsaa,
): Promise<{ token: string; sign: string }> {
  const guardado = await prisma.ticketAccesoArca.findUnique({
    where: { servicio_entorno: { servicio: SERVICIO_WSFE, entorno } },
  });
  if (guardado && guardado.expiraEn.getTime() - ahora.getTime() > MARGEN_VENCIMIENTO_MS) {
    return { token: guardado.token, sign: guardado.sign };
  }

  const nuevo = await pedirTicket(SERVICIO_WSFE, ahora, wsaa);
  const datos = {
    token: nuevo.token,
    sign: nuevo.sign,
    generadoEn: nuevo.generadoEn ?? ahora,
    expiraEn: nuevo.expiraEn,
  };
  await prisma.ticketAccesoArca.upsert({
    where: { servicio_entorno: { servicio: SERVICIO_WSFE, entorno } },
    create: { servicio: SERVICIO_WSFE, entorno, ...datos },
    update: datos,
  });
  return { token: nuevo.token, sign: nuevo.sign };
}
