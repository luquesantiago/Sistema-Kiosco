import { existsSync } from 'node:fs';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registrarManejoDeErrores, respuestaNoEncontrado } from './errores.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { rutasAuth } from './modules/auth/rutas.js';
import { rutasEstado, type VerificarBase } from './modules/estado/rutas.js';
import { rutasProductos } from './modules/productos/rutas.js';
import { rutasProveedores } from './modules/proveedores/rutas.js';
import { rutasUsuarios } from './modules/usuarios/rutas.js';
import { registrarSesion } from './plugins/sesion.js';

export interface OpcionesApp {
  prisma: PrismaClient;
  /** Por defecto, `SELECT 1` con el mismo cliente de Prisma. */
  verificarBase?: VerificarBase;
  /** Carpeta con el build de la web. Si no existe, la API no sirve archivos estáticos. */
  webDist?: string;
  logger?: FastifyServerOptions['logger'];
  /** Reloj inyectable para testear vencimientos y bloqueos. */
  ahora?: () => Date;
  /** Cookie de sesión solo por HTTPS (producción). */
  cookieSegura?: boolean;
}

export interface RutaRegistrada {
  method: string | string[];
  url: string;
}

export async function crearApp({
  prisma,
  verificarBase = async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  webDist,
  logger = false,
  ahora = () => new Date(),
  cookieSegura = false,
}: OpcionesApp) {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registrarManejoDeErrores(app);

  // Inventario de rutas, para el test que verifica que ninguna quede sin proteger.
  const rutas: RutaRegistrada[] = [];
  app.decorate('rutasRegistradas', rutas);
  app.addHook('onRoute', ({ method, url }) => {
    rutas.push({ method, url });
  });

  await app.register(fastifyCookie);
  registrarSesion(app, { prisma, ahora });

  await app.register(
    async (api) => {
      await api.register(rutasEstado, { verificarBase });
      await api.register(rutasAuth, { prefix: '/auth', prisma, ahora, cookieSegura });
      await api.register(rutasUsuarios, { prefix: '/usuarios', prisma });
      await api.register(rutasProveedores, { prefix: '/proveedores', prisma, ahora });
      await api.register(rutasProductos, { prefix: '/productos', prisma });
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

declare module 'fastify' {
  interface FastifyInstance {
    rutasRegistradas: RutaRegistrada[];
  }
}
