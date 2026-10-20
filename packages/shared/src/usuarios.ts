import { z } from 'zod';

export const ROLES = ['admin', 'empleado'] as const;
export const rolSchema = z.enum(ROLES);
export type Rol = z.infer<typeof rolSchema>;

/** Nombre de usuario: 3 a 30 caracteres, se guarda y se compara en minúsculas. */
export const nombreUsuarioSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,30}$/, 'Usá de 3 a 30 letras, números, punto, guion o guion bajo.');

export const contrasenaSchema = z
  .string()
  .min(8, 'La contraseña tiene que tener al menos 8 caracteres.')
  .max(200);

export const nombreSchema = z.string().trim().min(1, 'Ingresá el nombre.').max(100);

export const ingresoSchema = z.object({
  usuario: z.string().trim().toLowerCase().min(1).max(100),
  contrasena: z.string().min(1).max(200),
});
export type Ingreso = z.infer<typeof ingresoSchema>;

/** Usuario de la sesión actual, tal como lo devuelve la API. */
export const usuarioSesionSchema = z.object({
  id: z.uuid(),
  nombre: z.string(),
  usuario: z.string(),
  rol: rolSchema,
});
export type UsuarioSesion = z.infer<typeof usuarioSesionSchema>;

export const cambioContrasenaSchema = z.object({
  actual: z.string().min(1).max(200),
  nueva: contrasenaSchema,
});
export type CambioContrasena = z.infer<typeof cambioContrasenaSchema>;

export const restablecerContrasenaSchema = z.object({ nueva: contrasenaSchema });
export type RestablecerContrasena = z.infer<typeof restablecerContrasenaSchema>;

export const altaUsuarioSchema = z.object({
  nombre: nombreSchema,
  usuario: nombreUsuarioSchema,
  rol: rolSchema,
  contrasena: contrasenaSchema,
});
export type AltaUsuario = z.infer<typeof altaUsuarioSchema>;

export const edicionUsuarioSchema = z
  .object({
    nombre: nombreSchema.optional(),
    rol: rolSchema.optional(),
    activo: z.boolean().optional(),
  })
  .refine((datos) => Object.keys(datos).length > 0, 'No hay cambios para guardar.');
export type EdicionUsuario = z.infer<typeof edicionUsuarioSchema>;

/** Usuario en la lista de administración (nunca incluye la contraseña). */
export const usuarioListadoSchema = usuarioSesionSchema.extend({
  activo: z.boolean(),
  ultimoIngreso: z.iso.datetime().nullable(),
});
export type UsuarioListado = z.infer<typeof usuarioListadoSchema>;
