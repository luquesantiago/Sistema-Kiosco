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
} as const;
