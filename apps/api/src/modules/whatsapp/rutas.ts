import {
  destinoWhatsappEntradaSchema,
  estadoWhatsappSchema,
  qrWhatsappSchema,
} from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { requiereRol, usuarioActual } from '../../plugins/sesion.js';
import type { ClienteWhatsapp } from './cliente.js';
import {
  desvincular,
  estadoWhatsapp,
  guardarDestino,
  mandarPrueba,
  qr,
  vincular,
} from './servicio.js';

const respuestaEstado = { response: { 200: estadoWhatsappSchema } };

// Conexión con WhatsApp: solo el admin. Sin `whatsapp` (no hay WAHA_URL) el
// estado es `no_configurado` y el resto responde 409.
export const rutasWhatsapp: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  whatsapp?: ClienteWhatsapp;
}> = async (app, { prisma, whatsapp }) => {
  app.addHook('preValidation', requiereRol('admin'));

  app.get('/', { schema: respuestaEstado }, async () => estadoWhatsapp(prisma, whatsapp));

  app.post('/vincular', { schema: respuestaEstado }, async () => vincular(prisma, whatsapp));

  app.get('/qr', { schema: { response: { 200: qrWhatsappSchema } } }, async () => ({
    imagen: await qr(whatsapp),
  }));

  app.post('/desvincular', { schema: respuestaEstado }, async () => desvincular(prisma, whatsapp));

  app.put(
    '/destino',
    { schema: { body: destinoWhatsappEntradaSchema, ...respuestaEstado } },
    async (request) =>
      guardarDestino(prisma, whatsapp, request.body.numero, usuarioActual(request).id),
  );

  app.post('/prueba', async (_request, reply) => {
    await mandarPrueba(prisma, whatsapp);
    return reply.status(204).send();
  });
};
