import {
  aperturaSchema,
  cierreRespuestaSchema,
  cierreSchema,
  estadoCajaSchema,
  listadoMovimientosMpQuerySchema,
  movimientoCajaEntradaSchema,
  movimientoCajaSchema,
  paginaSchema,
  turnoDetalleSchema,
  turnoResumenSchema,
} from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { requiereRol, requiereSesion, usuarioActual } from '../../plugins/sesion.js';
import {
  abrirTurno,
  cerrarTurno,
  estadoDeCaja,
  listarMovimientosMp,
  listarTurnos,
  movimientosDelTurnoAbierto,
  obtenerTurno,
  registrarMovimientoCaja,
} from './servicio.js';

const paramsId = z.object({ id: z.uuid() });
const conSesion = { preValidation: requiereSesion };
const soloAdmin = { preValidation: requiereRol('admin') };

// Admin y empleado abren, cierran y mueven la caja (el servicio aplica las
// reglas de cada rol); la lista y el detalle de turnos son solo del admin. Los
// movimientos no se editan ni se borran.
export const rutasCaja: FastifyPluginAsyncZod<{
  prisma: PrismaClient;
  ahora: () => Date;
}> = async (app, { prisma, ahora }) => {
  app.get(
    '/estado',
    { ...conSesion, schema: { response: { 200: estadoCajaSchema } } },
    async (request) => estadoDeCaja(prisma, usuarioActual(request)),
  );

  app.post(
    '/turnos',
    { ...conSesion, schema: { body: aperturaSchema, response: { 201: estadoCajaSchema } } },
    async (request, reply) =>
      reply
        .status(201)
        .send(await abrirTurno(prisma, request.body, usuarioActual(request), ahora())),
  );

  app.post(
    '/turnos/:id/cerrar',
    {
      ...conSesion,
      schema: { params: paramsId, body: cierreSchema, response: { 200: cierreRespuestaSchema } },
    },
    async (request) =>
      cerrarTurno(prisma, request.params.id, request.body, usuarioActual(request), ahora()),
  );

  app.get(
    '/movimientos',
    { ...conSesion, schema: { response: { 200: z.array(movimientoCajaSchema) } } },
    async (request) => movimientosDelTurnoAbierto(prisma, usuarioActual(request)),
  );

  app.post(
    '/movimientos',
    {
      ...conSesion,
      schema: { body: movimientoCajaEntradaSchema, response: { 201: movimientoCajaSchema } },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await registrarMovimientoCaja(prisma, request.body, usuarioActual(request), ahora())),
  );

  app.get(
    '/movimientos-mp',
    {
      ...soloAdmin,
      schema: {
        querystring: listadoMovimientosMpQuerySchema,
        response: { 200: z.array(movimientoCajaSchema) },
      },
    },
    async (request) => listarMovimientosMp(prisma, request.query, ahora()),
  );

  app.get(
    '/turnos',
    {
      ...soloAdmin,
      schema: { querystring: paginaSchema, response: { 200: z.array(turnoResumenSchema) } },
    },
    async (request) => listarTurnos(prisma, request.query.pagina),
  );

  app.get(
    '/turnos/:id',
    { ...soloAdmin, schema: { params: paramsId, response: { 200: turnoDetalleSchema } } },
    async (request) => obtenerTurno(prisma, request.params.id),
  );
};
