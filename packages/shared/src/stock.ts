import { z } from 'zod';
import { montoSalidaSchema, montoSchema } from './montos.js';

export const TIPOS_MOVIMIENTO = ['compra', 'ajuste', 'venta', 'anulacion'] as const;
export const tipoMovimientoSchema = z.enum(TIPOS_MOVIMIENTO);
export type TipoMovimiento = z.infer<typeof tipoMovimientoSchema>;

export const MOTIVOS_AJUSTE = [
  'rotura',
  'vencimiento',
  'robo',
  'conteo',
  'venta_sin_sistema',
  'correccion',
  'otro',
] as const;
export const motivoAjusteSchema = z.enum(MOTIVOS_AJUSTE);
export type MotivoAjuste = z.infer<typeof motivoAjusteSchema>;

export const NOMBRE_MOTIVO: Record<MotivoAjuste, string> = {
  rotura: 'Rotura',
  vencimiento: 'Vencimiento',
  robo: 'Robo',
  conteo: 'Conteo',
  venta_sin_sistema: 'Venta sin sistema',
  correccion: 'Corrección',
  otro: 'Otro',
};

export const NOMBRE_TIPO_MOVIMIENTO: Record<TipoMovimiento, string> = {
  compra: 'Ingreso',
  ajuste: 'Ajuste',
  venta: 'Venta',
  anulacion: 'Anulación',
};

export const MAX_ITEMS_POR_CARGA = 200;
const MAX_CANTIDAD = 100_000;

/** Nota opcional: vacía o solo espacios se guarda como null. */
const notaSchema = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((t) => (t ? t : null));

const cantidadPositivaSchema = z.number().int().min(1).max(MAX_CANTIDAD);

export const ajusteStockSchema = z
  .object({
    productoId: z.uuid(),
    cantidad: z
      .number()
      .int()
      .min(-MAX_CANTIDAD)
      .max(MAX_CANTIDAD)
      .refine((c) => c !== 0, 'La cantidad no puede ser 0.'),
    motivo: motivoAjusteSchema,
    nota: notaSchema.default(null),
  })
  .refine((a) => a.motivo !== 'otro' || a.nota !== null, {
    message: 'Con el motivo "Otro" tenés que escribir una nota.',
    path: ['nota'],
  });
export type AjusteStock = z.input<typeof ajusteStockSchema>;

export const conteoStockSchema = z.object({
  productoId: z.uuid(),
  cantidadContada: z.number().int().min(0).max(1_000_000),
});
export type ConteoStock = z.input<typeof conteoStockSchema>;

export const resultadoConteoSchema = z.object({
  diferencia: z.number().int(),
  stockActual: z.number().int(),
});
export type ResultadoConteo = z.infer<typeof resultadoConteoSchema>;

export const ventasSinSistemaSchema = z.object({
  nota: notaSchema.default(null),
  items: z
    .array(z.object({ productoId: z.uuid(), cantidad: cantidadPositivaSchema }))
    .min(1, 'Agregá al menos un producto.')
    .max(MAX_ITEMS_POR_CARGA),
});
export type VentasSinSistema = z.input<typeof ventasSinSistemaSchema>;

export const resultadoVentasSinSistemaSchema = z.object({ productos: z.number().int() });
export type ResultadoVentasSinSistema = z.infer<typeof resultadoVentasSinSistemaSchema>;

export const ingresoMercaderiaSchema = z.object({
  proveedorId: z.uuid().nullable().default(null),
  nota: notaSchema.default(null),
  items: z
    .array(
      z.object({
        productoId: z.uuid(),
        cantidad: cantidadPositivaSchema,
        /** Solo el admin; vacío o ausente significa "sin cambios". */
        costoUnitario: montoSchema.nullable().optional(),
      }),
    )
    .min(1, 'Agregá al menos un producto.')
    .max(MAX_ITEMS_POR_CARGA),
});
export type IngresoMercaderia = z.input<typeof ingresoMercaderiaSchema>;

const referenciaSchema = z.object({ id: z.uuid(), nombre: z.string() });

export const movimientoStockSchema = z.object({
  id: z.uuid(),
  tipo: tipoMovimientoSchema,
  motivo: motivoAjusteSchema.nullable(),
  cantidad: z.number().int(),
  stockResultante: z.number().int(),
  nota: z.string().nullable(),
  ingresoId: z.uuid().nullable(),
  creadoEn: z.iso.datetime(),
  usuario: referenciaSchema,
});
export type MovimientoStock = z.infer<typeof movimientoStockSchema>;

export const paginaSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
});

export const MOVIMIENTOS_POR_PAGINA = 50;
export const INGRESOS_POR_PAGINA = 50;

export const ingresoListadoSchema = z.object({
  id: z.uuid(),
  creadoEn: z.iso.datetime(),
  proveedor: referenciaSchema.nullable(),
  usuario: referenciaSchema,
  nota: z.string().nullable(),
  cantidadProductos: z.number().int(),
});
export type IngresoListado = z.infer<typeof ingresoListadoSchema>;

export const ingresoDetalleSchema = ingresoListadoSchema.extend({
  items: z.array(
    z.object({
      producto: referenciaSchema.extend({ codigoBarras: z.string().nullable() }),
      cantidad: z.number().int(),
      costoUnitario: montoSalidaSchema.nullable(),
    }),
  ),
});
export type IngresoDetalle = z.infer<typeof ingresoDetalleSchema>;

/** Proveedor para elegir en el ingreso: solo lo que necesita ver el empleado. */
export const proveedorOpcionSchema = referenciaSchema;
export type ProveedorOpcion = z.infer<typeof proveedorOpcionSchema>;
