import {
  CODIGOS_ERROR,
  INGRESOS_POR_PAGINA,
  MOVIMIENTOS_POR_PAGINA,
  type ajusteStockSchema,
  type conteoStockSchema,
  type IngresoDetalle,
  type IngresoListado,
  type ingresoMercaderiaSchema,
  type MovimientoStock,
  type ResultadoConteo,
  type ResultadoVentasSinSistema,
  type UsuarioSesion,
  type ventasSinSistemaSchema,
} from '@kiosco/shared';
import type { z } from 'zod';
import { ErrorHttp } from '../../errores.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { productoNoEncontrado, registrarMovimiento } from './movimientos.js';

const conUsuario = { usuario: { select: { id: true, nombre: true } } } as const;

type MovimientoConUsuario = Prisma.MovimientoStockGetPayload<{ include: typeof conUsuario }>;

function aMovimiento(m: MovimientoConUsuario): MovimientoStock {
  return {
    id: m.id,
    tipo: m.tipo,
    motivo: m.motivo,
    cantidad: m.cantidad,
    stockResultante: m.stockResultante,
    nota: m.nota,
    ingresoId: m.ingresoId,
    creadoEn: m.creadoEn.toISOString(),
    usuario: m.usuario,
  };
}

/** Suma las cantidades de los productos repetidos, conservando el orden de aparición. */
function agruparPorProducto<T extends { productoId: string; cantidad: number }>(
  items: T[],
  combinar: (anterior: T, nuevo: T) => T = (anterior, nuevo) => ({
    ...anterior,
    cantidad: anterior.cantidad + nuevo.cantidad,
  }),
): T[] {
  const porProducto = new Map<string, T>();
  for (const item of items) {
    const anterior = porProducto.get(item.productoId);
    porProducto.set(item.productoId, anterior ? combinar(anterior, item) : item);
  }
  return [...porProducto.values()];
}

export async function registrarAjuste(
  prisma: PrismaClient,
  { productoId, cantidad, motivo, nota }: z.output<typeof ajusteStockSchema>,
  usuarioId: string,
): Promise<MovimientoStock> {
  const movimiento = await prisma.$transaction((tx) =>
    registrarMovimiento(tx, { productoId, tipo: 'ajuste', cantidad, motivo, nota, usuarioId }),
  );
  return aMovimiento(
    await prisma.movimientoStock.findUniqueOrThrow({
      where: { id: movimiento.id },
      include: conUsuario,
    }),
  );
}

/**
 * Registra un ajuste por la diferencia entre lo contado y el stock actual.
 * Acá se lee antes de escribir, así que la fila se bloquea explícitamente.
 */
export async function registrarConteo(
  prisma: PrismaClient,
  { productoId, cantidadContada }: z.output<typeof conteoStockSchema>,
  usuarioId: string,
): Promise<ResultadoConteo> {
  return prisma.$transaction(async (tx) => {
    const [producto] = await tx.$queryRaw<{ stock_actual: number; activo: boolean }[]>`
      SELECT stock_actual, activo FROM productos WHERE id = ${productoId}::uuid FOR UPDATE`;
    if (!producto?.activo) throw productoNoEncontrado();

    const diferencia = cantidadContada - producto.stock_actual;
    if (diferencia === 0) return { diferencia, stockActual: producto.stock_actual };
    const movimiento = await registrarMovimiento(tx, {
      productoId,
      tipo: 'ajuste',
      motivo: 'conteo',
      cantidad: diferencia,
      usuarioId,
    });
    return { diferencia, stockActual: movimiento.stockResultante };
  });
}

/** Descuenta lo vendido durante un corte, todo junto o nada. */
export async function registrarVentasSinSistema(
  prisma: PrismaClient,
  { items, nota }: z.output<typeof ventasSinSistemaSchema>,
  usuarioId: string,
): Promise<ResultadoVentasSinSistema> {
  const agrupados = agruparPorProducto(items);
  await prisma.$transaction(
    async (tx) => {
      for (const { productoId, cantidad } of agrupados) {
        await registrarMovimiento(tx, {
          productoId,
          tipo: 'ajuste',
          motivo: 'venta_sin_sistema',
          cantidad: -cantidad,
          nota,
          usuarioId,
        });
      }
    },
    { timeout: 30_000 },
  );
  return { productos: agrupados.length };
}

export async function movimientosDeProducto(
  prisma: PrismaClient,
  productoId: string,
  pagina: number,
): Promise<MovimientoStock[]> {
  const existe = await prisma.producto.findUnique({
    where: { id: productoId },
    select: { id: true },
  });
  if (!existe) {
    throw new ErrorHttp(404, CODIGOS_ERROR.productoNoEncontrado, 'El producto no existe.');
  }
  const movimientos = await prisma.movimientoStock.findMany({
    where: { productoId },
    include: conUsuario,
    orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
    skip: (pagina - 1) * MOVIMIENTOS_POR_PAGINA,
    take: MOVIMIENTOS_POR_PAGINA,
  });
  return movimientos.map(aMovimiento);
}

const incluirListado = {
  proveedor: { select: { id: true, nombre: true } },
  usuario: { select: { id: true, nombre: true } },
  _count: { select: { items: true } },
} as const;

type IngresoConDatos = Prisma.IngresoMercaderiaGetPayload<{ include: typeof incluirListado }>;

function aIngresoListado(i: IngresoConDatos): IngresoListado {
  return {
    id: i.id,
    creadoEn: i.creadoEn.toISOString(),
    proveedor: i.proveedor,
    usuario: i.usuario,
    nota: i.nota,
    cantidadProductos: i._count.items,
  };
}

/**
 * Registra la mercadería recibida: el ingreso, sus ítems y un movimiento
 * `compra` por producto, todo en una transacción. Si el admin cargó un costo
 * distinto del actual, actualiza el costo y lo deja en el historial de precios.
 */
export async function registrarIngreso(
  prisma: PrismaClient,
  datos: z.output<typeof ingresoMercaderiaSchema>,
  usuario: UsuarioSesion,
): Promise<IngresoListado> {
  const conCosto = datos.items.some((i) => i.costoUnitario != null);
  if (conCosto && usuario.rol !== 'admin') {
    throw new ErrorHttp(
      400,
      CODIGOS_ERROR.costoNoPermitido,
      'Solo el admin puede cargar costos en un ingreso.',
    );
  }
  // Si el mismo producto trae costos distintos, gana el último cargado.
  const items = agruparPorProducto(datos.items, (anterior, nuevo) => ({
    ...anterior,
    cantidad: anterior.cantidad + nuevo.cantidad,
    costoUnitario: nuevo.costoUnitario ?? anterior.costoUnitario,
  }));

  const id = await prisma.$transaction(
    async (tx) => {
      if (datos.proveedorId !== null) {
        const proveedor = await tx.proveedor.findUnique({
          where: { id: datos.proveedorId },
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

      const ingreso = await tx.ingresoMercaderia.create({
        data: {
          proveedorId: datos.proveedorId,
          nota: datos.nota,
          usuarioId: usuario.id,
          items: {
            create: items.map((i) => ({
              productoId: i.productoId,
              cantidad: i.cantidad,
              costoUnitario: i.costoUnitario ?? null,
            })),
          },
        },
      });

      for (const item of items) {
        await registrarMovimiento(tx, {
          productoId: item.productoId,
          tipo: 'compra',
          cantidad: item.cantidad,
          usuarioId: usuario.id,
          ingresoId: ingreso.id,
        });
        if (item.costoUnitario == null) continue;

        const producto = await tx.producto.findUniqueOrThrow({
          where: { id: item.productoId },
          select: { precio: true, costo: true },
        });
        const costoNuevo = new Prisma.Decimal(item.costoUnitario);
        if (producto.costo !== null && producto.costo.equals(costoNuevo)) continue;
        await tx.producto.update({ where: { id: item.productoId }, data: { costo: costoNuevo } });
        await tx.cambioPrecio.create({
          data: {
            productoId: item.productoId,
            usuarioId: usuario.id,
            precioAnterior: producto.precio,
            precioNuevo: producto.precio,
            costoAnterior: producto.costo,
            costoNuevo,
            origen: 'manual',
          },
        });
      }
      return ingreso.id;
    },
    { timeout: 30_000 },
  );

  return aIngresoListado(
    await prisma.ingresoMercaderia.findUniqueOrThrow({ where: { id }, include: incluirListado }),
  );
}

export async function listarIngresos(
  prisma: PrismaClient,
  pagina: number,
): Promise<IngresoListado[]> {
  const ingresos = await prisma.ingresoMercaderia.findMany({
    include: incluirListado,
    orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
    skip: (pagina - 1) * INGRESOS_POR_PAGINA,
    take: INGRESOS_POR_PAGINA,
  });
  return ingresos.map(aIngresoListado);
}

export async function obtenerIngreso(prisma: PrismaClient, id: string): Promise<IngresoDetalle> {
  const ingreso = await prisma.ingresoMercaderia.findUnique({
    where: { id },
    include: {
      ...incluirListado,
      items: {
        include: { producto: { select: { id: true, nombre: true, codigoBarras: true } } },
        orderBy: { id: 'asc' },
      },
    },
  });
  if (!ingreso) {
    throw new ErrorHttp(404, CODIGOS_ERROR.noEncontrado, 'El ingreso no existe.');
  }
  return {
    ...aIngresoListado(ingreso),
    items: ingreso.items.map((i) => ({
      producto: i.producto,
      cantidad: i.cantidad,
      costoUnitario: i.costoUnitario?.toFixed(2) ?? null,
    })),
  };
}

/** Proveedores activos para elegir en el ingreso (admin y empleado): solo id y nombre. */
export function opcionesDeProveedor(prisma: PrismaClient) {
  return prisma.proveedor.findMany({
    where: { activo: true },
    select: { id: true, nombre: true },
    orderBy: { nombre: 'asc' },
  });
}
