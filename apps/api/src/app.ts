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
import { rutasCaja } from './modules/caja/rutas.js';
import { rutasDashboard } from './modules/dashboard/rutas.js';
import { rutasPedidos } from './modules/pedidos/rutas.js';
import { rutasEstado, type VerificarBase } from './modules/estado/rutas.js';
import { rutasProductos } from './modules/productos/rutas.js';
import { rutasNotificaciones } from './modules/notificaciones/rutas.js';
import { rutasProveedores } from './modules/proveedores/rutas.js';
import { rutasStock } from './modules/stock/rutas.js';
import { rutasUsuarios } from './modules/usuarios/rutas.js';
import { rutasVentas } from './modules/ventas/rutas.js';
import type { ClienteWhatsapp } from './modules/whatsapp/cliente.js';
import { rutasWhatsapp } from './modules/whatsapp/rutas.js';
import { registrarSesion } from './plugins/sesion.js';

export interface OpcionesApp {
  prisma: PrismaClient;
  /** Sin cliente (no hay WAHA_URL), WhatsApp queda `no_configurado`. */
  whatsapp?: ClienteWhatsapp;
  /** Por defecto, `SELECT 1` con el mismo cliente de Prisma. */
  verificarBase?: VerificarBase;
  /** Carpeta con el build de la web. Si no existe, la API no sirve archivos estáticos. */
  webDist?: string;
  logger?: FastifyServerOptions['logger'];
  /** Reloj inyectable para testear vencimientos y bloqueos. */
  ahora?: () => Date;
  /** Cookie de sesión solo por HTTPS (producción). */
  cookieSegura?: boolean;
  /** Detrás del proxy (Caddy en producción): la IP del cliente sale de X-Forwarded-For. */
  trustProxy?: boolean;
}

export interface RutaRegistrada {
  method: string | string[];
  url: string;
}

export async function crearApp({
  prisma,
  whatsapp,
  verificarBase = async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  webDist,
  logger = false,
  ahora = () => new Date(),
  cookieSegura = false,
  trustProxy = false,
}: OpcionesApp) {
  const app = Fastify({ logger, trustProxy }).withTypeProvider<ZodTypeProvider>();
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
      await api.register(rutasStock, { prefix: '/stock', prisma });
      await api.register(rutasVentas, { prefix: '/ventas', prisma, ahora });
      await api.register(rutasPedidos, { prefix: '/pedidos', prisma, ahora });
      await api.register(rutasDashboard, { prefix: '/dashboard', prisma, ahora });
      await api.register(rutasCaja, { prefix: '/caja', prisma, ahora });
      await api.register(rutasNotificaciones, { prefix: '/notificaciones', prisma });
      await api.register(rutasWhatsapp, { prefix: '/whatsapp', prisma, whatsapp });
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
