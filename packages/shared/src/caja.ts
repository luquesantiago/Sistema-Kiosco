import { z } from 'zod';
import { comparar } from './decimales.js';
import { montoPositivoSchema, montoSalidaSchema, montoSchema } from './montos.js';
import { MEDIOS_PAGO, referenciaSchema } from './ventas.js';

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

export const TIPOS_MOVIMIENTO_CAJA = ['gasto', 'retiro', 'ingreso'] as const;
export const tipoMovimientoCajaSchema = z.enum(TIPOS_MOVIMIENTO_CAJA);
export type TipoMovimientoCaja = z.infer<typeof tipoMovimientoCajaSchema>;

export const NOMBRE_MOVIMIENTO_CAJA: Record<TipoMovimientoCaja, string> = {
  gasto: 'Gasto',
  retiro: 'Retiro',
  ingreso: 'Ingreso',
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

/** El gasto exige categoría; el retiro y el ingreso no la aceptan. */
export const movimientoCajaEntradaSchema = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('gasto'),
    categoria: categoriaGastoSchema,
    monto: montoPositivoSchema,
    motivo: motivoSchema,
  }),
  z.object({
    tipo: z.enum(['retiro', 'ingreso']),
    categoria: z.null({ error: 'Solo los gastos llevan categoría.' }).optional(),
    monto: montoPositivoSchema,
    motivo: motivoSchema,
  }),
]);
export type MovimientoCajaEntrada = z.input<typeof movimientoCajaEntradaSchema>;

export const movimientoCajaSchema = z.object({
  id: z.uuid(),
  tipo: tipoMovimientoCajaSchema,
  categoria: categoriaGastoSchema.nullable(),
  monto: montoSalidaSchema,
  motivo: z.string(),
  usuario: referenciaSchema,
  creadoEn: z.iso.datetime(),
});
export type MovimientoCaja = z.infer<typeof movimientoCajaSchema>;

/** "Gasto · Insumos" o "Retiro": cómo se nombra un movimiento en los listados. */
export function nombreMovimientoCaja(m: Pick<MovimientoCaja, 'tipo' | 'categoria'>): string {
  const tipo = NOMBRE_MOVIMIENTO_CAJA[m.tipo];
  return m.categoria ? `${tipo} · ${NOMBRE_CATEGORIA_GASTO[m.categoria]}` : tipo;
}

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

/** Cómo se llega al esperado: monto inicial + efectivo vendido + ingresos - gastos - retiros - anulado. */
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
  efectivoAnulado: montoSalidaSchema,
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
  /** Ventas anuladas durante este turno con pago en efectivo, que salieron de esta caja. */
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
