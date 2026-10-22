import { z } from 'zod';
import { comparar } from './decimales.js';
import { montoPositivoSchema, montoSalidaSchema, montoSchema } from './montos.js';
import { fechaSchema, MEDIOS_PAGO, referenciaSchema } from './ventas.js';

const motivoSchema = z.string().trim().min(3, 'Escribí el motivo (al menos 3 letras).').max(200);

/** Apertura: lo que contó quien abre. El sugerido lo calcula el servidor. */
export const aperturaSchema = z.object({ montoInicial: montoSchema });
export type Apertura = z.input<typeof aperturaSchema>;

/** Cierre ciego: lo contado y, opcionalmente, un retiro con motivo. */
export const cierreSchema = z
  .object({
    montoContado: montoSchema,
    retiro: montoSchema.nullish(),
    motivoRetiro: z.string().trim().max(200).nullish(),
  })
  .transform(({ montoContado, retiro, motivoRetiro }) => {
    // Un retiro de $0 es lo mismo que no retirar.
    const hayRetiro = retiro != null && comparar(retiro, 0) > 0;
    return {
      montoContado,
      retiro: hayRetiro ? retiro : null,
      motivoRetiro: hayRetiro ? (motivoRetiro ?? '') : null,
    };
  })
  .superRefine((cierre, ctx) => {
    if (cierre.retiro === null) return;
    if ((cierre.motivoRetiro ?? '').length < 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['motivoRetiro'],
        message: 'Escribí el motivo del retiro (al menos 3 letras).',
      });
    }
    if (comparar(cierre.retiro, cierre.montoContado) > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['retiro'],
        message: 'No podés retirar más de lo que contaste.',
      });
    }
  });
export type Cierre = z.input<typeof cierreSchema>;

/** `pago_proveedor` solo lo crea el pago de un pedido; no se registra suelto. */
export const TIPOS_MOVIMIENTO_CAJA = ['gasto', 'retiro', 'ingreso', 'pago_proveedor'] as const;
export const tipoMovimientoCajaSchema = z.enum(TIPOS_MOVIMIENTO_CAJA);
/** Los que se registran sueltos, desde F8 o la pantalla de Mercado Pago. */
export const TIPOS_MOVIMIENTO_SUELTO = ['gasto', 'retiro', 'ingreso'] as const;
export type TipoMovimientoSuelto = (typeof TIPOS_MOVIMIENTO_SUELTO)[number];
export type TipoMovimientoCaja = z.infer<typeof tipoMovimientoCajaSchema>;

export const NOMBRE_MOVIMIENTO_CAJA: Record<TipoMovimientoCaja, string> = {
  gasto: 'Gasto',
  retiro: 'Retiro',
  ingreso: 'Ingreso',
  pago_proveedor: 'Pago a proveedor',
};

/** Lista fija: los pagos a proveedor no son gastos (van por pedidos). */
export const CATEGORIAS_GASTO = ['servicios', 'insumos', 'otro'] as const;
export const categoriaGastoSchema = z.enum(CATEGORIAS_GASTO, {
  error: 'Elegí la categoría del gasto.',
});
export type CategoriaGasto = z.infer<typeof categoriaGastoSchema>;

export const NOMBRE_CATEGORIA_GASTO: Record<CategoriaGasto, string> = {
  servicios: 'Servicios',
  insumos: 'Insumos',
  otro: 'Otro',
};

/** De dónde sale o adónde entra la plata: el cajón o la cuenta de MP del kiosco. */
export const CUENTAS = ['efectivo', 'mercado_pago'] as const;
export const cuentaSchema = z.enum(CUENTAS);
export type Cuenta = z.infer<typeof cuentaSchema>;

export const NOMBRE_CUENTA: Record<Cuenta, string> = {
  efectivo: 'Efectivo',
  mercado_pago: 'Mercado Pago',
};

/** El gasto exige categoría; el retiro y el ingreso no la aceptan. Sin cuenta, es efectivo. */
export const movimientoCajaEntradaSchema = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('gasto'),
    categoria: categoriaGastoSchema,
    cuenta: cuentaSchema.default('efectivo'),
    monto: montoPositivoSchema,
    motivo: motivoSchema,
  }),
  z.object({
    tipo: z.enum(['retiro', 'ingreso']),
    categoria: z.null({ error: 'Solo los gastos llevan categoría.' }).optional(),
    cuenta: cuentaSchema.default('efectivo'),
    monto: montoPositivoSchema,
    motivo: motivoSchema,
  }),
]);
export type MovimientoCajaEntrada = z.input<typeof movimientoCajaEntradaSchema>;

export const movimientoCajaSchema = z.object({
  id: z.uuid(),
  tipo: tipoMovimientoCajaSchema,
  categoria: categoriaGastoSchema.nullable(),
  cuenta: cuentaSchema,
  /** Vacío solo en movimientos de Mercado Pago del admin sin turno abierto. */
  turnoId: z.uuid().nullable(),
  monto: montoSalidaSchema,
  motivo: z.string(),
  usuario: referenciaSchema,
  creadoEn: z.iso.datetime(),
});
export type MovimientoCaja = z.infer<typeof movimientoCajaSchema>;

/** "Gasto · Insumos · Mercado Pago" o "Retiro": cómo se nombra un movimiento en los listados. */
export function nombreMovimientoCaja(
  m: Pick<MovimientoCaja, 'tipo' | 'categoria' | 'cuenta'>,
): string {
  const partes = [NOMBRE_MOVIMIENTO_CAJA[m.tipo]];
  if (m.categoria) partes.push(NOMBRE_CATEGORIA_GASTO[m.categoria]);
  if (m.cuenta === 'mercado_pago') partes.push(NOMBRE_CUENTA.mercado_pago);
  return partes.join(' · ');
}

/** Movimientos de Mercado Pago del admin, por rango de fechas en hora de Argentina. */
export const listadoMovimientosMpQuerySchema = z.object({
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
  pagina: z.coerce.number().int().min(1).default(1),
});
export type ListadoMovimientosMpQuery = z.input<typeof listadoMovimientosMpQuerySchema>;

export const MOVIMIENTOS_MP_POR_PAGINA = 50;

/** Lo que necesita el mostrador para decidir si pide abrir, cerrar o deja vender. */
export const estadoCajaSchema = z.object({
  turnoAbierto: z
    .object({
      id: z.uuid(),
      responsable: referenciaSchema,
      abiertoEn: z.iso.datetime(),
      esMio: z.boolean(),
    })
    .nullable(),
  /** Lo que quedó en caja al cerrar el último turno ($0 si nunca hubo uno). */
  montoSugerido: montoSalidaSchema,
});
export type EstadoCaja = z.infer<typeof estadoCajaSchema>;

/** Respuesta del cierre. El empleado no recibe `esperado` ni `diferencia` (cierre ciego). */
export const cierreRespuestaSchema = z.object({
  id: z.uuid(),
  quedoEnCaja: montoSalidaSchema,
  esperado: montoSalidaSchema.optional(),
  diferencia: montoSalidaSchema.optional(),
});
export type CierreRespuesta = z.infer<typeof cierreRespuestaSchema>;

/**
 * Cómo se llega al esperado: monto inicial + efectivo vendido + ingresos - gastos - retiros -
 * devoluciones. Solo cuentan los movimientos en efectivo; las anulaciones se devuelven siempre
 * en efectivo, por el total de la venta.
 */
export const resumenCajaSchema = z.object({
  cantidadVentas: z.number().int(),
  porMedio: z.object(
    Object.fromEntries(MEDIOS_PAGO.map((m) => [m, montoSalidaSchema])) as Record<
      (typeof MEDIOS_PAGO)[number],
      typeof montoSalidaSchema
    >,
  ),
  montoInicial: montoSalidaSchema,
  efectivoVendido: montoSalidaSchema,
  ingresos: montoSalidaSchema,
  gastos: montoSalidaSchema,
  retiros: montoSalidaSchema,
  pagosProveedor: montoSalidaSchema,
  devoluciones: montoSalidaSchema,
  esperado: montoSalidaSchema,
});
export type ResumenCaja = z.infer<typeof resumenCajaSchema>;

export const turnoResumenSchema = z.object({
  id: z.uuid(),
  responsable: referenciaSchema,
  cerradoPor: referenciaSchema.nullable(),
  abiertoEn: z.iso.datetime(),
  cerradoEn: z.iso.datetime().nullable(),
  montoSugerido: montoSalidaSchema,
  montoInicial: montoSalidaSchema,
  diferenciaApertura: montoSalidaSchema,
  /** Null mientras el turno está abierto. */
  diferencia: montoSalidaSchema.nullable(),
});
export type TurnoResumen = z.infer<typeof turnoResumenSchema>;

export const turnoDetalleSchema = turnoResumenSchema.extend({
  /** En vivo si el turno está abierto; con el esperado de la foto del cierre si está cerrado. */
  resumen: resumenCajaSchema,
  montoContado: montoSalidaSchema.nullable(),
  retiroCierre: montoSalidaSchema.nullable(),
  motivoRetiroCierre: z.string().nullable(),
  quedoEnCaja: montoSalidaSchema.nullable(),
  movimientos: z.array(movimientoCajaSchema),
  /** Ventas anuladas durante este turno: su total se devolvió en efectivo de esta caja. */
  anulaciones: z.array(
    z.object({
      ventaId: z.uuid(),
      numero: z.number().int(),
      efectivo: montoSalidaSchema,
      anuladaEn: z.iso.datetime(),
      motivo: z.string(),
    }),
  ),
});
export type TurnoDetalle = z.infer<typeof turnoDetalleSchema>;

export const TURNOS_POR_PAGINA = 30;
