import { estadoServicioSchema, type EstadoServicio } from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/** Comprueba que la base responde; rechaza si falla. */
export type VerificarBase = () => Promise<void>;

const TIMEOUT_BASE_MS = 2000;

function conTimeout(promesa: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`La base no respondió en ${ms} ms`)), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(timer));
}

export const rutasEstado: FastifyPluginAsyncZod<{ verificarBase: VerificarBase }> = async (
  app,
  { verificarBase },
) => {
  app.get(
    '/health',
    {
      // El healthcheck de Docker lo llama cada 10 s: sin log por pedido.
      logLevel: 'warn',
      schema: { response: { 200: estadoServicioSchema, 503: estadoServicioSchema } },
    },
    async (request, reply) => {
      let baseOk = true;
      try {
        await conTimeout(verificarBase(), TIMEOUT_BASE_MS);
      } catch (err) {
        baseOk = false;
        request.log.error({ err }, 'Chequeo de estado: la base de datos no responde');
      }
      const respuesta: EstadoServicio = {
        estado: baseOk ? 'ok' : 'degradado',
        baseDeDatos: baseOk ? 'ok' : 'error',
        hora: new Date().toISOString(),
      };
      return reply.status(baseOk ? 200 : 503).send(respuesta);
    },
  );
};
