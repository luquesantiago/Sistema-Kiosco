import {
  altaProveedorSchema,
  edicionProveedorSchema,
  listadoProveedoresQuerySchema,
  proveedorListadoSchema,
} from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { requiereRol } from '../../plugins/sesion.js';
import { crearProveedor, editarProveedor, listarProveedores } from './servicio.js';

const paramsId = z.object({ id: z.uuid() });

export const rutasProveedores: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  ahora: () => Date;
}> = async (app, { prisma, ahora }) => {
  // Todo este módulo es solo para el admin.
  app.addHook('preValidation', requiereRol('admin'));

  app.get(
    '/',
    {
      schema: {
        querystring: listadoProveedoresQuerySchema,
        response: { 200: z.array(proveedorListadoSchema) },
      },
    },
    async (request) => listarProveedores(prisma, request.query, ahora()),
  );

  app.post(
    '/',
    { schema: { body: altaProveedorSchema, response: { 201: proveedorListadoSchema } } },
    async (request, reply) =>
      reply.status(201).send(await crearProveedor(prisma, request.body, ahora())),
  );

  app.patch(
    '/:id',
    {
      schema: {
        params: paramsId,
        body: edicionProveedorSchema,
        response: { 200: proveedorListadoSchema },
      },
    },
    async (request) => editarProveedor(prisma, request.params.id, request.body, ahora()),
  );
};
