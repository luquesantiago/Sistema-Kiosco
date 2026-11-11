import { formatearDiaYFecha, formatearHora } from '../../lib/formato.js';
import type { GrupoReposicion, Reposicion } from './servicio.js';

/**
 * Aviso diario de reposición. De los proveedores que piden hoy y del grupo
 * "Sin proveedor" va el detalle; del resto, cuántos productos les faltan.
 */
export function textoAvisoReposicion(r: Reposicion): string {
  const lineas = [
    `*Reposición - ${formatearDiaYFecha(r.fecha)}*`,
    `Stock a las ${formatearHora(r.calculadaEn)}`,
  ];
  if (r.grupos.length === 0) {
    lineas.push('', 'Hoy no hay nada para reponer');
    return lineas.join('\n');
  }

  const detalle = (g: GrupoReposicion) => g.productos.map((p) => `- ${p.nombre}: ${p.sugerido}`);
  const deHoy = r.grupos.filter((g) => g.proveedor && g.tomaPedidoHoy);
  const otros = r.grupos.filter((g) => g.proveedor && !g.tomaPedidoHoy);
  const sinProveedor = r.grupos.find((g) => !g.proveedor);

  for (const g of deHoy) {
    lineas.push('', `*${g.proveedor!.nombre}* (pide hoy)`);
    if (g.pedidoPorLlegarEl) {
      lineas.push(`_Ya hay un pedido por llegar el ${formatearDiaYFecha(g.pedidoPorLlegarEl)}_`);
    }
    lineas.push(...detalle(g));
  }
  if (otros.length > 0) {
    lineas.push('', '*Otros proveedores*');
    for (const g of otros) {
      const cantidad = g.productos.length;
      const marca = g.pedidoPorLlegarEl
        ? ` (pedido por llegar el ${formatearDiaYFecha(g.pedidoPorLlegarEl)})`
        : '';
      lineas.push(
        `- ${g.proveedor!.nombre}: ${cantidad} ${cantidad === 1 ? 'producto' : 'productos'}${marca}`,
      );
    }
  }
  if (sinProveedor) lineas.push('', '*Sin proveedor*', ...detalle(sinProveedor));
  return lineas.join('\n');
}
