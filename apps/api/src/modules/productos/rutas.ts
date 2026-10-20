import {
  altaProductoSchema,
  aumentoMasivoSchema,
  busquedaProductosSchema,
  cambioPrecioSchema,
  edicionProductoSchema,
  productoAdminSchema,
  productoVentaSchema,
  resultadoAumentoSchema,
  vistaPreviaAumentoSchema,
} from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { requiereRol, requiereSesion, usuarioActual } from '../../plugins/sesion.js';
import {
  aplicarAumento,
  buscarProductos,
  crearProducto,
  editarProducto,
  historialDePrecios,
  obtenerProducto,
  vistaPreviaAumento,
} from './servicio.js';

const paramsId = z.object({ id: z.uuid() });
const soloAdmin = { preValidation: requiereRol('admin') };

export const rutasProductos: FastifyPluginAsyncZod<{ prisma: PrismaClient }> = async (
  app,
  { prisma },
) => {
  // La búsqueda es la única ruta para cualquier usuario con sesión. El servicio
  // arma la respuesta según el rol y el esquema descarta lo que no corresponda:
  // la del empleado nunca incluye costo ni proveedor.
  app.get(
    '/',
    {
      preValidation: requiereSesion,
      schema: {
        querystring: busquedaProductosSchema,
        response: { 200: z.array(z.union([productoAdminSchema, productoVentaSchema])) },
      },
    },
    async (request) => buscarProductos(prisma, request.query, usuarioActual(request).rol),
  );

  app.post(
    '/',
    {
      ...soloAdmin,
      schema: { body: altaProductoSchema, response: { 201: productoAdminSchema } },
    },
    async (request, reply) => reply.status(201).send(await crearProducto(prisma, request.body)),
  );

  app.get(
    '/:id',
    { ...soloAdmin, schema: { params: paramsId, response: { 200: productoAdminSchema } } },
    async (request) => obtenerProducto(prisma, request.params.id),
  );

  app.patch(
    '/:id',
    {
      ...soloAdmin,
      schema: {
        params: paramsId,
        body: edicionProductoSchema,
        response: { 200: productoAdminSchema },
      },
    },
    async (request) =>
      editarProducto(prisma, request.params.id, request.body, usuarioActual(request).id),
  );

  app.get(
    '/:id/historial-precios',
    { ...soloAdmin, schema: { params: paramsId, response: { 200: z.array(cambioPrecioSchema) } } },
    async (request) => historialDePrecios(prisma, request.params.id),
  );

  app.post(
    '/aumento/vista-previa',
    {
      ...soloAdmin,
      schema: { body: aumentoMasivoSchema, response: { 200: vistaPreviaAumentoSchema } },
    },
    async (request) => vistaPreviaAumento(prisma, request.body),
  );

  app.post(
    '/aumento',
    {
      ...soloAdmin,
      schema: { body: aumentoMasivoSchema, response: { 200: resultadoAumentoSchema } },
    },
    async (request) => aplicarAumento(prisma, request.body, usuarioActual(request).id),
  );
};
