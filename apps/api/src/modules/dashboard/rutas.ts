import { dashboardQuerySchema, dashboardSchema } from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { requiereRol } from '../../plugins/sesion.js';
import { obtenerDashboard } from './servicio.js';

// Solo el admin: el empleado no ve números del negocio (el cierre es ciego).
export const rutasDashboard: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  ahora: () => Date;
}> = async (app, { prisma, ahora }) => {
  app.get(
    '/',
    {
      preValidation: requiereRol('admin'),
      schema: { querystring: dashboardQuerySchema, response: { 200: dashboardSchema } },
    },
    async (request) => obtenerDashboard(prisma, request.query, ahora()),
  );
};
