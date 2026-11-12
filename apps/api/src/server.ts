import { fileURLToPath } from 'node:url';
import { crearApp } from './app.js';
import { cargarConfig, configArca, configPoint } from './config.js';
import { crearPrisma } from './db.js';
import { clienteArca, leerCredenciales } from './integrations/arca/cliente.js';
import { clienteMercadoPago } from './integrations/mercadopago/cliente.js';
import { iniciarAvisoReposicion } from './jobs/aviso-reposicion.js';
import { iniciarCobrosMp } from './jobs/cobros-mp.js';
import { iniciarEmisionFacturas } from './jobs/emision-facturas.js';
import type { Facturacion } from './modules/facturacion/tipos.js';
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
// Con MP_TERMINAL_ID, débito, crédito y Mercado Pago se cobran con el Point.
const point = configPoint(config);

// Facturación con ARCA: sin las variables ARCA_*, se vende igual sin facturar.
// El certificado y la clave se leen al arrancar; la clave queda solo en memoria.
const arcaConfig = configArca(config);
let emision: ReturnType<typeof iniciarEmisionFacturas> | undefined;
let facturacion: Facturacion | undefined;
if (arcaConfig) {
  let credenciales: { certificado: string; clave: string };
  try {
    credenciales = leerCredenciales({
      certificado: arcaConfig.ARCA_CERT_PATH,
      clave: arcaConfig.ARCA_KEY_PATH,
    });
  } catch (error) {
    console.error(`Configuración inválida:\n- ${(error as Error).message}`);
    process.exit(1);
  }
  facturacion = {
    config: arcaConfig,
    arca: clienteArca({
      prisma,
      entorno: arcaConfig.ARCA_ENTORNO,
      cuit: arcaConfig.ARCA_CUIT,
      ...credenciales,
      ahora: () => new Date(),
    }),
    despertar: () => emision?.despertar(),
    estado: () => emision?.estado() ?? 'disponible',
  };
}

// Hasta 60 s; si la base no responde, sale y Docker vuelve a intentar.
if (!(await esperarBase(() => prisma.$queryRaw`SELECT 1`))) {
  console.error('La base de datos no responde: no se puede atender pedidos.');
  process.exit(1);
}

const app = await crearApp({
  prisma,
  whatsapp,
  mercadoPago,
  point,
  facturacion,
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

// La emisión de facturas corre solo acá, con la configuración de ARCA; nunca en los tests.
if (facturacion) {
  const tarea = iniciarEmisionFacturas({
    prisma,
    arca: facturacion.arca,
    config: facturacion.config,
    ahora: () => new Date(),
    log: app.log,
  });
  emision = tarea;
  app.addHook('onClose', () => tarea.detener());
  app.log.info(
    `Facturación con ARCA activa: ${facturacion.config.ARCA_ENTORNO === 'homologacion' ? 'HOMOLOGACIÓN (sin validez fiscal)' : 'producción'}, punto de venta ${facturacion.config.ARCA_PUNTO_VENTA}.`,
  );
} else {
  app.log.warn('La facturación con ARCA no está configurada (ARCA_*): las ventas no se facturan.');
}

// La consulta de respaldo de los cobros del Point corre solo acá y solo con el Point
// configurado; nunca en los tests (que llaman a revisarCobros).
if (point && mercadoPago) {
  const cobros = iniciarCobrosMp({
    prisma,
    mercadoPago,
    facturacion,
    ahora: () => new Date(),
    log: app.log,
  });
  app.addHook('onClose', () => cobros.detener());
  app.log.info(
    point.webhookSecret
      ? 'Cobro con el Point activo, con notificaciones firmadas y consulta cada 3 s.'
      : 'Cobro con el Point activo, sin notificaciones (MP_WEBHOOK_SECRET): solo consulta cada 3 s.',
  );
} else {
  app.log.warn(
    'El Point de Mercado Pago no está configurado (MP_TERMINAL_ID): las ventas con tarjeta o MP se registran sin pasar por la terminal.',
  );
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
