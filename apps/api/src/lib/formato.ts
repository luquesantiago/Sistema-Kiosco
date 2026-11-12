import { ZONA_ARGENTINA } from './fechas.js';

// Formatos para los textos de los avisos que se leen en WhatsApp.

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
const hora = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_ARGENTINA,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "$ 1.800,00" con espacio común: Intl usa uno duro que WhatsApp muestra raro. */
export function formatearPesos(monto: string): string {
  return pesos.format(Number(monto)).replace(/\s/g, ' ');
}

/** "20/10/2026 15:42" en hora de Argentina. */
export function formatearFechaHora(instante: Date): string {
  return fechaHora.format(instante).replace(',', '');
}

/** "15:42" en hora de Argentina. */
export function formatearHora(instante: Date): string {
  return hora.format(instante);
}

const NOMBRE_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/**
 * "jueves 12/11" para una fecha "AAAA-MM-DD". Es una fecha sin hora: se lee en
 * UTC para que no se corra un día.
 */
export function formatearDiaYFecha(fecha: string): string {
  const [, mes, dia] = fecha.split('-');
  const diaSemana = NOMBRE_DIA[new Date(`${fecha}T00:00:00Z`).getUTCDay()]!;
  return `${diaSemana} ${dia}/${mes}`;
}
