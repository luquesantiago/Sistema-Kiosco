import {
  calcularVuelto,
  CODIGOS_ERROR,
  multiplicar,
  sonIguales,
  sumar,
  VENTAS_POR_PAGINA,
  type anulacionSchema,
  type listadoVentasQuerySchema,
  type PreciosActuales,
  type UsuarioSesion,
  type VentaDetalle,
  type ventaEntradaSchema,
  type VentaResumen,
} from '@kiosco/shared';
import type { z } from 'zod';
import { ErrorHttp } from '../../errores.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { fechaEnArgentina, rangoDelDiaEnArgentina } from '../../lib/fechas.js';
import { turnoAbiertoBloqueado, turnoParaOperar } from '../caja/servicio.js';
import { registrarMovimiento } from '../stock/movimientos.js';
import { textoAvisoAnulacion } from './aviso.js';

const incluirResumen = {
  usuario: { select: { id: true, nombre: true } },
  pagos: { select: { medio: true }, orderBy: { medio: 'asc' } },
} as const;

const incluirDetalle = {
  usuario: { select: { id: true, nombre: true } },
  anuladaPor: { select: { id: true, nombre: true } },
  items: { orderBy: { id: 'asc' } },
  pagos: { orderBy: { medio: 'asc' } },
} as const;

type VentaConResumen = Prisma.VentaGetPayload<{ include: typeof incluirResumen }>;
type VentaConDetalle = Prisma.VentaGetPayload<{ include: typeof incluirDetalle }>;

function aResumen(v: VentaConResumen | VentaConDetalle): VentaResumen {
  return {
    id: v.id,
    numero: v.numero,
    creadaEn: v.creadaEn.toISOString(),
    usuario: v.usuario,
    total: v.total.toFixed(2),
    estado: v.estado,
    medios: v.pagos.map((p) => p.medio),
  };
}

function aDetalle(v: VentaConDetalle): VentaDetalle {
  return {
    ...aResumen(v),
    items: v.items.map((i) => ({
      productoId: i.productoId,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precioUnitario: i.precioUnitario.toFixed(2),
      subtotal: i.subtotal.toFixed(2),
    })),
    pagos: v.pagos.map((p) => ({
      medio: p.medio,
      monto: p.monto.toFixed(2),
      montoRecibido: p.montoRecibido?.toFixed(2) ?? null,
      vuelto: p.vuelto?.toFixed(2) ?? null,
    })),
    anulacion:
      v.anuladaEn && v.anuladaPor && v.motivoAnulacion
        ? { en: v.anuladaEn.toISOString(), por: v.anuladaPor, motivo: v.motivoAnulacion }
        : null,
  };
}

type Item = z.output<typeof ventaEntradaSchema>['items'][number];
type ItemCatalogo = Extract<Item, { productoId: string }>;

/**
 * Registra una venta en el turno abierto con precios del catálogo, sus pagos y
 * un movimiento `venta` por producto, todo en una transacción. El mostrador no
 * fija precios: `totalEsperado` solo detecta que el empleado vio otro precio.
 */
export async function registrarVenta(
  prisma: PrismaClient,
  { items, pagos, totalEsperado }: z.output<typeof ventaEntradaSchema>,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<VentaDetalle> {
  const usuarioId = usuario.id;
  // Agrupa los productos repetidos en la posición de su primera aparición.
  const agrupados: Item[] = [];
  const porProducto = new Map<string, ItemCatalogo>();
  for (const item of items) {
    if (!('productoId' in item)) {
      agrupados.push(item);
      continue;
    }
    const existente = porProducto.get(item.productoId);
    if (existente) {
      existente.cantidad += item.cantidad;
    } else {
      const copia = { ...item };
      porProducto.set(item.productoId, copia);
      agrupados.push(copia);
    }
  }

  const id = await prisma.$transaction(
    async (tx) => {
      const turno = await turnoParaOperar(tx, usuario);
      const productos = await tx.producto.findMany({
        where: { id: { in: [...porProducto.keys()] } },
        select: { id: true, nombre: true, precio: true, activo: true },
      });
      const productoPorId = new Map(productos.map((p) => [p.id, p]));
      for (const productoId of porProducto.keys()) {
        const p = productoPorId.get(productoId);
        if (!p?.activo) {
          throw new ErrorHttp(
            409,
            CODIGOS_ERROR.productoNoDisponible,
            p
              ? `"${p.nombre}" ya no está a la venta. Quitalo del carrito.`
              : 'Un producto del carrito ya no existe. Quitalo del carrito.',
            { productoId },
          );
        }
      }

      const itemsData = agrupados.map((item) => {
        const { productoId, descripcion, precioUnitario } =
          'productoId' in item
            ? {
                productoId: item.productoId,
                descripcion: productoPorId.get(item.productoId)!.nombre,
                precioUnitario: productoPorId.get(item.productoId)!.precio.toFixed(2),
              }
            : { productoId: null, ...item.varios, precioUnitario: item.varios.precio };
        return {
          productoId,
          descripcion,
          cantidad: item.cantidad,
          precioUnitario,
          subtotal: multiplicar(precioUnitario, item.cantidad),
        };
      });
      const total = sumar(...itemsData.map((i) => i.subtotal));
      if (!sonIguales(total, totalEsperado)) {
        const precios: PreciosActuales = productos.map((p) => ({
          productoId: p.id,
          precio: p.precio.toFixed(2),
        }));
        throw new ErrorHttp(
          409,
          CODIGOS_ERROR.preciosCambiaron,
          'Cambiaron precios mientras armabas la venta. Revisá el total y cobrá de nuevo.',
          precios,
        );
      }

      const venta = await tx.venta.create({
        data: {
          usuarioId,
          turnoId: turno.id,
          total,
          creadaEn: ahora,
          items: { create: itemsData },
          pagos: {
            create: pagos.map((p) => ({
              medio: p.medio,
              monto: p.monto,
              montoRecibido: p.montoRecibido ?? null,
              vuelto: p.montoRecibido == null ? null : calcularVuelto(p.monto, p.montoRecibido),
            })),
          },
        },
      });

      for (const { productoId, cantidad } of porProducto.values()) {
        await registrarMovimiento(tx, {
          productoId,
          tipo: 'venta',
          cantidad: -cantidad,
          usuarioId,
          ventaId: venta.id,
        });
      }
      return venta.id;
    },
    { timeout: 30_000 },
  );

  return aDetalle(await prisma.venta.findUniqueOrThrow({ where: { id }, include: incluirDetalle }));
}

const fueraDePlazo = (mensaje: string) => new ErrorHttp(403, CODIGOS_ERROR.fueraDePlazo, mensaje);

/** El empleado solo ve ventas del día en hora de Argentina; el admin, cualquiera. */
function esDeHoy(venta: { creadaEn: Date }, ahora: Date): boolean {
  return fechaEnArgentina(venta.creadaEn) === fechaEnArgentina(ahora);
}

export async function listarVentas(
  prisma: PrismaClient,
  { desde, hasta, pagina }: z.output<typeof listadoVentasQuerySchema>,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<VentaResumen[]> {
  const hoy = fechaEnArgentina(ahora);
  const inicio = desde ?? hasta ?? hoy;
  const fin = hasta ?? desde ?? hoy;
  if (usuario.rol !== 'admin' && (inicio !== hoy || fin !== hoy)) {
    throw fueraDePlazo('Solo podés ver las ventas de hoy.');
  }
  if (inicio > fin) {
    throw new ErrorHttp(400, CODIGOS_ERROR.validacion, 'La fecha "desde" es posterior a "hasta".');
  }

  const ventas = await prisma.venta.findMany({
    where: {
      creadaEn: {
        gte: rangoDelDiaEnArgentina(inicio).desde,
        lt: rangoDelDiaEnArgentina(fin).hasta,
      },
    },
    include: incluirResumen,
    orderBy: { numero: 'desc' },
    skip: (pagina - 1) * VENTAS_POR_PAGINA,
    take: VENTAS_POR_PAGINA,
  });
  return ventas.map(aResumen);
}

const ventaNoEncontrada = () =>
  new ErrorHttp(404, CODIGOS_ERROR.noEncontrado, 'La venta no existe.');

export async function obtenerVenta(
  prisma: PrismaClient,
  id: string,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<VentaDetalle> {
  const venta = await prisma.venta.findUnique({ where: { id }, include: incluirDetalle });
  if (!venta) throw ventaNoEncontrada();
  if (usuario.rol !== 'admin' && !esDeHoy(venta, ahora)) {
    throw fueraDePlazo('Solo podés ver las ventas de hoy.');
  }
  return aDetalle(venta);
}

/**
 * Anula una venta pagada: repone el stock con movimientos `anulacion` y deja
 * un aviso pendiente para el admin, todo en una transacción. El UPDATE
 * condicionado a `pagada` hace que dos anulaciones simultáneas repongan una vez.
 */
export async function anularVenta(
  prisma: PrismaClient,
  id: string,
  { motivo }: z.output<typeof anulacionSchema>,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<VentaDetalle> {
  await prisma.$transaction(
    async (tx) => {
      const venta = await tx.venta.findUnique({ where: { id }, include: { items: true } });
      if (!venta) throw ventaNoEncontrada();
      // La devolución en efectivo sale del turno abierto. El empleado solo
      // anula ventas de su turno; el admin, cualquiera, haya turno o no.
      const turno =
        usuario.rol === 'admin'
          ? await turnoAbiertoBloqueado(tx)
          : await turnoParaOperar(tx, usuario);
      if (usuario.rol !== 'admin' && venta.turnoId !== turno?.id) {
        throw fueraDePlazo('Solo podés anular ventas de tu turno. Pedile al admin que la anule.');
      }

      const { count } = await tx.venta.updateMany({
        where: { id, estado: 'pagada' },
        data: {
          estado: 'anulada',
          anuladaEn: ahora,
          anuladaPorId: usuario.id,
          motivoAnulacion: motivo,
          anulacionTurnoId: turno?.id ?? null,
        },
      });
      if (count === 0) {
        throw new ErrorHttp(
          409,
          CODIGOS_ERROR.ventaYaAnulada,
          `La venta #${venta.numero} ya estaba anulada.`,
        );
      }

      const vendidos = new Map<string, number>();
      for (const item of venta.items) {
        if (item.productoId === null) continue;
        vendidos.set(item.productoId, (vendidos.get(item.productoId) ?? 0) + item.cantidad);
      }
      for (const [productoId, cantidad] of vendidos) {
        await registrarMovimiento(tx, {
          productoId,
          tipo: 'anulacion',
          cantidad,
          usuarioId: usuario.id,
          ventaId: id,
          permitirDesactivado: true,
        });
      }

      await tx.notificacion.create({
        data: {
          tipo: 'anulacion_venta',
          destino: 'admin',
          texto: textoAvisoAnulacion({
            numero: venta.numero,
            total: venta.total.toFixed(2),
            items: venta.items.map((i) => ({
              descripcion: i.descripcion,
              cantidad: i.cantidad,
              subtotal: i.subtotal.toFixed(2),
            })),
            anuladaPor: usuario.nombre,
            motivo,
            anuladaEn: ahora,
          }),
          creadaEn: ahora,
        },
      });
    },
    { timeout: 30_000 },
  );

  return aDetalle(await prisma.venta.findUniqueOrThrow({ where: { id }, include: incluirDetalle }));
}
