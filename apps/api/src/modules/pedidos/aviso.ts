import { NOMBRE_CUENTA, type PedidoDetalle } from '@kiosco/shared';
import { formatearFechaHora, formatearPesos } from '../../lib/formato.js';

/** Aviso al admin cuando un empleado deja un pedido cargado y pagado. */
export function textoAvisoPedidoCerrado(p: PedidoDetalle, cerradoEn: Date): string {
  const lineas = [
    `*Pedido #${p.numero} cerrado - ${p.proveedor.nombre}*`,
    `Pagado: ${formatearPesos(p.pago!.monto)} (${NOMBRE_CUENTA[p.pago!.cuenta]})`,
  ];
  if (p.totalPedido !== p.pago!.monto) {
    lineas.push(`Total del pedido: ${formatearPesos(p.totalPedido)}`);
  }
  if (p.notaRecepcion) lineas.push(`Nota: ${p.notaRecepcion}`);
  lineas.push(
    `Productos cargados: ${p.carga!.cantidadProductos}`,
    `Recibió: ${p.recibido!.usuario.nombre} · Cargó: ${p.carga!.usuario.nombre} · Pagó: ${p.pago!.usuario.nombre}`,
    `Cerrado: ${formatearFechaHora(cerradoEn)}`,
  );
  return lineas.join('\n');
}
