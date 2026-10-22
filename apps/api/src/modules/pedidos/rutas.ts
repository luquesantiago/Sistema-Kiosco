import {
  altaPedidoSchema,
  cancelacionPedidoSchema,
  edicionPedidoSchema,
  ingresoMercaderiaSchema,
  listadoPedidosQuerySchema,
  llegadaPedidoSchema,
  pagoPedidoSchema,
  pedidoDetalleSchema,
  pedidoResumenSchema,
  productoCargaSchema,
  recepcionSinPedidoSchema,
} from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { requiereRol, requiereSesion, usuarioActual } from '../../plugins/sesion.js';
import {
  cancelarPedido,
  cargarMercaderia,
  crearPedido,
  editarPedido,
  listarPedidos,
  obtenerPedido,
  pagarPedido,
  productosParaCarga,
  recibirSinPedido,
  registrarLlegada,
} from './servicio.js';

const paramsId = z.object({ id: z.uuid() });
const conSesion = { preValidation: requiereSesion };
const soloAdmin = { preValidation: requiereRol('admin') };
const detalle = { 200: pedidoDetalleSchema };

// El admin crea, edita y cancela pedidos; recibir, cargar y pagar lo hacen
// admin y empleado. Los pedidos no se borran.
export const rutasPedidos: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  ahora: () => Date;
}> = async (app, { prisma, ahora }) => {
  app.get(
    '/',
    {
      ...conSesion,
      schema: {
        querystring: listadoPedidosQuerySchema,
        response: { 200: z.array(pedidoResumenSchema) },
      },
    },
    async (request) => listarPedidos(prisma, request.query, usuarioActual(request), ahora()),
  );

  app.get(
    '/productos',
    {
      ...conSesion,
      schema: {
        querystring: z.object({ q: z.string().max(100).default('') }),
        response: { 200: z.array(productoCargaSchema) },
      },
    },
    async (request) => productosParaCarga(prisma, request.query.q),
  );

  app.get(
    '/:id',
    { ...conSesion, schema: { params: paramsId, response: detalle } },
    async (request) => obtenerPedido(prisma, request.params.id),
  );

  app.post(
    '/',
    { ...soloAdmin, schema: { body: altaPedidoSchema, response: { 201: pedidoDetalleSchema } } },
    async (request, reply) =>
      reply
        .status(201)
        .send(await crearPedido(prisma, request.body, usuarioActual(request), ahora())),
  );

  app.patch(
    '/:id',
    { ...soloAdmin, schema: { params: paramsId, body: edicionPedidoSchema, response: detalle } },
    async (request) => editarPedido(prisma, request.params.id, request.body),
  );

  app.post(
    '/:id/cancelar',
    {
      ...soloAdmin,
      schema: { params: paramsId, body: cancelacionPedidoSchema, response: detalle },
    },
    async (request) =>
      cancelarPedido(prisma, request.params.id, request.body, usuarioActual(request), ahora()),
  );

  app.post(
    '/:id/llego',
    { ...conSesion, schema: { params: paramsId, body: llegadaPedidoSchema, response: detalle } },
    async (request) =>
      registrarLlegada(prisma, request.params.id, request.body, usuarioActual(request), ahora()),
  );

  app.post(
    '/sin-pedido',
    {
      ...conSesion,
      schema: { body: recepcionSinPedidoSchema, response: { 201: pedidoDetalleSchema } },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await recibirSinPedido(prisma, request.body, usuarioActual(request), ahora())),
  );

  app.post(
    '/:id/carga',
    {
      ...conSesion,
      schema: { params: paramsId, body: ingresoMercaderiaSchema, response: detalle },
    },
    async (request) =>
      cargarMercaderia(prisma, request.params.id, request.body, usuarioActual(request), ahora()),
  );

  app.post(
    '/:id/pago',
    { ...conSesion, schema: { params: paramsId, body: pagoPedidoSchema, response: detalle } },
    async (request) =>
      pagarPedido(prisma, request.params.id, request.body, usuarioActual(request), ahora()),
  );
};
