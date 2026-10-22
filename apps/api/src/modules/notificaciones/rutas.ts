import { CODIGOS_ERROR, notificacionSchema, paginaSchema } from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ErrorHttp } from '../../errores.js';
import type { Notificacion, PrismaClient } from '../../generated/prisma/client.js';
import { requiereRol } from '../../plugins/sesion.js';

export const NOTIFICACIONES_POR_PAGINA = 50;

const salida = (a: Notificacion) => ({
  ...a,
  creadaEn: a.creadaEn.toISOString(),
  enviadaEn: a.enviadaEn?.toISOString() ?? null,
});

// Avisos para el admin. Se crean junto con la operación que avisan y los envía
// por WhatsApp el proceso de modules/whatsapp/envio.ts.
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
      return avisos.map(salida);
    },
  );

  // Solo los avisos en `error`: el condicional en el UPDATE evita reintentar
  // uno que el proceso de envío acaba de mandar.
  app.post(
    '/:id/reintentar',
    {
      schema: { params: z.object({ id: z.uuid() }), response: { 200: notificacionSchema } },
    },
    async (request) => {
      const { id } = request.params;
      const { count } = await prisma.notificacion.updateMany({
        where: { id, estado: 'error' },
        data: { estado: 'pendiente', intentos: 0, proximoIntentoEn: null, error: null },
      });
      const aviso = await prisma.notificacion.findUnique({ where: { id } });
      if (!aviso) {
        throw new ErrorHttp(404, CODIGOS_ERROR.noEncontrado, 'No existe ese aviso.');
      }
      if (count === 0) {
        throw new ErrorHttp(
          409,
          CODIGOS_ERROR.avisoNoReintentable,
          'Solo se pueden reintentar los avisos con error.',
        );
      }
      return salida(aviso);
    },
  );
};
