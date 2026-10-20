import { z } from 'zod';

/**
 * Convierte un monto escrito por el usuario a texto decimal con punto y dos
 * decimales (`"1000.50"`), o null si no es válido. Acepta coma decimal y punto
 * de miles al estilo argentino: `"905,5"`, `"1.000"`, `"1.000,50"`, y también
 * punto decimal (`"905.50"`). Nunca pasa por `number`, así que no pierde precisión.
 */
export function textoAMonto(texto: string): string | null {
  let limpio = texto
    .trim()
    .replace(/^\$\s*/, '')
    .replace(/\s/g, '');
  if (limpio.includes(',')) {
    // Con coma, la coma es el decimal y los puntos son separadores de miles.
    if (!/^\d{1,3}(\.\d{3})*(,\d*)?$/.test(limpio) && !/^\d+(,\d*)?$/.test(limpio)) return null;
    limpio = limpio.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(limpio)) {
    // "1.000" o "12.500": punto de miles.
    limpio = limpio.replace(/\./g, '');
  }
  const partes = /^(\d+)(?:\.(\d{0,2}))?$/.exec(limpio);
  if (!partes) return null;
  const entero = partes[1]!.replace(/^0+(?=\d)/, '');
  // Decimal(12, 2): hasta 10 dígitos enteros.
  if (entero.length > 10) return null;
  return `${entero}.${(partes[2] ?? '').padEnd(2, '0')}`;
}

/** Monto de entrada: texto (con coma o punto) o número. Sale como texto `"905.00"`. */
export const montoSchema = z
  .union([z.string(), z.number().nonnegative()])
  .transform((valor, ctx) => {
    const monto = textoAMonto(typeof valor === 'number' ? String(valor) : valor);
    if (monto === null) {
      ctx.addIssue({ code: 'custom', message: 'Ingresá un monto válido, por ejemplo 1500,50.' });
      return z.NEVER;
    }
    return monto;
  });

/** Monto mayor que cero (precios de venta). */
export const montoPositivoSchema = montoSchema.refine(
  (monto) => !/^0\.00$/.test(monto),
  'El monto tiene que ser mayor que cero.',
);

/** Monto tal como lo devuelve la API: texto con dos decimales. */
export const montoSalidaSchema = z.string().regex(/^-?\d+\.\d{2}$/);
