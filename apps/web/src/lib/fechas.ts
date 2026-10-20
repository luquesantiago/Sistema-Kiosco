/** Fecha y hora en Argentina, corta: "20/10/26, 3:26 p. m.". */
export function formatearFechaHora(fecha: string): string {
  return new Date(fecha).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

const formatoFecha = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fecha de hoy "AAAA-MM-DD" en Argentina. */
export function hoyEnArgentina(ahora = new Date()): string {
  return formatoFecha.format(ahora);
}

/** Solo la hora en Argentina: "15:42". */
export function formatearHora(fecha: string): string {
  return new Date(fecha).toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
