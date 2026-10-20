import { textoAMonto } from '@kiosco/shared';

const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

/** "1000.50" (como lo manda la API) → "$ 1.000,50". Solo para mostrar. */
export function formatearPesos(monto: string): string {
  return pesos.format(Number(monto));
}

/** "1000.50" → "1000,50", para precargar un campo que el usuario va a editar. */
export function montoParaEditar(monto: string | null): string {
  return monto === null ? '' : monto.replace('.', ',');
}

/**
 * Lo que escribe el usuario ("1.000,50", "905,5", "905") → texto para la API
 * ("1000.50"), o null si no es un monto válido.
 */
export function entradaAMonto(texto: string): string | null {
  return textoAMonto(texto);
}
