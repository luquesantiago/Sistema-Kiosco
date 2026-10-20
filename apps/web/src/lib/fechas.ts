/** Fecha y hora en Argentina, corta: "20/10/26, 3:26 p. m.". */
export function formatearFechaHora(fecha: string): string {
  return new Date(fecha).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}
