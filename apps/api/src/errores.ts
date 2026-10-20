import { CODIGOS_ERROR, type ErrorApi } from '@kiosco/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

export function errorApi(codigo: string, mensaje: string): ErrorApi {
  return { error: { codigo, mensaje } };
}

export function respuestaNoEncontrado(url: string): ErrorApi {
  return errorApi(CODIGOS_ERROR.noEncontrado, `No existe la ruta ${url.split('?')[0]}.`);
}

/** Error de negocio que se responde tal cual con su código HTTP. */
export class ErrorHttp extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/** Traduce cualquier error al formato común `{ error: { codigo, mensaje } }`. */
export function registrarManejoDeErrores(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ErrorHttp) {
      return reply.status(error.status).send(errorApi(error.codigo, error.message));
    }
    if (hasZodFastifySchemaValidationErrors(error) || error.validation) {
      return reply
        .status(400)
        .send(errorApi(CODIGOS_ERROR.validacion, 'Los datos enviados no son válidos.'));
    }
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send(errorApi(error.code, error.message));
    }
    request.log.error({ err: error }, 'Error no controlado');
    return reply
      .status(500)
      .send(errorApi(CODIGOS_ERROR.interno, 'Ocurrió un error inesperado. Intentá de nuevo.'));
  });
}
