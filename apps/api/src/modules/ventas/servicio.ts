import {
  calcularVuelto,
  CODIGOS_ERROR,
  comparar,
  formatearNumeroComprobante,
  multiplicar,
  restar,
  sonIguales,
  sumar,
  VENTAS_POR_PAGINA,
  type anulacionSchema,
  type CobroMp as CobroMpRespuesta,
  type listadoVentasQuerySchema,
  type PreciosActuales,
  type UsuarioSesion,
  type VentaDetalle,
  type ventaEntradaSchema,
  type VentaResumen,
} from '@kiosco/shared';
import type { z } from 'zod';
import type { ConfigPoint } from '../../config.js';
import { ErrorHttp } from '../../errores.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { ClienteMercadoPago, MedioPoint } from '../../integrations/mercadopago/cliente.js';
import { fechaEnArgentina, rangoDelDiaEnArgentina } from '../../lib/fechas.js';
import { turnoAbiertoBloqueado, turnoParaOperar } from '../caja/servicio.js';
import { encolarFacturaSiCorresponde, importePorParte } from '../facturacion/encolado.js';
import { aFacturaVenta, emisorDe } from '../facturacion/servicio.js';
import type { Facturacion } from '../facturacion/tipos.js';
import { registrarMovimiento } from '../stock/movimientos.js';
import { textoAvisoAnulacion } from './aviso.js';
import {
  aCobro,
  crearIntento,
  enviarCobro,
  ESPERA_VENTA_MS,
  MOTIVO_CANCELADA_EN_MOSTRADOR,
  pedirCancelacion,
  reintentarCobro,
  ultimoCobro,
} from './cobro.js';

const incluirResumen = {
  usuario: { select: { id: true, nombre: true } },
  pagos: { select: { medio: true }, orderBy: { medio: 'asc' } },
  facturas: { select: { estado: true, importe: true } },
} as const;

const incluirDetalle = {
  usuario: { select: { id: true, nombre: true } },
  anuladaPor: { select: { id: true, nombre: true } },
  items: { orderBy: { id: 'asc' } },
  pagos: { orderBy: { medio: 'asc' } },
  // La automática (`electronica`) primero: es el orden del enum.
  facturas: { orderBy: { parte: 'asc' } },
  // Solo el último intento de cobro con el Point.
  cobrosMp: { orderBy: { intento: 'desc' }, take: 1 },
} as const;

type VentaConResumen = Prisma.VentaGetPayload<{ include: typeof incluirResumen }>;
type VentaConDetalle = Prisma.VentaGetPayload<{ include: typeof incluirDetalle }>;

/** Suma de las facturas autorizadas. */
function importeFacturado(facturas: { estado: string; importe: { toFixed(n: number): string } }[]) {
  return sumar(
    '0',
    ...facturas.filter((f) => f.estado === 'autorizada').map((f) => f.importe.toFixed(2)),
  );
}

function aResumen(v: VentaConResumen | VentaConDetalle): VentaResumen {
  return {
    id: v.id,
    numero: v.numero,
    creadaEn: v.creadaEn.toISOString(),
    usuario: v.usuario,
    total: v.total.toFixed(2),
    estado: v.estado,
    medios: v.pagos.map((p) => p.medio),
    importeFacturado: importeFacturado(v.facturas),
  };
}

/** El costo de cada ítem va solo al admin: al empleado no le llega ni la clave. */
function aDetalle(
  v: VentaConDetalle,
  usuario: UsuarioSesion,
  facturacion: Facturacion | undefined,
): VentaDetalle {
  const conCostos = usuario.rol === 'admin';
  const { efectivo } = importePorParte(v.pagos);
  const resumen = aResumen(v);
  return {
    ...resumen,
    items: v.items.map((i) => ({
      productoId: i.productoId,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precioUnitario: i.precioUnitario.toFixed(2),
      ...(conCostos && { costoUnitario: i.costoUnitario?.toFixed(2) ?? null }),
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
    cancelacion:
      v.estado === 'cancelada' && v.canceladaEn
        ? { en: v.canceladaEn.toISOString(), motivo: v.motivoCancelacion ?? '' }
        : null,
    cobro: v.cobrosMp[0] ? aCobro(v.cobrosMp[0]) : null,
    facturas: v.facturas.map((f) => aFacturaVenta(f, facturacion)),
    sinFacturar: restar(resumen.total, resumen.importeFacturado),
    // Hay efectivo sin su factura: el cliente la puede pedir (F10 o desde Ventas).
    puedePedirFactura:
      facturacion !== undefined &&
      v.estado === 'pagada' &&
      comparar(efectivo, 0) > 0 &&
      !v.facturas.some((f) => f.parte === 'efectivo'),
    emisor: emisorDe(facturacion),
  };
}

type Item = z.output<typeof ventaEntradaSchema>['items'][number];
type ItemCatalogo = Extract<Item, { productoId: string }>;

/** El Point configurado y su cliente: sin esto, toda venta nace pagada como siempre. */
export interface CobroConPoint {
  point: ConfigPoint;
  mercadoPago: ClienteMercadoPago;
}

/**
 * Registra una venta en el turno abierto con precios del catálogo, sus pagos y
 * un movimiento `venta` por producto, todo en una transacción. El mostrador no
 * fija precios: `totalEsperado` solo detecta que el empleado vio otro precio.
 *
 * Con el Point configurado y una parte electrónica (como mucho una), la venta nace
 * `pendiente` con todos sus pagos y sin mover stock, junto con su primer cobro en
 * `creando`; el cobro se manda a MP después de la transacción (design "Registro de una
 * venta con el Point").
 */
export async function registrarVenta(
  prisma: PrismaClient,
  { items, pagos, totalEsperado }: z.output<typeof ventaEntradaSchema>,
  usuario: UsuarioSesion,
  ahora: Date,
  facturacion?: Facturacion,
  conPoint?: CobroConPoint,
): Promise<VentaDetalle> {
  const usuarioId = usuario.id;
  const electronicos = pagos.filter((p) => p.medio !== 'efectivo');
  const porElPoint = conPoint !== undefined && electronicos.length > 0;
  if (porElPoint && electronicos.length > 1) {
    throw new ErrorHttp(
      400,
      CODIGOS_ERROR.unSoloMedioElectronico,
      'Solo una parte se puede cobrar con el Point: el resto, en efectivo.',
    );
  }
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

  const { id, cobroId } = await prisma.$transaction(
    async (tx) => {
      const turno = await turnoParaOperar(tx, usuario);
      const productos = await tx.producto.findMany({
        where: { id: { in: [...porProducto.keys()] } },
        select: { id: true, nombre: true, precio: true, costo: true, activo: true },
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

      // El costo se copia fijo junto con el precio; "Varios" no tiene costo.
      const itemsData = agrupados.map((item) => {
        const { productoId, descripcion, precioUnitario, costoUnitario } =
          'productoId' in item
            ? {
                productoId: item.productoId,
                descripcion: productoPorId.get(item.productoId)!.nombre,
                precioUnitario: productoPorId.get(item.productoId)!.precio.toFixed(2),
                costoUnitario: productoPorId.get(item.productoId)!.costo,
              }
            : {
                productoId: null,
                ...item.varios,
                precioUnitario: item.varios.precio,
                costoUnitario: null,
              };
        return {
          productoId,
          descripcion,
          cantidad: item.cantidad,
          precioUnitario,
          costoUnitario,
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
          ...(porElPoint && {
            estado: 'pendiente',
            venceEn: new Date(ahora.getTime() + ESPERA_VENTA_MS),
          }),
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
        include: { pagos: true },
      });

      if (porElPoint) {
        // Sin stock ni factura hasta que MP apruebe el pago (`confirmarCobroAprobado`).
        const parte = electronicos[0]!;
        const cobro = await crearIntento(tx, {
          venta,
          intento: 1,
          medio: parte.medio as MedioPoint,
          monto: parte.monto,
          ahora,
        });
        return { id: venta.id, cobroId: cobro.id };
      }

      for (const { productoId, cantidad } of porProducto.values()) {
        await registrarMovimiento(tx, {
          productoId,
          tipo: 'venta',
          cantidad: -cantidad,
          usuarioId,
          ventaId: venta.id,
        });
      }

      // Enganche de la facturación: la venta nace `pagada`, así que su factura
      // automática se encola acá, en la misma transacción. No habla con ARCA.
      await encolarFacturaSiCorresponde(tx, venta, { facturacion, ahora });
      return { id: venta.id, cobroId: null };
    },
    { timeout: 30_000 },
  );

  // Fuera de la transacción: MP puede tardar hasta 10 s y el turno no queda bloqueado.
  if (conPoint && cobroId !== null) {
    await enviarCobro(
      { prisma, mercadoPago: conPoint.mercadoPago, facturacion, ahora: () => ahora },
      conPoint.point,
      cobroId,
    );
  }

  return aDetalle(
    await prisma.venta.findUniqueOrThrow({ where: { id }, include: incluirDetalle }),
    usuario,
    facturacion,
  );
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
  facturacion?: Facturacion,
): Promise<VentaDetalle> {
  const venta = await prisma.venta.findUnique({ where: { id }, include: incluirDetalle });
  if (!venta) throw ventaNoEncontrada();
  if (usuario.rol !== 'admin' && !esDeHoy(venta, ahora)) {
    throw fueraDePlazo('Solo podés ver las ventas de hoy.');
  }
  return aDetalle(venta, usuario, facturacion);
}

/**
 * Anula una venta pagada: repone el stock con movimientos `anulacion`, cancela
 * sus facturas sin emitir y deja un aviso pendiente para el admin, todo en una
 * transacción. El UPDATE condicionado a `pagada` hace que dos anulaciones
 * simultáneas repongan una vez. No hay notas de crédito: el aviso dice qué
 * facturas autorizadas siguen vigentes.
 */
export async function anularVenta(
  prisma: PrismaClient,
  id: string,
  { motivo }: z.output<typeof anulacionSchema>,
  usuario: UsuarioSesion,
  ahora: Date,
  facturacion?: Facturacion,
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
        // Una venta en espera o cancelada no se cobró: no hay nada que anular.
        throw new ErrorHttp(
          409,
          CODIGOS_ERROR.ventaYaAnulada,
          venta.estado === 'pendiente'
            ? `La venta #${venta.numero} está esperando el cobro: cancelala en lugar de anularla.`
            : venta.estado === 'cancelada'
              ? `La venta #${venta.numero} no se cobró: no hay nada que anular.`
              : `La venta #${venta.numero} ya estaba anulada.`,
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

      // Lo que no se emitió no se emite más. Una `en_curso` la resuelve la emisión.
      await tx.factura.updateMany({
        where: { ventaId: id, estado: { in: ['pendiente', 'error'] } },
        data: { estado: 'cancelada', proximoIntentoEn: null },
      });
      const vigentes = await tx.factura.findMany({
        where: { ventaId: id, estado: 'autorizada', numero: { not: null } },
        orderBy: { parte: 'asc' },
      });

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
            facturasVigentes: vigentes.map((f) => ({
              numero: formatearNumeroComprobante(f.puntoVenta, f.numero!),
              importe: f.importe.toFixed(2),
            })),
          }),
          creadaEn: ahora,
        },
      });
    },
    { timeout: 30_000 },
  );

  return aDetalle(
    await prisma.venta.findUniqueOrThrow({ where: { id }, include: incluirDetalle }),
    usuario,
    facturacion,
  );
}

// --- Ventas en espera de un cobro con el Point (cobro-mercado-pago) ---

const sinPoint = () =>
  new ErrorHttp(
    409,
    CODIGOS_ERROR.mpNoDisponible,
    'El cobro con el Point no está configurado en el servidor.',
  );

/**
 * El empleado opera solo las ventas en espera de su turno abierto; el admin, cualquiera.
 * Devuelve la venta (404 si no existe).
 */
async function ventaQuePuedeOperar(prisma: PrismaClient, id: string, usuario: UsuarioSesion) {
  const venta = await prisma.venta.findUnique({ where: { id } });
  if (!venta) throw ventaNoEncontrada();
  if (usuario.rol === 'admin') return venta;
  const turno = await prisma.turno.findFirst({ where: { cerradoEn: null } });
  if (!turno || turno.abiertoPorId !== usuario.id || venta.turnoId !== turno.id) {
    throw new ErrorHttp(
      403,
      CODIGOS_ERROR.sinPermiso,
      'Solo podés manejar los cobros de las ventas de tu turno. Pedíselo al admin.',
    );
  }
  return venta;
}

const noEnEspera = (numero: number) =>
  new ErrorHttp(
    409,
    CODIGOS_ERROR.ventaNoEnEspera,
    `La venta #${numero} no está esperando un cobro.`,
  );

/**
 * Cancela una venta en espera (`POST /api/ventas/:id/cancelar`, también "Cobrar de otra
 * forma"). Si MP todavía tiene que confirmar, la venta sigue en espera con la
 * cancelación pedida; si el pago ya se había procesado, queda pagada.
 */
export async function cancelarVenta(
  prisma: PrismaClient,
  id: string,
  usuario: UsuarioSesion,
  ahora: () => Date,
  { conPoint, facturacion }: { conPoint?: CobroConPoint; facturacion?: Facturacion },
): Promise<VentaDetalle> {
  const venta = await ventaQuePuedeOperar(prisma, id, usuario);
  if (venta.estado !== 'pendiente') throw noEnEspera(venta.numero);
  if (!conPoint) throw sinPoint();
  await pedirCancelacion(
    { prisma, mercadoPago: conPoint.mercadoPago, facturacion, ahora },
    id,
    MOTIVO_CANCELADA_EN_MOSTRADOR,
  );
  return aDetalle(
    await prisma.venta.findUniqueOrThrow({ where: { id }, include: incluirDetalle }),
    usuario,
    facturacion,
  );
}

/** Reintenta el cobro de una venta en espera (`POST /api/ventas/:id/cobro/reintentar`). */
export async function reintentarCobroDeVenta(
  prisma: PrismaClient,
  id: string,
  usuario: UsuarioSesion,
  ahora: () => Date,
  { conPoint, facturacion }: { conPoint?: CobroConPoint; facturacion?: Facturacion },
): Promise<CobroMpRespuesta> {
  const venta = await ventaQuePuedeOperar(prisma, id, usuario);
  if (venta.estado !== 'pendiente') throw noEnEspera(venta.numero);
  if (!conPoint) throw sinPoint();
  const cobro = await reintentarCobro(
    { prisma, mercadoPago: conPoint.mercadoPago, facturacion, ahora },
    conPoint.point,
    id,
  );
  return aCobro(cobro);
}

/** Estado del último cobro de una venta, solo de la base (el mostrador lo pide cada 1 s). */
export async function cobroDeVenta(
  prisma: PrismaClient,
  id: string,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<CobroMpRespuesta> {
  const venta = await prisma.venta.findUnique({ where: { id } });
  if (!venta) throw ventaNoEncontrada();
  if (usuario.rol !== 'admin' && !esDeHoy(venta, ahora)) {
    throw fueraDePlazo('Solo podés ver las ventas de hoy.');
  }
  const cobro = await ultimoCobro(prisma, id);
  if (!cobro) {
    throw new ErrorHttp(
      404,
      CODIGOS_ERROR.noEncontrado,
      'Esta venta no tiene un cobro con el Point.',
    );
  }
  return aCobro(cobro);
}

/**
 * La venta en espera del turno abierto, para retomar la pantalla de espera al recargar
 * (`GET /api/ventas/en-espera`), o null. El empleado solo ve la de su turno.
 */
export async function ventaEnEspera(
  prisma: PrismaClient,
  usuario: UsuarioSesion,
  facturacion?: Facturacion,
): Promise<VentaDetalle | null> {
  const turno = await prisma.turno.findFirst({ where: { cerradoEn: null } });
  if (!turno) return null;
  if (usuario.rol !== 'admin' && turno.abiertoPorId !== usuario.id) return null;
  const venta = await prisma.venta.findFirst({
    where: { turnoId: turno.id, estado: 'pendiente' },
    orderBy: { numero: 'desc' },
    include: incluirDetalle,
  });
  return venta ? aDetalle(venta, usuario, facturacion) : null;
}
