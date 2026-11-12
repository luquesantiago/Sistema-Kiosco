import { z } from 'zod';
import { CATEGORIAS_GASTO } from './caja.js';
import { montoSalidaSchema } from './montos.js';
import { fechaSchema, MEDIOS_PAGO } from './ventas.js';

/** Atajos de período; "fechas" es un rango elegido a mano. */
export const PERIODOS = ['hoy', 'ayer', 'semana', 'mes', 'mes_anterior'] as const;
export type Periodo = (typeof PERIODOS)[number];

export const NOMBRE_PERIODO: Record<Periodo, string> = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  semana: 'Semana',
  mes: 'Mes',
  mes_anterior: 'Mes anterior',
};

export interface Rango {
  desde: string;
  hasta: string;
}

// Las fechas "AAAA-MM-DD" se tratan en UTC para que no se corran de día.
const aFecha = (f: string) => new Date(`${f}T00:00:00Z`);
const aTexto = (d: Date) => d.toISOString().slice(0, 10);

function sumarDias(fecha: string, dias: number): string {
  const d = aFecha(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return aTexto(d);
}

/** Último día del mes de la fecha. */
function finDeMes(fecha: string): string {
  const d = aFecha(fecha);
  return aTexto(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** Primer día del mes anterior al de la fecha. */
function inicioDelMesAnterior(fecha: string): string {
  const d = aFecha(fecha);
  return aTexto(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)));
}

const diasEntre = (desde: string, hasta: string) =>
  Math.round((aFecha(hasta).getTime() - aFecha(desde).getTime()) / 86_400_000);

/** Fechas de un atajo, con `hoy` en Argentina. La semana empieza el lunes. */
export function rangoDelPeriodo(periodo: Periodo, hoy: string): Rango {
  switch (periodo) {
    case 'hoy':
      return { desde: hoy, hasta: hoy };
    case 'ayer': {
      const ayer = sumarDias(hoy, -1);
      return { desde: ayer, hasta: ayer };
    }
    case 'semana': {
      const diaSemana = (aFecha(hoy).getUTCDay() + 6) % 7; // lunes = 0
      return { desde: sumarDias(hoy, -diaSemana), hasta: hoy };
    }
    case 'mes':
      return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
    case 'mes_anterior': {
      const desde = inicioDelMesAnterior(hoy);
      return { desde, hasta: finDeMes(desde) };
    }
  }
}

/**
 * Período contra el que se compara: un mes completo contra el mes anterior
 * completo; un mes empezado contra los mismos días del mes anterior (recortado
 * a su último día); cualquier otro rango contra el mismo largo justo antes.
 */
export function periodoAnterior({ desde, hasta }: Rango): Rango {
  const mismoMes = desde.slice(0, 7) === hasta.slice(0, 7);
  if (desde.endsWith('-01') && mismoMes) {
    const inicio = inicioDelMesAnterior(desde);
    const ultimo = finDeMes(inicio);
    if (hasta === finDeMes(hasta)) return { desde: inicio, hasta: ultimo };
    const mismoDia = `${inicio.slice(0, 8)}${hasta.slice(8, 10)}`;
    return { desde: inicio, hasta: mismoDia > ultimo ? ultimo : mismoDia };
  }
  const largo = diasEntre(desde, hasta);
  const fin = sumarDias(desde, -1);
  return { desde: sumarDias(fin, -largo), hasta: fin };
}

/** Variación porcentual redondeada; null si no hay base para comparar. */
export function variacion(actual: string, anterior: string): number | null {
  const base = Number(anterior);
  if (base === 0) return null;
  return Math.round(((Number(actual) - base) / base) * 100);
}

export const dashboardQuerySchema = z.object({
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
});
export type DashboardQuery = z.input<typeof dashboardQuerySchema>;

const rangoSchema = z.object({ desde: fechaSchema, hasta: fechaSchema });
const conVariacion = z.object({
  total: montoSalidaSchema,
  anterior: montoSalidaSchema,
  variacion: z.number().nullable(),
});
const cantidadYTotal = z.object({ cantidad: z.number().int(), total: montoSalidaSchema });

const productoVendidoSchema = z.object({
  productoId: z.uuid(),
  nombre: z.string(),
  unidades: z.number().int(),
  importe: montoSalidaSchema,
  /** Null si alguna venta del producto no tiene costo. */
  ganancia: montoSalidaSchema.nullable(),
});
export type ProductoVendido = z.infer<typeof productoVendidoSchema>;

export const AGRUPACIONES = ['hora', 'dia', 'semana'] as const;

export const dashboardSchema = z.object({
  periodo: rangoSchema,
  anterior: rangoSchema,
  /** Estado actual, sin importar el período. */
  ahora: z.object({
    efectivoEnCaja: montoSalidaSchema,
    turnoAbierto: z.boolean(),
    pendiente: z.object({
      total: montoSalidaSchema,
      porLlegar: cantidadYTotal,
      deben: cantidadYTotal,
    }),
  }),
  ventas: conVariacion.extend({ cantidad: z.number().int() }),
  /** Solo de los ítems con costo; `margen` sobre lo vendido con costo. */
  ganancia: conVariacion.extend({ margen: z.number().nullable() }),
  /** Vendido en ítems sin costo, incluido "Varios". */
  sinCosto: montoSalidaSchema,
  gastos: z.object({
    total: montoSalidaSchema,
    porCategoria: z.object(
      Object.fromEntries(CATEGORIAS_GASTO.map((c) => [c, montoSalidaSchema])) as Record<
        (typeof CATEGORIAS_GASTO)[number],
        typeof montoSalidaSchema
      >,
    ),
  }),
  /** Ganancia − gastos. */
  resultado: montoSalidaSchema,
  serie: z.object({
    agrupacion: z.enum(AGRUPACIONES),
    /** `inicio`: "AAAA-MM-DD" (día o semana) o "AAAA-MM-DDTHH" (hora), en Argentina. */
    puntos: z.array(z.object({ inicio: z.string(), total: montoSalidaSchema })),
  }),
  medios: z.object(
    Object.fromEntries(MEDIOS_PAGO.map((m) => [m, montoSalidaSchema])) as Record<
      (typeof MEDIOS_PAGO)[number],
      typeof montoSalidaSchema
    >,
  ),
  masVendidos: z.object({
    unidades: z.array(productoVendidoSchema),
    importe: z.array(productoVendidoSchema),
    ganancia: z.array(productoVendidoSchema),
  }),
  movimientos: z.object({
    pagosProveedor: z.object({
      total: montoSalidaSchema,
      efectivo: montoSalidaSchema,
      mercadoPago: montoSalidaSchema,
    }),
    retiros: montoSalidaSchema,
    ingresos: montoSalidaSchema,
    /** Suma de diferencias de los turnos cerrados y cuántos tuvieron diferencia. */
    diferencias: z.object({ total: montoSalidaSchema, turnos: z.number().int() }),
    anuladas: cantidadYTotal,
  }),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
