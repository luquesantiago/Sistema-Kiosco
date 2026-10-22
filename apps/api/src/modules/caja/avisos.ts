import {
  comparar,
  NOMBRE_CATEGORIA_GASTO,
  NOMBRE_MEDIO,
  restar,
  type CategoriaGasto,
  type Cuenta,
  type ResumenCaja,
} from '@kiosco/shared';
import { formatearFechaHora, formatearHora, formatearPesos } from '../../lib/formato.js';

export interface DatosAvisoMovimiento {
  tipo: 'gasto' | 'retiro';
  /** Solo en los gastos. */
  categoria: CategoriaGasto | null;
  cuenta: Cuenta;
  monto: string;
  motivo: string;
  usuario: string;
  creadoEn: Date;
}

/** Aviso al admin por un gasto o retiro que registró un empleado. */
export function textoAvisoMovimiento({
  tipo,
  categoria,
  cuenta,
  monto,
  motivo,
  usuario,
  creadoEn,
}: DatosAvisoMovimiento): string {
  const origen = cuenta === 'mercado_pago' ? 'de Mercado Pago' : 'de caja';
  const titulo = `${tipo === 'gasto' ? 'Gasto' : 'Retiro'} ${origen}`;
  const encabezado = categoria ? `${titulo} · ${NOMBRE_CATEGORIA_GASTO[categoria]}` : titulo;
  return [
    `*${encabezado}: ${formatearPesos(monto)}*`,
    `Fecha y hora: ${formatearFechaHora(creadoEn)}`,
    `Registró: ${usuario}`,
    `Motivo: ${motivo}`,
  ].join('\n');
}

export interface DatosAvisoCierre {
  responsable: string;
  cerradoPor: string;
  abiertoEn: Date;
  cerradoEn: Date;
  montoSugerido: string;
  resumen: ResumenCaja;
  montoContado: string;
  diferencia: string;
  retiro: string | null;
  motivoRetiro: string | null;
  quedoEnCaja: string;
}

const esCero = (monto: string) => comparar(monto, 0) === 0;

/** Resumen del turno cerrado para el admin, legible en WhatsApp. */
export function textoAvisoCierre(d: DatosAvisoCierre): string {
  const { resumen: r } = d;
  const diferenciaApertura = restar(r.montoInicial, d.montoSugerido);
  const lineas = [
    `*Turno cerrado - ${d.responsable}*`,
    `De ${formatearFechaHora(d.abiertoEn)} a ${formatearHora(d.cerradoEn)}`,
  ];
  if (d.cerradoPor !== d.responsable) {
    lineas.push(`Cerró: ${d.cerradoPor} (en nombre de ${d.responsable})`);
  }
  lineas.push('', `Ventas: ${r.cantidadVentas}`);
  for (const [medio, monto] of Object.entries(r.porMedio) as [
    keyof typeof NOMBRE_MEDIO,
    string,
  ][]) {
    if (!esCero(monto)) lineas.push(`${NOMBRE_MEDIO[medio]}: ${formatearPesos(monto)}`);
  }
  lineas.push('', `Inicial: ${formatearPesos(r.montoInicial)}`);
  if (!esCero(diferenciaApertura)) {
    lineas.push(`Diferencia de apertura: ${formatearPesos(diferenciaApertura)}`);
  }
  const movimientos: [string, string][] = [
    ['Ingresos', r.ingresos],
    ['Gastos', r.gastos],
    ['Retiros', r.retiros],
    ['Pagos a proveedores', r.pagosProveedor],
    ['Devoluciones de anulaciones', r.devoluciones],
  ];
  for (const [nombre, monto] of movimientos) {
    if (!esCero(monto)) lineas.push(`${nombre}: ${formatearPesos(monto)}`);
  }
  lineas.push(
    `Esperado: ${formatearPesos(r.esperado)}`,
    `Contado: ${formatearPesos(d.montoContado)}`,
    `*Diferencia: ${formatearPesos(d.diferencia)}*`,
  );
  if (d.retiro) lineas.push(`Retiro al cierre: ${formatearPesos(d.retiro)} (${d.motivoRetiro})`);
  lineas.push(`Quedó en caja: ${formatearPesos(d.quedoEnCaja)}`);
  return lineas.join('\n');
}
