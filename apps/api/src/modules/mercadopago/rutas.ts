import {
  CODIGOS_ERROR,
  cobroARevisarSchema,
  cobroMpSchema,
  revisionCobroSchema,
  saldoMercadoPagoSchema,
} from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ConfigPoint } from '../../config.js';
import { errorApi } from '../../errores.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { ClienteMercadoPago } from '../../integrations/mercadopago/cliente.js';
import { requiereRol, requiereSesion, usuarioActual } from '../../plugins/sesion.js';
import type { Facturacion } from '../facturacion/tipos.js';
import {
  cobrosARevisar,
  confirmarDevolucion,
  marcarRevisado,
  marcarSinDevolver,
} from './cobros.js';
import { crearServicioSaldo } from './saldo.js';
import { procesarNotificacion } from './webhook.js';

const paramsId = z.object({ id: z.uuid() });

/** Tope del cuerpo de una notificación de Mercado Pago. */
const LIMITE_WEBHOOK_BYTES = 64 * 1024;

const encabezado = (valor: string | string[] | undefined) =>
  Array.isArray(valor) ? valor[0] : valor;

// Mercado Pago: el saldo lo ven el admin y el empleado (en Caja, F8). Sin
// `mercadoPago` (no hay MP_ACCESS_TOKEN) el saldo es `no_configurado`. El token
// nunca sale del servidor: la respuesta solo trae montos, hora y motivo.
// Cobro con el Point: el webhook es la única ruta sin sesión (la protege la firma); la
// devolución en efectivo la confirma quien opera el turno; los cobros a revisar son del admin.
export const rutasMercadoPago: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  mercadoPago?: ClienteMercadoPago;
  point?: ConfigPoint;
  facturacion?: Facturacion;
  ahora: () => Date;
}> = async (app, { prisma, mercadoPago, point, facturacion, ahora }) => {
  const saldo = crearServicioSaldo({ cliente: mercadoPago, ahora });

  app.get(
    '/saldo',
    { preValidation: requiereSesion, schema: { response: { 200: saldoMercadoPagoSchema } } },
    async () => saldo.obtener(),
  );

  // Sin clave secreta (o con firma inválida) responde 401 sin hacer nada; los cobros se
  // siguen resolviendo por la consulta de respaldo. MP espera la respuesta hasta 22 s.
  app.post('/webhook', { bodyLimit: LIMITE_WEBHOOK_BYTES }, async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const deQuery = (clave: string) => {
      const valor = query[clave];
      return typeof valor === 'string' ? valor : undefined;
    };
    const valida = await procesarNotificacion(
      {
        prisma,
        // Sin Point configurado no hay cobros que actualizar.
        mercadoPago: point ? mercadoPago : undefined,
        webhookSecret: point?.webhookSecret,
        facturacion,
        ahora,
      },
      {
        dataId: deQuery('data.id'),
        tipo: deQuery('type'),
        xSignature: encabezado(request.headers['x-signature']),
        xRequestId: encabezado(request.headers['x-request-id']),
        cuerpo: request.body,
      },
    );
    if (!valida) {
      return reply
        .status(401)
        .send(errorApi(CODIGOS_ERROR.firmaInvalida, 'La notificación no tiene una firma válida.'));
    }
    return reply.status(200).send({ recibida: true });
  });

  app.post(
    '/cobros/:id/devolucion',
    {
      preValidation: requiereSesion,
      schema: { params: paramsId, response: { 200: cobroMpSchema } },
    },
    async (request) =>
      confirmarDevolucion(prisma, request.params.id, usuarioActual(request), ahora()),
  );

  app.post(
    '/cobros/:id/sin-devolver',
    {
      preValidation: requiereSesion,
      schema: { params: paramsId, response: { 200: cobroMpSchema } },
    },
    async (request) =>
      marcarSinDevolver(prisma, request.params.id, usuarioActual(request), ahora()),
  );

  app.get(
    '/cobros-a-revisar',
    {
      preValidation: requiereRol('admin'),
      schema: { response: { 200: z.array(cobroARevisarSchema) } },
    },
    async () => cobrosARevisar(prisma),
  );

  app.post(
    '/cobros/:id/revisado',
    {
      preValidation: requiereRol('admin'),
      schema: {
        params: paramsId,
        body: revisionCobroSchema,
        response: { 200: cobroARevisarSchema },
      },
    },
    async (request) =>
      marcarRevisado(prisma, request.params.id, request.body.nota, usuarioActual(request), ahora()),
  );
};
