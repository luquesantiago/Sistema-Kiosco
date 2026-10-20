import { z } from 'zod';
import { montoPositivoSchema, montoSalidaSchema, montoSchema } from './montos.js';
import { nombreSchema } from './usuarios.js';

/** Código de barras sin espacios en los extremos; vacío se guarda como null. */
export const codigoBarrasSchema = z
  .string()
  .trim()
  .max(50)
  .nullable()
  .transform((c) => (c ? c : null));

const cantidadStockSchema = z.number().int().min(0).max(1_000_000);

const MENSAJE_MIN_MAX = 'El stock máximo no puede ser menor que el mínimo.';

export const altaProductoSchema = z
  .object({
    nombre: nombreSchema,
    codigoBarras: codigoBarrasSchema.default(null),
    precio: montoPositivoSchema,
    costo: montoSchema.nullable().default(null),
    stockMinimo: cantidadStockSchema,
    stockMaximo: cantidadStockSchema,
    proveedorId: z.uuid().nullable().default(null),
  })
  .refine((p) => p.stockMaximo >= p.stockMinimo, {
    message: MENSAJE_MIN_MAX,
    path: ['stockMaximo'],
  });
export type AltaProducto = z.input<typeof altaProductoSchema>;

/**
 * Edición: todos los datos salvo el stock actual, que lo mueve el cambio
 * `stock`. Zod descarta `stockActual` si viene. Si llega uno solo de mínimo o
 * máximo, la API lo compara con el valor guardado.
 */
export const edicionProductoSchema = z
  .object({
    nombre: nombreSchema.optional(),
    codigoBarras: codigoBarrasSchema.optional(),
    precio: montoPositivoSchema.optional(),
    costo: montoSchema.nullable().optional(),
    stockMinimo: cantidadStockSchema.optional(),
    stockMaximo: cantidadStockSchema.optional(),
    proveedorId: z.uuid().nullable().optional(),
    activo: z.boolean().optional(),
  })
  .refine((datos) => Object.keys(datos).length > 0, 'No hay cambios para guardar.')
  .refine(
    (p) =>
      p.stockMinimo === undefined || p.stockMaximo === undefined || p.stockMaximo >= p.stockMinimo,
    { message: MENSAJE_MIN_MAX, path: ['stockMaximo'] },
  );
export type EdicionProducto = z.input<typeof edicionProductoSchema>;

export const busquedaProductosSchema = z.object({
  q: z.string().trim().max(100).default(''),
  pagina: z.coerce.number().int().min(1).default(1),
  /** Solo para el admin; se ignora para el empleado. */
  incluirInactivos: z.stringbool().default(false),
});
export type BusquedaProductos = z.input<typeof busquedaProductosSchema>;

export const PRODUCTOS_POR_PAGINA = 50;

/** Lo que ve cualquier usuario con sesión (el empleado en el mostrador). */
export const productoVentaSchema = z.object({
  id: z.uuid(),
  codigoBarras: z.string().nullable(),
  nombre: z.string(),
  precio: montoSalidaSchema,
  stockActual: z.number().int(),
});
export type ProductoVenta = z.infer<typeof productoVentaSchema>;

/** Ficha completa para el admin: suma costo, proveedor, límites de stock y estado. */
export const productoAdminSchema = productoVentaSchema.extend({
  costo: montoSalidaSchema.nullable(),
  proveedor: z.object({ id: z.uuid(), nombre: z.string() }).nullable(),
  stockMinimo: z.number().int(),
  stockMaximo: z.number().int(),
  activo: z.boolean(),
});
export type ProductoAdmin = z.infer<typeof productoAdminSchema>;

export const ORIGENES_CAMBIO_PRECIO = ['manual', 'aumento_masivo'] as const;
export const origenCambioPrecioSchema = z.enum(ORIGENES_CAMBIO_PRECIO);
export type OrigenCambioPrecio = z.infer<typeof origenCambioPrecioSchema>;

export const cambioPrecioSchema = z.object({
  id: z.uuid(),
  precioAnterior: montoSalidaSchema,
  precioNuevo: montoSalidaSchema,
  costoAnterior: montoSalidaSchema.nullable(),
  costoNuevo: montoSalidaSchema.nullable(),
  origen: origenCambioPrecioSchema,
  creadoEn: z.iso.datetime(),
  usuario: z.object({ id: z.uuid(), nombre: z.string() }),
});
export type CambioPrecio = z.infer<typeof cambioPrecioSchema>;

export const REDONDEOS = [1, 10, 50, 100] as const;

/** Porcentaje con hasta dos decimales; acepta número o texto con coma ("7,5"). */
const porcentajeSchema = z
  .union([z.number(), z.string().trim()])
  .transform((valor, ctx) => {
    const texto = typeof valor === 'number' ? String(valor) : valor.replace(',', '.');
    if (!/^-?\d+(\.\d{1,2})?$/.test(texto)) {
      ctx.addIssue({ code: 'custom', message: 'Ingresá un porcentaje válido, por ejemplo 10.' });
      return z.NEVER;
    }
    return Number(texto);
  })
  .pipe(
    z
      .number()
      .min(-50, 'El porcentaje tiene que estar entre -50 y 200.')
      .max(200, 'El porcentaje tiene que estar entre -50 y 200.')
      .refine((p) => p !== 0, 'El porcentaje no puede ser 0.'),
  );

export const aumentoMasivoSchema = z.object({
  /** null aplica a todos los productos activos. */
  proveedorId: z.uuid().nullable(),
  porcentaje: porcentajeSchema,
  redondeo: z.union(REDONDEOS.map((r) => z.literal(r))),
  incluirCosto: z.boolean().default(false),
});
export type AumentoMasivo = z.input<typeof aumentoMasivoSchema>;

export const vistaPreviaAumentoSchema = z.array(
  z.object({
    id: z.uuid(),
    nombre: z.string(),
    precioActual: montoSalidaSchema,
    precioNuevo: montoSalidaSchema,
    costoActual: montoSalidaSchema.nullable(),
    costoNuevo: montoSalidaSchema.nullable(),
  }),
);
export type VistaPreviaAumento = z.infer<typeof vistaPreviaAumentoSchema>;

export const resultadoAumentoSchema = z.object({ actualizados: z.number().int() });
export type ResultadoAumento = z.infer<typeof resultadoAumentoSchema>;
