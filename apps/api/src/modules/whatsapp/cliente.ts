/** Estado de la sesión de WhatsApp, ya traducido desde WAHA (ver design.md). */
export type EstadoSesion = 'desvinculado' | 'esperando_qr' | 'conectado' | 'no_disponible';

export interface InfoSesion {
  estado: EstadoSesion;
  /** Número internacional del chip (por ejemplo `5491123456789`), solo si está conectado. */
  cuenta: string | null;
}

/** WAHA no respondió (red, timeout o servicio caído). No es culpa del aviso. */
export class WhatsappNoDisponible extends Error {}

/** WAHA respondió con error. Si la sesión está conectada, cuenta como intento fallido. */
export class WhatsappRechazo extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/** Lo que el sistema usa de WhatsApp. Los tests inyectan un cliente falso. */
export interface ClienteWhatsapp {
  estado(): Promise<InfoSesion>;
  /** Crea la sesión si no existe y la inicia (idempotente). */
  iniciar(): Promise<void>;
  /** Detiene e inicia la sesión: genera QR nuevos después de que se vencieron. */
  reiniciar(): Promise<void>;
  desvincular(): Promise<void>;
  /** QR listo para un `<img src>`. */
  qr(): Promise<string>;
  /** `chatId` del número internacional, o `null` si no tiene WhatsApp. */
  verificarNumero(numero: string): Promise<string | null>;
  enviarTexto(chatId: string, texto: string): Promise<void>;
}

const SESION = 'default';
const TIMEOUT_MS = 10_000;

/** Estados de WAHA. `PASSKEY_*` (solo GOWS) piden confirmar en el celular: para el admin, desvinculado. */
function traducirEstado(status: string): EstadoSesion {
  if (status === 'WORKING') return 'conectado';
  if (status === 'SCAN_QR_CODE' || status === 'STARTING') return 'esperando_qr';
  return 'desvinculado';
}

/** Cliente HTTP de WAHA. Solo usa endpoints que son iguales en todos los motores. */
export function clienteWaha(
  url: string,
  apiKey: string,
  { timeoutMs = TIMEOUT_MS }: { timeoutMs?: number } = {},
): ClienteWhatsapp {
  const base = url.replace(/\/$/, '');

  async function pedir(metodo: string, ruta: string, cuerpo?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: {
          'X-Api-Key': apiKey,
          Accept: 'application/json',
          ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new WhatsappNoDisponible('WhatsApp no responde.');
    }
    if (!res.ok) {
      // El cuerpo de WAHA puede traer detalles internos: solo se guarda el código.
      throw new WhatsappRechazo(res.status, `WhatsApp rechazó el pedido (HTTP ${res.status}).`);
    }
    return res;
  }

  async function json<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
    const res = await pedir(metodo, ruta, cuerpo);
    try {
      return (await res.json()) as T;
    } catch {
      throw new WhatsappRechazo(res.status, 'WhatsApp respondió algo inesperado.');
    }
  }

  return {
    async estado() {
      let sesion: { status: string; me?: { id: string } | null };
      try {
        sesion = await json('GET', `/api/sessions/${SESION}`);
      } catch (error) {
        if (error instanceof WhatsappRechazo && error.status === 404) {
          return { estado: 'desvinculado', cuenta: null };
        }
        if (error instanceof WhatsappRechazo && error.status >= 500) {
          return { estado: 'no_disponible', cuenta: null };
        }
        if (error instanceof WhatsappNoDisponible) return { estado: 'no_disponible', cuenta: null };
        throw error;
      }
      const estado = traducirEstado(sesion.status);
      const cuenta = estado === 'conectado' && sesion.me ? sesion.me.id.split('@')[0]! : null;
      return { estado, cuenta };
    },

    async iniciar() {
      try {
        await pedir('POST', `/api/sessions/${SESION}/start`);
      } catch (error) {
        // La sesión todavía no existe: se crea ya iniciada.
        if (error instanceof WhatsappRechazo && (error.status === 404 || error.status === 422)) {
          await pedir('POST', '/api/sessions', { name: SESION, start: true });
          return;
        }
        throw error;
      }
    },

    async reiniciar() {
      await pedir('POST', `/api/sessions/${SESION}/restart`);
    },

    async desvincular() {
      // Después del logout WAHA vuelve a pedir QR solo: se detiene para que quede desvinculada.
      await pedir('POST', `/api/sessions/${SESION}/logout`);
      await pedir('POST', `/api/sessions/${SESION}/stop`);
    },

    async qr() {
      const { mimetype, data } = await json<{ mimetype: string; data: string }>(
        'GET',
        `/api/${SESION}/auth/qr`,
      );
      return `data:${mimetype};base64,${data}`;
    },

    async verificarNumero(numero) {
      const res = await json<{ numberExists: boolean; chatId?: string | null }>(
        'GET',
        `/api/contacts/check-exists?phone=${encodeURIComponent(numero)}&session=${SESION}`,
      );
      return res.numberExists && res.chatId ? res.chatId : null;
    },

    async enviarTexto(chatId, texto) {
      await pedir('POST', '/api/sendText', { session: SESION, chatId, text: texto });
    },
  };
}
