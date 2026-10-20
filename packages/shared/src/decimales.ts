import Decimal, { type Numeric } from 'decimal.js-light';

/**
 * Cuentas con montos como texto decimal ("905.50"), sin pasar por `number`:
 * 0.1 + 0.2 da 0.3 y el pago mixto cierra al centavo. Las usan la web
 * (carrito, vuelto) y la API.
 */

/** Monto con dos decimales, redondeando la mitad hacia arriba: "905.5" → "905.50". */
export function formatear(valor: Numeric): string {
  return new Decimal(valor).toFixed(2, Decimal.ROUND_HALF_UP);
}

export function sumar(...montos: Numeric[]): string {
  return formatear(montos.reduce<Decimal>((total, m) => total.plus(m), new Decimal(0)));
}

export function restar(a: Numeric, b: Numeric): string {
  return formatear(new Decimal(a).minus(b));
}

export function multiplicar(monto: Numeric, cantidad: Numeric): string {
  return formatear(new Decimal(monto).times(cantidad));
}

/** -1, 0 o 1, como `a - b`. */
export function comparar(a: Numeric, b: Numeric): number {
  return new Decimal(a).comparedTo(b);
}

export function sonIguales(a: Numeric, b: Numeric): boolean {
  return comparar(a, b) === 0;
}
