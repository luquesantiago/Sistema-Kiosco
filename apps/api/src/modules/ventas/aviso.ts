import { formatearFechaHora, formatearPesos } from '../../lib/formato.js';

export interface DatosAvisoAnulacion {
  numero: number;
  total: string;
  items: { descripcion: string; cantidad: number; subtotal: string }[];
  anuladaPor: string;
  motivo: string;
  anuladaEn: Date;
  /** Facturas autorizadas de la venta: siguen vigentes en ARCA. `numero` formateado. */
  facturasVigentes?: { numero: string; importe: string }[];
}

/** Texto del aviso al admin por una venta anulada, legible en WhatsApp. */
export function textoAvisoAnulacion({
  numero,
  total,
  items,
  anuladaPor,
  motivo,
  anuladaEn,
  facturasVigentes = [],
}: DatosAvisoAnulacion): string {
  const lineas = [
    `*Venta #${numero} anulada*`,
    `Fecha y hora: ${formatearFechaHora(anuladaEn)}`,
    `Anuló: ${anuladaPor}`,
    `Motivo: ${motivo}`,
    '',
    ...items.map((i) => `${i.cantidad} × ${i.descripcion}: ${formatearPesos(i.subtotal)}`),
    `*Total: ${formatearPesos(total)}*`,
  ];
  if (facturasVigentes.length > 0) {
    // El sistema no emite notas de crédito.
    lineas.push(
      '',
      ...facturasVigentes.map(
        (f) => `Factura C ${f.numero} por ${formatearPesos(f.importe)}: sigue vigente.`,
      ),
      'Hay que hacer la nota de crédito por fuera del sistema.',
    );
  }
  return lineas.join('\n');
}
