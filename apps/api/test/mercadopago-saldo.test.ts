import { textoSaldoNoDisponible } from '@kiosco/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearServicioSaldo } from '../src/modules/mercadopago/saldo.js';
import { crearMercadoPagoFalso } from './mercadopago-falso.js';

/** Hora de Argentina del 11/11/2026, con milisegundos (por ejemplo `10:00:59.999`). */
function a(hora: string) {
  return new Date(`2026-11-11T${hora}-03:00`);
}

/**
 * Servicio del saldo con el cliente falso y el reloj de Vitest: `ahora()` lee la
 * hora falsa, que avanza con `irA` o al adelantar los timers.
 */
function preparar(inicio: string) {
  vi.useFakeTimers({ now: a(inicio) });
  const { falso, cliente } = crearMercadoPagoFalso();
  const servicio = crearServicioSaldo({ cliente, ahora: () => new Date() });
  return { falso, servicio, irA: (hora: string) => vi.setSystemTime(a(hora)) };
}

/**
 * El design fija `leidoEn` como ISO en la respuesta. Por si el servicio lo guarda
 * como `Date` y lo serializa la ruta, se normaliza acá: el contrato es el instante.
 */
async function consultar(servicio: ReturnType<typeof preparar>['servicio']) {
  const saldo = (await servicio.obtener()) as Record<string, unknown>;
  return saldo.leidoEn === undefined
    ? saldo
    : { ...saldo, leidoEn: new Date(saldo.leidoEn as string | Date).toISOString() };
}

/** Consulta mientras el cliente falso tarda `ms` en contestar. */
async function consultarConDemora(
  servicio: ReturnType<typeof preparar>['servicio'],
  ms: number,
) {
  const pendiente = consultar(servicio);
  await vi.advanceTimersByTimeAsync(ms);
  return pendiente;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('caché del saldo (vigencia de 60 s)', () => {
  it('la primera consulta va a Mercado Pago y devuelve el saldo con su hora', async () => {
    const { falso, servicio } = preparar('10:00:00.000');

    expect(await consultar(servicio)).toEqual({
      estado: 'disponible',
      disponible: '250000.00',
      aLiberar: '40000.00',
      leidoEn: a('10:00:00.000').toISOString(),
      desactualizado: false,
    });
    expect(falso.llamadas).toBe(1);
  });

  // Leído a las 10:00:00,000. Con menos de 60 000 ms se reutiliza; con 60 000 o más, se vuelve a pedir.
  it.each([
    { consulta: '10:00:00.000', llamadas: 1, disponible: '250000.00', leidoEn: '10:00:00.000' },
    { consulta: '10:00:59.999', llamadas: 1, disponible: '250000.00', leidoEn: '10:00:00.000' },
    { consulta: '10:01:00.000', llamadas: 2, disponible: '260000.00', leidoEn: '10:01:00.000' },
    { consulta: '10:01:00.001', llamadas: 2, disponible: '260000.00', leidoEn: '10:01:00.001' },
  ])(
    'leído a las 10:00:00,000 y consultado a las $consulta: $llamadas llamada(s) a MP',
    async ({ consulta, llamadas, disponible, leidoEn }) => {
      const { falso, servicio, irA } = preparar('10:00:00.000');
      await consultar(servicio);
      falso.saldo = { disponible: '260000.00', aLiberar: '40000.00' };

      irA(consulta);
      const saldo = await consultar(servicio);

      expect(falso.llamadas).toBe(llamadas);
      expect(saldo).toEqual({
        estado: 'disponible',
        disponible,
        aLiberar: '40000.00',
        leidoEn: a(leidoEn).toISOString(),
        desactualizado: false,
      });
    },
  );

  // La vigencia se cuenta desde que llegó la respuesta, no desde que se pidió.
  it.each([
    { consulta: '10:01:09.899', llamadas: 1 },
    { consulta: '10:01:09.900', llamadas: 2 },
  ])(
    'pedido a las 10:00:00 que tardó 9,9 s, consultado a las $consulta: $llamadas llamada(s)',
    async ({ consulta, llamadas }) => {
      const { falso, servicio, irA } = preparar('10:00:00.000');
      falso.demoraMs = 9_900;
      const primera = await consultarConDemora(servicio, 9_900);
      expect(primera).toMatchObject({ leidoEn: a('10:00:09.900').toISOString() });

      falso.demoraMs = 0;
      irA(consulta);
      await consultar(servicio);

      expect(falso.llamadas).toBe(llamadas);
    },
  );

  it.each([
    { caso: 'sin saldo previo', leerAntes: false, llamadas: 1 },
    { caso: 'con la caché vencida', leerAntes: true, llamadas: 2 },
  ])(
    '3 consultas simultáneas $caso hacen una sola llamada a MP y reciben el mismo saldo',
    async ({ leerAntes, llamadas }) => {
      const { falso, servicio, irA } = preparar('10:00:00.000');
      if (leerAntes) await consultar(servicio);
      irA('10:01:00.000');
      falso.saldo = { disponible: '260000.00', aLiberar: null };
      falso.demoraMs = 500;

      const pendientes = [consultar(servicio), consultar(servicio), consultar(servicio)];
      await vi.advanceTimersByTimeAsync(500);
      const saldos = await Promise.all(pendientes);

      expect(falso.llamadas).toBe(llamadas);
      const esperado = {
        estado: 'disponible',
        disponible: '260000.00',
        aLiberar: null,
        leidoEn: a('10:01:00.500').toISOString(),
        desactualizado: false,
      };
      expect(saldos).toEqual([esperado, esperado, esperado]);

      // Terminada la consulta compartida, la siguiente usa la caché nueva.
      await consultar(servicio);
      expect(falso.llamadas).toBe(llamadas);
    },
  );

  it('si la consulta compartida falla, las 3 reciben la falla y la siguiente vuelve a intentar', async () => {
    const { falso, servicio } = preparar('10:00:00.000');
    falso.falla = 'no_responde';
    falso.demoraMs = 500;

    const pendientes = [consultar(servicio), consultar(servicio), consultar(servicio)];
    await vi.advanceTimersByTimeAsync(500);
    const saldos = await Promise.all(pendientes);

    const esperado = { estado: 'no_disponible', motivo: 'no_responde' };
    expect(saldos).toEqual([esperado, esperado, esperado]);
    expect(falso.llamadas).toBe(1);

    falso.falla = null;
    falso.demoraMs = 0;
    expect(await consultar(servicio)).toMatchObject({ estado: 'disponible' });
    expect(falso.llamadas).toBe(2);
  });
});

describe('saldo cuando Mercado Pago no responde o rechaza', () => {
  it('respuesta a los 9,9 s: se muestra el saldo nuevo', async () => {
    const { falso, servicio, irA } = preparar('09:58:00.000');
    await consultar(servicio);
    irA('10:05:00.000');
    falso.saldo = { disponible: '255000.50', aLiberar: '0.00' };
    falso.demoraMs = 9_900;

    expect(await consultarConDemora(servicio, 9_900)).toEqual({
      estado: 'disponible',
      disponible: '255000.50',
      aLiberar: '0.00',
      leidoEn: a('10:05:09.900').toISOString(),
      desactualizado: false,
    });
  });

  it('sin respuesta a los 10 s con un saldo de las 09:58: ese saldo, desactualizado', async () => {
    const { falso, servicio, irA } = preparar('09:58:00.000');
    await consultar(servicio);
    irA('10:05:00.000');
    falso.saldo = { disponible: '1.00', aLiberar: null };
    falso.falla = 'no_responde';
    falso.demoraMs = 10_000;

    expect(await consultarConDemora(servicio, 10_000)).toEqual({
      estado: 'disponible',
      disponible: '250000.00',
      aLiberar: '40000.00',
      leidoEn: a('09:58:00.000').toISOString(),
      desactualizado: true,
      motivo: 'no_responde',
    });
  });

  it('sin respuesta a los 10 s y sin saldo anterior: no disponible porque no responde', async () => {
    const { falso, servicio } = preparar('10:05:00.000');
    falso.falla = 'no_responde';
    falso.demoraMs = 10_000;

    const saldo = await consultarConDemora(servicio, 10_000);

    expect(saldo).toEqual({ estado: 'no_disponible', motivo: 'no_responde' });
    expect(textoSaldoNoDisponible('no_responde')).toBe(
      'Saldo no disponible: Mercado Pago no responde',
    );
  });

  // 401 y 403 son credenciales; el resto de los 4xx, un rechazo genérico.
  it.each([
    { status: 401, motivo: 'credenciales' },
    { status: 403, motivo: 'credenciales' },
    { status: 400, motivo: 'rechazo' },
    { status: 404, motivo: 'rechazo' },
  ])('MP rechaza con $status sin saldo anterior: no disponible por $motivo', async ({ status, motivo }) => {
    const { falso, servicio } = preparar('10:00:00.000');
    falso.falla = status;

    const saldo = await consultar(servicio);

    expect(saldo).toEqual({ estado: 'no_disponible', motivo });
    // Ni el detalle que mandó MP ni nada de las credenciales.
    expect(JSON.stringify(saldo)).not.toContain('detalle-interno-de-mp');
  });

  it('credenciales rechazadas con un saldo anterior: ese saldo, desactualizado por credenciales', async () => {
    const { falso, servicio, irA } = preparar('09:58:00.000');
    await consultar(servicio);
    irA('10:05:00.000');
    falso.falla = 401;

    expect(await consultar(servicio)).toEqual({
      estado: 'disponible',
      disponible: '250000.00',
      aLiberar: '40000.00',
      leidoEn: a('09:58:00.000').toISOString(),
      desactualizado: true,
      motivo: 'credenciales',
    });
  });

  it('los textos de saldo no disponible distinguen rechazo de falta de respuesta', () => {
    expect(textoSaldoNoDisponible('credenciales')).toBe(
      'Saldo no disponible: Mercado Pago rechazó las credenciales',
    );
    // El spec no fija el texto del rechazo genérico: solo que empiece igual y sea otro.
    const rechazo = textoSaldoNoDisponible('rechazo');
    expect(rechazo).toMatch(/^Saldo no disponible: /);
    expect(new Set([rechazo, textoSaldoNoDisponible('no_responde')]).size).toBe(2);
    expect(rechazo).not.toBe(textoSaldoNoDisponible('credenciales'));
  });

  // MP no respondió a las 10:05 (última lectura buena 09:58). Las fallas no se guardan:
  // la próxima consulta vuelve a intentar aunque sea 1 ms o 10 s después.
  it.each([{ reintento: '10:05:00.001' }, { reintento: '10:05:10.000' }])(
    'después de la falla de las 10:05, a las $reintento vuelve a consultar a MP',
    async ({ reintento }) => {
      const { falso, servicio, irA } = preparar('09:58:00.000');
      await consultar(servicio);
      irA('10:05:00.000');
      falso.falla = 'no_responde';
      await consultar(servicio);
      expect(falso.llamadas).toBe(2);

      irA(reintento);
      falso.falla = null;
      falso.saldo = { disponible: '255000.00', aLiberar: null };

      expect(await consultar(servicio)).toEqual({
        estado: 'disponible',
        disponible: '255000.00',
        aLiberar: null,
        leidoEn: a(reintento).toISOString(),
        desactualizado: false,
      });
      expect(falso.llamadas).toBe(3);
    },
  );

  it('si a las 10:05:10 MP sigue sin responder, sigue mostrando el saldo de las 09:58', async () => {
    const { falso, servicio, irA } = preparar('09:58:00.000');
    await consultar(servicio);
    irA('10:05:00.000');
    falso.falla = 'no_responde';
    await consultar(servicio);

    irA('10:05:10.000');
    const saldo = await consultar(servicio);

    expect(falso.llamadas).toBe(3);
    expect(saldo).toMatchObject({
      leidoEn: a('09:58:00.000').toISOString(),
      desactualizado: true,
      motivo: 'no_responde',
    });
  });
});

describe('sin Mercado Pago configurado', () => {
  it('sin cliente el saldo es no_configurado, siempre', async () => {
    const servicio = crearServicioSaldo({ cliente: undefined, ahora: () => new Date() });

    expect(await servicio.obtener()).toEqual({ estado: 'no_configurado' });
    expect(await servicio.obtener()).toEqual({ estado: 'no_configurado' });
  });
});
