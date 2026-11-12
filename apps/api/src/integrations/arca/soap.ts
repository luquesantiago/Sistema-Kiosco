import { XMLParser } from 'fast-xml-parser';
import { ArcaNoDisponible } from './errores.js';

/*
 * Lo mínimo de SOAP que usan WSAA y WSFEv1: los sobres se arman con plantillas
 * de texto (son pocos y fijos, con los valores escapados) y las respuestas se
 * leen con fast-xml-parser. Sin WSDL ni librerías de SOAP, para poder
 * distinguir bien los errores de red de los rechazos.
 */

export const TIMEOUT_MS = 15_000;

/** Escapa un valor para ponerlo dentro de un elemento XML. */
export function escaparXml(valor: string | number): string {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Todo como texto (sin convertir números) y sin prefijos de espacio de nombres. */
const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (nombre) => ['Obs', 'Err', 'Evt'].includes(nombre),
});

/** Nodo leído del XML: objeto, texto o nada. */
export type NodoXml = Record<string, unknown> | string | undefined;

export function leerXml(xml: string): Record<string, unknown> {
  return parser.parse(xml) as Record<string, unknown>;
}

/** Hijo de un nodo, o undefined si no está. */
export function hijo(nodo: unknown, nombre: string): NodoXml {
  if (nodo === null || typeof nodo !== 'object') return undefined;
  return (nodo as Record<string, unknown>)[nombre] as NodoXml;
}

/** Texto de un nodo hoja ("" si está vacío o no es texto). */
export function texto(nodo: unknown): string {
  return typeof nodo === 'string' ? nodo : '';
}

/** Recorta un mensaje de ARCA para guardarlo y mostrarlo. */
export function recortar(mensaje: string, largo = 200): string {
  const limpio = mensaje.replace(/\s+/g, ' ').trim();
  return limpio.length > largo ? `${limpio.slice(0, largo - 1)}…` : limpio;
}

export interface FaultSoap {
  codigo: string;
  /** Completo: quien lo use le saca las credenciales y después lo recorta. */
  mensaje: string;
}

export type RespuestaSoap = { cuerpo: Record<string, unknown> } | { fault: FaultSoap };

/**
 * Manda un sobre SOAP 1.1 y devuelve el `Body` leído o el `Fault`. Red,
 * timeout, HTTP 5xx sin Fault o una respuesta que no es XML son `ArcaNoDisponible`.
 */
export async function enviarSoap(
  url: string,
  sobre: string,
  { soapAction, timeoutMs = TIMEOUT_MS }: { soapAction: string; timeoutMs?: number },
): Promise<RespuestaSoap> {
  let res: Response;
  let cuerpo: string;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${soapAction}"` },
      body: sobre,
      signal: AbortSignal.timeout(timeoutMs),
    });
    cuerpo = await res.text();
  } catch {
    throw new ArcaNoDisponible('caido', 'ARCA no responde (sin conexión o se agotó el tiempo).');
  }

  let documento: Record<string, unknown>;
  try {
    documento = leerXml(cuerpo);
  } catch {
    throw new ArcaNoDisponible(
      'caido',
      `ARCA respondió algo que no se entiende (HTTP ${res.status}).`,
    );
  }
  const body = hijo(hijo(documento, 'Envelope'), 'Body');
  const fault = hijo(body, 'Fault');
  if (fault !== undefined) {
    return {
      fault: {
        codigo: texto(hijo(fault, 'faultcode')),
        mensaje: texto(hijo(fault, 'faultstring')),
      },
    };
  }
  if (!res.ok || body === undefined || typeof body !== 'object') {
    throw new ArcaNoDisponible('caido', `ARCA respondió con un error (HTTP ${res.status}).`);
  }
  return { cuerpo: body };
}
