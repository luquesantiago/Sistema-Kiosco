import { createHash, verify } from 'node:crypto';
import forge from 'node-forge';
import { describe, expect, it } from 'vitest';
import { armarTra, firmarTra } from '../src/integrations/arca/wsaa.js';

/*
 * TRA y firma CMS del WSAA (cambio facturacion-arca, tarea 3.2). El pedido a
 * `LoginCms` contra un servidor local está en `arca-tickets.test.ts`.
 */

function credenciales() {
  const claves = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = claves.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2028-01-01T00:00:00Z');
  const sujeto = [{ name: 'commonName', value: 'kiosco' }];
  cert.setSubject(sujeto);
  cert.setIssuer(sujeto);
  cert.sign(claves.privateKey, forge.md.sha256.create());
  return {
    certificado: forge.pki.certificateToPem(cert),
    clave: forge.pki.privateKeyToPem(claves.privateKey),
    publica: forge.pki.publicKeyToPem(claves.publicKey),
  };
}

/** Atributos autenticados (como SET, que es lo que se firma) y la firma del CMS. */
function leerFirma(cms: string) {
  const mensaje = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.decode64(cms))) as {
    rawCapture: { signature: string; authenticatedAttributes: forge.asn1.Asn1[] };
  };
  const atributos = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.SET,
    true,
    mensaje.rawCapture.authenticatedAttributes,
  );
  return {
    atributos: Buffer.from(forge.asn1.toDer(atributos).getBytes(), 'latin1'),
    firma: Buffer.from(mensaje.rawCapture.signature, 'latin1'),
  };
}

describe('armarTra', () => {
  it('lleva uniqueId con los segundos de ahora, ±10 minutos en hora de Argentina y el servicio', () => {
    const tra = armarTra('wsfe', new Date('2026-11-10T19:59:00Z'));

    expect(tra).toContain(`<uniqueId>${Date.parse('2026-11-10T19:59:00Z') / 1000}</uniqueId>`);
    expect(tra).toContain('<generationTime>2026-11-10T16:49:00-03:00</generationTime>');
    expect(tra).toContain('<expirationTime>2026-11-10T17:09:00-03:00</expirationTime>');
    expect(tra).toContain('<service>wsfe</service>');
  });

  // Bordes agregados en la revisión.
  it('uniqueId son los segundos enteros: 999 ms no suman un segundo', () => {
    const tra = armarTra('wsfe', new Date('2026-11-10T19:59:00.999Z'));

    expect(tra).toContain(`<uniqueId>${Date.parse('2026-11-10T19:59:00Z') / 1000}</uniqueId>`);
    expect(tra).toContain('<generationTime>2026-11-10T16:49:00-03:00</generationTime>');
  });

  it('cerca de la medianoche de Argentina, generationTime cae el día anterior', () => {
    // 00:05 del 11/11 en Argentina.
    const tra = armarTra('wsfe', new Date('2026-11-11T03:05:00Z'));

    expect(tra).toContain('<generationTime>2026-11-10T23:55:00-03:00</generationTime>');
    expect(tra).toContain('<expirationTime>2026-11-11T00:15:00-03:00</expirationTime>');
  });

  it('expirationTime − generationTime son exactamente 20 minutos', () => {
    const tra = armarTra('wsfe', new Date('2026-11-10T19:59:30Z'));
    const hora = (etiqueta: string) =>
      Date.parse(new RegExp(`<${etiqueta}>([^<]+)</${etiqueta}>`).exec(tra)![1]!);

    expect(hora('expirationTime') - hora('generationTime')).toBe(20 * 60_000);
  });

  it('escapa el nombre del servicio', () => {
    expect(armarTra('a<b&c', new Date('2026-11-10T19:59:00Z'))).toContain(
      '<service>a&lt;b&amp;c</service>',
    );
  });
});

describe('firmarTra', () => {
  it('arma un CMS con el TRA adjunto y una firma SHA-256 que verifica con el certificado', () => {
    const { certificado, clave, publica } = credenciales();
    const tra = armarTra('wsfe', new Date('2026-11-10T19:59:00Z'));

    const cms = firmarTra(tra, certificado, clave);

    const der = Buffer.from(cms, 'base64');
    // El TRA viaja adentro y el certificado también.
    expect(der.toString('latin1')).toContain('<service>wsfe</service>');
    const certDer = Buffer.from(
      forge.asn1
        .toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(certificado)))
        .getBytes(),
      'latin1',
    );
    expect(der.includes(certDer)).toBe(true);

    const { atributos, firma } = leerFirma(cms);
    expect(verify('sha256', atributos, publica, firma)).toBe(true);
    // Los atributos firmados llevan el SHA-256 del TRA.
    expect(atributos.includes(createHash('sha256').update(tra, 'utf8').digest())).toBe(true);
  });

  it('con una clave que no es la del certificado, la firma no verifica', () => {
    const uno = credenciales();
    const otro = credenciales();

    const { atributos, firma } = leerFirma(
      firmarTra('<loginTicketRequest/>', uno.certificado, otro.clave),
    );

    expect(verify('sha256', atributos, uno.publica, firma)).toBe(false);
  });

  it('el digest firmado corresponde al TRA exacto: otro TRA da otro digest', () => {
    const { certificado, clave } = credenciales();
    const tra = armarTra('wsfe', new Date('2026-11-10T19:59:00Z'));
    const otro = armarTra('wsfe', new Date('2026-11-10T19:59:01Z'));

    const { atributos } = leerFirma(firmarTra(tra, certificado, clave));

    expect(atributos.includes(createHash('sha256').update(otro, 'utf8').digest())).toBe(false);
  });
});
