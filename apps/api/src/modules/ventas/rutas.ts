import {
  anulacionSchema,
  listadoVentasQuerySchema,
  ventaDetalleSchema,
  ventaEntradaSchema,
  ventaResumenSchema,
} from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { requiereSesion, usuarioActual } from '../../plugins/sesion.js';
import { anularVenta, listarVentas, obtenerVenta, registrarVenta } from './servicio.js';

const paramsId = z.object({ id: z.uuid() });

// Admin y empleado venden, listan y anulan; el servicio aplica la regla de
// "solo ventas de hoy" para el empleado.
export const rutasVentas: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  ahora: () => Date;
}> = async (app, { prisma, ahora }) => {
  app.addHook('preValidation', requiereSesion);

  app.post(
    '/',
    { schema: { body: ventaEntradaSchema, response: { 201: ventaDetalleSchema } } },
    async (request, reply) =>
      reply
        .status(201)
        .send(await registrarVenta(prisma, request.body, usuarioActual(request).id, ahora())),
  );

  app.get(
    '/',
    {
      schema: {
        querystring: listadoVentasQuerySchema,
        response: { 200: z.array(ventaResumenSchema) },
      },
    },
    async (request) => listarVentas(prisma, request.query, usuarioActual(request), ahora()),
  );

  app.get(
    '/:id',
    { schema: { params: paramsId, response: { 200: ventaDetalleSchema } } },
    async (request) => obtenerVenta(prisma, request.params.id, usuarioActual(request), ahora()),
  );

  app.post(
    '/:id/anular',
    {
      schema: { params: paramsId, body: anulacionSchema, response: { 200: ventaDetalleSchema } },
    },
    async (request) =>
      anularVenta(prisma, request.params.id, request.body, usuarioActual(request), ahora()),
  );
};
