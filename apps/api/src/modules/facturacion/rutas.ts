import { estadoFacturacionSchema, facturaListadoSchema } from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { requiereRol } from '../../plugins/sesion.js';
import { estadoDeFacturacion, reintentarFactura } from './servicio.js';
import type { Facturacion } from './tipos.js';

const soloAdmin = { preValidation: requiereRol('admin') };

// Estado de la facturación (`/api/facturacion`), solo del admin. Se registra
// siempre: sin ARCA configurado responde `no_configurado`.
export const rutasFacturacion: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  facturacion?: Facturacion;
}> = async (app, { prisma, facturacion }) => {
  app.get('/', { ...soloAdmin, schema: { response: { 200: estadoFacturacionSchema } } }, async () =>
    estadoDeFacturacion(prisma, facturacion),
  );
};

// Reintento manual de una factura con error (`/api/facturas`), solo del admin.
export const rutasFacturas: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  facturacion?: Facturacion;
}> = async (app, { prisma, facturacion }) => {
  app.post(
    '/:id/reintentar',
    {
      ...soloAdmin,
      schema: { params: z.object({ id: z.uuid() }), response: { 200: facturaListadoSchema } },
    },
    async (request) => {
      const factura = await reintentarFactura(prisma, request.params.id);
      facturacion?.despertar();
      return factura;
    },
  );
};
