import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ArcaNoDisponible,
  ArcaRechazo,
  clienteArca,
  type PedidoCae,
} from '../src/integrations/arca/cliente.js';
import { limpiarBase, prismaTest } from './base.js';

/*
 * Cliente real de ARCA contra un WSFEv1 local que devuelve XML como el de
 * homologación (cambio facturacion-arca, tarea 3.4). El ticket de acceso ya
 * está guardado en la base, así que no se pasa por el WSAA (ver arca-tickets.test.ts).
 */

/** Token con caracteres que hay que escapar en el XML. */
const TOKEN = 'TOKEN<&>secreto';
const SIGN = 'SIGN-secreto';
const AHORA = new Date('2026-11-10T13:00:00Z');

let servidor: Server | undefined;
let pedidos: { accion: string; cuerpo: string }[] = [];
let responder: (accion: string) => { status: number; xml: string } | 'colgar';

function sobre(contenido: string) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body>${contenido}</soap:Body></soap:Envelope>`
  );
}

const resultado = (metodo: string, cuerpo: string) =>
  sobre(
    `<${metodo}Response xmlns="http://ar.gov.afip.dif.FEV1/"><${metodo}Result>${cuerpo}</${metodo}Result></${metodo}Response>`,
  );

const DUMMY_OK = resultado(
  'FEDummy',
  '<AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer>',
);

const CAE_APROBADO = resultado(
  'FECAESolicitar',
  '<FeCabResp><Cuit>20123456786</Cuit><PtoVta>5</PtoVta><CbteTipo>11</CbteTipo>' +
    '<FchProceso>20261110100000</FchProceso><CantReg>1</CantReg><Resultado>A</Resultado><Reproceso>N</Reproceso></FeCabResp>' +
    '<FeDetResp><FECAEDetResponse><Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro>' +
    '<CbteDesde>42</CbteDesde><CbteHasta>42</CbteHasta><CbteFch>20261110</CbteFch><Resultado>A</Resultado>' +
    '<CAE>76451234567890</CAE><CAEFchVto>20261120</CAEFchVto></FECAEDetResponse></FeDetResp>',
);

const CAE_CON_ERRORS = resultado(
  'FECAESolicitar',
  '<FeCabResp><Resultado>R</Resultado></FeCabResp>' +
    `<Errors><Err><Code>10016</Code><Msg>El numero o fecha del comprobante no se corresponde con el proximo a autorizar. Token ${TOKEN}</Msg></Err></Errors>`,
);

const CAE_CON_OBSERVACIONES = resultado(
  'FECAESolicitar',
  '<FeCabResp><Resultado>R</Resultado></FeCabResp>' +
    '<FeDetResp><FECAEDetResponse><CbteDesde>42</CbteDesde><Resultado>R</Resultado><CAE></CAE><CAEFchVto></CAEFchVto>' +
    '<Observaciones><Obs><Code>10242</Code><Msg>El campo Condicion Frente al IVA del receptor es obligatorio.</Msg></Obs></Observaciones>' +
    '</FECAEDetResponse></FeDetResp>',
);

const FAULT = sobre(
  '<soap:Fault><faultcode>soap:Server</faultcode><faultstring>Server was unable to process request.</faultstring></soap:Fault>',
);

async function wsfeLocal(): Promise<string> {
  servidor = createServer(async (req, res) => {
    let cuerpo = '';
    for await (const parte of req) cuerpo += parte;
    const accion =
      String(req.headers.soapaction ?? '')
        .replace(/"/g, '')
        .split('/')
        .pop() ?? '';
    pedidos.push({ accion, cuerpo });
    const respuesta = responder(accion);
    if (respuesta === 'colgar') return; // Nunca contesta: el cliente corta por timeout.
    res.writeHead(respuesta.status, { 'Content-Type': 'text/xml; charset=utf-8' });
    res.end(respuesta.xml);
  });
  await new Promise<void>((listo) => servidor!.listen(0, '127.0.0.1', listo));
  return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}

async function cliente({ timeoutMs = 2_000 } = {}) {
  const base = await wsfeLocal();
  await prismaTest.ticketAccesoArca.create({
    data: {
      servicio: 'wsfe',
      entorno: 'homologacion',
      token: TOKEN,
      sign: SIGN,
      generadoEn: new Date('2026-11-10T10:00:00Z'),
      expiraEn: new Date('2026-11-10T22:00:00Z'),
    },
  });
  return clienteArca({
    prisma: prismaTest,
    entorno: 'homologacion',
    cuit: '20123456786',
    certificado: 'sin uso: el ticket ya está guardado',
    clave: 'sin uso',
    ahora: () => AHORA,
    direcciones: { wsaa: `${base}/wsaa`, wsfe: `${base}/wsfe` },
    timeoutMs,
  });
}

const PEDIDO: PedidoCae = {
  PtoVta: 5,
  CbteTipo: 11,
  Concepto: 1,
  DocTipo: 99,
  DocNro: 0,
  CbteDesde: 42,
  CbteHasta: 42,
  CbteFch: '20261110',
  ImpTotal: '3300.50',
  ImpTotConc: '0.00',
  ImpNeto: '3300.50',
  ImpOpEx: '0.00',
  ImpIVA: '0.00',
  ImpTrib: '0.00',
  MonId: 'PES',
  MonCotiz: 1,
  CondicionIVAReceptorId: 5,
};

beforeEach(async () => {
  await limpiarBase();
  pedidos = [];
  responder = () => ({ status: 200, xml: DUMMY_OK });
});

afterEach(async () => {
  servidor?.closeAllConnections();
  await new Promise((listo) => (servidor ? servidor.close(listo) : listo(undefined)));
  servidor = undefined;
});

describe('estadoServidores (FEDummy)', () => {
  it('con los tres servidores OK → ok, sin ticket', async () => {
    const arca = await cliente();

    expect(await arca.estadoServidores()).toBe('ok');
    expect(pedidos[0]!.cuerpo).not.toContain('Token');
  });

  it('con un servidor caído → caido', async () => {
    const arca = await cliente();
    responder = () => ({
      status: 200,
      xml: resultado(
        'FEDummy',
        '<AppServer>OK</AppServer><DbServer>ERROR</DbServer><AuthServer>OK</AuthServer>',
      ),
    });

    expect(await arca.estadoServidores()).toBe('caido');
  });

  it('con HTTP 500 → caido', async () => {
    const arca = await cliente();
    responder = () => ({ status: 500, xml: '<html>Error</html>' });

    expect(await arca.estadoServidores()).toBe('caido');
  });
});

describe('solicitarCae', () => {
  it('aprobado → CAE y vencimiento AAAA-MM-DD; el pedido lleva los datos y los valores escapados', async () => {
    const arca = await cliente();
    responder = () => ({ status: 200, xml: CAE_APROBADO });

    expect(await arca.solicitarCae(PEDIDO)).toEqual({
      cae: '76451234567890',
      vencimiento: '2026-11-20',
    });

    const { accion, cuerpo } = pedidos[0]!;
    expect(accion).toBe('FECAESolicitar');
    expect(cuerpo).toContain('<ar:Token>TOKEN&lt;&amp;&gt;secreto</ar:Token>');
    expect(cuerpo).toContain('<ar:Cuit>20123456786</ar:Cuit>');
    expect(cuerpo).toContain('<ar:CantReg>1</ar:CantReg>');
    for (const campo of [
      '<ar:CbteDesde>42</ar:CbteDesde>',
      '<ar:CbteFch>20261110</ar:CbteFch>',
      '<ar:ImpTotal>3300.50</ar:ImpTotal>',
      '<ar:ImpNeto>3300.50</ar:ImpNeto>',
      '<ar:ImpIVA>0.00</ar:ImpIVA>',
      '<ar:DocTipo>99</ar:DocTipo>',
      '<ar:DocNro>0</ar:DocNro>',
      '<ar:MonId>PES</ar:MonId>',
      '<ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>',
    ]) {
      expect(cuerpo).toContain(campo);
    }
  });

  it('rechazado con Errors → ArcaRechazo con el código y el mensaje, sin el token', async () => {
    const arca = await cliente();
    responder = () => ({ status: 200, xml: CAE_CON_ERRORS });

    const error = await arca.solicitarCae(PEDIDO).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArcaRechazo);
    expect(error).toMatchObject({ codigo: '10016' });
    expect((error as Error).message).toContain('10016');
    expect((error as Error).message).not.toContain('secreto');
  });

  it('rechazado con Observaciones → ArcaRechazo con la observación', async () => {
    const arca = await cliente();
    responder = () => ({ status: 200, xml: CAE_CON_OBSERVACIONES });

    const error = await arca.solicitarCae(PEDIDO).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArcaRechazo);
    expect(error).toMatchObject({ codigo: '10242' });
    expect((error as Error).message).toContain('Condicion Frente al IVA');
  });

  it.each([
    ['SOAP Fault', () => ({ status: 500, xml: FAULT })],
    ['HTTP 500 sin SOAP', () => ({ status: 500, xml: '<html>Service Unavailable</html>' })],
    ['HTTP 503 vacío', () => ({ status: 503, xml: '' })],
  ])('%s → ArcaNoDisponible (no gasta intento)', async (_caso, respuesta) => {
    const arca = await cliente();
    responder = respuesta;

    const error = await arca.solicitarCae(PEDIDO).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArcaNoDisponible);
    expect(error).toMatchObject({ motivo: 'caido' });
    expect((error as Error).message).not.toContain('secreto');
  });

  it('sin respuesta antes del timeout → ArcaNoDisponible', async () => {
    const arca = await cliente({ timeoutMs: 200 });
    responder = () => 'colgar';

    const error = await arca.solicitarCae(PEDIDO).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ArcaNoDisponible);
  });
});

describe('ultimoAutorizado y consultar', () => {
  it('último 41 con su fecha (FECompUltimoAutorizado + FECompConsultar)', async () => {
    const arca = await cliente();
    responder = (accion) => ({
      status: 200,
      xml:
        accion === 'FECompUltimoAutorizado'
          ? resultado(
              'FECompUltimoAutorizado',
              '<PtoVta>5</PtoVta><CbteTipo>11</CbteTipo><CbteNro>41</CbteNro>',
            )
          : resultado(
              'FECompConsultar',
              '<ResultGet><CbteDesde>41</CbteDesde><CbteHasta>41</CbteHasta><CbteFch>20261109</CbteFch>' +
                '<ImpTotal>1000</ImpTotal><CodAutorizacion>76451234567889</CodAutorizacion>' +
                '<FchVto>20261119</FchVto><Resultado>A</Resultado></ResultGet>',
            ),
    });

    expect(await arca.ultimoAutorizado(5, 11)).toEqual({ numero: 41, fecha: '2026-11-09' });
    expect(pedidos.map((p) => p.accion)).toEqual(['FECompUltimoAutorizado', 'FECompConsultar']);
    expect(pedidos[1]!.cuerpo).toContain('<ar:CbteNro>41</ar:CbteNro>');
  });

  it('sin comprobantes → número 0 y sin fecha, sin consultar', async () => {
    const arca = await cliente();
    responder = () => ({
      status: 200,
      xml: resultado(
        'FECompUltimoAutorizado',
        '<PtoVta>5</PtoVta><CbteTipo>11</CbteTipo><CbteNro>0</CbteNro>',
      ),
    });

    expect(await arca.ultimoAutorizado(5, 11)).toEqual({ numero: 0, fecha: null });
    expect(pedidos).toHaveLength(1);
  });

  it('consultar un número que ARCA no tiene (602) → null', async () => {
    const arca = await cliente();
    responder = () => ({
      status: 200,
      xml: resultado(
        'FECompConsultar',
        '<Errors><Err><Code>602</Code><Msg>No existen datos en nuestros registros para los parametros ingresados.</Msg></Err></Errors>',
      ),
    });

    expect(await arca.consultar(5, 11, 42)).toBeNull();
  });

  it('consultar uno autorizado → número, fecha, importe con 2 decimales, CAE y vencimiento', async () => {
    const arca = await cliente();
    responder = () => ({
      status: 200,
      xml: resultado(
        'FECompConsultar',
        '<ResultGet><CbteDesde>42</CbteDesde><CbteFch>20261110</CbteFch><ImpTotal>3300.5</ImpTotal>' +
          '<CodAutorizacion>76451234567890</CodAutorizacion><FchVto>20261120</FchVto></ResultGet>',
      ),
    });

    expect(await arca.consultar(5, 11, 42)).toEqual({
      numero: 42,
      fecha: '2026-11-10',
      importe: '3300.50',
      cae: '76451234567890',
      vencimiento: '2026-11-20',
    });
  });
});
