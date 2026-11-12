import { createHmac, timingSafeEqual } from 'node:crypto';

/** Diferencia máxima, en segundos, entre la marca de tiempo de la notificación y el reloj. */
export const TOLERANCIA_FIRMA_S = 300;

export interface DatosFirma {
  /** `MP_WEBHOOK_SECRET`. */
  secreto: string;
  /** Encabezado `x-signature` tal cual (`ts=...,v1=...`), o undefined si no vino. */
  xSignature: string | undefined;
  /** Encabezado `x-request-id`, o undefined si no vino. */
  xRequestId: string | undefined;
  /** `data.id` del query string tal cual llegó. */
  dataId: string | undefined;
  ahora: Date;
}

/** Lee `ts=...,v1=...`; null si falta alguna de las dos partes. */
function leerEncabezado(xSignature: string): { ts: string; v1: string } | null {
  const partes = new Map<string, string>();
  for (const parte of xSignature.split(',')) {
    const igual = parte.indexOf('=');
    if (igual < 0) continue;
    partes.set(parte.slice(0, igual).trim(), parte.slice(igual + 1).trim());
  }
  const ts = partes.get('ts');
  const v1 = partes.get('v1');
  if (!ts || !v1) return null;
  return { ts, v1 };
}

/** Marca de tiempo en milisegundos: 13 dígitos son milisegundos; si no, segundos. */
function marcaEnMs(ts: string): number | null {
  if (!/^\d{1,13}$/.test(ts)) return null;
  const valor = Number(ts);
  return ts.length === 13 ? valor : valor * 1000;
}

/**
 * Verifica la firma de una notificación de Mercado Pago (design de cobro-mercado-pago,
 * "Webhook firmado"): HMAC-SHA256 en hexadecimal del manifest
 * `id:{data.id en minúsculas};request-id:{x-request-id};ts:{ts};` (sin las partes que no
 * vienen), comparado en tiempo constante, y la marca de tiempo a no más de 300 s del reloj.
 * El template sale de los SDK de MP: confirmarlo con "Simular notificación" (tarea 8.2).
 * Nunca tira error: cualquier cosa rara es una firma inválida.
 */
export function verificarFirmaWebhook({
  secreto,
  xSignature,
  xRequestId,
  dataId,
  ahora,
}: DatosFirma): boolean {
  if (!secreto || !xSignature) return false;
  const encabezado = leerEncabezado(xSignature);
  if (!encabezado) return false;

  const ms = marcaEnMs(encabezado.ts);
  if (ms === null) return false;
  if (Math.abs(ahora.getTime() - ms) > TOLERANCIA_FIRMA_S * 1000) return false;

  const manifest = [
    dataId === undefined ? '' : `id:${dataId.toLowerCase()};`,
    xRequestId === undefined ? '' : `request-id:${xRequestId};`,
    `ts:${encabezado.ts};`,
  ].join('');
  const esperada = createHmac('sha256', secreto).update(manifest).digest();
  if (!/^[0-9a-f]{64}$/i.test(encabezado.v1)) return false;
  const recibida = Buffer.from(encabezado.v1, 'hex');
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}
