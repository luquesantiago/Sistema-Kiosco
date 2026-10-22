import { fileURLToPath } from 'node:url';
import { crearApp } from './app.js';
import { cargarConfig } from './config.js';
import { crearPrisma } from './db.js';
import { esperarBase } from './lib/esperar-base.js';
import { clienteWaha } from './modules/whatsapp/cliente.js';
import { iniciarEnvio } from './modules/whatsapp/envio.js';

const resultado = cargarConfig(process.env);
if (!resultado.ok) {
  console.error(`Configuración inválida:\n- ${resultado.errores.join('\n- ')}`);
  process.exit(1);
}
const { config } = resultado;

const prisma = crearPrisma(config.DATABASE_URL);
const whatsapp =
  config.WAHA_URL && config.WAHA_API_KEY
    ? clienteWaha(config.WAHA_URL, config.WAHA_API_KEY)
    : undefined;

// Hasta 60 s; si la base no responde, sale y Docker vuelve a intentar.
if (!(await esperarBase(() => prisma.$queryRaw`SELECT 1`))) {
  console.error('La base de datos no responde: no se puede atender pedidos.');
  process.exit(1);
}

const app = await crearApp({
  prisma,
  whatsapp,
  cookieSegura: config.NODE_ENV === 'production',
  // En producción solo se llega a la app a través de Caddy.
  trustProxy: config.NODE_ENV === 'production',
  // Tanto src/ (dev) como dist/ (build) están un nivel debajo de apps/api.
  webDist: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
  logger:
    config.NODE_ENV === 'development'
      ? { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } }
      : { level: config.LOG_LEVEL },
});

// El envío de avisos corre solo acá, nunca en los tests (que llaman a procesarPendientes).
if (whatsapp) {
  const envio = iniciarEnvio({ prisma, whatsapp, ahora: () => new Date(), log: app.log });
  app.addHook('onClose', () => envio.detener());
} else {
  app.log.warn('WhatsApp no está configurado (WAHA_URL): los avisos quedan pendientes.');
}

app.addHook('onClose', async () => {
  await prisma.$disconnect();
});

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(senal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.PORT, host: '0.0.0.0' });
