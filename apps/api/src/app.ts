import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registrarManejoDeErrores, respuestaNoEncontrado } from './errores.js';
import { rutasEstado, type VerificarBase } from './modules/estado/rutas.js';

export interface OpcionesApp {
  verificarBase: VerificarBase;
  /** Carpeta con el build de la web. Si no existe, la API no sirve archivos estáticos. */
  webDist?: string;
  logger?: FastifyServerOptions['logger'];
}

export async function crearApp({ verificarBase, webDist, logger = false }: OpcionesApp) {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registrarManejoDeErrores(app);

  await app.register(
    async (api) => {
      await api.register(rutasEstado, { verificarBase });
    },
    { prefix: '/api' },
  );

  const servirWeb = webDist !== undefined && existsSync(webDist);
  if (servirWeb) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    const esApi = request.url === '/api' || request.url.startsWith('/api/');
    if (servirWeb && !esApi && request.method === 'GET') {
      // Fallback de la SPA: React Router resuelve la ruta en el navegador.
      return reply.sendFile('index.html');
    }
    return reply.status(404).send(respuestaNoEncontrado(request.url));
  });

  return app;
}
