import { z } from 'zod';
import { comparar, restar, sonIguales, sumar } from './decimales.js';
import { montoPositivoSchema, montoSalidaSchema, montoSchema } from './montos.js';

export const MEDIOS_PAGO = ['efectivo', 'debito', 'credito', 'mercado_pago'] as const;
export const medioPagoSchema = z.enum(MEDIOS_PAGO);
export type MedioPago = z.infer<typeof medioPagoSchema>;

export const NOMBRE_MEDIO: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  mercado_pago: 'Mercado Pago',
};

export const ESTADOS_VENTA = ['pagada', 'anulada'] as const;
export type EstadoVenta = (typeof ESTADOS_VENTA)[number];

export const MAX_ITEMS_POR_VENTA = 200;
const cantidadVendidaSchema = z.number().int().min(1).max(999);

export const itemCatalogoSchema = z.object({
  productoId: z.uuid(),
  cantidad: cantidadVendidaSchema,
});

/** Ítem "Varios": lo que no está cargado, con precio libre. No mueve stock. */
export const itemVariosSchema = z.object({
  varios: z.object({
    descripcion: z
      .string()
      .trim()
      .max(100)
      .nullish()
      .transform((d) => (d ? d : 'Varios')),
    precio: montoPositivoSchema,
  }),
  cantidad: cantidadVendidaSchema,
});

export const itemVentaEntradaSchema = z.union([itemCatalogoSchema, itemVariosSchema]);
export type ItemVentaEntrada = z.input<typeof itemVentaEntradaSchema>;

export const pagoEntradaSchema = z.object({
  medio: medioPagoSchema,
  monto: montoPositivoSchema,
  /** Solo efectivo: con cuánto pagó el cliente, para calcular el vuelto. */
  montoRecibido: montoSchema.nullish(),
});
export type PagoEntrada = z.input<typeof pagoEntradaSchema>;

/** Vuelto de un pago en efectivo: recibido menos monto. */
export function calcularVuelto(monto: string, montoRecibido: string): string {
  return restar(montoRecibido, monto);
}

export const ventaEntradaSchema = z
  .object({
    items: z
      .array(itemVentaEntradaSchema)
      .min(1, 'Agregá al menos un producto.')
      .max(MAX_ITEMS_POR_VENTA),
    pagos: z.array(pagoEntradaSchema).min(1, 'Elegí cómo se paga.').max(MEDIOS_PAGO.length),
    /** El total que vio el mostrador; si no coincide con el del servidor, cambiaron los precios. */
    totalEsperado: montoSchema,
  })
  .superRefine((venta, ctx) => {
    const medios = venta.pagos.map((p) => p.medio);
    if (new Set(medios).size !== medios.length) {
      ctx.addIssue({ code: 'custom', path: ['pagos'], message: 'Hay un medio de pago repetido.' });
    }
    venta.pagos.forEach((p, i) => {
      if (p.montoRecibido == null) return;
      if (p.medio !== 'efectivo') {
        ctx.addIssue({
          code: 'custom',
          path: ['pagos', i, 'montoRecibido'],
          message: 'El monto recibido es solo para efectivo.',
        });
      } else if (comparar(p.montoRecibido, p.monto) < 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['pagos', i, 'montoRecibido'],
          message: 'Lo que paga el cliente no alcanza.',
        });
      }
    });
    if (!sonIguales(sumar(...venta.pagos.map((p) => p.monto)), venta.totalEsperado)) {
      ctx.addIssue({
        code: 'custom',
        path: ['pagos'],
        message: 'Los pagos tienen que sumar el total.',
      });
    }
  });
export type VentaEntrada = z.input<typeof ventaEntradaSchema>;

export const anulacionSchema = z.object({
  motivo: z.string().trim().min(3, 'Escribí el motivo (al menos 3 letras).').max(200),
});
export type Anulacion = z.input<typeof anulacionSchema>;

/** Fecha "AAAA-MM-DD" en hora de Argentina. */
export const fechaSchema = z.iso.date();

export const listadoVentasQuerySchema = z.object({
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
  pagina: z.coerce.number().int().min(1).default(1),
});
export type ListadoVentasQuery = z.input<typeof listadoVentasQuerySchema>;

export const VENTAS_POR_PAGINA = 50;

export const referenciaSchema = z.object({ id: z.uuid(), nombre: z.string() });

export const ventaResumenSchema = z.object({
  id: z.uuid(),
  numero: z.number().int(),
  creadaEn: z.iso.datetime(),
  usuario: referenciaSchema,
  total: montoSalidaSchema,
  estado: z.enum(ESTADOS_VENTA),
  medios: z.array(medioPagoSchema),
});
export type VentaResumen = z.infer<typeof ventaResumenSchema>;

export const ventaDetalleSchema = ventaResumenSchema.extend({
  items: z.array(
    z.object({
      productoId: z.uuid().nullable(),
      descripcion: z.string(),
      cantidad: z.number().int(),
      precioUnitario: montoSalidaSchema,
      subtotal: montoSalidaSchema,
    }),
  ),
  pagos: z.array(
    z.object({
      medio: medioPagoSchema,
      monto: montoSalidaSchema,
      montoRecibido: montoSalidaSchema.nullable(),
      vuelto: montoSalidaSchema.nullable(),
    }),
  ),
  anulacion: z
    .object({ en: z.iso.datetime(), por: referenciaSchema, motivo: z.string() })
    .nullable(),
});
export type VentaDetalle = z.infer<typeof ventaDetalleSchema>;

/** Detalle de `409 PRECIOS_CAMBIARON`: los precios actuales de los productos de la venta. */
export const preciosActualesSchema = z.array(
  z.object({ productoId: z.uuid(), precio: montoSalidaSchema }),
);
export type PreciosActuales = z.infer<typeof preciosActualesSchema>;

export const TIPOS_NOTIFICACION = [
  'anulacion_venta',
  'gasto_caja',
  'retiro_caja',
  'cierre_turno',
] as const;
export type TipoNotificacion = (typeof TIPOS_NOTIFICACION)[number];

export const ESTADOS_NOTIFICACION = ['pendiente', 'enviada', 'error'] as const;
export type EstadoNotificacion = (typeof ESTADOS_NOTIFICACION)[number];

export const notificacionSchema = z.object({
  id: z.uuid(),
  tipo: z.enum(TIPOS_NOTIFICACION),
  destino: z.string(),
  texto: z.string(),
  estado: z.enum(ESTADOS_NOTIFICACION),
  creadaEn: z.iso.datetime(),
  enviadaEn: z.iso.datetime().nullable(),
  error: z.string().nullable(),
  intentos: z.number().int(),
});
export type Notificacion = z.infer<typeof notificacionSchema>;
