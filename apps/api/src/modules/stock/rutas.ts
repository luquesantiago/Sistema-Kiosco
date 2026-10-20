import {
  ajusteStockSchema,
  conteoStockSchema,
  ingresoDetalleSchema,
  ingresoListadoSchema,
  ingresoMercaderiaSchema,
  movimientoStockSchema,
  paginaSchema,
  proveedorOpcionSchema,
  resultadoConteoSchema,
  resultadoVentasSinSistemaSchema,
  ventasSinSistemaSchema,
} from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { requiereRol, requiereSesion, usuarioActual } from '../../plugins/sesion.js';
import {
  listarIngresos,
  movimientosDeProducto,
  obtenerIngreso,
  opcionesDeProveedor,
  registrarAjuste,
  registrarConteo,
  registrarIngreso,
  registrarVentasSinSistema,
} from './servicio.js';

const paramsId = z.object({ id: z.uuid() });
const soloAdmin = { preValidation: requiereRol('admin') };

// Los movimientos no tienen rutas de edición ni de borrado: un error se corrige
// con otro movimiento.
export const rutasStock: FastifyPluginAsyncZod<{ prisma: PrismaClient }> = async (
  app,
  { prisma },
) => {
  // El ingreso de mercadería (y la lista de proveedores para elegir en él) lo
  // usan admin y empleado; el resto es solo del admin.
  app.post(
    '/ingresos',
    {
      preValidation: requiereSesion,
      schema: { body: ingresoMercaderiaSchema, response: { 201: ingresoListadoSchema } },
    },
    async (request, reply) =>
      reply.status(201).send(await registrarIngreso(prisma, request.body, usuarioActual(request))),
  );

  app.get(
    '/proveedores',
    {
      preValidation: requiereSesion,
      schema: { response: { 200: z.array(proveedorOpcionSchema) } },
    },
    async () => opcionesDeProveedor(prisma),
  );

  app.get(
    '/ingresos',
    {
      ...soloAdmin,
      schema: { querystring: paginaSchema, response: { 200: z.array(ingresoListadoSchema) } },
    },
    async (request) => listarIngresos(prisma, request.query.pagina),
  );

  app.get(
    '/ingresos/:id',
    { ...soloAdmin, schema: { params: paramsId, response: { 200: ingresoDetalleSchema } } },
    async (request) => obtenerIngreso(prisma, request.params.id),
  );

  app.post(
    '/ajustes',
    {
      ...soloAdmin,
      schema: { body: ajusteStockSchema, response: { 201: movimientoStockSchema } },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await registrarAjuste(prisma, request.body, usuarioActual(request).id)),
  );

  app.post(
    '/conteos',
    {
      ...soloAdmin,
      schema: { body: conteoStockSchema, response: { 200: resultadoConteoSchema } },
    },
    async (request) => registrarConteo(prisma, request.body, usuarioActual(request).id),
  );

  app.post(
    '/ventas-sin-sistema',
    {
      ...soloAdmin,
      schema: { body: ventasSinSistemaSchema, response: { 201: resultadoVentasSinSistemaSchema } },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await registrarVentasSinSistema(prisma, request.body, usuarioActual(request).id)),
  );

  app.get(
    '/productos/:id/movimientos',
    {
      ...soloAdmin,
      schema: {
        params: paramsId,
        querystring: paginaSchema,
        response: { 200: z.array(movimientoStockSchema) },
      },
    },
    async (request) => movimientosDeProducto(prisma, request.params.id, request.query.pagina),
  );
};
