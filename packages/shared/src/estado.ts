import { z } from 'zod';

/** Respuesta de `GET /api/health` (spec `estado-del-servicio`). */
export const estadoServicioSchema = z.object({
  estado: z.enum(['ok', 'degradado']),
  baseDeDatos: z.enum(['ok', 'error']),
  hora: z.iso.datetime(),
});

export type EstadoServicio = z.infer<typeof estadoServicioSchema>;
