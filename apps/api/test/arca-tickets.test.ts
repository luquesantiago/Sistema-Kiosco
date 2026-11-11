import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase, prismaTest } from './base.js';

/*
 * Ticket de acceso de ARCA (specs/facturacion: "Autenticación con ARCA").
 *
 * Contrato asumido: `obtenerTicket(prisma, entorno, ahora, wsaa)`, donde
 * `wsaa = { url, certificado, clave }` (PEM) es lo que necesita para pedir uno
 * nuevo a `LoginCms`; el design fija los tres primeros parámetros y no dice de
 * dónde salen la dirección, el certificado y la clave. Devuelve `{ token, sign }`.
 * Reutiliza el guardado si faltan MÁS de 60 s para que venza.
 *
 * El certificado autofirmado se genera con `node-forge` (dependencia que suma
 * este cambio); el servidor WSAA local no verifica la firma.
 */
const tickets = () => import('../src/integrations/arca/tickets.js');

let servidor: Server | undefined;
let pedidos: string[] = [];
let responder: () => { status: number; xml: string } = () => ({ status: 200, xml: loginOk() });

/** Vence el ticket guardado: 20:00:00Z (17:00 de Argentina). */
const VENCE = new Date('2026-11-10T20:00:00Z');
/** El que devuelve el WSAA local: vence el 11/11 a las 08:00:00Z. */
const VENCE_NUEVO = new Date('2026-11-11T08:00:00Z');

function loginOk() {
  const ticket = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<loginTicketResponse version="1.0">',
    '<header>',
    '<source>CN=wsaahomo, O=AFIP, C=AR, SERIALNUMBER=CUIT 33693450239</source>',
    '<destination>SERIALNUMBER=CUIT 20123456786, CN=kiosco</destination>',
    '<uniqueId>4325399</uniqueId>',
    '<generationTime>2026-11-10T16:59:00.000-03:00</generationTime>',
    '<expirationTime>2026-11-11T05:00:00.000-03:00</expirationTime>',
    '</header>',
    '<credentials>',
    '<token>TOKEN-NUEVO</token>',
    '<sign>SIGN-NUEVO</sign>',
    '</credentials>',
    '</loginTicketResponse>',
  ].join('\n');
  const escapado = ticket.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<soapenv:Body><loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov">' +
    `<loginCmsReturn>${escapado}</loginCmsReturn>` +
    '</loginCmsResponse></soapenv:Body></soapenv:Envelope>'
  );
}

const YA_AUTENTICADO =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
  'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  '<soapenv:Body><soapenv:Fault>' +
  '<faultcode xmlns:ns1="http://xml.apache.org/axis/">ns1:coe.alreadyAuthenticated</faultcode>' +
  '<faultstring>El CEE ya posee un TA valido para el acceso al WSN solicitado</faultstring>' +
  '<detail><ns2:hostname xmlns:ns2="http://xml.apache.org/axis/">wsaaext1.homo.afip.gov.ar</ns2:hostname></detail>' +
  '</soapenv:Fault></soapenv:Body></soapenv:Envelope>';

/** WSAA de mentira en un puerto libre; cuenta los pedidos. */
async function wsaaLocal(): Promise<string> {
  servidor = createServer(async (req, res) => {
    let texto = '';
    for await (const parte of req) texto += parte;
    pedidos.push(texto);
    const { status, xml } = responder();
    res.writeHead(status, { 'Content-Type': 'text/xml; charset=utf-8' });
    res.end(xml);
  });
  await new Promise<void>((listo) => servidor!.listen(0, '127.0.0.1', listo));
  return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/ws/services/LoginCms`;
}

let credenciales: Promise<{ certificado: string; clave: string }> | undefined;

/** Certificado autofirmado generado una vez por archivo. */
function certificadoDePrueba() {
  credenciales ??= (async () => {
    const forge = (await import('node-forge')).default;
    const claves = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.createCertificate();
    cert.publicKey = claves.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
    cert.validity.notAfter = new Date('2028-01-01T00:00:00Z');
    const sujeto = [
      { name: 'commonName', value: 'kiosco' },
      { name: 'serialNumber', value: 'CUIT 20123456786' },
    ];
    cert.setSubject(sujeto);
    cert.setIssuer(sujeto);
    cert.sign(claves.privateKey, forge.md.sha256.create());
    return {
      certificado: forge.pki.certificateToPem(cert),
      clave: forge.pki.privateKeyToPem(claves.privateKey),
    };
  })();
  return credenciales;
}

async function wsaa() {
  return { url: await wsaaLocal(), ...(await certificadoDePrueba()) };
}

function guardarTicket(entorno: 'homologacion' | 'produccion', expiraEn = VENCE) {
  return prismaTest.ticketAccesoArca.create({
    data: {
      servicio: 'wsfe',
      entorno,
      token: 'TOKEN-GUARDADO',
      sign: 'SIGN-GUARDADO',
      generadoEn: new Date(expiraEn.getTime() - 12 * 3600_000),
      expiraEn,
    },
  });
}

function ticketGuardado(entorno: 'homologacion' | 'produccion') {
  return prismaTest.ticketAccesoArca.findUnique({
    where: { servicio_entorno: { servicio: 'wsfe', entorno } },
  });
}

beforeEach(async () => {
  await limpiarBase();
  pedidos = [];
  responder = () => ({ status: 200, xml: loginOk() });
});

afterEach(async () => {
  await new Promise((listo) => (servidor ? servidor.close(listo) : listo(undefined)));
  servidor = undefined;
});

describe('vigencia del ticket guardado (vence a las 20:00:00Z)', () => {
  it('a las 19:58:59Z (faltan 61 s) se reutiliza sin pedir otro', async () => {
    const { obtenerTicket } = await tickets();
    const opciones = await wsaa();
    await guardarTicket('homologacion');

    const ticket = await obtenerTicket(
      prismaTest,
      'homologacion',
      new Date('2026-11-10T19:58:59Z'),
      opciones,
    );

    expect(ticket).toMatchObject({ token: 'TOKEN-GUARDADO', sign: 'SIGN-GUARDADO' });
    expect(pedidos).toHaveLength(0);
  });

  it.each([
    ['19:59:00Z (faltan 60 s)', '2026-11-10T19:59:00Z'],
    ['19:59:01Z (faltan 59 s)', '2026-11-10T19:59:01Z'],
    ['20:00:01Z (vencido por 1 s)', '2026-11-10T20:00:01Z'],
  ])('a las %s se pide uno nuevo, se guarda y se usa', async (_caso, instante) => {
    const { obtenerTicket } = await tickets();
    const opciones = await wsaa();
    await guardarTicket('homologacion');

    const ticket = await obtenerTicket(prismaTest, 'homologacion', new Date(instante), opciones);

    expect(pedidos).toHaveLength(1);
    expect(ticket).toMatchObject({ token: 'TOKEN-NUEVO', sign: 'SIGN-NUEVO' });
    expect(await ticketGuardado('homologacion')).toMatchObject({
      token: 'TOKEN-NUEVO',
      sign: 'SIGN-NUEVO',
      expiraEn: VENCE_NUEVO,
    });
  });

  it('sin ticket guardado pide uno con un TRA firmado para el servicio wsfe', async () => {
    const { obtenerTicket } = await tickets();
    const opciones = await wsaa();

    await obtenerTicket(prismaTest, 'homologacion', new Date('2026-11-10T19:59:00Z'), opciones);

    expect(pedidos).toHaveLength(1);
    const cms = /<(?:\w+:)?in0>([^<]+)<\/(?:\w+:)?in0>/.exec(pedidos[0]!)?.[1];
    expect(cms, pedidos[0]).toBeDefined();
    // CMS con el contenido adjunto: el TRA viaja dentro del DER.
    const der = Buffer.from(cms!.trim(), 'base64').toString('latin1');
    expect(der).toContain('<service>wsfe</service>');
    expect(der).toContain('<loginTicketRequest');
    expect(await ticketGuardado('homologacion')).toMatchObject({ token: 'TOKEN-NUEVO' });
  });
});

describe('reinicio y entornos', () => {
  it('al reiniciar con un ticket vigente guardado, lo usa sin pedir otro', async () => {
    // "Reiniciar" es no tener nada en memoria: el ticket lo dejó otra ejecución en la base.
    const { obtenerTicket } = await tickets();
    const opciones = await wsaa();
    await guardarTicket('produccion');

    const ticket = await obtenerTicket(
      prismaTest,
      'produccion',
      new Date('2026-11-10T15:00:00Z'),
      opciones,
    );

    expect(ticket).toMatchObject({ token: 'TOKEN-GUARDADO' });
    expect(pedidos).toHaveLength(0);
  });

  it('homologación y producción no comparten ticket', async () => {
    const { obtenerTicket } = await tickets();
    const opciones = await wsaa();
    await guardarTicket('homologacion');

    const ticket = await obtenerTicket(
      prismaTest,
      'produccion',
      new Date('2026-11-10T15:00:00Z'),
      opciones,
    );

    expect(pedidos).toHaveLength(1);
    expect(ticket).toMatchObject({ token: 'TOKEN-NUEVO' });
    expect(await ticketGuardado('produccion')).toMatchObject({ token: 'TOKEN-NUEVO' });
    expect(await ticketGuardado('homologacion')).toMatchObject({
      token: 'TOKEN-GUARDADO',
      expiraEn: VENCE,
    });
  });
});

describe('ticket vigente perdido', () => {
  it('coe.alreadyAuthenticated → ArcaNoDisponible con motivo autenticacion_bloqueada y no guarda nada', async () => {
    const { obtenerTicket } = await tickets();
    const { ArcaNoDisponible } = await import('../src/integrations/arca/cliente.js');
    const opciones = await wsaa();
    responder = () => ({ status: 500, xml: YA_AUTENTICADO });

    const error = await obtenerTicket(
      prismaTest,
      'homologacion',
      new Date('2026-11-10T15:00:00Z'),
      opciones,
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArcaNoDisponible);
    expect(error).toMatchObject({ motivo: 'autenticacion_bloqueada' });
    expect(await ticketGuardado('homologacion')).toBeNull();
  });
});
