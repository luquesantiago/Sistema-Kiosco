import {
  cambioContrasenaSchema,
  CODIGOS_ERROR,
  ingresoSchema,
  usuarioSesionSchema,
} from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ErrorHttp } from '../../errores.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { requiereSesion, usuarioActual } from '../../plugins/sesion.js';
import { hashearContrasena, verificarContrasena } from './contrasenas.js';
import { cerrarSesiones, COOKIE_SESION, crearSesion } from './sesiones.js';

const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

export interface OpcionesAuth {
  prisma: PrismaClient;
  ahora: () => Date;
  cookieSegura: boolean;
}

// Nota: Fastify no loguea los bodies; no activarlo, porque estas rutas llevan contraseñas.
export const rutasAuth: FastifyPluginAsyncZod<OpcionesAuth> = async (
  app,
  { prisma, ahora, cookieSegura },
) => {
  app.post(
    '/ingresar',
    { schema: { body: ingresoSchema, response: { 200: usuarioSesionSchema } } },
    async (request, reply) => {
      const { usuario: nombreUsuario, contrasena } = request.body;
      const momento = ahora();
      const usuario = await prisma.usuario.findUnique({ where: { usuario: nombreUsuario } });

      if (usuario?.bloqueadoHasta && usuario.bloqueadoHasta > momento) {
        throw new ErrorHttp(
          429,
          CODIGOS_ERROR.ingresoBloqueado,
          'Demasiados intentos fallidos. Probá de nuevo en 15 minutos.',
        );
      }

      const contrasenaOk = await verificarContrasena(usuario?.contrasenaHash, contrasena);
      if (!usuario || !contrasenaOk || !usuario.activo) {
        if (usuario && !contrasenaOk) {
          const intentos = usuario.intentosFallidos + 1;
          await prisma.usuario.update({
            where: { id: usuario.id },
            data:
              intentos >= MAX_INTENTOS
                ? { intentosFallidos: 0, bloqueadoHasta: new Date(momento.getTime() + BLOQUEO_MS) }
                : { intentosFallidos: intentos },
          });
        }
        throw new ErrorHttp(
          401,
          CODIGOS_ERROR.credencialesInvalidas,
          'Usuario o contraseña incorrectos.',
        );
      }

      await prisma.usuario.update({
        where: { id: usuario.id },
        data: { intentosFallidos: 0, bloqueadoHasta: null, ultimoIngreso: momento },
      });
      await prisma.sesion.deleteMany({
        where: { usuarioId: usuario.id, expiraEn: { lte: momento } },
      });
      const { token, expiraEn } = await crearSesion(prisma, usuario, momento);
      reply.setCookie(COOKIE_SESION, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: cookieSegura,
        path: '/',
        maxAge: Math.floor((expiraEn.getTime() - momento.getTime()) / 1000),
      });
      const { id, nombre, rol } = usuario;
      return { id, nombre, usuario: usuario.usuario, rol };
    },
  );

  app.get(
    '/sesion',
    { preValidation: requiereSesion, schema: { response: { 200: usuarioSesionSchema } } },
    async (request) => usuarioActual(request),
  );

  app.post('/salir', { preValidation: requiereSesion }, async (request, reply) => {
    await prisma.sesion.deleteMany({ where: { id: request.sesionId! } });
    reply.clearCookie(COOKIE_SESION, { path: '/' });
    return reply.status(204).send();
  });

  app.post(
    '/contrasena',
    { preValidation: requiereSesion, schema: { body: cambioContrasenaSchema } },
    async (request, reply) => {
      const { id } = usuarioActual(request);
      const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id } });
      if (!(await verificarContrasena(usuario.contrasenaHash, request.body.actual))) {
        throw new ErrorHttp(
          400,
          CODIGOS_ERROR.contrasenaActualIncorrecta,
          'La contraseña actual no es correcta.',
        );
      }
      const contrasenaHash = await hashearContrasena(request.body.nueva);
      await prisma.$transaction(async (tx) => {
        await tx.usuario.update({ where: { id }, data: { contrasenaHash } });
        await cerrarSesiones(tx, id, request.sesionId!);
      });
      return reply.status(204).send();
    },
  );
};
