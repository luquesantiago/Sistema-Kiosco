import { z } from 'zod';

/** Formato común de los errores de la API. */
export const errorApiSchema = z.object({
  error: z.object({
    codigo: z.string(),
    mensaje: z.string(),
  }),
});

export type ErrorApi = z.infer<typeof errorApiSchema>;

export const CODIGOS_ERROR = {
  validacion: 'VALIDACION',
  noEncontrado: 'NO_ENCONTRADO',
  interno: 'ERROR_INTERNO',
  credencialesInvalidas: 'CREDENCIALES_INVALIDAS',
  noAutenticado: 'NO_AUTENTICADO',
  sinPermiso: 'SIN_PERMISO',
  ingresoBloqueado: 'INGRESO_BLOQUEADO',
  usuarioExistente: 'USUARIO_EXISTENTE',
  ultimoAdmin: 'ULTIMO_ADMIN',
  autoDesactivacion: 'NO_PUEDE_DESACTIVARSE',
  contrasenaActualIncorrecta: 'CONTRASENA_ACTUAL_INCORRECTA',
  codigoExistente: 'CODIGO_EXISTENTE',
  proveedorInactivo: 'PROVEEDOR_INACTIVO',
  productoNoEncontrado: 'PRODUCTO_NO_ENCONTRADO',
  costoNoPermitido: 'COSTO_NO_PERMITIDO',
} as const;
