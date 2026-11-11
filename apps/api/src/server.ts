import { fileURLToPath } from 'node:url';
import { crearApp } from './app.js';
import { cargarConfig } from './config.js';
import { crearPrisma } from './db.js';
import { clienteMercadoPago } from './integrations/mercadopago/cliente.js';
import { iniciarAvisoReposicion } from './jobs/aviso-reposicion.js';
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
// Sin token, el saldo de Mercado Pago queda "no configurado" y todo lo demás funciona.
const mercadoPago = config.MP_ACCESS_TOKEN ? clienteMercadoPago(config.MP_ACCESS_TOKEN) : undefined;

// Hasta 60 s; si la base no responde, sale y Docker vuelve a intentar.
if (!(await esperarBase(() => prisma.$queryRaw`SELECT 1`))) {
  console.error('La base de datos no responde: no se puede atender pedidos.');
  process.exit(1);
}

const app = await crearApp({
  prisma,
  whatsapp,
  mercadoPago,
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

// El aviso diario de reposición se genera aunque no haya WhatsApp: queda pendiente en Avisos.
const avisoReposicion = iniciarAvisoReposicion({ prisma, ahora: () => new Date(), log: app.log });
app.log.info('Tarea del aviso de reposición iniciada (todos los días a las 12:00).');
app.addHook('onClose', () => avisoReposicion.detener());

app.addHook('onClose', async () => {
  await prisma.$disconnect();
});

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(senal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.PORT, host: '0.0.0.0' });
