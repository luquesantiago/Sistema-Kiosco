import forge from 'node-forge';
import { ArcaNoDisponible } from './errores.js';
import { enviarSoap, escaparXml, hijo, leerXml, texto } from './soap.js';

/*
 * WSAA (`LoginCms`): pide el ticket de acceso con un TRA firmado en CMS/PKCS#7
 * con el certificado y la clave del kiosco. El ticket dura unas 12 h.
 */

/** Lo que devuelve ARCA: el token y el sign van en cada pedido al WSFE. */
export interface TicketAcceso {
  token: string;
  sign: string;
  /** Null si ARCA no la informó bien. */
  generadoEn: Date | null;
  expiraEn: Date;
}

/** Lo que hace falta para pedir un ticket: la dirección del WSAA y las credenciales (PEM). */
export interface OpcionesWsaa {
  url: string;
  certificado: string;
  clave: string;
  timeoutMs?: number;
}

const DIEZ_MINUTOS_MS = 10 * 60_000;
const DESFASE_ARGENTINA_MS = 3 * 60 * 60_000;

/** "2026-11-10T16:49:00-03:00": ARCA lee la hora con su zona. */
function horaArgentina(instante: Date): string {
  const local = new Date(instante.getTime() - DESFASE_ARGENTINA_MS);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

/**
 * TRA (pedido de ticket de acceso): `uniqueId` son los segundos de `ahora` y
 * vale de 10 minutos antes a 10 minutos después, por si el reloj está corrido.
 */
export function armarTra(servicio: string, ahora: Date): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<loginTicketRequest version="1.0">',
    '<header>',
    `<uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>`,
    `<generationTime>${horaArgentina(new Date(ahora.getTime() - DIEZ_MINUTOS_MS))}</generationTime>`,
    `<expirationTime>${horaArgentina(new Date(ahora.getTime() + DIEZ_MINUTOS_MS))}</expirationTime>`,
    '</header>',
    `<service>${escaparXml(servicio)}</service>`,
    '</loginTicketRequest>',
  ].join('');
}

/** Firma el TRA en CMS `SignedData` con el contenido adjunto (SHA-256) y lo devuelve en base64. */
export function firmarTra(tra: string, certificadoPem: string, clavePem: string): string {
  const certificado = forge.pki.certificateFromPem(certificadoPem);
  const clave = forge.pki.privateKeyFromPem(clavePem);
  const cms = forge.pkcs7.createSignedData();
  cms.content = forge.util.createBuffer(tra, 'utf8');
  cms.addCertificate(certificado);
  cms.addSigner({
    key: clave,
    certificate: certificado,
    digestAlgorithm: forge.pki.oids.sha256!,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType!, value: forge.pki.oids.data! },
      { type: forge.pki.oids.messageDigest! },
      { type: forge.pki.oids.signingTime! },
    ],
  });
  cms.sign();
  return forge.util.encode64(forge.asn1.toDer(cms.toAsn1()).getBytes());
}

/** Pide el ticket a `LoginCms`. `coe.alreadyAuthenticated` → `ArcaNoDisponible('autenticacion_bloqueada')`. */
export async function loginCms(cmsBase64: string, opciones: OpcionesWsaa): Promise<TicketAcceso> {
  const sobre =
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    'xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">' +
    '<soapenv:Header/><soapenv:Body><wsaa:loginCms>' +
    `<wsaa:in0>${cmsBase64}</wsaa:in0>` +
    '</wsaa:loginCms></soapenv:Body></soapenv:Envelope>';
  const respuesta = await enviarSoap(opciones.url, sobre, {
    soapAction: '',
    timeoutMs: opciones.timeoutMs,
  });
  if ('fault' in respuesta) {
    if (respuesta.fault.codigo.includes('alreadyAuthenticated')) {
      throw new ArcaNoDisponible('autenticacion_bloqueada');
    }
    // Certificado vencido, firma inválida o servicio no asociado: no se resuelve reintentando
    // la factura, pero tampoco es culpa de ella. La pantalla muestra el motivo.
    throw new ArcaNoDisponible(
      'caido',
      `ARCA no dio el ticket de acceso: ${respuesta.fault.mensaje}`,
    );
  }

  const devuelto = texto(hijo(hijo(respuesta.cuerpo, 'loginCmsResponse'), 'loginCmsReturn'));
  const ticket = leerTicket(devuelto);
  if (!ticket)
    throw new ArcaNoDisponible('caido', 'ARCA devolvió un ticket de acceso que no se entiende.');
  return ticket;
}

/** Lee el `loginTicketResponse` (viene como texto XML adentro de la respuesta SOAP). */
function leerTicket(xml: string): TicketAcceso | null {
  if (!xml) return null;
  let documento: Record<string, unknown>;
  try {
    documento = leerXml(xml);
  } catch {
    return null;
  }
  const respuesta = hijo(documento, 'loginTicketResponse');
  const token = texto(hijo(hijo(respuesta, 'credentials'), 'token'));
  const sign = texto(hijo(hijo(respuesta, 'credentials'), 'sign'));
  const generadoEn = new Date(texto(hijo(hijo(respuesta, 'header'), 'generationTime')));
  const expiraEn = new Date(texto(hijo(hijo(respuesta, 'header'), 'expirationTime')));
  if (!token || !sign || Number.isNaN(expiraEn.getTime())) return null;
  return {
    token,
    sign,
    generadoEn: Number.isNaN(generadoEn.getTime()) ? null : generadoEn,
    expiraEn,
  };
}

/** TRA firmado y pedido a `LoginCms`, todo junto. */
export async function pedirTicket(
  servicio: string,
  ahora: Date,
  opciones: OpcionesWsaa,
): Promise<TicketAcceso> {
  const cms = firmarTra(armarTra(servicio, ahora), opciones.certificado, opciones.clave);
  return loginCms(cms, opciones);
}
