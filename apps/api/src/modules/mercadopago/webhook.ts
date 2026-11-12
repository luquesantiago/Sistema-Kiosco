import type { PrismaClient } from '../../generated/prisma/client.js';
import type { ClienteMercadoPago } from '../../integrations/mercadopago/cliente.js';
import { verificarFirmaWebhook } from '../../integrations/mercadopago/firma.js';
import type { Facturacion } from '../facturacion/tipos.js';
import { actualizarCobro } from '../ventas/cobro.js';

/** Lo que llega en una notificación de Mercado Pago (solo lo que se usa). */
export interface NotificacionMp {
  /** `data.id` del query string: es lo que firma MP. */
  dataId: string | undefined;
  /** `type` del query o del cuerpo. */
  tipo: string | undefined;
  xSignature: string | undefined;
  xRequestId: string | undefined;
  cuerpo: unknown;
}

interface CuerpoNotificacion {
  id?: unknown;
  type?: unknown;
  data?: { id?: unknown; external_reference?: unknown } | null;
}

const texto = (valor: unknown) =>
  typeof valor === 'string' && valor ? valor : typeof valor === 'number' ? String(valor) : null;

/**
 * Procesa una notificación de MP (design "Webhook firmado"). Devuelve `false` si la
 * firma no es válida o no hay clave (→ 401). Una notificación válida nunca confirma nada
 * por sí misma: consulta la orden en MP y aplica lo que diga. Una repetida no se procesa
 * otra vez (la clave primaria de `avisos_mp`). Si MP no responde, la consulta de respaldo
 * lo resuelve.
 */
export async function procesarNotificacion(
  {
    prisma,
    mercadoPago,
    webhookSecret,
    facturacion,
    ahora,
  }: {
    prisma: PrismaClient;
    mercadoPago: ClienteMercadoPago | undefined;
    webhookSecret: string | undefined;
    facturacion?: Facturacion;
    ahora: () => Date;
  },
  { dataId, tipo, xSignature, xRequestId, cuerpo }: NotificacionMp,
): Promise<boolean> {
  if (!webhookSecret || !mercadoPago) return false;
  if (
    !verificarFirmaWebhook({
      secreto: webhookSecret,
      xSignature,
      xRequestId,
      dataId,
      ahora: ahora(),
    })
  ) {
    return false;
  }

  const datos = (cuerpo ?? {}) as CuerpoNotificacion;
  if ((tipo ?? texto(datos.type)) !== 'order') return true;

  const avisoId = texto(datos.id) ?? xRequestId;
  const ordenId = dataId ?? texto(datos.data?.id);
  if (avisoId) {
    try {
      await prisma.avisoMp.create({ data: { id: avisoId, ordenId, recibidoEn: ahora() } });
    } catch (error) {
      // Ya se recibió: no se vuelve a procesar.
      if ((error as { code?: string }).code === 'P2002') return true;
      throw error;
    }
  }

  // Por la orden o, si el cobro quedó sin `ordenId` (timeout al crearlo), por la referencia.
  const referencia = texto(datos.data?.external_reference);
  const cobro =
    (ordenId ? await prisma.cobroMp.findUnique({ where: { ordenId } }) : null) ??
    (referencia
      ? await prisma.cobroMp.findUnique({ where: { referenciaExterna: referencia } })
      : null);
  if (!cobro || !ordenId) return true;

  await actualizarCobro(
    { prisma, mercadoPago, facturacion, ahora },
    { ...cobro, ordenId: cobro.ordenId ?? ordenId },
  );
  return true;
}
