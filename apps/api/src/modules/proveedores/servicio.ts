import {
  altaProveedorSchema,
  CODIGOS_ERROR,
  type edicionProveedorSchema,
  type AltaProveedor,
  type ProveedorListado,
} from '@kiosco/shared';
import type { z } from 'zod';
import { ErrorHttp } from '../../errores.js';
import type { PrismaClient, Proveedor } from '../../generated/prisma/client.js';
import { diaDeHoyEnArgentina } from '../../lib/fechas.js';

type ProveedorConConteo = Proveedor & { _count: { productos: number } };

const conProductosActivos = {
  _count: { select: { productos: { where: { activo: true } } } },
} as const;

function aListado(p: ProveedorConConteo, ahora: Date): ProveedorListado {
  return {
    id: p.id,
    nombre: p.nombre,
    telefono: p.telefono,
    notas: p.notas,
    diasPedido: p.diasPedido,
    diasEntrega: p.diasEntrega,
    activo: p.activo,
    tomaPedidoHoy: p.diasPedido.includes(diaDeHoyEnArgentina(ahora)),
    productosActivos: p._count.productos,
  };
}

const noEncontrado = () =>
  new ErrorHttp(404, CODIGOS_ERROR.noEncontrado, 'El proveedor no existe.');

/** Lista con los que toman pedido hoy primero, después por nombre. */
export async function listarProveedores(
  prisma: PrismaClient,
  { incluirInactivos }: { incluirInactivos: boolean },
  ahora: Date,
): Promise<ProveedorListado[]> {
  const proveedores = await prisma.proveedor.findMany({
    where: incluirInactivos ? {} : { activo: true },
    include: conProductosActivos,
    orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
  });
  const lista = proveedores.map((p) => aListado(p, ahora));
  // sort es estable: dentro de cada grupo se mantiene el orden por nombre.
  return lista.sort(
    (a, b) =>
      Number(b.activo) - Number(a.activo) || Number(b.tomaPedidoHoy) - Number(a.tomaPedidoHoy),
  );
}

export async function crearProveedor(
  prisma: PrismaClient,
  datos: AltaProveedor,
  ahora: Date,
): Promise<ProveedorListado> {
  const creado = await prisma.proveedor.create({
    data: altaProveedorSchema.parse(datos),
    include: conProductosActivos,
  });
  return aListado(creado, ahora);
}

export async function editarProveedor(
  prisma: PrismaClient,
  id: string,
  cambios: z.output<typeof edicionProveedorSchema>,
  ahora: Date,
): Promise<ProveedorListado> {
  const existe = await prisma.proveedor.findUnique({ where: { id }, select: { id: true } });
  if (!existe) throw noEncontrado();
  const editado = await prisma.proveedor.update({
    where: { id },
    data: cambios,
    include: conProductosActivos,
  });
  return aListado(editado, ahora);
}
