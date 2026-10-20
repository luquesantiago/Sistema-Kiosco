import type { DiaSemana } from '@kiosco/shared';

export const ZONA_ARGENTINA = 'America/Argentina/Buenos_Aires';

const formatoDia = new Intl.DateTimeFormat('en-US', { timeZone: ZONA_ARGENTINA, weekday: 'long' });

// Se formatea en inglés para no depender de cómo escribe los días cada versión de ICU.
const DIA_POR_NOMBRE: Record<string, DiaSemana> = {
  Monday: 'lunes',
  Tuesday: 'martes',
  Wednesday: 'miercoles',
  Thursday: 'jueves',
  Friday: 'viernes',
  Saturday: 'sabado',
  Sunday: 'domingo',
};

/** Día de la semana en Argentina para el instante dado (normalmente `ahora()`). */
export function diaDeHoyEnArgentina(ahora: Date): DiaSemana {
  const nombre = formatoDia.format(ahora);
  const dia = DIA_POR_NOMBRE[nombre];
  if (!dia) throw new Error(`Día de la semana inesperado: ${nombre}`);
  return dia;
}

/** Argentina no tiene horario de verano desde 2009: siempre UTC−3. */
const DESFASE_ARGENTINA_MS = 3 * 60 * 60 * 1000;

const formatoFecha = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_ARGENTINA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fecha "AAAA-MM-DD" en Argentina del instante dado. */
export function fechaEnArgentina(instante: Date): string {
  return formatoFecha.format(instante);
}

/**
 * Instantes UTC del día "AAAA-MM-DD" en Argentina: desde las 00:00 incluido
 * hasta las 00:00 del día siguiente excluido.
 */
export function rangoDelDiaEnArgentina(fecha: string): { desde: Date; hasta: Date } {
  const desde = new Date(Date.parse(`${fecha}T00:00:00Z`) + DESFASE_ARGENTINA_MS);
  return { desde, hasta: new Date(desde.getTime() + 24 * 60 * 60 * 1000) };
}
