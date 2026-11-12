import { createHmac, randomUUID } from 'node:crypto';
import { crearApp, type OpcionesApp } from '../src/app.js';
import { prismaTest } from './base.js';
import type { OpcionesFacturacion } from './facturacion-ayudas.js';
import { crearMercadoPagoFalso } from './mercadopago-falso.js';

/*
 * Ayudas de los tests de cobro-mercado-pago.
 *
 * Contrato asumido (el design no lo detalla; se eligió lo más simple):
 * - `crearApp({ ..., mercadoPago, point: { terminalId, webhookSecret? } })`: con `point`
 *   y `mercadoPago` el Point está configurado (`MP_TERMINAL_ID`); sin `webhookSecret`
 *   (`MP_WEBHOOK_SECRET`) el webhook responde 401. `server.ts` arma `point` desde la config.
 * - `revisarCobros({ prisma, mercadoPago, ahora, facturacion })` en `src/jobs/cobros-mp.ts`:
 *   una pasada de la consulta de respaldo y del vencimiento. `ahora` es una función, como
 *   en `procesarFacturas` y `generarAvisoDelDia`; `facturacion` hace falta para encolar la
 *   factura al confirmar.
 * - El cobro en las respuestas (`cobro` del detalle de la venta, `GET /api/ventas/:id/cobro`,
 *   reintentar, devolución) trae al menos `{ id, ventaId, intento, medio, monto, estado,
 *   motivo, cancelacionPedida }`; `motivo` es el texto para el mostrador (o null).
 * - El detalle de la venta suma `cancelacion: { en, motivo } | null`, como `anulacion`.
 * - Con el Point configurado, `GET /api/caja/estado` suma `pointHabilitado: true` y
 *   `devolucionesPendientes` (siempre, aunque esté vacío); sin Point no los manda (así los
 *   tests de caja existentes, que comparan el estado completo, siguen igual).
 *
 * Este archivo no importa módulos que todavía no existen de forma estática: lo usan
 * también `caja.test.ts` y `dashboard.test.ts`, y sus tests viejos tienen que seguir
 * corriendo. `revisarCobros` se importa al usarse.
 */

export const TERMINAL_ID = 'NEWLAND_N950__N950NCB801293324';
export const SECRETO_WEBHOOK = 'clave-secreta-de-webhooks-de-prueba';

/** El texto exacto que el spec pide cuando Mercado Pago no responde. */
export const TEXTO_MP_NO_RESPONDE =
  'Mercado Pago no responde. Por ahora cobrá solo en efectivo (F1) o reintentá en un rato.';

export interface OpcionesAppConPoint {
  facturacion?: OpcionesFacturacion;
  /** `null`: el Point está configurado pero sin clave de webhooks. */
  secreto?: string | null;
  /** false: hay token de MP pero no `MP_TERMINAL_ID` (sin Point). */
  conPoint?: boolean;
}

/** App con reloj ajustable, el cliente falso de Mercado Pago y, por defecto, el Point configurado. */
export async function crearAppConPoint(
  inicio: Date,
  { facturacion, secreto = SECRETO_WEBHOOK, conPoint = true }: OpcionesAppConPoint = {},
) {
  let ahora = inicio;
  const { falso, cliente } = crearMercadoPagoFalso();
  const point = conPoint
    ? { terminalId: TERMINAL_ID, ...(secreto === null ? {} : { webhookSecret: secreto }) }
    : undefined;
  // `point` todavía no existe en `OpcionesApp`: se pasa igual (ver el contrato arriba).
  const opciones = {
    prisma: prismaTest,
    ahora: () => ahora,
    mercadoPago: cliente,
    facturacion,
    point,
  };
  const app = await crearApp(opciones as OpcionesApp);
  return {
    app,
    falso,
    cliente,
    facturacion,
    ahora: () => ahora,
    fijarHora(instante: Date) {
      ahora = instante;
    },
    adelantar(ms: number) {
      ahora = new Date(ahora.getTime() + ms);
    },
  };
}

export type ContextoPoint = Awaited<ReturnType<typeof crearAppConPoint>>;

/** Una pasada de la consulta de respaldo y del vencimiento, con el reloj de la app. */
export async function revisar(ctx: ContextoPoint) {
  const { revisarCobros } = await import('../src/jobs/cobros-mp.js');
  await revisarCobros({
    prisma: prismaTest,
    mercadoPago: ctx.cliente,
    ahora: ctx.ahora,
    facturacion: ctx.facturacion,
  });
}

// --- Lectura de los modelos nuevos ---
// El cliente de Prisma generado todavía no conoce `CobroMp`, `AvisoMp` ni las columnas
// nuevas de `Venta`: se leen con este tipo mínimo hasta que exista la migración.

export interface FilaCobro {
  id: string;
  ventaId: string;
  intento: number;
  medio: string;
  monto: { toFixed(decimales: number): string };
  claveIdempotencia: string;
  referenciaExterna: string;
  ordenId: string | null;
  estado: string;
  detalle: string | null;
  cancelacionPedida: boolean;
  consultadoEn: Date | null;
  revisadoPorId: string | null;
  revisadoEn: Date | null;
  notaRevision: string | null;
}

export interface FilaVenta {
  id: string;
  numero: number;
  estado: string;
  pagadaEn: Date | null;
  venceEn: Date | null;
  canceladaEn: Date | null;
  motivoCancelacion: string | null;
}

type Donde = Record<string, unknown>;

const db = prismaTest as unknown as {
  cobroMp: {
    findMany(args?: { where?: Donde; orderBy?: Donde }): Promise<FilaCobro[]>;
    count(args?: { where?: Donde }): Promise<number>;
    update(args: { where: { id: string }; data: Donde }): Promise<FilaCobro>;
  };
  avisoMp: { count(): Promise<number> };
  venta: { findUniqueOrThrow(args: { where: { id: string } }): Promise<FilaVenta> };
};

/** Cobros de una venta, del primer intento al último. */
export function cobrosDe(ventaId: string) {
  return db.cobroMp.findMany({ where: { ventaId }, orderBy: { intento: 'asc' } });
}

export function contarCobros() {
  return db.cobroMp.count();
}

export function contarAvisosMp() {
  return db.avisoMp.count();
}

export function filaVenta(id: string) {
  return db.venta.findUniqueOrThrow({ where: { id } });
}

/** Mueve la última consulta de un cobro a otro instante (para los bordes de 3 s). */
export function fijarConsultadoEn(cobroId: string, consultadoEn: Date) {
  return db.cobroMp.update({ where: { id: cobroId }, data: { consultadoEn } });
}

/** Movimientos de caja de un tipo (sirve también para `devolucion_cobro`, que el cliente no conoce). */
export async function movimientosDeTipo(tipo: string) {
  const todos = await prismaTest.movimientoCaja.findMany({ orderBy: { creadoEn: 'asc' } });
  return todos.filter((m) => String(m.tipo) === tipo);
}

/** Avisos al admin de un tipo (sirve para `cobro_mp_a_revisar` y `devolucion_cobro_mp`). */
export async function avisosDeTipo(tipo: string) {
  const todos = await prismaTest.notificacion.findMany({
    orderBy: [{ creadaEn: 'asc' }, { id: 'asc' }],
  });
  return todos.filter((n) => String(n.tipo) === tipo);
}

// --- Webhook firmado ---

/** `x-signature` como lo arma Mercado Pago: HMAC-SHA256 del manifest con `data.id` en minúsculas. */
export function firmaWebhook({
  dataId,
  requestId,
  ts,
  secreto = SECRETO_WEBHOOK,
}: {
  dataId: string;
  requestId: string;
  ts: string;
  secreto?: string;
}) {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  return `ts=${ts},v1=${createHmac('sha256', secreto).update(manifest).digest('hex')}`;
}

export interface AvisoWebhook {
  ordenId: string;
  /** `id` de la notificación (para detectar repetidas). Por defecto, uno nuevo. */
  idAviso?: string;
  /** Segundos respecto del reloj de la app (negativo: en el pasado). Por defecto, −10. */
  desfasajeS?: number;
  secreto?: string;
  /** Encabezado `x-signature` a mano (`null`: sin encabezado). */
  firma?: string | null;
  tipo?: string;
  accion?: string;
  /** `external_reference` dentro de `data`, para el cobro que quedó sin `ordenId`. */
  referenciaExterna?: string;
  /** Rellena el cuerpo hasta este largo exacto en bytes (para el límite de 64 KB). */
  tamanoCuerpo?: number;
}

/** Notificación de Mercado Pago a `POST /api/mercado-pago/webhook`, sin sesión. */
export function avisoWebhook(ctx: ContextoPoint, aviso: AvisoWebhook) {
  const requestId = randomUUID();
  const ts = String(Math.floor(ctx.ahora().getTime() / 1000) + (aviso.desfasajeS ?? -10));
  const firma =
    aviso.firma === undefined
      ? firmaWebhook({ dataId: aviso.ordenId, requestId, ts, secreto: aviso.secreto })
      : aviso.firma;
  const tipo = aviso.tipo ?? 'order';
  const cuerpo: Record<string, unknown> = {
    id: aviso.idAviso ?? randomUUID(),
    type: tipo,
    action: aviso.accion ?? 'order.processed',
    api_version: 'v1',
    live_mode: false,
    data: {
      id: aviso.ordenId,
      ...(aviso.referenciaExterna ? { external_reference: aviso.referenciaExterna } : {}),
    },
  };
  if (aviso.tamanoCuerpo !== undefined) {
    // Todo es ASCII: el largo del texto es el largo en bytes.
    const base = JSON.stringify({ ...cuerpo, relleno: '' }).length;
    cuerpo.relleno = 'x'.repeat(aviso.tamanoCuerpo - base);
  }
  const texto = JSON.stringify(cuerpo);
  return ctx.app.inject({
    method: 'POST',
    url: `/api/mercado-pago/webhook?data.id=${encodeURIComponent(aviso.ordenId)}&type=${tipo}`,
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
      ...(firma === null ? {} : { 'x-signature': firma }),
    },
    payload: texto,
  });
}
