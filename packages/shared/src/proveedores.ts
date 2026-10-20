import { z } from 'zod';
import { nombreSchema } from './usuarios.js';

export const DIAS_SEMANA = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
] as const;
export const diaSemanaSchema = z.enum(DIAS_SEMANA);
export type DiaSemana = z.infer<typeof diaSemanaSchema>;

export const NOMBRE_DIA: Record<DiaSemana, string> = {
  lunes: 'Lunes',
  martes: 'Martes',
  miercoles: 'Miércoles',
  jueves: 'Jueves',
  viernes: 'Viernes',
  sabado: 'Sábado',
  domingo: 'Domingo',
};

/** De cero a siete días; se quitan los repetidos y quedan en orden de la semana. */
const diasSchema = z
  .array(diaSemanaSchema)
  .max(7)
  .transform((dias) => DIAS_SEMANA.filter((d) => dias.includes(d)));

/** Texto opcional: vacío o solo espacios se guarda como null. */
function textoOpcional(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((t) => (t ? t : null));
}

export const altaProveedorSchema = z.object({
  nombre: nombreSchema,
  telefono: textoOpcional(30).default(null),
  notas: textoOpcional(500).default(null),
  diasPedido: diasSchema.default([]),
  diasEntrega: diasSchema.default([]),
});
export type AltaProveedor = z.input<typeof altaProveedorSchema>;

export const edicionProveedorSchema = z
  .object({
    nombre: nombreSchema.optional(),
    telefono: textoOpcional(30).optional(),
    notas: textoOpcional(500).optional(),
    diasPedido: diasSchema.optional(),
    diasEntrega: diasSchema.optional(),
    activo: z.boolean().optional(),
  })
  .refine((datos) => Object.keys(datos).length > 0, 'No hay cambios para guardar.');
export type EdicionProveedor = z.input<typeof edicionProveedorSchema>;

export const listadoProveedoresQuerySchema = z.object({
  incluirInactivos: z.stringbool().default(false),
});

export const proveedorListadoSchema = z.object({
  id: z.uuid(),
  nombre: z.string(),
  telefono: z.string().nullable(),
  notas: z.string().nullable(),
  diasPedido: z.array(diaSemanaSchema),
  diasEntrega: z.array(diaSemanaSchema),
  activo: z.boolean(),
  /** Calculado en la API con la hora de Argentina. */
  tomaPedidoHoy: z.boolean(),
  productosActivos: z.number().int(),
});
export type ProveedorListado = z.infer<typeof proveedorListadoSchema>;
