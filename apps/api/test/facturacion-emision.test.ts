import { beforeEach, describe, expect, it } from 'vitest';
import { ESPERAS_MS, MAX_INTENTOS } from '../src/modules/whatsapp/envio.js';
import { limpiarBase, prismaTest } from './base.js';
import { crearUsuarioDePrueba } from './ayudas.js';
import { crearArcaFalso, pedidoEsperado, PRIMER_CAE, PUNTO_VENTA } from './arca-falso.js';
import {
  avisosDeFactura,
  configArca,
  crearFacturaDirecta,
  crearVentaDirecta,
  fechaMenosDias,
  inicioDelDiaEnArgentina,
} from './facturacion-ayudas.js';

/*
 * Una pasada de la emisión: `procesarFacturas({ prisma, arca, config, ahora })`
 * (specs/facturacion: numeración, número reservado, fecha, plazo, reintentos,
 * ARCA caído, orden; specs/ventas: anulación con la factura en curso;
 * specs/notificaciones: avisos de factura).
 *
 * Devuelve el estado de ARCA que vio la pasada ('disponible' | 'no_disponible'
 * | 'autenticacion_bloqueada'): es lo que la tarea guarda para `GET /api/facturacion`.
 */
const emision = () => import('../src/modules/facturacion/emision.js');
const reglas = () => import('../src/modules/facturacion/reglas.js');

/** 10/11/2026 a las 10:00:00 de Argentina. */
const DIEZ = new Date('2026-11-10T13:00:00Z');
/** Venta del 10/11 a las 09:00 de Argentina. */
const VENTA_0900 = new Date('2026-11-10T12:00:00Z');

let ahora = DIEZ;
let usuarioId = '';

beforeEach(async () => {
  await limpiarBase();
  ahora = DIEZ;
  usuarioId = (await crearUsuarioDePrueba('juan')).id;
});

const a = (iso: string) => new Date(iso);
const masMs = (d: Date, ms: number) => new Date(d.getTime() + ms);

type Arca = ReturnType<typeof crearArcaFalso>;

async function pasada({ cliente }: Arca) {
  const { procesarFacturas } = await emision();
  return procesarFacturas({
    prisma: prismaTest,
    arca: cliente,
    config: configArca(),
    ahora: () => ahora,
  });
}

/** Venta en débito con su factura automática; por defecto, $3.300 del 10/11 a las 09:00. */
async function ventaConFactura({
  ventaEn = VENTA_0900,
  importe = '3300.00',
  estadoVenta = 'pagada' as 'pagada' | 'anulada',
  factura = {} as Record<string, unknown>,
} = {}) {
  const venta = await crearVentaDirecta({
    usuarioId,
    creadaEn: ventaEn,
    pagos: [{ medio: 'debito', monto: importe }],
    estado: estadoVenta,
  });
  const f = await crearFacturaDirecta(venta.id, { importe, creadaEn: ventaEn, ...factura });
  return { venta, factura: f };
}

function leer(id: string) {
  return prismaTest.factura.findUniqueOrThrow({ where: { id } });
}

describe('numeración correlativa', () => {
  it.each([
    [41, 42],
    [0, 1],
  ])('último autorizado %s → la factura se pide con el número %s', async (ultimo, esperado) => {
    const arca = crearArcaFalso({ ultimo, fechaUltimo: ultimo ? '2026-11-09' : null });
    const { factura } = await ventaConFactura();

    await pasada(arca);

    expect(arca.falso.pedidos.map((p) => p.CbteDesde)).toEqual([esperado]);
    expect(await leer(factura.id)).toMatchObject({
      estado: 'autorizada',
      numero: esperado,
      puntoVenta: PUNTO_VENTA,
    });
  });

  it('último 99999998: la primera sale con el 99999999 y la siguiente queda en error por numeración agotada, con aviso', async () => {
    const arca = crearArcaFalso({ ultimo: 99999998, fechaUltimo: '2026-11-09' });
    const primera = await ventaConFactura({ ventaEn: a('2026-11-10T12:00:00Z') });
    const segunda = await ventaConFactura({ ventaEn: a('2026-11-10T12:01:00Z') });

    await pasada(arca);
    await pasada(arca);

    expect(arca.falso.pedidos.map((p) => p.CbteDesde)).toEqual([99999999]);
    expect(await leer(primera.factura.id)).toMatchObject({
      estado: 'autorizada',
      numero: 99999999,
    });
    expect(await leer(segunda.factura.id)).toMatchObject({
      estado: 'error',
      codigoError: 'numeracion_agotada',
      numero: null,
    });
    const avisos = await avisosDeFactura();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.texto).toContain(`#${segunda.venta.numero}`);
    expect(avisos[0]!.texto).toContain('Administración → Facturación');
  });
});

describe('datos de la Factura C', () => {
  it('una factura de $3.300,50: tipo 11, concepto 1, PES, cotización 1, neto = total, IVA 0, consumidor final sin identificar', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    await ventaConFactura({ importe: '3300.50' });

    await pasada(arca);

    expect(arca.falso.pedidos).toEqual([
      pedidoEsperado({ numero: 42, cbteFch: '20261110', importe: '3300.50' }),
    ]);
  });

  it('autorizada: guarda el CAE y el vencimiento tal como vienen, y la hora de autorización', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    const { factura } = await ventaConFactura();

    await pasada(arca);

    expect(await leer(factura.id)).toMatchObject({
      estado: 'autorizada',
      cae: PRIMER_CAE,
      caeVencimiento: new Date('2026-11-20T00:00:00Z'),
      autorizadaEn: DIEZ,
      fechaComprobante: new Date('2026-11-10T00:00:00Z'),
      intentos: 0,
      codigoError: null,
      error: null,
    });
  });
});

describe('fecha del comprobante', () => {
  it.each([
    [
      'venta del 09/11 23:59:00 emitida el 10/11 a las 00:01:00, último del 09/11',
      '2026-11-10T02:59:00Z',
      '2026-11-10T03:01:00Z',
      '2026-11-09',
      '20261109',
    ],
    [
      'venta del 09/11 23:59:59 emitida el 10/11 a las 00:00:01',
      '2026-11-10T02:59:59Z',
      '2026-11-10T03:00:01Z',
      '2026-11-09',
      '20261109',
    ],
    [
      'venta del 10/11 00:00:00 emitida a las 00:00:05',
      '2026-11-10T03:00:00Z',
      '2026-11-10T03:00:05Z',
      '2026-11-09',
      '20261110',
    ],
    [
      'venta del 09/11 con el último autorizado del 10/11',
      '2026-11-09T18:00:00Z',
      '2026-11-10T13:00:00Z',
      '2026-11-10',
      '20261110',
    ],
  ])('%s → CbteFch %s', async (_caso, ventaEn, emitidaEn, fechaUltimo, cbteFch) => {
    ahora = a(emitidaEn);
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo });
    const { factura } = await ventaConFactura({ ventaEn: a(ventaEn) });

    await pasada(arca);

    expect(arca.falso.pedidos.map((p) => p.CbteFch)).toEqual([cbteFch]);
    expect((await leer(factura.id)).fechaComprobante).toEqual(
      new Date(`${cbteFch.slice(0, 4)}-${cbteFch.slice(4, 6)}-${cbteFch.slice(6)}T00:00:00Z`),
    );
  });
});

describe('plazo en la cola (DIAS_ATRAS_MAXIMO de reglas.ts; hoy 5)', () => {
  async function inicioDelUltimoDia() {
    const { DIAS_ATRAS_MAXIMO } = await reglas();
    return inicioDelDiaEnArgentina(fechaMenosDias('2026-11-10', DIAS_ATRAS_MAXIMO));
  }

  it('pendiente de una venta del día anterior al último permitido (04/11 23:59:59 hoy), procesada el 10/11 → error por plazo, sin ARCA y con aviso', async () => {
    const arca = crearArcaFalso();
    const { venta, factura } = await ventaConFactura({
      ventaEn: masMs(await inicioDelUltimoDia(), -1_000),
    });

    await pasada(arca);

    expect(await leer(factura.id)).toMatchObject({
      estado: 'error',
      codigoError: 'fuera_de_plazo',
      intentos: 0,
      numero: null,
    });
    expect(arca.falso.pedidos).toEqual([]);
    const avisos = await avisosDeFactura();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.texto).toContain(`#${venta.numero}`);
    expect(avisos[0]!.texto).toContain('Administración → Facturación');
  });

  it('pendiente de una venta del último día permitido a las 00:00 (05/11 hoy) → se emite', async () => {
    const arca = crearArcaFalso();
    const ventaEn = await inicioDelUltimoDia();
    const { factura } = await ventaConFactura({ ventaEn });

    await pasada(arca);

    expect(await leer(factura.id)).toMatchObject({ estado: 'autorizada', numero: 1 });
    // Sin comprobantes anteriores, la fecha es la de la venta.
    expect(arca.falso.pedidos[0]!.CbteFch).toBe(
      fechaMenosDias('2026-11-10', (await reglas()).DIAS_ATRAS_MAXIMO).replaceAll('-', ''),
    );
  });
});

describe('reintentos de una factura rechazada', () => {
  it('primer rechazo a las 10:00:00 → 1 intento; a las 10:00:29 no se manda, a las 10:00:30 sí y queda autorizada', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    arca.falso.fallas = ['rechazo'];
    const { factura } = await ventaConFactura();

    await pasada(arca);
    const rechazada = await leer(factura.id);
    expect(rechazada).toMatchObject({
      estado: 'pendiente',
      intentos: 1,
      proximoIntentoEn: a('2026-11-10T13:00:30Z'),
      // Un rechazo libera el número: ARCA no lo consumió.
      numero: null,
      fechaComprobante: null,
    });
    expect(rechazada.error).toContain('Rechazo de prueba');

    ahora = a('2026-11-10T13:00:29Z');
    await pasada(arca);
    expect(arca.falso.pedidos).toHaveLength(1);

    ahora = a('2026-11-10T13:00:30Z');
    await pasada(arca);
    expect(arca.falso.pedidos).toHaveLength(2);
    expect(await leer(factura.id)).toMatchObject({ estado: 'autorizada', numero: 42, intentos: 1 });
  });

  it('con 3 intentos y otro rechazo a las 10:00:00 → 4 intentos; a las 10:29:59 no se manda y a las 10:30:00 sí', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    arca.falso.fallas = ['rechazo'];
    const { factura } = await ventaConFactura({ factura: { intentos: 3 } });

    await pasada(arca);
    expect(await leer(factura.id)).toMatchObject({
      estado: 'pendiente',
      intentos: 4,
      proximoIntentoEn: a('2026-11-10T13:30:00Z'),
    });

    ahora = a('2026-11-10T13:29:59Z');
    await pasada(arca);
    expect(arca.falso.pedidos).toHaveLength(1);

    ahora = a('2026-11-10T13:30:00Z');
    await pasada(arca);
    expect(arca.falso.pedidos).toHaveLength(2);
  });

  it('con 4 intentos y otro rechazo → error con 5 intentos y el motivo de ARCA, aviso, y no se reintenta sola', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    arca.falso.fallas = ['rechazo'];
    const { venta, factura } = await ventaConFactura({ factura: { intentos: 4 } });

    await pasada(arca);

    const final = await leer(factura.id);
    expect(final).toMatchObject({
      estado: 'error',
      intentos: 5,
      codigoError: 'rechazo_arca',
      proximoIntentoEn: null,
      numero: null,
    });
    expect(final.error).toContain('Rechazo de prueba');
    const avisos = await avisosDeFactura();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ destino: 'admin', estado: 'pendiente' });
    expect(avisos[0]!.texto).toContain(`#${venta.numero}`);
    expect(avisos[0]!.texto).toContain('10/11/2026');
    expect(avisos[0]!.texto).toContain('3.300,00');
    expect(avisos[0]!.texto).toContain('Rechazo de prueba');
    expect(avisos[0]!.texto).toContain('Administración → Facturación');

    ahora = masMs(DIEZ, 24 * 60 * 60_000);
    await pasada(arca);
    expect(arca.falso.pedidos).toHaveLength(1);
  });

  it(`las esperas son las de WhatsApp y al intento ${MAX_INTENTOS} queda en error`, async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    arca.falso.fallas = Array(MAX_INTENTOS).fill('rechazo');
    const { factura } = await ventaConFactura();

    const esperas: number[] = [];
    for (let i = 0; i < MAX_INTENTOS; i++) {
      await pasada(arca);
      const actual = await leer(factura.id);
      if (actual.proximoIntentoEn) {
        esperas.push(actual.proximoIntentoEn.getTime() - ahora.getTime());
        ahora = actual.proximoIntentoEn;
      }
    }

    expect(esperas).toEqual(ESPERAS_MS);
    expect(esperas).toEqual([30_000, 120_000, 600_000, 1_800_000]);
    expect(await leer(factura.id)).toMatchObject({ estado: 'error', intentos: 5 });
    expect(await avisosDeFactura()).toHaveLength(1);
  });

  it('una factura en espera no frena a las siguientes', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    const enEspera = await ventaConFactura({
      ventaEn: a('2026-11-10T12:00:00Z'),
      factura: { intentos: 1, proximoIntentoEn: a('2026-11-10T13:00:30Z') },
    });
    const siguiente = await ventaConFactura({ ventaEn: a('2026-11-10T12:01:00Z') });

    await pasada(arca);

    expect(await leer(siguiente.factura.id)).toMatchObject({ estado: 'autorizada', numero: 42 });
    expect(await leer(enEspera.factura.id)).toMatchObject({ estado: 'pendiente', intentos: 1 });
  });

  it('el admin la reintenta, vuelve a fallar 5 veces y se crea un aviso nuevo', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    arca.falso.fallas = Array(1 + MAX_INTENTOS).fill('rechazo');
    const { factura } = await ventaConFactura({ factura: { intentos: 4 } });
    await pasada(arca);
    expect(await avisosDeFactura()).toHaveLength(1);

    // Lo que hace "Reintentar" del admin (POST /api/facturas/:id/reintentar).
    await prismaTest.factura.update({
      where: { id: factura.id },
      data: { estado: 'pendiente', intentos: 0, proximoIntentoEn: null, numero: null },
    });
    for (let i = 0; i < MAX_INTENTOS; i++) {
      await pasada(arca);
      const actual = await leer(factura.id);
      if (actual.proximoIntentoEn) ahora = actual.proximoIntentoEn;
    }

    expect(await leer(factura.id)).toMatchObject({ estado: 'error', intentos: 5 });
    expect(await avisosDeFactura()).toHaveLength(2);
  });
});

describe('ARCA caído no gasta intentos', () => {
  it('con FEDummy caído no cambia nada y no se pide nada más', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    arca.falso.servidores = 'caido';
    const { factura } = await ventaConFactura();

    await pasada(arca);

    expect(await leer(factura.id)).toMatchObject({
      estado: 'pendiente',
      intentos: 0,
      numero: null,
      proximoIntentoEn: null,
    });
    expect(arca.falso.llamadas).toEqual(['estadoServidores']);
  });

  it('30 ventas con tarjeta de 14:00 a 18:00 con ARCA caído: siguen pendientes con 0 intentos y al volver se emiten en orden', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    arca.falso.servidores = 'caido';
    const facturas = [];
    for (let i = 0; i < 30; i++) {
      // De 14:00 a 17:52 de Argentina, una cada 8 minutos.
      const ventaEn = a(
        new Date(Date.parse('2026-11-10T17:00:00Z') + i * 8 * 60_000).toISOString(),
      );
      facturas.push((await ventaConFactura({ ventaEn })).factura);
    }
    ahora = a('2026-11-10T21:00:00Z');

    await pasada(arca);
    const durante = await prismaTest.factura.findMany();
    expect(durante.every((f) => f.estado === 'pendiente' && f.intentos === 0)).toBe(true);

    arca.falso.servidores = 'ok';
    await pasada(arca);
    // Hasta 20 por pasada; lo que queda sale en la siguiente.
    expect(await prismaTest.factura.count({ where: { estado: 'autorizada' } })).toBe(20);
    await pasada(arca);

    const finales = await Promise.all(facturas.map((f) => leer(f.id)));
    expect(finales.map((f) => f.estado)).toEqual(Array(30).fill('autorizada'));
    expect(finales.map((f) => f.numero)).toEqual(Array.from({ length: 30 }, (_, i) => 42 + i));
    expect(finales.every((f) => f.intentos === 0)).toBe(true);
  });

  it('con 4 intentos y FEDummy caído en el reintento → sigue pendiente con 4', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    arca.falso.servidores = 'caido';
    const { factura } = await ventaConFactura({ factura: { intentos: 4 } });

    await pasada(arca);

    expect(await leer(factura.id)).toMatchObject({ estado: 'pendiente', intentos: 4 });
  });

  it('con 4 intentos y ARCA que no contesta el pedido → queda en curso con 4 y la pasada siguiente la emite sin sumar intento', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    arca.falso.fallas = ['no_disponible'];
    const { factura } = await ventaConFactura({ factura: { intentos: 4 } });

    await pasada(arca);
    expect(await leer(factura.id)).toMatchObject({ estado: 'en_curso', intentos: 4, numero: 42 });

    await pasada(arca);
    expect(await leer(factura.id)).toMatchObject({ estado: 'autorizada', intentos: 4, numero: 42 });
    expect(await avisosDeFactura()).toEqual([]);
  });

  it('autenticación bloqueada (ticket vigente perdido): siguen pendientes sin intentos y la pasada lo informa', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    arca.falso.autenticacionBloqueada = true;
    const { factura } = await ventaConFactura();

    const estado = await pasada(arca);

    expect(estado).toBe('autenticacion_bloqueada');
    expect(await leer(factura.id)).toMatchObject({
      estado: 'pendiente',
      intentos: 0,
      numero: null,
    });
  });

  it('la pasada informa el estado de ARCA que vio', async () => {
    const arca = crearArcaFalso();
    expect(await pasada(arca)).toBe('disponible');
    arca.falso.servidores = 'caido';
    expect(await pasada(arca)).toBe('no_disponible');
  });
});

describe('número reservado y corte de la respuesta', () => {
  it('ARCA autorizó la 42 pero la respuesta no llegó → queda en curso; la pasada siguiente la consulta y la deja autorizada sin pedir otro número', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    arca.falso.fallas = ['timeout_autorizado'];
    const { factura } = await ventaConFactura();

    await pasada(arca);
    expect(await leer(factura.id)).toMatchObject({ estado: 'en_curso', numero: 42, intentos: 0 });
    expect(arca.falso.comprobantes.map((c) => c.numero)).toEqual([42]);

    await pasada(arca);

    expect(arca.falso.consultas).toContain(42);
    expect(arca.falso.pedidos).toHaveLength(1);
    expect(await leer(factura.id)).toMatchObject({
      estado: 'autorizada',
      numero: 42,
      cae: arca.falso.comprobantes[0]!.cae,
      caeVencimiento: new Date('2026-11-20T00:00:00Z'),
      intentos: 0,
    });
  });

  it('en curso con la 42 que ARCA no tiene y último 41 → reenvía la 42', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    const { factura } = await ventaConFactura({
      factura: { estado: 'en_curso', numero: 42, fechaComprobante: a('2026-11-10T00:00:00Z') },
    });

    await pasada(arca);

    expect(arca.falso.consultas).toContain(42);
    expect(arca.falso.pedidos.map((p) => p.CbteDesde)).toEqual([42]);
    expect(await leer(factura.id)).toMatchObject({ estado: 'autorizada', numero: 42, intentos: 0 });
  });

  it.each([
    ['otro importe', { importe: '999.00', fecha: '2026-11-10' }],
    ['otra fecha', { importe: '3300.00', fecha: '2026-11-09' }],
  ])(
    'ARCA tiene la 42 con %s → error por numeración inconsistente, aviso y se frena todo hasta el reintento del admin',
    async (_caso, datosEnArca) => {
      const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
      arca.falso.agregarComprobante({ numero: 42, ...datosEnArca });
      const enCurso = await ventaConFactura({
        ventaEn: a('2026-11-10T12:00:00Z'),
        factura: { estado: 'en_curso', numero: 42, fechaComprobante: a('2026-11-10T00:00:00Z') },
      });
      const otra = await ventaConFactura({ ventaEn: a('2026-11-10T12:05:00Z') });

      await pasada(arca);
      await pasada(arca);

      expect(await leer(enCurso.factura.id)).toMatchObject({
        estado: 'error',
        codigoError: 'numeracion_inconsistente',
      });
      expect(await leer(otra.factura.id)).toMatchObject({ estado: 'pendiente', intentos: 0 });
      expect(arca.falso.pedidos).toEqual([]);
      const avisos = await avisosDeFactura();
      expect(avisos).toHaveLength(1);
      expect(avisos[0]!.texto).toContain(`#${enCurso.venta.numero}`);
      expect(avisos[0]!.texto).toContain('Administración → Facturación');

      // Lo que hace "Reintentar" del admin: la emisión se destraba.
      await prismaTest.factura.update({
        where: { id: enCurso.factura.id },
        data: { estado: 'pendiente', intentos: 0, proximoIntentoEn: null, numero: null },
      });
      await pasada(arca);
      expect(arca.falso.pedidos.length).toBeGreaterThan(0);
    },
  );

  it('con una en curso sin resolver, ninguna pendiente se manda', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    const { ArcaNoDisponible } = await import('../src/integrations/arca/cliente.js');
    arca.cliente.consultar = async () => {
      throw new ArcaNoDisponible('caido', 'Timeout de 15 s.');
    };
    const enCurso = await ventaConFactura({
      ventaEn: a('2026-11-10T12:00:00Z'),
      factura: { estado: 'en_curso', numero: 42, fechaComprobante: a('2026-11-10T00:00:00Z') },
    });
    const pendiente = await ventaConFactura({ ventaEn: a('2026-11-10T12:05:00Z') });

    await pasada(arca);

    expect(arca.falso.pedidos).toEqual([]);
    expect(await leer(enCurso.factura.id)).toMatchObject({ estado: 'en_curso', numero: 42 });
    expect(await leer(pendiente.factura.id)).toMatchObject({ estado: 'pendiente', numero: null });
  });
});

describe('orden de emisión', () => {
  it('las pendientes de las ventas #120, #121 y #122 salen en ese orden con números correlativos', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    const ventas = [];
    for (const [i, importe] of ['100.00', '200.00', '300.00'].entries()) {
      ventas.push(await ventaConFactura({ ventaEn: a(`2026-11-10T12:0${i}:00Z`), importe }));
    }

    await pasada(arca);

    expect(arca.falso.pedidos.map((p) => [p.CbteDesde, p.ImpTotal])).toEqual([
      [42, '100.00'],
      [43, '200.00'],
      [44, '300.00'],
    ]);
    const numeros = await Promise.all(ventas.map(async (v) => (await leer(v.factura.id)).numero));
    expect(numeros).toEqual([42, 43, 44]);
    expect(ventas.map((v) => v.venta.numero)).toEqual([
      ventas[0]!.venta.numero,
      ventas[0]!.venta.numero + 1,
      ventas[0]!.venta.numero + 2,
    ]);
  });
});

describe('venta anulada con la factura en curso', () => {
  it('la consulta la encuentra autorizada → queda autorizada y avisa que es de una venta anulada', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    arca.falso.agregarComprobante({ numero: 42, importe: '3300.00', fecha: '2026-11-10' });
    const { venta, factura } = await ventaConFactura({
      estadoVenta: 'anulada',
      factura: { estado: 'en_curso', numero: 42, fechaComprobante: a('2026-11-10T00:00:00Z') },
    });

    await pasada(arca);

    expect(await leer(factura.id)).toMatchObject({ estado: 'autorizada', numero: 42 });
    expect(arca.falso.pedidos).toEqual([]);
    const avisos = await avisosDeFactura();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.texto).toContain(`#${venta.numero}`);
    expect(avisos[0]!.texto).toMatch(/anulada/i);
    expect(avisos[0]!.texto).toContain('00005-00000042');
    expect(avisos[0]!.texto).toContain('3.300,00');
    expect(avisos[0]!.texto).toMatch(/nota de crédito/i);
  });

  it('la consulta no la encuentra → queda cancelada y no se vuelve a mandar', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    const { factura } = await ventaConFactura({
      estadoVenta: 'anulada',
      factura: { estado: 'en_curso', numero: 42, fechaComprobante: a('2026-11-10T00:00:00Z') },
    });

    await pasada(arca);
    await pasada(arca);

    expect(await leer(factura.id)).toMatchObject({ estado: 'cancelada' });
    expect(arca.falso.pedidos).toEqual([]);
    expect(await avisosDeFactura()).toEqual([]);
  });

  it('una pendiente de una venta anulada se cancela sin llegar a ARCA', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    const { factura } = await ventaConFactura({ estadoVenta: 'anulada' });

    await pasada(arca);

    expect(await leer(factura.id)).toMatchObject({ estado: 'cancelada', numero: null });
    expect(arca.falso.pedidos).toEqual([]);
  });

  it('una factura cancelada nunca se emite', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    const { factura } = await ventaConFactura({ factura: { estado: 'cancelada' } });

    await pasada(arca);

    expect(await leer(factura.id)).toMatchObject({ estado: 'cancelada' });
    expect(arca.falso.pedidos).toEqual([]);
  });
});

describe('dos pasadas a la vez', () => {
  it('no reservan el mismo número y ninguna falla con un error no controlado', async () => {
    const arca = crearArcaFalso({ ultimo: 41, fechaUltimo: '2026-11-09' });
    const primera = await ventaConFactura({ ventaEn: a('2026-11-10T12:00:00Z') });
    const segunda = await ventaConFactura({ ventaEn: a('2026-11-10T12:01:00Z') });

    await expect(Promise.all([pasada(arca), pasada(arca)])).resolves.toBeDefined();

    const numeros = (await prismaTest.factura.findMany())
      .map((f) => f.numero)
      .filter((n) => n !== null);
    expect(new Set(numeros).size).toBe(numeros.length);

    // Lo que haya quedado sale en las pasadas siguientes, sin saltear números.
    ahora = masMs(ahora, 31 * 60_000);
    await pasada(arca);
    await pasada(arca);
    const finales = await Promise.all([leer(primera.factura.id), leer(segunda.factura.id)]);
    expect(finales.map((f) => [f.estado, f.numero])).toEqual([
      ['autorizada', 42],
      ['autorizada', 43],
    ]);
    expect(arca.falso.comprobantes.map((c) => c.numero)).toEqual([42, 43]);
  });
});
