import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verificarFirmaWebhook } from '../src/integrations/mercadopago/firma.js';

/*
 * Verificación de la firma de las notificaciones de Mercado Pago (spec
 * "Notificaciones de Mercado Pago con firma verificada" y design "Webhook firmado").
 *
 * Contrato asumido (el design fija el algoritmo pero no la firma de la función):
 *   verificarFirmaWebhook({ secreto, xSignature, xRequestId, dataId, ahora }): boolean
 * - `xSignature` y `xRequestId` son los encabezados tal cual (o undefined si no vienen).
 * - `dataId` es `data.id` del query string tal cual llegó (la función lo pasa a minúsculas).
 * - `ahora` es el reloj del servidor (inyectado).
 * - Manifest: `id:{data.id en minúsculas};request-id:{x-request-id};ts:{ts};`, omitiendo
 *   `id:` o `request-id:` si no vienen; HMAC-SHA256 en hexadecimal con la clave secreta.
 * - Tolerancia: |ahora − ts| <= 300 s; un `ts` de 13 dígitos se toma en milisegundos.
 */

const SECRETO = 'clave-secreta-de-prueba-del-kiosco';
const REQUEST_ID = 'bb56a2f1-6aae-46ac-982e-9dcd3581d08e';
const DATA_ID = 'ord01jq4s4ky8hwq6na5pxb65b3d3';

/** 10/11/2026 a las 10:00:00 en Argentina. */
const AHORA = new Date('2026-11-10T13:00:00Z');
const AHORA_S = Math.floor(AHORA.getTime() / 1000);

/** El manifest de MP con las partes que vengan, en el orden documentado. */
function manifest({ dataId, requestId, ts }: { dataId?: string; requestId?: string; ts: string }) {
  return [
    dataId === undefined ? '' : `id:${dataId};`,
    requestId === undefined ? '' : `request-id:${requestId};`,
    `ts:${ts};`,
  ].join('');
}

function hmac(texto: string, secreto = SECRETO) {
  return createHmac('sha256', secreto).update(texto).digest('hex');
}

/** Encabezado `x-signature` firmado como lo haría MP. */
function firmar({
  ts = String(AHORA_S - 10),
  dataId = DATA_ID as string | undefined,
  requestId = REQUEST_ID as string | undefined,
  secreto = SECRETO,
} = {}) {
  return `ts=${ts},v1=${hmac(manifest({ dataId, requestId, ts }), secreto)}`;
}

function verificar(cambios: {
  xSignature?: string | undefined;
  xRequestId?: string | undefined;
  dataId?: string | undefined;
  ahora?: Date;
}) {
  return verificarFirmaWebhook({
    secreto: SECRETO,
    xSignature: firmar(),
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    ahora: AHORA,
    ...cambios,
  });
}

describe('firma de las notificaciones de Mercado Pago', () => {
  it('firma válida con marca de tiempo de hace 10 segundos: se acepta', () => {
    expect(verificar({})).toBe(true);
  });

  it('firma hecha con otra clave: se rechaza', () => {
    expect(verificar({ xSignature: firmar({ secreto: 'otra-clave' }) })).toBe(false);
  });

  it('firma de otro cobro (otro data.id): se rechaza', () => {
    expect(verificar({ dataId: 'ord01otroidistinto' })).toBe(false);
  });

  it('firma de otro request-id: se rechaza', () => {
    expect(verificar({ xRequestId: 'otro-request-id' })).toBe(false);
  });

  it('sin el encabezado de firma: se rechaza', () => {
    expect(verificar({ xSignature: undefined })).toBe(false);
  });

  it.each([
    ['vacío', ''],
    ['sin v1', `ts=${AHORA_S}`],
    ['sin ts', `v1=${hmac(manifest({ dataId: DATA_ID, requestId: REQUEST_ID, ts: '' }))}`],
    ['basura', 'cualquier cosa'],
    ['ts no numérico', `ts=ayer,v1=${hmac(manifest({ dataId: DATA_ID, requestId: REQUEST_ID, ts: 'ayer' }))}`],
    // Una firma de otro largo no tiene que romper la comparación de tiempo constante.
    ['v1 más corto', `ts=${AHORA_S - 10},v1=abc123`],
    ['v1 vacío', `ts=${AHORA_S - 10},v1=`],
  ])('encabezado de firma %s: se rechaza sin tirar error', (_caso, xSignature) => {
    expect(() => verificar({ xSignature })).not.toThrow();
    expect(verificar({ xSignature })).toBe(false);
  });
});

describe('tolerancia de la marca de tiempo (300 s)', () => {
  it.each([
    // [descripción, segundos respecto de ahora (negativo = pasado), acepta]
    ['hace 299 s', -299, true],
    ['hace exactamente 300 s (el límite)', -300, true],
    ['hace 301 s', -301, false],
    ['ahora mismo', 0, true],
    ['299 s en el futuro', 299, true],
    ['300 s en el futuro', 300, true],
    ['301 s en el futuro', 301, false],
  ])('ts %s → acepta: %s', (_caso, segundos, acepta) => {
    const xSignature = firmar({ ts: String(AHORA_S + segundos) });
    expect(verificar({ xSignature })).toBe(acepta);
  });

  it.each([
    ['hace 300.000 ms', -300_000, true],
    ['hace 300.001 ms', -300_001, false],
    ['hace 301.000 ms', -301_000, false],
    ['301.000 ms en el futuro', 301_000, false],
  ])('ts de 13 dígitos (milisegundos) %s → acepta: %s', (_caso, ms, acepta) => {
    const ts = String(AHORA.getTime() + ms);
    expect(ts).toHaveLength(13);
    expect(verificar({ xSignature: firmar({ ts }) })).toBe(acepta);
  });

  it('un ts en segundos de 10 dígitos no se confunde con milisegundos', () => {
    const ts = String(AHORA_S);
    expect(ts).toHaveLength(10);
    expect(verificar({ xSignature: firmar({ ts }) })).toBe(true);
  });
});

describe('manifest', () => {
  it('data.id en mayúsculas en el query: se firma en minúsculas y se acepta', () => {
    const xSignature = firmar({ dataId: DATA_ID.toLowerCase() });
    expect(verificar({ xSignature, dataId: DATA_ID.toUpperCase() })).toBe(true);
  });

  it('una firma hecha con el data.id en mayúsculas no coincide', () => {
    const xSignature = firmar({ dataId: DATA_ID.toUpperCase() });
    expect(verificar({ xSignature, dataId: DATA_ID.toUpperCase() })).toBe(false);
  });

  it('sin x-request-id: el manifest omite "request-id:" y se acepta', () => {
    const xSignature = firmar({ requestId: undefined });
    expect(verificar({ xSignature, xRequestId: undefined })).toBe(true);
  });

  it('sin x-request-id, una firma que sí lo incluía no coincide', () => {
    expect(verificar({ xRequestId: undefined })).toBe(false);
  });

  it('sin data.id: el manifest omite "id:" y se acepta', () => {
    const xSignature = firmar({ dataId: undefined });
    expect(verificar({ xSignature, dataId: undefined })).toBe(true);
  });
});
