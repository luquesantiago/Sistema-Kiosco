import { formatearFechaHora, formatearPesos } from '../../lib/formato.js';

export interface DatosAvisoAnulacion {
  numero: number;
  total: string;
  items: { descripcion: string; cantidad: number; subtotal: string }[];
  anuladaPor: string;
  motivo: string;
  anuladaEn: Date;
}

/** Texto del aviso al admin por una venta anulada, legible en WhatsApp. */
export function textoAvisoAnulacion({
  numero,
  total,
  items,
  anuladaPor,
  motivo,
  anuladaEn,
}: DatosAvisoAnulacion): string {
  return [
    `*Venta #${numero} anulada*`,
    `Fecha y hora: ${formatearFechaHora(anuladaEn)}`,
    `Anuló: ${anuladaPor}`,
    `Motivo: ${motivo}`,
    '',
    ...items.map((i) => `${i.cantidad} × ${i.descripcion}: ${formatearPesos(i.subtotal)}`),
    `*Total: ${formatearPesos(total)}*`,
  ].join('\n');
}
