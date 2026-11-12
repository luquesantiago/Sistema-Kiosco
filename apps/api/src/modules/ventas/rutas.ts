import {
  anulacionSchema,
  facturaVentaSchema,
  listadoVentasQuerySchema,
  ventaDetalleSchema,
  ventaEntradaSchema,
  ventaResumenSchema,
} from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { requiereSesion, usuarioActual } from '../../plugins/sesion.js';
import { pedirFactura } from '../facturacion/servicio.js';
import type { Facturacion } from '../facturacion/tipos.js';
import { anularVenta, listarVentas, obtenerVenta, registrarVenta } from './servicio.js';

const paramsId = z.object({ id: z.uuid() });

// Admin y empleado venden, listan, anulan y piden factura; el servicio exige el
// turno abierto y aplica las reglas del empleado (ventas de hoy, anulaciones de su turno).
export const rutasVentas: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  ahora: () => Date;
  facturacion?: Facturacion;
}> = async (app, { prisma, ahora, facturacion }) => {
  app.addHook('preValidation', requiereSesion);

  app.post(
    '/',
    { schema: { body: ventaEntradaSchema, response: { 201: ventaDetalleSchema } } },
    async (request, reply) => {
      const venta = await registrarVenta(
        prisma,
        request.body,
        usuarioActual(request),
        ahora(),
        facturacion,
      );
      // La factura ya quedó en la cola junto con la venta: que la emisión no espere al intervalo.
      facturacion?.despertar();
      return reply.status(201).send(venta);
    },
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
    async (request) =>
      obtenerVenta(prisma, request.params.id, usuarioActual(request), ahora(), facturacion),
  );

  app.post(
    '/:id/anular',
    {
      schema: { params: paramsId, body: anulacionSchema, response: { 200: ventaDetalleSchema } },
    },
    async (request) =>
      anularVenta(
        prisma,
        request.params.id,
        request.body,
        usuarioActual(request),
        ahora(),
        facturacion,
      ),
  );

  // Factura a pedido del cliente por lo cobrado en efectivo: 201 si la crea,
  // 200 si ya existía (o si la venta no tiene efectivo y es la automática).
  app.post(
    '/:id/factura',
    {
      schema: { params: paramsId, response: { 200: facturaVentaSchema, 201: facturaVentaSchema } },
    },
    async (request, reply) => {
      const { factura, creada } = await pedirFactura(
        prisma,
        request.params.id,
        usuarioActual(request),
        ahora(),
        facturacion,
      );
      if (creada) facturacion?.despertar();
      return reply.status(creada ? 201 : 200).send(factura);
    },
  );
};
