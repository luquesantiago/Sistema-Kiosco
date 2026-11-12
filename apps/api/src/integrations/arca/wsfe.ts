import { ArcaNoDisponible, ArcaRechazo } from './errores.js';
import { enviarSoap, escaparXml, hijo, recortar, texto } from './soap.js';

/*
 * WSFEv1: sobres SOAP y lectura de las respuestas de los cuatro métodos que
 * usa el kiosco. Ningún mensaje de error lleva el token ni el sign.
 */

const NS = 'http://ar.gov.afip.dif.FEV1/';

/** Credenciales de cada pedido autenticado: el ticket de acceso y el CUIT del emisor. */
export interface AuthWsfe {
  token: string;
  sign: string;
  cuit: string;
}

/**
 * Detalle de `FECAESolicitar` para una sola factura, con los nombres de ARCA.
 * Los importes van como texto con 2 decimales y `CbteFch` como "AAAAMMDD".
 */
export interface PedidoCae {
  PtoVta: number;
  CbteTipo: number;
  Concepto: number;
  DocTipo: number;
  DocNro: number;
  CbteDesde: number;
  CbteHasta: number;
  CbteFch: string;
  ImpTotal: string;
  ImpTotConc: string;
  ImpNeto: string;
  ImpOpEx: string;
  ImpIVA: string;
  ImpTrib: string;
  MonId: string;
  MonCotiz: number;
  CondicionIVAReceptorId: number;
}

/** Un comprobante autorizado, tal como lo informa `FECompConsultar`. */
export interface ComprobanteArca {
  numero: number;
  /** "AAAA-MM-DD". */
  fecha: string;
  /** Con 2 decimales: "3300.50". */
  importe: string;
  cae: string;
  /** "AAAA-MM-DD". */
  vencimiento: string;
}

export interface OpcionesWsfe {
  url: string;
  timeoutMs?: number;
}

/** "20261120" → "2026-11-20". */
export function fechaConGuiones(aaaammdd: string): string {
  return `${aaaammdd.slice(0, 4)}-${aaaammdd.slice(4, 6)}-${aaaammdd.slice(6, 8)}`;
}

function sobre(metodo: string, contenido: string): string {
  return (
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ' +
    `xmlns:ar="${NS}"><soap:Header/><soap:Body>` +
    `<ar:${metodo}>${contenido}</ar:${metodo}>` +
    '</soap:Body></soap:Envelope>'
  );
}

function auth({ token, sign, cuit }: AuthWsfe): string {
  return (
    `<ar:Auth><ar:Token>${escaparXml(token)}</ar:Token>` +
    `<ar:Sign>${escaparXml(sign)}</ar:Sign><ar:Cuit>${escaparXml(cuit)}</ar:Cuit></ar:Auth>`
  );
}

/** `<ar:Nombre>valor</ar:Nombre>` por cada campo, en el orden dado (el WSDL es una secuencia). */
function campos(valores: [string, string | number][]): string {
  return valores
    .map(([nombre, valor]) => `<ar:${nombre}>${escaparXml(valor)}</ar:${nombre}>`)
    .join('');
}

/** Saca el token y el sign de un texto, por si ARCA los repitiera en un mensaje. */
function sinCredenciales(mensaje: string, credenciales?: AuthWsfe): string {
  if (!credenciales) return mensaje;
  return mensaje.split(credenciales.token).join('[token]').split(credenciales.sign).join('[sign]');
}

/** Llama a un método y devuelve su `...Result`. Un SOAP Fault es ARCA no disponible. */
async function llamar(
  opciones: OpcionesWsfe,
  metodo: string,
  contenido: string,
  credenciales?: AuthWsfe,
): Promise<Record<string, unknown>> {
  const respuesta = await enviarSoap(opciones.url, sobre(metodo, contenido), {
    soapAction: `${NS}${metodo}`,
    timeoutMs: opciones.timeoutMs,
  });
  if ('fault' in respuesta) {
    throw new ArcaNoDisponible(
      'caido',
      sinCredenciales(
        `ARCA respondió con un error del servidor: ${respuesta.fault.mensaje}`,
        credenciales,
      ),
    );
  }
  const resultado = hijo(hijo(respuesta.cuerpo, `${metodo}Response`), `${metodo}Result`);
  if (resultado === undefined || typeof resultado !== 'object') {
    throw new ArcaNoDisponible('caido', `ARCA respondió a ${metodo} sin resultado.`);
  }
  return resultado;
}

/** Lista de `{ Code, Msg }` de `Errors`, `Observaciones` o `Events`. */
function mensajes(nodo: unknown, item: string): { codigo: string; mensaje: string }[] {
  const lista = hijo(nodo, item);
  if (!Array.isArray(lista)) return [];
  return lista.map((m: unknown) => ({
    codigo: texto(hijo(m, 'Code')),
    mensaje: texto(hijo(m, 'Msg')),
  }));
}

/** El primer error o la primera observación, como rechazo, con todos los mensajes juntos. */
function rechazo(
  lista: { codigo: string; mensaje: string }[],
  credenciales: AuthWsfe,
): ArcaRechazo {
  const texto = lista.map((m) => `${m.codigo}: ${m.mensaje}`).join(' · ');
  return new ArcaRechazo(
    lista[0]?.codigo ?? 'R',
    recortar(
      sinCredenciales(
        `ARCA rechazó el comprobante: ${texto || 'sin motivo informado'}`,
        credenciales,
      ),
    ),
  );
}

/** `FEDummy`: estado de los servidores de ARCA. No necesita ticket. */
export async function feDummy(opciones: OpcionesWsfe): Promise<'ok' | 'caido'> {
  try {
    const resultado = await llamar(opciones, 'FEDummy', '');
    const servidores = ['AppServer', 'DbServer', 'AuthServer'].map((s) =>
      texto(hijo(resultado, s)),
    );
    return servidores.every((s) => s.toUpperCase() === 'OK') ? 'ok' : 'caido';
  } catch (error) {
    if (error instanceof ArcaNoDisponible) return 'caido';
    throw error;
  }
}

/** `FECompUltimoAutorizado`: último número autorizado del punto de venta y tipo. */
export async function feCompUltimoAutorizado(
  opciones: OpcionesWsfe,
  credenciales: AuthWsfe,
  ptoVta: number,
  tipo: number,
): Promise<number> {
  const resultado = await llamar(
    opciones,
    'FECompUltimoAutorizado',
    auth(credenciales) +
      campos([
        ['PtoVta', ptoVta],
        ['CbteTipo', tipo],
      ]),
    credenciales,
  );
  const errores = mensajes(hijo(resultado, 'Errors'), 'Err');
  if (errores.length > 0) throw rechazo(errores, credenciales);
  const numero = Number(texto(hijo(resultado, 'CbteNro')));
  if (!Number.isInteger(numero) || numero < 0) {
    throw new ArcaNoDisponible('caido', 'ARCA no informó el último número autorizado.');
  }
  return numero;
}

/** Código de ARCA para "no existen datos en nuestros registros" (comprobante inexistente). */
const NO_EXISTE = '602';

/** `FECompConsultar`: un comprobante puntual, o null si ARCA no lo tiene. */
export async function feCompConsultar(
  opciones: OpcionesWsfe,
  credenciales: AuthWsfe,
  ptoVta: number,
  tipo: number,
  numero: number,
): Promise<ComprobanteArca | null> {
  const resultado = await llamar(
    opciones,
    'FECompConsultar',
    auth(credenciales) +
      `<ar:FeCompConsReq>${campos([
        ['CbteTipo', tipo],
        ['CbteNro', numero],
        ['PtoVta', ptoVta],
      ])}</ar:FeCompConsReq>`,
    credenciales,
  );
  const errores = mensajes(hijo(resultado, 'Errors'), 'Err');
  if (errores.some((e) => e.codigo === NO_EXISTE)) return null;
  if (errores.length > 0) throw rechazo(errores, credenciales);
  const encontrado = hijo(resultado, 'ResultGet');
  const fecha = texto(hijo(encontrado, 'CbteFch'));
  const cae = texto(hijo(encontrado, 'CodAutorizacion'));
  if (!fecha || !cae) return null;
  return {
    numero: Number(texto(hijo(encontrado, 'CbteDesde')) || numero),
    fecha: fechaConGuiones(fecha),
    importe: Number(texto(hijo(encontrado, 'ImpTotal'))).toFixed(2),
    cae,
    vencimiento: fechaConGuiones(texto(hijo(encontrado, 'FchVto'))),
  };
}

/** `FECAESolicitar` de una sola factura. Autorizada → CAE y vencimiento; si no, `ArcaRechazo`. */
export async function feCaeSolicitar(
  opciones: OpcionesWsfe,
  credenciales: AuthWsfe,
  pedido: PedidoCae,
): Promise<{ cae: string; vencimiento: string }> {
  const cabecera = campos([
    ['CantReg', 1],
    ['PtoVta', pedido.PtoVta],
    ['CbteTipo', pedido.CbteTipo],
  ]);
  const detalle = campos([
    ['Concepto', pedido.Concepto],
    ['DocTipo', pedido.DocTipo],
    ['DocNro', pedido.DocNro],
    ['CbteDesde', pedido.CbteDesde],
    ['CbteHasta', pedido.CbteHasta],
    ['CbteFch', pedido.CbteFch],
    ['ImpTotal', pedido.ImpTotal],
    ['ImpTotConc', pedido.ImpTotConc],
    ['ImpNeto', pedido.ImpNeto],
    ['ImpOpEx', pedido.ImpOpEx],
    ['ImpTrib', pedido.ImpTrib],
    ['ImpIVA', pedido.ImpIVA],
    ['MonId', pedido.MonId],
    ['MonCotiz', pedido.MonCotiz],
    ['CondicionIVAReceptorId', pedido.CondicionIVAReceptorId],
  ]);
  const resultado = await llamar(
    opciones,
    'FECAESolicitar',
    auth(credenciales) +
      `<ar:FeCAEReq><ar:FeCabReq>${cabecera}</ar:FeCabReq>` +
      `<ar:FeDetReq><ar:FECAEDetRequest>${detalle}</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>`,
    credenciales,
  );

  const respuestaDetalle = hijo(hijo(resultado, 'FeDetResp'), 'FECAEDetResponse');
  const errores = mensajes(hijo(resultado, 'Errors'), 'Err');
  const observaciones = mensajes(hijo(respuestaDetalle, 'Observaciones'), 'Obs');
  const aprobado = texto(hijo(respuestaDetalle, 'Resultado')) === 'A';
  const cae = texto(hijo(respuestaDetalle, 'CAE'));
  const vencimiento = texto(hijo(respuestaDetalle, 'CAEFchVto'));
  if (aprobado && cae && vencimiento) {
    return { cae, vencimiento: fechaConGuiones(vencimiento) };
  }
  throw rechazo([...errores, ...observaciones], credenciales);
}
