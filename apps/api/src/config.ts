import { z } from 'zod';

const configSchema = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    // WhatsApp es opcional: sin WAHA la app funciona y los avisos quedan pendientes.
    WAHA_URL: z.url({ protocol: /^https?$/ }).optional(),
    WAHA_API_KEY: z.string().min(1).optional(),
  })
  .superRefine((config, ctx) => {
    // Una sin la otra es un error de instalación: mejor no arrancar que no enviar en silencio.
    if (config.WAHA_URL !== undefined && config.WAHA_API_KEY === undefined) {
      ctx.addIssue({ code: 'custom', path: ['WAHA_API_KEY'], message: 'falta' });
    }
    if (config.WAHA_API_KEY !== undefined && config.WAHA_URL === undefined) {
      ctx.addIssue({ code: 'custom', path: ['WAHA_URL'], message: 'falta' });
    }
  });

export type Config = z.infer<typeof configSchema>;

export type ResultadoConfig = { ok: true; config: Config } | { ok: false; errores: string[] };

/**
 * Valida la configuración de entorno. Los errores nombran la variable y el
 * problema, nunca el valor recibido (puede contener credenciales).
 */
export function cargarConfig(env: NodeJS.ProcessEnv): ResultadoConfig {
  const resultado = configSchema.safeParse(env);
  if (resultado.success) {
    return { ok: true, config: resultado.data };
  }
  const errores = resultado.error.issues.map((issue) => {
    const variable = issue.path.join('.');
    return env[variable] === undefined
      ? `${variable}: falta la variable`
      : `${variable}: valor inválido`;
  });
  return { ok: false, errores };
}
