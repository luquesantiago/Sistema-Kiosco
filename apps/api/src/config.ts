import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
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
