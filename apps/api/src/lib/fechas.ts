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
