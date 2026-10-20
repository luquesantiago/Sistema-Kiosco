import { fileURLToPath } from 'node:url';
import { crearApp } from './app.js';
import { cargarConfig } from './config.js';
import { crearPrisma } from './db.js';

const resultado = cargarConfig(process.env);
if (!resultado.ok) {
  console.error(`Configuración inválida:\n- ${resultado.errores.join('\n- ')}`);
  process.exit(1);
}
const { config } = resultado;

const prisma = crearPrisma(config.DATABASE_URL);

const app = await crearApp({
  prisma,
  cookieSegura: config.NODE_ENV === 'production',
  // Tanto src/ (dev) como dist/ (build) están un nivel debajo de apps/api.
  webDist: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
  logger:
    config.NODE_ENV === 'development'
      ? { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } }
      : { level: config.LOG_LEVEL },
});

app.addHook('onClose', async () => {
  await prisma.$disconnect();
});

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(senal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.PORT, host: '0.0.0.0' });
