import {
  CODIGOS_ERROR,
  normalizarParaBusqueda,
  PRODUCTOS_POR_PAGINA,
  type altaProductoSchema,
  type aumentoMasivoSchema,
  type busquedaProductosSchema,
  type CambioPrecio,
  type edicionProductoSchema,
  type ProductoAdmin,
  type ProductoVenta,
  type ResultadoAumento,
  type Rol,
  type VistaPreviaAumento,
} from '@kiosco/shared';
import type { z } from 'zod';
import { ErrorHttp } from '../../errores.js';
import { Prisma, type PrismaClient, type Producto } from '../../generated/prisma/client.js';

type Decimal = Prisma.Decimal;
type Tx = Prisma.TransactionClient;
type ProductoConProveedor = Producto & { proveedor: { id: string; nombre: string } | null };

const conProveedor = { proveedor: { select: { id: true, nombre: true } } } as const;

function monto(valor: Decimal): string {
  return valor.toFixed(2);
}

function montoONulo(valor: Decimal | null): string | null {
  return valor === null ? null : monto(valor);
}

export function aVenta(p: Producto): ProductoVenta {
  return {
    id: p.id,
    codigoBarras: p.codigoBarras,
    nombre: p.nombre,
    precio: monto(p.precio),
    stockActual: p.stockActual,
  };
}

export function aAdmin(p: ProductoConProveedor): ProductoAdmin {
  return {
    ...aVenta(p),
    costo: montoONulo(p.costo),
    proveedor: p.proveedor,
    stockMinimo: p.stockMinimo,
    stockMaximo: p.stockMaximo,
    activo: p.activo,
  };
}

const noEncontrado = () => new ErrorHttp(404, CODIGOS_ERROR.noEncontrado, 'El producto no existe.');

const minMaxInvalido = () =>
  new ErrorHttp(400, CODIGOS_ERROR.validacion, 'El stock máximo no puede ser menor que el mínimo.');

/** El código de barras no puede repetirse, ni siquiera con productos desactivados. */
async function verificarCodigoLibre(tx: Tx, codigo: string | null, propioId?: string) {
  if (codigo === null) return;
  const otro = await tx.producto.findUnique({
    where: { codigoBarras: codigo },
    select: { id: true, nombre: true },
  });
  if (otro && otro.id !== propioId) {
    throw new ErrorHttp(
      409,
      CODIGOS_ERROR.codigoExistente,
      `El código ${codigo} ya lo usa el producto "${otro.nombre}".`,
    );
  }
}

/** Solo se puede asignar un proveedor existente y activo. */
async function verificarProveedorActivo(tx: Tx, proveedorId: string | null) {
  if (proveedorId === null) return;
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

/** Por si dos altas con el mismo código pasan la verificación a la vez. */
function traducirCodigoRepetido(error: unknown, codigo: string | null): never {
  if ((error as { code?: string }).code === 'P2002') {
    throw new ErrorHttp(409, CODIGOS_ERROR.codigoExistente, `El código ${codigo} ya existe.`);
  }
  throw error;
}

export async function crearProducto(
  prisma: PrismaClient,
  datos: z.output<typeof altaProductoSchema>,
): Promise<ProductoAdmin> {
  try {
    return await prisma.$transaction(async (tx) => {
      await verificarCodigoLibre(tx, datos.codigoBarras);
      await verificarProveedorActivo(tx, datos.proveedorId);
      const creado = await tx.producto.create({
        data: { ...datos, nombreBusqueda: normalizarParaBusqueda(datos.nombre) },
        include: conProveedor,
      });
      return aAdmin(creado);
    });
  } catch (error) {
    traducirCodigoRepetido(error, datos.codigoBarras);
  }
}

export async function obtenerProducto(prisma: PrismaClient, id: string): Promise<ProductoAdmin> {
  const producto = await prisma.producto.findUnique({ where: { id }, include: conProveedor });
  if (!producto) throw noEncontrado();
  return aAdmin(producto);
}

function mismoCosto(a: Decimal | null, b: Decimal | null): boolean {
  return a === null || b === null ? a === b : a.equals(b);
}

/**
 * Edita todo salvo el stock actual. Si cambian el precio o el costo, deja un
 * registro manual en el historial dentro de la misma transacción.
 */
export async function editarProducto(
  prisma: PrismaClient,
  id: string,
  cambios: z.output<typeof edicionProductoSchema>,
  usuarioId: string,
): Promise<ProductoAdmin> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const actual = await tx.producto.findUnique({ where: { id } });
        if (!actual) throw noEncontrado();

        if (
          (cambios.stockMaximo ?? actual.stockMaximo) < (cambios.stockMinimo ?? actual.stockMinimo)
        ) {
          throw minMaxInvalido();
        }
        if (cambios.codigoBarras !== undefined) {
          await verificarCodigoLibre(tx, cambios.codigoBarras, id);
        }
        // Un producto puede conservar un proveedor ya desactivado, pero no se le asigna uno nuevo.
        if (cambios.proveedorId !== undefined && cambios.proveedorId !== actual.proveedorId) {
          await verificarProveedorActivo(tx, cambios.proveedorId);
        }

        const precioNuevo =
          cambios.precio === undefined ? actual.precio : new Prisma.Decimal(cambios.precio);
        const costoNuevo =
          cambios.costo === undefined
            ? actual.costo
            : cambios.costo === null
              ? null
              : new Prisma.Decimal(cambios.costo);

        const editado = await tx.producto.update({
          where: { id },
          data: {
            ...cambios,
            ...(cambios.nombre === undefined
              ? {}
              : { nombreBusqueda: normalizarParaBusqueda(cambios.nombre) }),
          },
          include: conProveedor,
        });

        if (!precioNuevo.equals(actual.precio) || !mismoCosto(costoNuevo, actual.costo)) {
          await tx.cambioPrecio.create({
            data: {
              productoId: id,
              usuarioId,
              precioAnterior: actual.precio,
              precioNuevo,
              costoAnterior: actual.costo,
              costoNuevo,
              origen: 'manual',
            },
          });
        }
        return aAdmin(editado);
      },
      { isolationLevel: 'Serializable' },
    );
  } catch (error) {
    traducirCodigoRepetido(error, cambios.codigoBarras ?? null);
  }
}

/**
 * Búsqueda del mostrador y del admin. Si `q` es exactamente un código de
 * barras, devuelve solo ese producto (lo que manda el lector); si no, busca por
 * parte del nombre sin mayúsculas ni acentos, de a 50.
 */
export async function buscarProductos(
  prisma: PrismaClient,
  { q, pagina, incluirInactivos }: z.output<typeof busquedaProductosSchema>,
  rol: Rol,
): Promise<ProductoAdmin[] | ProductoVenta[]> {
  const soloActivos = rol !== 'admin' || !incluirInactivos;
  const filtroActivo = soloActivos ? { activo: true } : {};
  const formatear = (productos: ProductoConProveedor[]) =>
    rol === 'admin' ? productos.map(aAdmin) : productos.map(aVenta);

  if (q !== '' && pagina === 1) {
    const porCodigo = await prisma.producto.findFirst({
      where: { codigoBarras: q, ...filtroActivo },
      include: conProveedor,
    });
    if (porCodigo) return formatear([porCodigo]);
  }

  const nombre = normalizarParaBusqueda(q);
  const productos = await prisma.producto.findMany({
    where: { ...filtroActivo, ...(nombre === '' ? {} : { nombreBusqueda: { contains: nombre } }) },
    include: conProveedor,
    orderBy: [{ nombreBusqueda: 'asc' }, { id: 'asc' }],
    skip: (pagina - 1) * PRODUCTOS_POR_PAGINA,
    take: PRODUCTOS_POR_PAGINA,
  });
  return formatear(productos);
}

export async function historialDePrecios(
  prisma: PrismaClient,
  productoId: string,
): Promise<CambioPrecio[]> {
  const existe = await prisma.producto.findUnique({
    where: { id: productoId },
    select: { id: true },
  });
  if (!existe) throw noEncontrado();
  const cambios = await prisma.cambioPrecio.findMany({
    where: { productoId },
    include: { usuario: { select: { id: true, nombre: true } } },
    orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
  });
  return cambios.map((c) => ({
    id: c.id,
    precioAnterior: monto(c.precioAnterior),
    precioNuevo: monto(c.precioNuevo),
    costoAnterior: montoONulo(c.costoAnterior),
    costoNuevo: montoONulo(c.costoNuevo),
    origen: c.origen,
    creadoEn: c.creadoEn.toISOString(),
    usuario: c.usuario,
  }));
}

/** Precio con el porcentaje aplicado, redondeado hacia arriba al múltiplo y nunca menor que él. */
export function calcularPrecioAumentado(
  precio: Decimal,
  porcentaje: number,
  redondeo: number,
): Decimal {
  const paso = new Prisma.Decimal(redondeo);
  const bruto = precio.mul(new Prisma.Decimal(100).plus(porcentaje)).div(100);
  const redondeado = bruto.div(paso).ceil().mul(paso);
  return Prisma.Decimal.max(redondeado, paso);
}

/** Costo con el porcentaje aplicado, sin redondeo comercial: dos decimales, mitad hacia arriba. */
export function calcularCostoAumentado(costo: Decimal, porcentaje: number): Decimal {
  return costo
    .mul(new Prisma.Decimal(100).plus(porcentaje))
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

interface ItemAumento {
  producto: Producto;
  precioNuevo: Decimal;
  costoNuevo: Decimal | null;
}

/** Productos afectados y sus valores nuevos; omite los que quedan igual. */
async function calcularAumento(
  tx: Tx | PrismaClient,
  { proveedorId, porcentaje, redondeo, incluirCosto }: z.output<typeof aumentoMasivoSchema>,
): Promise<ItemAumento[]> {
  const productos = await tx.producto.findMany({
    where: { activo: true, ...(proveedorId === null ? {} : { proveedorId }) },
    orderBy: [{ nombreBusqueda: 'asc' }, { id: 'asc' }],
  });
  return productos
    .map((producto) => ({
      producto,
      precioNuevo: calcularPrecioAumentado(producto.precio, porcentaje, redondeo),
      costoNuevo:
        incluirCosto && producto.costo !== null
          ? calcularCostoAumentado(producto.costo, porcentaje)
          : producto.costo,
    }))
    .filter(
      ({ producto, precioNuevo, costoNuevo }) =>
        !precioNuevo.equals(producto.precio) || !mismoCosto(costoNuevo, producto.costo),
    );
}

export async function vistaPreviaAumento(
  prisma: PrismaClient,
  datos: z.output<typeof aumentoMasivoSchema>,
): Promise<VistaPreviaAumento> {
  const items = await calcularAumento(prisma, datos);
  return items.map(({ producto, precioNuevo, costoNuevo }) => ({
    id: producto.id,
    nombre: producto.nombre,
    precioActual: monto(producto.precio),
    precioNuevo: monto(precioNuevo),
    costoActual: montoONulo(producto.costo),
    costoNuevo: montoONulo(costoNuevo),
  }));
}

/**
 * Aplica el aumento todo junto o nada. Recalcula dentro de la transacción en
 * vez de confiar en la vista previa, por si algún precio cambió en el medio.
 */
export async function aplicarAumento(
  prisma: PrismaClient,
  datos: z.output<typeof aumentoMasivoSchema>,
  usuarioId: string,
): Promise<ResultadoAumento> {
  return prisma.$transaction(
    async (tx) => {
      const items = await calcularAumento(tx, datos);
      for (const { producto, precioNuevo, costoNuevo } of items) {
        await tx.producto.update({
          where: { id: producto.id },
          data: { precio: precioNuevo, costo: costoNuevo },
        });
      }
      await tx.cambioPrecio.createMany({
        data: items.map(({ producto, precioNuevo, costoNuevo }) => ({
          productoId: producto.id,
          usuarioId,
          precioAnterior: producto.precio,
          precioNuevo,
          costoAnterior: producto.costo,
          costoNuevo,
          origen: 'aumento_masivo' as const,
        })),
      });
      return { actualizados: items.length };
    },
    { isolationLevel: 'Serializable', timeout: 30_000 },
  );
}
