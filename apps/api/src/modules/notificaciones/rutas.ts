import { notificacionSchema, paginaSchema } from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { requiereRol } from '../../plugins/sesion.js';

export const NOTIFICACIONES_POR_PAGINA = 50;

// Avisos para el admin. En la Etapa 1 solo se crean y se listan; el envío por
// WAHA llega en la Etapa 2.
export const rutasNotificaciones: FastifyPluginAsyncZod<{ prisma: PrismaClient }> = async (
  app,
  { prisma },
) => {
  app.addHook('preValidation', requiereRol('admin'));

  app.get(
    '/',
    { schema: { querystring: paginaSchema, response: { 200: z.array(notificacionSchema) } } },
    async (request) => {
      const avisos = await prisma.notificacion.findMany({
        orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
        skip: (request.query.pagina - 1) * NOTIFICACIONES_POR_PAGINA,
        take: NOTIFICACIONES_POR_PAGINA,
      });
      return avisos.map((a) => ({
        ...a,
        creadaEn: a.creadaEn.toISOString(),
        enviadaEn: a.enviadaEn?.toISOString() ?? null,
      }));
    },
  );
};
