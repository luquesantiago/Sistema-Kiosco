import { CODIGOS_ERROR, type Rol, type UsuarioSesion } from '@kiosco/shared';
import type { FastifyInstance, FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import { ErrorHttp } from '../errores.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { buscarSesion, COOKIE_SESION } from '../modules/auth/sesiones.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Usuario de la sesión vigente, o null si no hay sesión. */
    usuario: UsuarioSesion | null;
    sesionId: string | null;
  }
}

/** Carga en cada pedido el usuario de la cookie de sesión, si es vigente. */
export function registrarSesion(
  app: FastifyInstance,
  { prisma, ahora }: { prisma: PrismaClient; ahora: () => Date },
): void {
  app.decorateRequest('usuario', null);
  app.decorateRequest('sesionId', null);
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[COOKIE_SESION];
    if (!token) return;
    const sesion = await buscarSesion(prisma, token, ahora());
    if (sesion) {
      request.usuario = sesion.usuario;
      request.sesionId = sesion.sesionId;
    }
  });
}

function usuarioDe(request: FastifyRequest): UsuarioSesion {
  if (!request.usuario) {
    throw new ErrorHttp(401, CODIGOS_ERROR.noAutenticado, 'Tu sesión venció. Ingresá de nuevo.');
  }
  return request.usuario;
}

/** Hook preValidation: exige una sesión vigente (401 si no hay). Corre antes de validar el body. */
export const requiereSesion: preValidationAsyncHookHandler = async (request) => {
  usuarioDe(request);
};

/** Hook preValidation: exige una sesión vigente con el rol indicado (403 si es otro). */
export function requiereRol(rol: Rol): preValidationAsyncHookHandler {
  return async (request) => {
    if (usuarioDe(request).rol !== rol) {
      throw new ErrorHttp(403, CODIGOS_ERROR.sinPermiso, 'No tenés permiso para hacer esto.');
    }
  };
}

/** Usuario de la sesión dentro de una ruta protegida. */
export function usuarioActual(request: FastifyRequest): UsuarioSesion {
  return usuarioDe(request);
}
