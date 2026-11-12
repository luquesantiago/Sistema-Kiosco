import { MercadoPagoNoDisponible, MercadoPagoRechazo } from './errores.js';

/*
 * Terminales Point de la cuenta (para el script `mp:terminales`): listarlas y pasar una
 * a modo integrado (PDV), así el dueño no tiene que usar `curl`. Ver el design de
 * cobro-mercado-pago y la guía de migración de MP:
 *
 *   GET   /terminals/v1/list   → { data: { terminals: [{ id, operating_mode, ... }] } }
 *   PATCH /terminals/v1/setup  ← { terminals: [{ id, operating_mode: "PDV" }] }
 *
 * El formato exacto de la respuesta se confirma con las credenciales de prueba (tarea 8.1).
 */

export interface Terminal {
  /** `{tipo}__{serie}`: es lo que va en `MP_TERMINAL_ID`. */
  id: string;
  /** `PDV` (integrado) o `STANDALONE`, tal como lo informa MP. */
  modo: string | null;
}

interface Opciones {
  baseUrl?: string;
  timeoutMs?: number;
}

const URL_MP = 'https://api.mercadopago.com';

async function pedir(
  token: string,
  metodo: 'GET' | 'PATCH',
  ruta: string,
  cuerpo: unknown,
  { baseUrl = URL_MP, timeoutMs = 10_000 }: Opciones,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, '')}${ruta}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new MercadoPagoNoDisponible('Mercado Pago no responde.');
  }
  if (res.status >= 500) throw new MercadoPagoNoDisponible('Mercado Pago no responde.');
  if (!res.ok) throw new MercadoPagoRechazo(res.status);
  const texto = await res.text();
  return texto ? (JSON.parse(texto) as unknown) : null;
}

/** Las terminales Point vinculadas a la cuenta del token. */
export async function listarTerminales(
  token: string,
  opciones: Opciones = {},
): Promise<Terminal[]> {
  const datos = (await pedir(token, 'GET', '/terminals/v1/list', undefined, opciones)) as {
    data?: { terminals?: { id?: unknown; operating_mode?: unknown }[] };
  } | null;
  return (datos?.data?.terminals ?? [])
    .filter((t): t is { id: string; operating_mode?: unknown } => typeof t.id === 'string')
    .map((t) => ({
      id: t.id,
      modo: typeof t.operating_mode === 'string' ? t.operating_mode : null,
    }));
}

/** Pasa una terminal a modo integrado (PDV): necesario para cobrar desde el sistema y con QR. */
export async function activarModoPdv(
  token: string,
  terminalId: string,
  opciones: Opciones = {},
): Promise<void> {
  await pedir(
    token,
    'PATCH',
    '/terminals/v1/setup',
    { terminals: [{ id: terminalId, operating_mode: 'PDV' }] },
    opciones,
  );
}
