import { errorApiSchema } from '@kiosco/shared';

/** Error de la API con el formato común `{ error: { codigo, mensaje } }`. */
export class ErrorDeApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
    /** Datos extra de algunos errores (por ejemplo, los precios actuales). */
    readonly detalle?: unknown,
  ) {
    super(mensaje);
  }
}

let alNoAutenticado: () => void = () => {};

/** Se llama cuando la API responde 401 (sesión vencida o cerrada). */
export function configurarAlNoAutenticado(funcion: () => void): void {
  alNoAutenticado = funcion;
}

type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Llama a la API (`/api` + ruta) y devuelve el JSON, o undefined si es 204. */
export async function pedir<T>(metodo: Metodo, ruta: string, cuerpo?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${ruta}`, {
      method: metodo,
      headers: cuerpo === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorDeApi(0, 'SIN_CONEXION', 'No se pudo conectar con el servidor.');
  }

  if (res.status === 204) return undefined as T;
  const datos: unknown = await res.json().catch(() => null);
  if (res.ok) return datos as T;

  const error = errorApiSchema.safeParse(datos);
  const { codigo, mensaje, detalle } = error.success
    ? error.data.error
    : {
        codigo: 'ERROR',
        mensaje: 'Ocurrió un error inesperado. Intentá de nuevo.',
        detalle: undefined,
      };
  if (res.status === 401 && codigo === 'NO_AUTENTICADO') {
    alNoAutenticado();
  }
  throw new ErrorDeApi(res.status, codigo, mensaje, detalle);
}
