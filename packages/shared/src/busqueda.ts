/**
 * Normaliza un texto para buscar sin distinguir mayúsculas ni acentos:
 * "  Café   Molido " → "cafe molido". Se usa al guardar `nombreBusqueda` y al
 * normalizar la consulta, así que las dos puntas tienen que usar esta función.
 */
export function normalizarParaBusqueda(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
