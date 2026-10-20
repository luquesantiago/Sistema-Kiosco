import {
  altaUsuarioSchema,
  edicionUsuarioSchema,
  restablecerContrasenaSchema,
  usuarioListadoSchema,
} from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { requiereRol, usuarioActual } from '../../plugins/sesion.js';
import { crearUsuario, editarUsuario, listarUsuarios, restablecerContrasena } from './servicio.js';

const paramsId = z.object({ id: z.uuid() });

export const rutasUsuarios: FastifyPluginAsyncZod<{ prisma: PrismaClient }> = async (
  app,
  { prisma },
) => {
  // Todo este módulo es solo para el admin.
  app.addHook('preValidation', requiereRol('admin'));

  app.get('/', { schema: { response: { 200: z.array(usuarioListadoSchema) } } }, async () =>
    listarUsuarios(prisma),
  );

  app.post(
    '/',
    { schema: { body: altaUsuarioSchema, response: { 201: usuarioListadoSchema } } },
    async (request, reply) => reply.status(201).send(await crearUsuario(prisma, request.body)),
  );

  app.patch(
    '/:id',
    {
      schema: {
        params: paramsId,
        body: edicionUsuarioSchema,
        response: { 200: usuarioListadoSchema },
      },
    },
    async (request) =>
      editarUsuario(prisma, request.params.id, request.body, usuarioActual(request).id),
  );

  app.post(
    '/:id/contrasena',
    { schema: { params: paramsId, body: restablecerContrasenaSchema } },
    async (request, reply) => {
      await restablecerContrasena(prisma, request.params.id, request.body.nueva);
      return reply.status(204).send();
    },
  );
};
