import { describe, expect, it } from 'vitest';
import { formatearNumeroComprobante, URL_QR, urlQrFactura } from '../src/facturacion.js';

/*
 * QR de ARCA (RG 4892/2020, normativo, verificar) y formato del número impreso.
 *
 * Nota: tasks.md pide `packages/shared/src/facturacion.test.ts`; los tests de
 * shared viven en `packages/shared/test/` (como `whatsapp.test.ts`), así que va acá.
 */

/** Decodifica el parámetro `p` de la URL del QR: base64 estándar (no url-safe). */
function jsonDelQr(url: string): string {
  const prefijo = 'https://www.afip.gob.ar/fe/qr/?p=';
  expect(url.startsWith(prefijo), url).toBe(true);
  const base64 = url.slice(prefijo.length);
  // Base64 estándar: solo letras, dígitos, +, / y relleno con =.
  expect(base64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  return Buffer.from(base64, 'base64').toString('utf8');
}

const FACTURA_42 = {
  fecha: '2026-11-09',
  cuit: '20123456786',
  ptoVta: 5,
  tipoCmp: 11,
  nroCmp: 42,
  importe: '3300.50',
  cae: '76451234567890',
};

describe('urlQrFactura', () => {
  it('la dirección base es la de ARCA para QR', () => {
    expect(URL_QR).toBe('https://www.afip.gob.ar/fe/qr/');
  });

  it('arma exactamente el JSON del spec, con las claves en ese orden', () => {
    const url = urlQrFactura(FACTURA_42);

    expect(jsonDelQr(url)).toBe(
      '{"ver":1,"fecha":"2026-11-09","cuit":20123456786,"ptoVta":5,"tipoCmp":11,"nroCmp":42,' +
        '"importe":3300.5,"moneda":"PES","ctz":1,"tipoDocRec":99,"nroDocRec":0,' +
        '"tipoCodAut":"E","codAut":76451234567890}',
    );
  });

  it('la URL es la dirección de ARCA + "?p=" + la base64 estándar del texto', () => {
    const json =
      '{"ver":1,"fecha":"2026-11-09","cuit":20123456786,"ptoVta":5,"tipoCmp":11,"nroCmp":42,' +
      '"importe":3300.5,"moneda":"PES","ctz":1,"tipoDocRec":99,"nroDocRec":0,' +
      '"tipoCodAut":"E","codAut":76451234567890}';

    expect(urlQrFactura(FACTURA_42)).toBe(
      `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(json, 'utf8').toString('base64')}`,
    );
  });

  it.each([
    ['0.01', 0.01],
    ['1000.00', 1000],
    ['9999999.99', 9999999.99],
    ['3300.50', 3300.5],
  ])('importe %s → "importe": %s en el QR', (importe, esperado) => {
    const datos = JSON.parse(jsonDelQr(urlQrFactura({ ...FACTURA_42, importe })));
    expect(datos.importe).toBe(esperado);
  });

  it('el importe va como número en el texto, sin comillas ni ceros de más', () => {
    expect(jsonDelQr(urlQrFactura({ ...FACTURA_42, importe: '1000.00' }))).toContain(
      '"importe":1000,',
    );
    expect(jsonDelQr(urlQrFactura({ ...FACTURA_42, importe: '0.01' }))).toContain(
      '"importe":0.01,',
    );
  });

  it('el CAE de 14 dígitos no pierde precisión', () => {
    for (const cae of ['76451234567890', '99999999999999', '10000000000001']) {
      const texto = jsonDelQr(urlQrFactura({ ...FACTURA_42, cae }));
      expect(texto, cae).toContain(`"codAut":${cae}}`);
    }
  });

  it('el CUIT y el número de comprobante van como números', () => {
    const texto = jsonDelQr(urlQrFactura({ ...FACTURA_42, ptoVta: 99999, nroCmp: 99999999 }));
    expect(texto).toContain('"cuit":20123456786,');
    expect(texto).toContain('"ptoVta":99999,');
    expect(texto).toContain('"nroCmp":99999999,');
  });
});

describe('formatearNumeroComprobante', () => {
  it.each([
    [1, 42, '00001-00000042'],
    [5, 42, '00005-00000042'],
    [1, 1, '00001-00000001'],
    [99999, 99999999, '99999-99999999'],
  ])('punto de venta %s y número %s → %s', (ptoVta, numero, esperado) => {
    expect(formatearNumeroComprobante(ptoVta, numero)).toBe(esperado);
  });
});
