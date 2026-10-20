import { CODIGOS_ERROR, type MotivoAjuste, type TipoMovimiento } from '@kiosco/shared';
import { ErrorHttp } from '../../errores.js';
import type { MovimientoStock, Prisma } from '../../generated/prisma/client.js';

export interface DatosMovimiento {
  productoId: string;
  tipo: TipoMovimiento;
  /** Con signo: positiva suma, negativa resta. */
  cantidad: number;
  /** Obligatorio para `ajuste`; prohibido para los demás tipos. */
  motivo?: MotivoAjuste | null;
  nota?: string | null;
  usuarioId: string;
  ingresoId?: string | null;
}

export const productoNoEncontrado = () =>
  new ErrorHttp(
    404,
    CODIGOS_ERROR.productoNoEncontrado,
    'El producto no existe o está desactivado.',
  );

/**
 * Único punto que modifica `Producto.stockActual`. Corre dentro de la
 * transacción de quien lo llama (ingreso, ajuste, venta...): el UPDATE con
 * incremento bloquea la fila hasta el final de esa transacción, así que dos
 * movimientos simultáneos se ordenan solos y cada stock resultante es correcto.
 * El stock puede quedar negativo.
 */
export async function registrarMovimiento(
  tx: Prisma.TransactionClient,
  {
    productoId,
    tipo,
    cantidad,
    motivo = null,
    nota = null,
    usuarioId,
    ingresoId = null,
  }: DatosMovimiento,
): Promise<MovimientoStock> {
  if ((tipo === 'ajuste') !== (motivo !== null)) {
    throw new Error(`Motivo inválido para un movimiento de tipo ${tipo}: ${motivo}`);
  }
  if (!Number.isInteger(cantidad) || cantidad === 0) {
    throw new Error(`Cantidad inválida para un movimiento: ${cantidad}`);
  }

  // updateMany no falla si no hay fila; así se distingue el producto inexistente o desactivado.
  const actualizados = await tx.producto.updateManyAndReturn({
    where: { id: productoId, activo: true },
    data: { stockActual: { increment: cantidad } },
    select: { stockActual: true },
  });
  const producto = actualizados[0];
  if (!producto) throw productoNoEncontrado();

  return tx.movimientoStock.create({
    data: {
      productoId,
      tipo,
      motivo,
      cantidad,
      stockResultante: producto.stockActual,
      nota,
      usuarioId,
      ingresoId,
    },
  });
}
