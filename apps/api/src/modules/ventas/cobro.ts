import { randomUUID } from 'node:crypto';
import {
  CODIGOS_ERROR,
  MOTIVO_COBRO_NO_CREADO,
  motivoRechazoCobro,
  type CobroMp as CobroMpRespuesta,
} from '@kiosco/shared';
import type { ConfigPoint } from '../../config.js';
import { ErrorHttp } from '../../errores.js';
import type {
  CobroMp,
  EstadoCobroMp,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client.js';
import {
  MercadoPagoRechazo,
  type ClienteMercadoPago,
  type MedioPoint,
  type OrdenPoint,
} from '../../integrations/mercadopago/cliente.js';
import { turnoAbiertoBloqueado } from '../caja/servicio.js';
import { encolarFacturaSiCorresponde } from '../facturacion/encolado.js';
import type { Facturacion } from '../facturacion/tipos.js';
import { textoAvisoCobroARevisar } from '../mercadopago/avisos-cobro.js';
import { registrarMovimiento } from '../stock/movimientos.js';

/*
 * Cobro de una venta con la terminal Point (cambio cobro-mercado-pago). La venta nace
 * `pendiente` con su cobro; acá se envía a Mercado Pago, se aplica lo que informa MP
 * (por consulta o por aviso: el estado se toma SOLO de `consultarOrden`), se cancela y
 * se reintenta. Cada transición es un UPDATE condicionado al estado anterior, así que
 * la misma novedad llegando por varias vías tiene efecto una sola vez.
 */

type Tx = Prisma.TransactionClient;

/** Una venta en espera vence 10 minutos después de su último intento de cobro. */
export const ESPERA_VENTA_MS = 10 * 60_000;
/** Mientras un cobro está activo, se consulta a MP cada 3 s (como mucho). */
export const INTERVALO_CONSULTA_MS = 3_000;

export const MOTIVO_CANCELADA_EN_MOSTRADOR = 'Cancelada en el mostrador';
export const MOTIVO_VENCIDA = 'Venció la espera';

/** Cobros activos: ocupan la terminal (índice parcial `cobros_mp_uno_activo`). */
export const ESTADOS_ACTIVOS = [
  'creando',
  'en_espera',
  'cancelando',
] as const satisfies readonly EstadoCobroMp[];

/** Lo que necesitan las operaciones del cobro. Sin Point configurado no se usan. */
export interface ContextoCobro {
  prisma: PrismaClient;
  mercadoPago: ClienteMercadoPago;
  facturacion?: Facturacion;
  ahora: () => Date;
}

const esActivo = (estado: EstadoCobroMp) =>
  (ESTADOS_ACTIVOS as readonly EstadoCobroMp[]).includes(estado);

/** Texto del motivo para el mostrador: solo los rechazos lo tienen. */
function motivoDe(cobro: Pick<CobroMp, 'estado' | 'detalle'>): string | null {
  if (cobro.estado !== 'rechazado') return null;
  const detalle = cobro.detalle;
  if (detalle !== null && Object.hasOwn(MOTIVO_COBRO_NO_CREADO, detalle)) {
    return MOTIVO_COBRO_NO_CREADO[detalle as keyof typeof MOTIVO_COBRO_NO_CREADO];
  }
  if (detalle?.startsWith('http_')) return 'Mercado Pago rechazó el cobro';
  return motivoRechazoCobro(detalle);
}

export function aCobro(cobro: CobroMp): CobroMpRespuesta {
  return {
    id: cobro.id,
    ventaId: cobro.ventaId,
    intento: cobro.intento,
    medio: cobro.medio,
    monto: cobro.monto.toFixed(2),
    estado: cobro.estado,
    motivo: motivoDe(cobro),
    cancelacionPedida: cobro.cancelacionPedida,
  };
}

const terminalOcupada = () =>
  new ErrorHttp(
    409,
    CODIGOS_ERROR.terminalOcupada,
    'El Point está ocupado con otro cobro: terminalo o cancelalo.',
  );

/**
 * Guarda un intento de cobro en `creando`, con su clave de idempotencia, ANTES de
 * llamar a MP. Si ya hay un cobro activo, el índice parcial lo rechaza: `409`.
 */
export async function crearIntento(
  tx: Tx,
  {
    venta,
    intento,
    medio,
    monto,
    ahora,
  }: {
    venta: { id: string; numero: number };
    intento: number;
    medio: MedioPoint;
    monto: string;
    ahora: Date;
  },
): Promise<CobroMp> {
  try {
    return await tx.cobroMp.create({
      data: {
        ventaId: venta.id,
        intento,
        medio,
        monto,
        claveIdempotencia: randomUUID(),
        referenciaExterna: `venta-${venta.numero}-${intento}`,
        estado: 'creando',
        creadoEn: ahora,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') throw terminalOcupada();
    throw error;
  }
}

/**
 * Manda el cobro a la terminal (fuera de toda transacción: puede tardar hasta 10 s).
 * Sin respuesta, el cobro queda `creando` y reintentar reusa la misma clave; si MP lo
 * rechaza (terminal ocupada, monto), queda `rechazado` con el motivo.
 */
export async function enviarCobro(
  ctx: ContextoCobro,
  point: ConfigPoint,
  cobroId: string,
): Promise<void> {
  const cobro = await ctx.prisma.cobroMp.findUniqueOrThrow({ where: { id: cobroId } });
  let orden: OrdenPoint;
  try {
    orden = await ctx.mercadoPago.crearOrden({
      claveIdempotencia: cobro.claveIdempotencia,
      referenciaExterna: cobro.referenciaExterna,
      monto: cobro.monto.toFixed(2),
      medio: cobro.medio as MedioPoint,
      terminalId: point.terminalId,
    });
  } catch (error) {
    if (error instanceof MercadoPagoRechazo) {
      await ctx.prisma.cobroMp.updateMany({
        where: { id: cobroId, estado: 'creando' },
        data: {
          estado: 'rechazado',
          detalle: error.codigo ?? `http_${error.status}`,
          resueltoEn: ctx.ahora(),
        },
      });
    }
    // Cualquier otra falla (red, timeout, 5xx) es "Mercado Pago no responde".
    return;
  }
  await aplicarOrden(ctx, cobroId, orden);
}

/** Pasa la venta en espera a `cancelada` (si sigue en espera), con el motivo que se pidió. */
async function cancelarVentaEnEspera(tx: Tx, ventaId: string, ahora: Date, motivo?: string) {
  const venta = await tx.venta.findUniqueOrThrow({
    where: { id: ventaId },
    select: { motivoCancelacion: true },
  });
  await tx.venta.updateMany({
    where: { id: ventaId, estado: 'pendiente' },
    data: {
      estado: 'cancelada',
      canceladaEn: ahora,
      venceEn: null,
      motivoCancelacion: motivo ?? venta.motivoCancelacion ?? MOTIVO_CANCELADA_EN_MOSTRADOR,
    },
  });
}

/**
 * El cobro terminó sin aprobarse (rechazado, vencido o cancelado en MP). Si la
 * cancelación la había pedido el sistema, la venta queda `cancelada`; si no, sigue en
 * espera y el mostrador ofrece reintentar.
 */
async function terminarSinAprobar(
  ctx: ContextoCobro,
  cobroId: string,
  estado: 'rechazado' | 'vencido' | 'cancelado',
  detalle: string | null,
) {
  const ahora = ctx.ahora();
  await ctx.prisma.$transaction(async (tx) => {
    const { count } = await tx.cobroMp.updateMany({
      where: { id: cobroId, estado: { in: [...ESTADOS_ACTIVOS] } },
      data: { estado, detalle, resueltoEn: ahora },
    });
    if (count === 0) return;
    const cobro = await tx.cobroMp.findUniqueOrThrow({ where: { id: cobroId } });
    if (cobro.cancelacionPedida) await cancelarVentaEnEspera(tx, cobro.ventaId, ahora);
  });
}

/** La terminal pide revisar el pago: el cobro queda `a_revisar` y se avisa al admin una vez. */
async function pasarARevisar(ctx: ContextoCobro, cobroId: string, detalle: string | null) {
  const ahora = ctx.ahora();
  await ctx.prisma.$transaction(async (tx) => {
    const { count } = await tx.cobroMp.updateMany({
      where: { id: cobroId, estado: { in: [...ESTADOS_ACTIVOS] } },
      data: { estado: 'a_revisar', detalle, resueltoEn: ahora },
    });
    if (count === 0) return;
    const cobro = await tx.cobroMp.findUniqueOrThrow({
      where: { id: cobroId },
      include: { venta: { select: { numero: true } } },
    });
    await tx.notificacion.create({
      data: {
        tipo: 'cobro_mp_a_revisar',
        destino: 'admin',
        texto: textoAvisoCobroARevisar({
          caso: 'a_revisar',
          monto: cobro.monto.toFixed(2),
          medio: cobro.medio,
          ventaNumero: cobro.venta.numero,
          en: ahora,
        }),
        creadaEn: ahora,
      },
    });
  });
}

/**
 * Confirma un pago aprobado, en una transacción (design "Confirmación"):
 * - Venta `pendiente` → `pagada`, con el stock y la factura automática.
 * - Venta ya `cancelada` → sigue cancelada; lo cobrado entra a la cuenta MP y el cobro
 *   queda `a_devolver` en efectivo, con aviso al admin. Nunca se factura.
 * Si el cobro ya estaba resuelto (otra vía llegó antes), no hace nada.
 */
export async function confirmarCobroAprobado(
  ctx: ContextoCobro,
  cobroId: string,
  orden: Pick<OrdenPoint, 'detalle' | 'tipoInformado'>,
): Promise<void> {
  const ahora = ctx.ahora();
  const pagada = await ctx.prisma.$transaction(
    async (tx) => {
      const { count } = await tx.cobroMp.updateMany({
        // `cancelado`: el pago entró después de que MP confirmara la cancelación.
        where: {
          id: cobroId,
          estado: { in: ['creando', 'en_espera', 'cancelando', 'a_revisar', 'cancelado'] },
        },
        data: {
          estado: 'aprobado',
          detalle: orden.detalle,
          tipoInformado: orden.tipoInformado,
          resueltoEn: ahora,
        },
      });
      if (count === 0) return false;
      const cobro = await tx.cobroMp.findUniqueOrThrow({ where: { id: cobroId } });

      const { count: pasoAPagada } = await tx.venta.updateMany({
        where: { id: cobro.ventaId, estado: 'pendiente' },
        data: { estado: 'pagada', pagadaEn: ahora, venceEn: null },
      });
      const venta = await tx.venta.findUniqueOrThrow({
        where: { id: cobro.ventaId },
        include: { items: true, pagos: true },
      });

      if (pasoAPagada === 1) {
        // El stock se descuenta ahora, aunque el producto se haya desactivado en la espera.
        const vendidos = new Map<string, number>();
        for (const item of venta.items) {
          if (item.productoId === null) continue;
          vendidos.set(item.productoId, (vendidos.get(item.productoId) ?? 0) + item.cantidad);
        }
        for (const [productoId, cantidad] of vendidos) {
          await registrarMovimiento(tx, {
            productoId,
            tipo: 'venta',
            cantidad: -cantidad,
            usuarioId: venta.usuarioId,
            ventaId: venta.id,
            permitirDesactivado: true,
          });
        }
        await encolarFacturaSiCorresponde(
          tx,
          {
            id: venta.id,
            numero: venta.numero,
            estado: 'pagada',
            creadaEn: venta.creadaEn,
            pagos: venta.pagos,
          },
          { facturacion: ctx.facturacion, ahora },
        );
        return true;
      }

      if (venta.estado === 'cancelada') {
        await tx.cobroMp.update({ where: { id: cobroId }, data: { estado: 'a_devolver' } });
        // Entra a la cuenta MP (no toca el esperado). Sin turno abierto, queda sin turno.
        const turno = await turnoAbiertoBloqueado(tx);
        await tx.movimientoCaja.create({
          data: {
            turnoId: turno?.id ?? null,
            tipo: 'ingreso',
            cuenta: 'mercado_pago',
            monto: cobro.monto,
            motivo: `Cobro de la venta #${venta.numero} cancelada`,
            usuarioId: venta.usuarioId,
            cobroMpId: cobro.id,
            creadoEn: ahora,
          },
        });
        await tx.notificacion.create({
          data: {
            tipo: 'cobro_mp_a_revisar',
            destino: 'admin',
            texto: textoAvisoCobroARevisar({
              caso: 'a_devolver',
              monto: cobro.monto.toFixed(2),
              medio: cobro.medio,
              ventaNumero: venta.numero,
              en: ahora,
            }),
            creadaEn: ahora,
          },
        });
      }
      return false;
    },
    { timeout: 30_000 },
  );
  // La factura ya está en la cola: que la emisión no espere al intervalo.
  if (pagada) ctx.facturacion?.despertar();
}

/**
 * Aplica lo que informó MP de la orden (tabla del design). `orden` sale siempre de
 * `crearOrden` o `consultarOrden`, nunca del cuerpo de un aviso.
 */
export async function aplicarOrden(
  ctx: ContextoCobro,
  cobroId: string,
  orden: OrdenPoint,
): Promise<void> {
  const cobro = await ctx.prisma.cobroMp.findUniqueOrThrow({ where: { id: cobroId } });
  // Un cobro sin orden (timeout al crearlo) solo se enlaza con la orden de su referencia.
  if (
    cobro.ordenId === null &&
    orden.referenciaExterna !== '' &&
    orden.referenciaExterna !== cobro.referenciaExterna
  ) {
    return;
  }
  await ctx.prisma.cobroMp.update({
    where: { id: cobroId },
    data: {
      consultadoEn: ctx.ahora(),
      ...(cobro.ordenId === null && { ordenId: orden.id }),
    },
  });

  switch (orden.estado) {
    case 'aprobado':
      return confirmarCobroAprobado(ctx, cobroId, orden);
    case 'en_espera':
      // Una cancelación pedida sigue pedida aunque MP todavía no la refleje.
      await ctx.prisma.cobroMp.updateMany({
        where: { id: cobroId, estado: 'creando' },
        data: { estado: 'en_espera' },
      });
      return;
    case 'cancelando':
      await ctx.prisma.cobroMp.updateMany({
        where: { id: cobroId, estado: { in: ['creando', 'en_espera'] } },
        data: { estado: 'cancelando' },
      });
      return;
    case 'rechazado':
    case 'vencido':
    case 'cancelado':
      return terminarSinAprobar(ctx, cobroId, orden.estado, orden.detalle);
    case 'a_revisar':
      return pasarARevisar(ctx, cobroId, orden.detalle);
  }
}

/** Consulta la orden en MP y aplica su estado. Si MP no responde, el cobro queda como estaba. */
export async function actualizarCobro(ctx: ContextoCobro, cobro: CobroMp): Promise<boolean> {
  if (cobro.ordenId === null) return false;
  let orden: OrdenPoint;
  try {
    orden = await ctx.mercadoPago.consultarOrden(cobro.ordenId);
  } catch {
    return false;
  }
  await aplicarOrden(ctx, cobro.id, orden);
  return true;
}

/** El último intento de cobro de una venta, o null si no pasó por el Point. */
export function ultimoCobro(db: Tx | PrismaClient, ventaId: string) {
  return db.cobroMp.findFirst({ where: { ventaId }, orderBy: { intento: 'desc' } });
}

/**
 * Pide cancelar una venta en espera (el empleado, "Cobrar de otra forma" o el
 * vencimiento). Con el cobro terminado o sin crear en MP, la venta se cancela en el
 * momento. Con el cobro en MP, se le pide cancelarlo: `200` cancela la venta, `202`
 * deja el cobro `cancelando` hasta que MP confirme, y `409` (ya procesado) consulta y
 * aplica lo que diga, lo que puede dejar la venta `pagada`.
 */
export async function pedirCancelacion(
  ctx: ContextoCobro,
  ventaId: string,
  motivo: string,
): Promise<void> {
  const ahora = ctx.ahora();
  // El motivo queda guardado desde el pedido: la confirmación puede llegar después.
  await ctx.prisma.venta.updateMany({
    where: { id: ventaId, estado: 'pendiente' },
    data: { motivoCancelacion: motivo },
  });
  const cobro = await ultimoCobro(ctx.prisma, ventaId);

  if (!cobro || !esActivo(cobro.estado) || cobro.ordenId === null) {
    await ctx.prisma.$transaction(async (tx) => {
      if (cobro) {
        // Sin `ordenId` no hay nada que cancelar en MP: si la orden llegó, vence sola.
        await tx.cobroMp.updateMany({
          where: { id: cobro.id, estado: 'creando' },
          data: { estado: 'cancelado', cancelacionPedida: true, resueltoEn: ahora },
        });
      }
      await cancelarVentaEnEspera(tx, ventaId, ahora, motivo);
    });
    return;
  }
  if (cobro.estado === 'cancelando') return;

  await ctx.prisma.cobroMp.update({
    where: { id: cobro.id },
    data: { cancelacionPedida: true },
  });
  let resultado;
  try {
    resultado = await ctx.mercadoPago.cancelarOrden(cobro.ordenId);
  } catch {
    // MP no responde: la venta sigue en espera; el vencimiento lo vuelve a intentar.
    return;
  }
  if (resultado === 'cancelada') {
    await terminarSinAprobar(ctx, cobro.id, 'cancelado', null);
  } else if (resultado === 'pedida') {
    await ctx.prisma.cobroMp.updateMany({
      where: { id: cobro.id, estado: { in: ['creando', 'en_espera'] } },
      data: { estado: 'cancelando' },
    });
  } else {
    await actualizarCobro(ctx, { ...cobro, cancelacionPedida: true });
  }
}

/**
 * Reintenta el cobro de una venta en espera. Si el último quedó `creando` (MP no
 * respondió), se reenvía con la MISMA clave: si la primera había llegado, MP devuelve
 * la misma orden. Si se rechazó o venció, se crea el intento siguiente (clave y
 * referencia nuevas) y la espera vuelve a contar 10 minutos.
 */
export async function reintentarCobro(
  ctx: ContextoCobro,
  point: ConfigPoint,
  ventaId: string,
): Promise<CobroMp> {
  const ahora = ctx.ahora();
  const ultimo = await ultimoCobro(ctx.prisma, ventaId);
  if (!ultimo) {
    throw new ErrorHttp(409, CODIGOS_ERROR.ventaNoEnEspera, 'Esta venta no se cobra con el Point.');
  }

  let cobroId: string;
  if (ultimo.estado === 'creando') {
    cobroId = ultimo.id;
  } else if (
    ultimo.estado === 'rechazado' ||
    ultimo.estado === 'vencido' ||
    (ultimo.estado === 'cancelado' && !ultimo.cancelacionPedida)
  ) {
    cobroId = await ctx.prisma.$transaction(async (tx) => {
      const venta = await tx.venta.findUniqueOrThrow({ where: { id: ventaId } });
      const nuevo = await crearIntento(tx, {
        venta,
        intento: ultimo.intento + 1,
        medio: ultimo.medio as MedioPoint,
        monto: ultimo.monto.toFixed(2),
        ahora,
      });
      await tx.venta.updateMany({
        where: { id: ventaId, estado: 'pendiente' },
        data: { venceEn: new Date(ahora.getTime() + ESPERA_VENTA_MS) },
      });
      return nuevo.id;
    });
  } else {
    throw terminalOcupada();
  }

  await enviarCobro(ctx, point, cobroId);
  return ctx.prisma.cobroMp.findUniqueOrThrow({ where: { id: cobroId } });
}

/**
 * Vencimiento de una venta en espera (10 minutos desde el último intento). Antes de
 * cancelar consulta el cobro, aunque se haya consultado hace menos de 3 s: si se
 * aprobó, la venta queda pagada; si sigue activo, se pide cancelarlo.
 */
export async function vencerVenta(ctx: ContextoCobro, ventaId: string): Promise<void> {
  const cobro = await ultimoCobro(ctx.prisma, ventaId);
  if (cobro && cobro.ordenId !== null && esActivo(cobro.estado)) {
    let orden: OrdenPoint;
    try {
      orden = await ctx.mercadoPago.consultarOrden(cobro.ordenId);
    } catch {
      return; // MP no responde: se vuelve a intentar en la próxima pasada.
    }
    await aplicarOrden(ctx, cobro.id, orden);
    const venta = await ctx.prisma.venta.findUniqueOrThrow({ where: { id: ventaId } });
    if (venta.estado !== 'pendiente') return;
    const actual = await ctx.prisma.cobroMp.findUniqueOrThrow({ where: { id: cobro.id } });
    // Ya se pidió cancelar: se espera la confirmación de MP.
    if (actual.estado === 'cancelando') return;
  }
  await pedirCancelacion(ctx, ventaId, MOTIVO_VENCIDA);
}
