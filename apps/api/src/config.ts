import { ENTORNOS_ARCA } from '@kiosco/shared';
import { z } from 'zod';

/** CUIT de 11 dígitos con el dígito verificador válido (módulo 11). */
export function esCuitValido(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((total, peso, i) => total + peso * Number(cuit[i]), 0);
  const resto = 11 - (suma % 11);
  const verificador = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return verificador === Number(cuit[10]);
}

/**
 * Facturación electrónica con ARCA: todas opcionales, pero todas juntas o
 * ninguna. El punto de venta va de 1 a 99999 (normativo, verificar).
 */
const VARIABLES_ARCA = {
  ARCA_CUIT: z.string().refine(esCuitValido).optional(),
  ARCA_PUNTO_VENTA: z.coerce.number().int().min(1).max(99999).optional(),
  ARCA_ENTORNO: z.enum(ENTORNOS_ARCA).optional(),
  ARCA_CERT_PATH: z.string().min(1).optional(),
  ARCA_KEY_PATH: z.string().min(1).optional(),
  // Datos del emisor que van en el ticket con factura.
  ARCA_NOMBRE_FANTASIA: z.string().min(1).optional(),
  ARCA_RAZON_SOCIAL: z.string().min(1).optional(),
  ARCA_DOMICILIO: z.string().min(1).optional(),
  ARCA_INICIO_ACTIVIDADES: z.iso.date().optional(),
  ARCA_IIBB: z.string().min(1).optional(),
};

const configSchema = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    // WhatsApp es opcional: sin WAHA la app funciona y los avisos quedan pendientes.
    WAHA_URL: z.url({ protocol: /^https?$/ }).optional(),
    WAHA_API_KEY: z.string().min(1).optional(),
    // Mercado Pago es opcional: sin token el saldo aparece como "no configurado".
    MP_ACCESS_TOKEN: z.string().min(1).optional(),
    // Con la terminal, débito, crédito y Mercado Pago se cobran con el Point (exige el token).
    MP_TERMINAL_ID: z.string().min(1).optional(),
    // Clave de las notificaciones (webhooks): sin ella solo se consulta (exige la terminal).
    MP_WEBHOOK_SECRET: z.string().min(1).optional(),
    // Sin ARCA el sistema vende igual, sin facturar.
    ...VARIABLES_ARCA,
  })
  .superRefine((config, ctx) => {
    // Una parte del grupo sin el resto es un error de instalación: mejor no
    // arrancar que funcionar a medias en silencio.
    const todasONinguna = (grupo: readonly (keyof typeof config)[]) => {
      if (grupo.every((variable) => config[variable] === undefined)) return;
      for (const variable of grupo) {
        if (config[variable] === undefined) {
          ctx.addIssue({ code: 'custom', path: [variable], message: 'falta' });
        }
      }
    };
    todasONinguna(['WAHA_URL', 'WAHA_API_KEY']);
    todasONinguna(Object.keys(VARIABLES_ARCA) as (keyof typeof VARIABLES_ARCA)[]);
    // El Point necesita el token, y las notificaciones necesitan el Point.
    const exige = (variable: keyof typeof config, requerida: keyof typeof config) => {
      if (config[variable] !== undefined && config[requerida] === undefined) {
        ctx.addIssue({ code: 'custom', path: [requerida], message: 'falta' });
      }
    };
    exige('MP_TERMINAL_ID', 'MP_ACCESS_TOKEN');
    exige('MP_WEBHOOK_SECRET', 'MP_TERMINAL_ID');
  });

export type Config = z.infer<typeof configSchema>;

/** Las variables `ARCA_*` cuando están todas: la facturación está configurada. */
export type ConfigArca = { [V in keyof typeof VARIABLES_ARCA]-?: NonNullable<Config[V]> };

/** La configuración de ARCA, o `undefined` si no hay (la regla "todas o ninguna" ya se validó). */
export function configArca(config: Config): ConfigArca | undefined {
  const valores = Object.fromEntries(
    Object.keys(VARIABLES_ARCA).map((variable) => [variable, config[variable as keyof Config]]),
  );
  if (Object.values(valores).some((v) => v === undefined)) return undefined;
  return valores as ConfigArca;
}

/** La terminal Point configurada (token y terminal), o `undefined`: entonces nada pasa por el Point. */
export interface ConfigPoint {
  terminalId: string;
  /** Sin clave, las notificaciones de MP se rechazan y solo se consulta. */
  webhookSecret?: string;
}

export function configPoint(config: Config): ConfigPoint | undefined {
  if (!config.MP_ACCESS_TOKEN || !config.MP_TERMINAL_ID) return undefined;
  return {
    terminalId: config.MP_TERMINAL_ID,
    ...(config.MP_WEBHOOK_SECRET ? { webhookSecret: config.MP_WEBHOOK_SECRET } : {}),
  };
}

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
