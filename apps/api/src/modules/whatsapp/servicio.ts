import {
  CODIGOS_ERROR,
  type EstadoWhatsappRespuesta,
  normalizarNumeroArgentino,
  numeroInternacional,
} from '@kiosco/shared';
import { ErrorHttp } from '../../errores.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { type ClienteWhatsapp, WhatsappNoDisponible, WhatsappRechazo } from './cliente.js';

export const TEXTO_PRUEBA =
  '✅ Prueba del sistema del kiosco: los avisos de anulaciones, gastos, retiros y cierres de caja van a llegar a este número.';

/** Lleva los errores de WAHA a respuestas de la API, sin detalles internos. */
function traducirError(error: unknown): never {
  if (error instanceof WhatsappNoDisponible) {
    throw new ErrorHttp(
      503,
      CODIGOS_ERROR.whatsappFallo,
      'WhatsApp no responde. Probá de nuevo en un rato.',
    );
  }
  if (error instanceof WhatsappRechazo) {
    throw new ErrorHttp(502, CODIGOS_ERROR.whatsappFallo, error.message);
  }
  throw error;
}

function configurado(whatsapp: ClienteWhatsapp | undefined): ClienteWhatsapp {
  if (!whatsapp) {
    throw new ErrorHttp(
      409,
      CODIGOS_ERROR.whatsappNoConfigurado,
      'WhatsApp no está configurado en el servidor.',
    );
  }
  return whatsapp;
}

async function estadoDe(cliente: ClienteWhatsapp) {
  return cliente.estado().catch(traducirError);
}

/** 10 dígitos si es un celular argentino; si no (por ejemplo, un `@lid`), tal cual. */
function numeroParaMostrar(internacional: string): string {
  const normalizado = normalizarNumeroArgentino(internacional);
  return normalizado.ok ? normalizado.numero : internacional;
}

export async function estadoWhatsapp(
  prisma: PrismaClient,
  whatsapp: ClienteWhatsapp | undefined,
): Promise<EstadoWhatsappRespuesta> {
  const [destino, pendientes] = await Promise.all([
    prisma.configuracionWhatsapp.findUnique({ where: { id: 1 } }),
    prisma.notificacion.count({ where: { estado: 'pendiente' } }),
  ]);
  const base = { destino: destino ? { numero: destino.numero } : null, pendientes };
  if (!whatsapp) return { ...base, estado: 'no_configurado', cuenta: null };

  let info;
  try {
    info = await whatsapp.estado();
  } catch {
    info = { estado: 'no_disponible' as const, cuenta: null };
  }
  return {
    ...base,
    estado: info.estado,
    cuenta: info.cuenta ? { numero: numeroParaMostrar(info.cuenta) } : null,
  };
}

/**
 * Deja la sesión esperando el QR. Con la sesión conectada o ya mostrando QR no
 * hace nada; desvinculada (detenida, fallada por QR vencidos o inexistente), la
 * reinicia o la crea.
 */
export async function vincular(prisma: PrismaClient, whatsapp: ClienteWhatsapp | undefined) {
  const cliente = configurado(whatsapp);
  const { estado } = await estadoDe(cliente);
  if (estado === 'no_disponible') traducirError(new WhatsappNoDisponible(''));
  if (estado === 'desvinculado') {
    try {
      await cliente.reiniciar();
    } catch (error) {
      if (!(error instanceof WhatsappRechazo)) traducirError(error);
      // No existe la sesión: se crea.
      await cliente.iniciar().catch(traducirError);
    }
  }
  return estadoWhatsapp(prisma, whatsapp);
}

export async function qr(whatsapp: ClienteWhatsapp | undefined): Promise<string> {
  const cliente = configurado(whatsapp);
  const sinQr = new ErrorHttp(
    409,
    CODIGOS_ERROR.whatsappNoQr,
    'No hay QR para mostrar: WhatsApp no está esperando una vinculación.',
  );
  const { estado } = await estadoDe(cliente);
  if (estado !== 'esperando_qr') throw sinQr;
  try {
    return await cliente.qr();
  } catch (error) {
    // Mientras la sesión arranca todavía no hay QR.
    if (error instanceof WhatsappRechazo) throw sinQr;
    return traducirError(error);
  }
}

export async function desvincular(prisma: PrismaClient, whatsapp: ClienteWhatsapp | undefined) {
  await configurado(whatsapp).desvincular().catch(traducirError);
  return estadoWhatsapp(prisma, whatsapp);
}

export async function guardarDestino(
  prisma: PrismaClient,
  whatsapp: ClienteWhatsapp | undefined,
  texto: string,
  usuarioId: string,
) {
  const cliente = configurado(whatsapp);
  const normalizado = normalizarNumeroArgentino(texto);
  if (!normalizado.ok) {
    throw normalizado.motivo === 'con_15'
      ? new ErrorHttp(
          422,
          CODIGOS_ERROR.numeroCon15,
          'Cargá el número sin el 15: código de área sin 0 y número. Por ejemplo, 11 2345-6789.',
        )
      : new ErrorHttp(
          422,
          CODIGOS_ERROR.numeroInvalido,
          'El número tiene que tener código de área y número, 10 dígitos en total. Por ejemplo, 11 2345-6789.',
        );
  }
  if ((await estadoDe(cliente)).estado !== 'conectado') {
    throw new ErrorHttp(
      409,
      CODIGOS_ERROR.whatsappNoConectado,
      'Primero vinculá WhatsApp: hace falta para verificar el número.',
    );
  }
  const chatId = await cliente
    .verificarNumero(numeroInternacional(normalizado.numero))
    .catch(traducirError);
  if (!chatId) {
    throw new ErrorHttp(422, CODIGOS_ERROR.numeroSinWhatsapp, 'Ese número no tiene WhatsApp.');
  }
  const datos = { numero: normalizado.numero, chatId, actualizadoPorId: usuarioId };
  await prisma.configuracionWhatsapp.upsert({
    where: { id: 1 },
    create: { id: 1, ...datos },
    update: datos,
  });
  return estadoWhatsapp(prisma, whatsapp);
}

/** Manda la prueba directo, sin guardarla como aviso. */
export async function mandarPrueba(prisma: PrismaClient, whatsapp: ClienteWhatsapp | undefined) {
  const cliente = configurado(whatsapp);
  const destino = await prisma.configuracionWhatsapp.findUnique({ where: { id: 1 } });
  if (!destino) {
    throw new ErrorHttp(
      409,
      CODIGOS_ERROR.whatsappSinDestino,
      'Cargá el número que recibe los avisos antes de mandar la prueba.',
    );
  }
  if ((await estadoDe(cliente)).estado !== 'conectado') {
    throw new ErrorHttp(409, CODIGOS_ERROR.whatsappNoConectado, 'WhatsApp no está vinculado.');
  }
  await cliente.enviarTexto(destino.chatId, TEXTO_PRUEBA).catch(traducirError);
}
