import { ZONA_ARGENTINA } from '../../lib/fechas.js';

const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const fechaHora = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_ARGENTINA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "$ 1.800,00" con espacio común: Intl usa uno duro que WhatsApp muestra raro. */
function formatearPesos(monto: string): string {
  return pesos.format(Number(monto)).replace(/\s/g, ' ');
}

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
    `Fecha y hora: ${fechaHora.format(anuladaEn).replace(',', '')}`,
    `Anuló: ${anuladaPor}`,
    `Motivo: ${motivo}`,
    '',
    ...items.map((i) => `${i.cantidad} × ${i.descripcion}: ${formatearPesos(i.subtotal)}`),
    `*Total: ${formatearPesos(total)}*`,
  ].join('\n');
}
