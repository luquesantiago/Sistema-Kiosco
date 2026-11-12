import {
  CODIGOS_ERROR,
  normalizarParaBusqueda,
  PEDIDOS_POR_PAGINA,
  type altaPedidoSchema,
  type cancelacionPedidoSchema,
  type Cuenta,
  type edicionPedidoSchema,
  type ingresoMercaderiaSchema,
  type llegadaPedidoSchema,
  type listadoPedidosQuerySchema,
  type pagoPedidoSchema,
  type PedidoDetalle,
  type PedidoResumen,
  type ProductoCarga,
  type recepcionSinPedidoSchema,
  type UsuarioSesion,
} from '@kiosco/shared';
import type { z } from 'zod';
import { ErrorHttp } from '../../errores.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { fechaEnArgentina, rangoDelDiaEnArgentina } from '../../lib/fechas.js';
import { turnoParaMovimiento } from '../caja/servicio.js';
import { registrarIngreso } from '../stock/servicio.js';
import { textoAvisoPedidoCerrado } from './aviso.js';

type Tx = Prisma.TransactionClient;

const usuarioRef = { select: { id: true, nombre: true } } as const;

const incluirResumen = {
  proveedor: { select: { id: true, nombre: true } },
  pago: { select: { cuenta: true } },
} as const;

const incluirDetalle = {
  proveedor: { select: { id: true, nombre: true } },
  creadoPor: usuarioRef,
  recibidoPor: usuarioRef,
  canceladoPor: usuarioRef,
  ingreso: { include: { usuario: usuarioRef, _count: { select: { items: true } } } },
  pago: { include: { usuario: usuarioRef } },
} as const;

type PedidoConResumen = Prisma.PedidoGetPayload<{ include: typeof incluirResumen }>;
type PedidoConDetalle = Prisma.PedidoGetPayload<{ include: typeof incluirDetalle }>;

const fecha = (d: Date) => d.toISOString().slice(0, 10);

function aResumen(p: PedidoConResumen): PedidoResumen {
  return {
    id: p.id,
    numero: p.numero,
    proveedor: p.proveedor,
    totalPedido: p.totalPedido.toFixed(2),
    total: p.total?.toFixed(2) ?? null,
    llegaEl: fecha(p.llegaEl),
    nota: p.nota,
    estado: p.estado,
    cuentaPago: p.pago?.cuenta ?? null,
    cerradoEn: p.cerradoEn?.toISOString() ?? null,
  };
}

function aDetalle(p: PedidoConDetalle): PedidoDetalle {
  return {
    ...aResumen(p),
    creado: { usuario: p.creadoPor, en: p.creadoEn.toISOString() },
    recibido:
      p.recibidoPor && p.llegoEn ? { usuario: p.recibidoPor, en: p.llegoEn.toISOString() } : null,
    notaRecepcion: p.notaRecepcion,
    cancelado:
      p.canceladoPor && p.canceladoEn
        ? {
            usuario: p.canceladoPor,
            en: p.canceladoEn.toISOString(),
            motivo: p.motivoCancelacion ?? '',
          }
        : null,
    carga: p.ingreso
      ? {
          usuario: p.ingreso.usuario,
          en: p.ingreso.creadoEn.toISOString(),
          ingresoId: p.ingreso.id,
          cantidadProductos: p.ingreso._count.items,
        }
      : null,
    pago: p.pago
      ? {
          usuario: p.pago.usuario,
          en: p.pago.creadoEn.toISOString(),
          cuenta: p.pago.cuenta,
          monto: p.pago.monto.toFixed(2),
        }
      : null,
  };
}

const noEncontrado = () => new ErrorHttp(404, CODIGOS_ERROR.noEncontrado, 'El pedido no existe.');
const otroEstado = (mensaje: string) =>
  new ErrorHttp(409, CODIGOS_ERROR.pedidoEnOtroEstado, mensaje);

async function detalle(db: Tx | PrismaClient, id: string): Promise<PedidoDetalle> {
  const pedido = await db.pedido.findUnique({ where: { id }, include: incluirDetalle });
  if (!pedido) throw noEncontrado();
  return aDetalle(pedido);
}

export function obtenerPedido(prisma: PrismaClient, id: string): Promise<PedidoDetalle> {
  return detalle(prisma, id);
}

async function proveedorActivo(tx: Tx, proveedorId: string) {
  const proveedor = await tx.proveedor.findUnique({
    where: { id: proveedorId },
    select: { activo: true },
  });
  if (!proveedor?.activo) {
    throw new ErrorHttp(
      400,
      CODIGOS_ERROR.proveedorInactivo,
      'El proveedor no existe o está desactivado.',
    );
  }
}

/** Primero lo que hay que atender: falta cargar, llega hoy o atrasado, debe, y lo que viene. */
function prioridad(p: PedidoConResumen, hoy: string): number {
  if (p.estado === 'llego') return 0;
  if (p.estado === 'por_llegar' && fecha(p.llegaEl) <= hoy) return 1;
  if (!p.pago) return p.estado === 'por_llegar' ? 3 : 2;
  return 4;
}

export async function listarPedidos(
  prisma: PrismaClient,
  { vista, desde, hasta, pagina }: z.output<typeof listadoPedidosQuerySchema>,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<PedidoResumen[]> {
  const hoy = fechaEnArgentina(ahora);
  if (vista === 'abiertos') {
    const abiertos = await prisma.pedido.findMany({
      where: { cerradoEn: null, estado: { not: 'cancelado' } },
      include: incluirResumen,
      orderBy: [{ llegaEl: 'asc' }, { numero: 'asc' }],
    });
    return abiertos.sort((a, b) => prioridad(a, hoy) - prioridad(b, hoy)).map(aResumen);
  }
  if (usuario.rol !== 'admin') {
    throw new ErrorHttp(403, CODIGOS_ERROR.sinPermiso, 'Solo el admin ve los pedidos cerrados.');
  }
  const inicio = desde ?? hasta ?? hoy;
  const fin = hasta ?? desde ?? hoy;
  if (inicio > fin) {
    throw new ErrorHttp(400, CODIGOS_ERROR.validacion, 'La fecha "desde" es posterior a "hasta".');
  }
  const rango = {
    gte: rangoDelDiaEnArgentina(inicio).desde,
    lt: rangoDelDiaEnArgentina(fin).hasta,
  };
  const pedidos = await prisma.pedido.findMany({
    where:
      vista === 'cerrados' ? { cerradoEn: rango } : { estado: 'cancelado', canceladoEn: rango },
    include: incluirResumen,
    orderBy: [
      vista === 'cerrados' ? { cerradoEn: 'desc' } : { canceladoEn: 'desc' },
      { numero: 'desc' },
    ],
    skip: (pagina - 1) * PEDIDOS_POR_PAGINA,
    take: PEDIDOS_POR_PAGINA,
  });
  return pedidos.map(aResumen);
}

export async function crearPedido(
  prisma: PrismaClient,
  datos: z.output<typeof altaPedidoSchema>,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<PedidoDetalle> {
  return prisma.$transaction(async (tx) => {
    await proveedorActivo(tx, datos.proveedorId);
    const { id } = await tx.pedido.create({
      data: {
        proveedorId: datos.proveedorId,
        totalPedido: datos.totalPedido,
        llegaEl: new Date(`${datos.llegaEl}T00:00:00Z`),
        nota: datos.nota,
        creadoPorId: usuario.id,
        creadoEn: ahora,
      },
    });
    return detalle(tx, id);
  });
}

export async function editarPedido(
  prisma: PrismaClient,
  id: string,
  datos: z.output<typeof edicionPedidoSchema>,
): Promise<PedidoDetalle> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.pedido.updateMany({
      where: { id, estado: 'por_llegar' },
      data: {
        totalPedido: datos.totalPedido,
        llegaEl: datos.llegaEl ? new Date(`${datos.llegaEl}T00:00:00Z`) : undefined,
        nota: datos.nota,
      },
    });
    if (count === 0) {
      await detalle(tx, id);
      throw otroEstado('Solo se puede editar un pedido que todavía no llegó.');
    }
    return detalle(tx, id);
  });
}

export async function cancelarPedido(
  prisma: PrismaClient,
  id: string,
  { motivo }: z.output<typeof cancelacionPedidoSchema>,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<PedidoDetalle> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.pedido.updateMany({
      where: { id, estado: 'por_llegar' },
      data: {
        estado: 'cancelado',
        canceladoEn: ahora,
        canceladoPorId: usuario.id,
        motivoCancelacion: motivo,
      },
    });
    if (count === 0) {
      await detalle(tx, id);
      throw otroEstado('Solo se puede cancelar un pedido que todavía no llegó.');
    }
    return detalle(tx, id);
  });
}

/**
 * Pago de la entrega entera: un movimiento de caja `pago_proveedor` atado al
 * pedido, con las reglas de turno de la caja. El índice único de `pedidoId`
 * hace que dos pagos simultáneos registren uno.
 */
async function registrarPago(
  tx: Tx,
  pedido: { id: string; numero: number; proveedor: string },
  monto: string,
  cuenta: Cuenta,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<void> {
  const turno = await turnoParaMovimiento(tx, usuario, cuenta);
  try {
    await tx.movimientoCaja.create({
      data: {
        turnoId: turno?.id ?? null,
        tipo: 'pago_proveedor',
        cuenta,
        monto,
        motivo: `Pedido #${pedido.numero} - ${pedido.proveedor}`,
        usuarioId: usuario.id,
        pedidoId: pedido.id,
        creadoEn: ahora,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw otroEstado(`El pedido #${pedido.numero} ya está pagado.`);
    }
    throw error;
  }
}

/**
 * Cierra el pedido si ya está cargado y pagado. Si lo cerró un empleado, deja
 * el aviso para el admin en la misma transacción.
 */
async function cerrarSiCorresponde(
  tx: Tx,
  id: string,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<void> {
  const pedido = await tx.pedido.findUniqueOrThrow({ where: { id }, include: incluirDetalle });
  if (pedido.estado !== 'cargado' || !pedido.pago || pedido.cerradoEn) return;
  await tx.pedido.update({ where: { id }, data: { cerradoEn: ahora } });
  if (usuario.rol === 'admin') return;
  await tx.notificacion.create({
    data: {
      tipo: 'pedido_cerrado',
      destino: 'admin',
      texto: textoAvisoPedidoCerrado(aDetalle(pedido), ahora),
      creadaEn: ahora,
    },
  });
}

export async function registrarLlegada(
  prisma: PrismaClient,
  id: string,
  { total, notaRecepcion, cuenta }: z.output<typeof llegadaPedidoSchema>,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<PedidoDetalle> {
  return prisma.$transaction(
    async (tx) => {
      const { count } = await tx.pedido.updateMany({
        where: { id, estado: 'por_llegar' },
        data: { estado: 'llego', total, notaRecepcion, llegoEn: ahora, recibidoPorId: usuario.id },
      });
      if (count === 0) {
        await detalle(tx, id);
        throw otroEstado('Este pedido ya llegó o está cancelado.');
      }
      if (cuenta) {
        const pedido = await tx.pedido.findUniqueOrThrow({
          where: { id },
          include: { proveedor: { select: { nombre: true } } },
        });
        await registrarPago(
          tx,
          { id, numero: pedido.numero, proveedor: pedido.proveedor.nombre },
          total,
          cuenta,
          usuario,
          ahora,
        );
      }
      return detalle(tx, id);
    },
    { timeout: 30_000 },
  );
}

export async function recibirSinPedido(
  prisma: PrismaClient,
  { proveedorId, total, nota, cuenta }: z.output<typeof recepcionSinPedidoSchema>,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<PedidoDetalle> {
  return prisma.$transaction(
    async (tx) => {
      await proveedorActivo(tx, proveedorId);
      const pedido = await tx.pedido.create({
        data: {
          proveedorId,
          totalPedido: total,
          llegaEl: new Date(`${fechaEnArgentina(ahora)}T00:00:00Z`),
          nota,
          creadoPorId: usuario.id,
          creadoEn: ahora,
          estado: 'llego',
          total,
          llegoEn: ahora,
          recibidoPorId: usuario.id,
        },
        include: { proveedor: { select: { nombre: true } } },
      });
      if (cuenta) {
        await registrarPago(
          tx,
          { id: pedido.id, numero: pedido.numero, proveedor: pedido.proveedor.nombre },
          total,
          cuenta,
          usuario,
          ahora,
        );
      }
      return detalle(tx, pedido.id);
    },
    { timeout: 30_000 },
  );
}

export async function cargarMercaderia(
  prisma: PrismaClient,
  id: string,
  datos: z.output<typeof ingresoMercaderiaSchema>,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<PedidoDetalle> {
  return prisma.$transaction(
    async (tx) => {
      const pedido = await tx.pedido.findUnique({ where: { id } });
      if (!pedido) throw noEncontrado();
      const { count } = await tx.pedido.updateMany({
        where: { id, estado: 'llego' },
        data: { estado: 'cargado' },
      });
      if (count === 0) {
        throw otroEstado(
          pedido.estado === 'cargado'
            ? 'La mercadería de este pedido ya está cargada.'
            : 'Primero marcá que el pedido llegó.',
        );
      }
      await registrarIngreso(tx, datos, pedido, usuario);
      await cerrarSiCorresponde(tx, id, usuario, ahora);
      return detalle(tx, id);
    },
    { timeout: 30_000 },
  );
}

export async function pagarPedido(
  prisma: PrismaClient,
  id: string,
  { cuenta, total }: z.output<typeof pagoPedidoSchema>,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<PedidoDetalle> {
  return prisma.$transaction(
    async (tx) => {
      const pedido = await tx.pedido.findUnique({
        where: { id },
        include: { proveedor: { select: { nombre: true } }, pago: { select: { id: true } } },
      });
      if (!pedido) throw noEncontrado();
      if (pedido.estado === 'por_llegar' || pedido.estado === 'cancelado') {
        throw otroEstado('Solo se paga un pedido que ya llegó.');
      }
      if (pedido.pago) throw otroEstado(`El pedido #${pedido.numero} ya está pagado.`);
      const monto = total ?? pedido.total!.toFixed(2);
      if (total) await tx.pedido.update({ where: { id }, data: { total } });
      await registrarPago(
        tx,
        { id, numero: pedido.numero, proveedor: pedido.proveedor.nombre },
        monto,
        cuenta,
        usuario,
        ahora,
      );
      await cerrarSiCorresponde(tx, id, usuario, ahora);
      return detalle(tx, id);
    },
    { timeout: 30_000 },
  );
}

/**
 * Búsqueda para cargar un pedido, como la de productos (código exacto primero,
 * después por nombre), pero con el costo también para el empleado.
 */
export async function productosParaCarga(
  prisma: PrismaClient,
  q: string,
): Promise<ProductoCarga[]> {
  const seleccion = { id: true, codigoBarras: true, nombre: true, costo: true } as const;
  const formatear = (p: {
    id: string;
    codigoBarras: string | null;
    nombre: string;
    costo: Prisma.Decimal | null;
  }) => ({
    ...p,
    costo: p.costo?.toFixed(2) ?? null,
  });
  const texto = q.trim();
  if (texto === '') return [];
  const porCodigo = await prisma.producto.findFirst({
    where: { codigoBarras: texto, activo: true },
    select: seleccion,
  });
  if (porCodigo) return [formatear(porCodigo)];
  const productos = await prisma.producto.findMany({
    where: { activo: true, nombreBusqueda: { contains: normalizarParaBusqueda(texto) } },
    select: seleccion,
    orderBy: [{ nombreBusqueda: 'asc' }, { id: 'asc' }],
    take: 20,
  });
  return productos.map(formatear);
}
