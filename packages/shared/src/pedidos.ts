import { z } from 'zod';
import { cuentaSchema } from './caja.js';
import { montoPositivoSchema, montoSalidaSchema } from './montos.js';
import type { DiaSemana } from './proveedores.js';
import { notaSchema } from './stock.js';
import { fechaSchema, referenciaSchema } from './ventas.js';

/** Estado de la mercadería del pedido. Si está pagado se ve aparte. */
export const ESTADOS_PEDIDO = ['por_llegar', 'llego', 'cargado', 'cancelado'] as const;
export const estadoPedidoSchema = z.enum(ESTADOS_PEDIDO);
export type EstadoPedido = z.infer<typeof estadoPedidoSchema>;

export const NOMBRE_ESTADO_PEDIDO: Record<EstadoPedido, string> = {
  por_llegar: 'Por llegar',
  llego: 'Llegó, falta cargar',
  cargado: 'Cargado',
  cancelado: 'Cancelado',
};

const motivoSchema = z.string().trim().min(3, 'Escribí el motivo (al menos 3 letras).').max(200);

export const altaPedidoSchema = z.object({
  proveedorId: z.uuid({ error: 'Elegí el proveedor.' }),
  totalPedido: montoPositivoSchema,
  llegaEl: fechaSchema,
  nota: notaSchema.default(null),
});
export type AltaPedido = z.input<typeof altaPedidoSchema>;

/** Solo mientras está por llegar. */
export const edicionPedidoSchema = z
  .object({
    totalPedido: montoPositivoSchema.optional(),
    llegaEl: fechaSchema.optional(),
    nota: notaSchema.optional(),
  })
  .refine((e) => Object.values(e).some((v) => v !== undefined), 'No hay nada para cambiar.');
export type EdicionPedido = z.input<typeof edicionPedidoSchema>;

export const cancelacionPedidoSchema = z.object({ motivo: motivoSchema });
export type CancelacionPedido = z.input<typeof cancelacionPedidoSchema>;

/** Llegó: total final y, si se paga en el momento, la cuenta. Sin cuenta, queda debiendo. */
export const llegadaPedidoSchema = z.object({
  total: montoPositivoSchema,
  notaRecepcion: notaSchema.default(null),
  cuenta: cuentaSchema.nullable().default(null),
});
export type LlegadaPedido = z.input<typeof llegadaPedidoSchema>;

/** Mercadería sin pedido previo (pan, hielo): el proveedor es obligatorio. */
export const recepcionSinPedidoSchema = z.object({
  proveedorId: z.uuid({ error: 'Elegí el proveedor.' }),
  total: montoPositivoSchema,
  nota: notaSchema.default(null),
  cuenta: cuentaSchema.nullable().default(null),
});
export type RecepcionSinPedido = z.input<typeof recepcionSinPedidoSchema>;

/** Se paga la entrega entera; el total se puede corregir al pagar. */
export const pagoPedidoSchema = z.object({
  cuenta: cuentaSchema,
  total: montoPositivoSchema.optional(),
});
export type PagoPedido = z.input<typeof pagoPedidoSchema>;

export const VISTAS_PEDIDOS = ['abiertos', 'cerrados', 'cancelados'] as const;
export const listadoPedidosQuerySchema = z.object({
  vista: z.enum(VISTAS_PEDIDOS).default('abiertos'),
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
  pagina: z.coerce.number().int().min(1).default(1),
});
export type ListadoPedidosQuery = z.input<typeof listadoPedidosQuerySchema>;

export const PEDIDOS_POR_PAGINA = 50;

export const pedidoResumenSchema = z.object({
  id: z.uuid(),
  numero: z.number().int(),
  proveedor: referenciaSchema,
  totalPedido: montoSalidaSchema,
  /** Total final; null hasta que llega. */
  total: montoSalidaSchema.nullable(),
  llegaEl: fechaSchema,
  nota: z.string().nullable(),
  estado: estadoPedidoSchema,
  /** Cuenta con la que se pagó; null si está sin pagar. */
  cuentaPago: cuentaSchema.nullable(),
  cerradoEn: z.iso.datetime().nullable(),
});
export type PedidoResumen = z.infer<typeof pedidoResumenSchema>;

const quienCuandoSchema = z.object({ usuario: referenciaSchema, en: z.iso.datetime() });

export const pedidoDetalleSchema = pedidoResumenSchema.extend({
  creado: quienCuandoSchema,
  recibido: quienCuandoSchema.nullable(),
  notaRecepcion: z.string().nullable(),
  cancelado: quienCuandoSchema.extend({ motivo: z.string() }).nullable(),
  carga: quienCuandoSchema
    .extend({ ingresoId: z.uuid(), cantidadProductos: z.number().int() })
    .nullable(),
  pago: quienCuandoSchema.extend({ cuenta: cuentaSchema, monto: montoSalidaSchema }).nullable(),
});
export type PedidoDetalle = z.infer<typeof pedidoDetalleSchema>;

/** Producto para cargar un pedido: el costo lo ven el admin y el empleado. */
export const productoCargaSchema = z.object({
  id: z.uuid(),
  codigoBarras: z.string().nullable(),
  nombre: z.string(),
  costo: montoSalidaSchema.nullable(),
});
export type ProductoCarga = z.infer<typeof productoCargaSchema>;

const ORDEN_DIA: Record<number, DiaSemana> = {
  0: 'domingo',
  1: 'lunes',
  2: 'martes',
  3: 'miercoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sabado',
};

/** "AAAA-MM-DD" más `dias` días (las fechas se tratan en UTC para no correrse). */
function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Próximo día de entrega del proveedor a partir de mañana, o mañana si no
 * tiene días de entrega. Es el valor precargado al crear un pedido.
 */
export function proximoDiaDeEntrega(diasEntrega: readonly DiaSemana[], hoy: string): string {
  for (let i = 1; i <= 7; i++) {
    const fecha = sumarDias(hoy, i);
    const dia = ORDEN_DIA[new Date(`${fecha}T00:00:00Z`).getUTCDay()]!;
    if (diasEntrega.includes(dia)) return fecha;
  }
  return sumarDias(hoy, 1);
}
