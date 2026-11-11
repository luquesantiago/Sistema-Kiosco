import { beforeEach, describe, expect, it } from 'vitest';
import { generarAvisoDelDia } from '../src/jobs/aviso-reposicion.js';
import { textoAvisoReposicion } from '../src/modules/reposicion/aviso.js';
import { calcularReposicion } from '../src/modules/reposicion/servicio.js';
import { limpiarBase, prismaTest } from './base.js';
import { crearProductoDePrueba } from './stock-ayudas.js';

/*
 * `generarAvisoDelDia({ prisma, ahora })` con `ahora: () => Date`, igual que
 * `procesarPendientes` del envío (el design no dice si es una función o un
 * instante; se eligió la forma de las otras tareas periódicas, que también usa
 * `iniciarAvisoReposicion`). Devuelve 'fuera_de_horario' | 'ya_generado' | 'generado'.
 *
 * El orden de los pasos del design (primero la ventana, después la ejecución
 * del día) fija qué devuelve cada revisión fuera de horario aunque ya exista el aviso.
 */

beforeEach(async () => {
  await limpiarBase();
});

function generar(instante: string) {
  const ahora = new Date(instante);
  return generarAvisoDelDia({ prisma: prismaTest, ahora: () => ahora });
}

function avisosDeReposicion() {
  return prismaTest.notificacion.findMany({
    where: { tipo: 'reposicion' },
    orderBy: [{ creadaEn: 'asc' }, { id: 'asc' }],
  });
}

const ejecuciones = () => prismaTest.ejecucionTarea.findMany({ orderBy: { fecha: 'asc' } });

/** Fecha `@db.Date` tal como la devuelve Prisma: medianoche UTC del día. */
const dia = (fecha: string) => new Date(`${fecha}T00:00:00.000Z`);

describe('hora del aviso diario y recuperación hasta las 19:00', () => {
  it.each([
    // [instante UTC, hora de Argentina, resultado, "Stock a las" esperado]
    ['2026-11-10T03:00:00Z', '00:00:00 del 10/11', 'fuera_de_horario', null],
    ['2026-11-10T14:59:59Z', '11:59:59', 'fuera_de_horario', null],
    ['2026-11-10T15:00:00Z', '12:00:00', 'generado', '12:00'],
    ['2026-11-10T15:00:01Z', '12:00:01', 'generado', '12:00'],
    ['2026-11-10T18:20:00Z', '15:20:00', 'generado', '15:20'],
    ['2026-11-10T21:59:59Z', '18:59:59', 'generado', '18:59'],
    ['2026-11-10T22:00:00Z', '19:00:00', 'fuera_de_horario', null],
    ['2026-11-11T02:59:59Z', '23:59:59 del 10/11', 'fuera_de_horario', null],
  ] as const)('a las %s (%s en Argentina) → %s', async (instante, _hora, resultado, stockA) => {
    expect(await generar(instante)).toBe(resultado);

    const avisos = await avisosDeReposicion();
    if (stockA === null) {
      expect(avisos).toEqual([]);
      expect(await ejecuciones()).toEqual([]);
    } else {
      expect(avisos).toHaveLength(1);
      expect(avisos[0]!.texto.split('\n').slice(0, 2)).toEqual([
        '*Reposición - martes 10/11*',
        `Stock a las ${stockA}`,
      ]);
    }
  });

  it('apagado todo el 10/11: a las 09:00 del 11/11 no genera ni el del 10 ni el del 11; a las 12:00 genera el del 11', async () => {
    expect(await generar('2026-11-11T12:00:00Z')).toBe('fuera_de_horario');
    expect(await avisosDeReposicion()).toEqual([]);
    expect(await ejecuciones()).toEqual([]);

    expect(await generar('2026-11-11T15:00:00Z')).toBe('generado');

    const avisos = await avisosDeReposicion();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.texto.split('\n')[0]).toBe('*Reposición - miércoles 11/11*');
    expect((await ejecuciones()).map((e) => e.fecha)).toEqual([dia('2026-11-11')]);
  });
});

describe('un solo aviso por día', () => {
  it('después de generarlo a las 12:00, las revisiones de las 12:01 y las 18:59:59 no generan otro', async () => {
    expect(await generar('2026-11-10T15:00:00Z')).toBe('generado');

    expect(await generar('2026-11-10T15:01:00Z')).toBe('ya_generado');
    expect(await generar('2026-11-10T21:59:59Z')).toBe('ya_generado');

    expect(await avisosDeReposicion()).toHaveLength(1);
    expect(await ejecuciones()).toHaveLength(1);
  });

  it('si la app se reinicia a las 13:00, al volver no genera otro (la garantía está en la base)', async () => {
    expect(await generar('2026-11-10T15:00:00Z')).toBe('generado');

    // Un proceso nuevo no tiene nada en memoria: solo vuelve a llamar con otro reloj.
    expect(await generar('2026-11-10T16:00:00Z')).toBe('ya_generado');

    expect(await avisosDeReposicion()).toHaveLength(1);
  });

  it('cambio de día: a las 23:59:59 del 10/11 y a las 00:00:00 del 11/11 no genera; a las 12:00 del 11/11 sí', async () => {
    expect(await generar('2026-11-10T15:00:00Z')).toBe('generado');

    expect(await generar('2026-11-11T02:59:59Z')).toBe('fuera_de_horario');
    expect(await generar('2026-11-11T03:00:00Z')).toBe('fuera_de_horario');
    expect(await avisosDeReposicion()).toHaveLength(1);

    expect(await generar('2026-11-11T15:00:00Z')).toBe('generado');
    expect((await ejecuciones()).map((e) => e.fecha)).toEqual([
      dia('2026-11-10'),
      dia('2026-11-11'),
    ]);
  });

  it('dos revisiones a la vez a las 12:00 dejan un solo aviso y ninguna falla', async () => {
    const resultados = await Promise.all([
      generar('2026-11-10T15:00:00Z'),
      generar('2026-11-10T15:00:00Z'),
    ]);

    expect([...resultados].sort()).toEqual(['generado', 'ya_generado']);
    expect(await avisosDeReposicion()).toHaveLength(1);
    expect(await ejecuciones()).toHaveLength(1);
  });
});

describe('el aviso generado', () => {
  it('queda pendiente, tipo reposicion, para el admin, con creadaEn igual al reloj y su ejecución', async () => {
    const ahora = new Date('2026-11-10T15:00:00Z');
    await crearProductoDePrueba('Hielo', { stockMinimo: 5, stockMaximo: 15, stockActual: 5 });

    expect(await generarAvisoDelDia({ prisma: prismaTest, ahora: () => ahora })).toBe('generado');

    const [aviso] = await avisosDeReposicion();
    expect(aviso).toMatchObject({
      tipo: 'reposicion',
      destino: 'admin',
      estado: 'pendiente',
      creadaEn: ahora,
      enviadaEn: null,
      error: null,
      intentos: 0,
      proximoIntentoEn: null,
    });
    expect(aviso!.texto).toBe(textoAvisoReposicion(await calcularReposicion(prismaTest, ahora)));
    expect(aviso!.texto).toContain('- Hielo: 10');
    expect(await ejecuciones()).toEqual([
      expect.objectContaining({
        tarea: 'aviso_reposicion',
        fecha: dia('2026-11-10'),
        ejecutadaEn: ahora,
        notificacionId: aviso!.id,
      }),
    ]);
  });

  it('sin WhatsApp configurado ni número de destino, se genera igual y queda pendiente', async () => {
    // generarAvisoDelDia no recibe cliente de WAHA y no hay ConfiguracionWhatsapp.
    expect(await prismaTest.configuracionWhatsapp.count()).toBe(0);

    expect(await generar('2026-11-10T15:00:00Z')).toBe('generado');

    expect((await avisosDeReposicion()).map((a) => a.estado)).toEqual(['pendiente']);
  });
});

describe('solo el aviso de reposición más reciente queda pendiente', () => {
  /** Aviso de reposición de un día anterior, creado a las 12:00 de ese día. */
  function avisoAnterior(
    fecha: string,
    datos: Partial<{
      estado: 'pendiente' | 'enviada' | 'error';
      intentos: number;
      error: string;
      proximoIntentoEn: Date;
      enviadaEn: Date;
    }> = {},
  ) {
    return prismaTest.notificacion.create({
      data: {
        tipo: 'reposicion',
        destino: 'admin',
        texto: `Reposición del ${fecha}`,
        creadaEn: new Date(`${fecha}T15:00:00Z`),
        ...datos,
      },
    });
  }

  const estadoDe = async (id: string) =>
    (await prismaTest.notificacion.findUniqueOrThrow({ where: { id } })).estado;

  it('con 0 anteriores pendientes, queda el del 10/11 pendiente y ningún otro aviso cambia', async () => {
    const gasto = await prismaTest.notificacion.create({
      data: { tipo: 'gasto_caja', destino: 'admin', texto: 'Gasto de $8.000' },
    });
    const antes = await prismaTest.notificacion.findMany();

    expect(await generar('2026-11-10T15:00:00Z')).toBe('generado');

    const otros = await prismaTest.notificacion.findMany({ where: { NOT: { tipo: 'reposicion' } } });
    expect(otros).toEqual(antes);
    expect(otros.map((a) => a.id)).toEqual([gasto.id]);
    expect((await avisosDeReposicion()).map((a) => a.estado)).toEqual(['pendiente']);
  });

  it.each([
    [1, ['2026-11-09']],
    [3, ['2026-11-07', '2026-11-08', '2026-11-09']],
  ])(
    'con %i anteriores pendientes, todos pasan a reemplazada y el del 10/11 queda pendiente',
    async (_cantidad, fechas) => {
      for (const fecha of fechas) await avisoAnterior(fecha);

      expect(await generar('2026-11-10T15:00:00Z')).toBe('generado');

      const avisos = await avisosDeReposicion();
      expect(avisos.map((a) => [a.texto.split('\n')[0], a.estado])).toEqual([
        ...fechas.map((f) => [`Reposición del ${f}`, 'reemplazada']),
        ['*Reposición - martes 10/11*', 'pendiente'],
      ]);
    },
  );

  it('uno pendiente con 2 intentos y próximo intento pasa a reemplazada sin próximo intento', async () => {
    const anterior = await avisoAnterior('2026-11-09', {
      intentos: 2,
      error: 'WhatsApp rechazó el pedido (HTTP 500).',
      proximoIntentoEn: new Date('2026-11-10T15:10:00Z'),
    });

    await generar('2026-11-10T15:00:00Z');

    expect(
      await prismaTest.notificacion.findUniqueOrThrow({ where: { id: anterior.id } }),
    ).toMatchObject({ estado: 'reemplazada', proximoIntentoEn: null });
  });

  it('uno enviado y uno en error no cambian', async () => {
    const enviado = await avisoAnterior('2026-11-09', {
      estado: 'enviada',
      enviadaEn: new Date('2026-11-09T15:00:10Z'),
    });
    const conError = await avisoAnterior('2026-11-08', {
      estado: 'error',
      intentos: 5,
      error: 'WhatsApp rechazó el pedido (HTTP 500).',
    });
    const antes = await prismaTest.notificacion.findMany({
      where: { id: { in: [enviado.id, conError.id] } },
      orderBy: { creadaEn: 'asc' },
    });

    await generar('2026-11-10T15:00:00Z');

    expect(
      await prismaTest.notificacion.findMany({
        where: { id: { in: [enviado.id, conError.id] } },
        orderBy: { creadaEn: 'asc' },
      }),
    ).toEqual(antes);
  });

  it('una anulación pendiente no cambia', async () => {
    const anulacion = await prismaTest.notificacion.create({
      data: {
        tipo: 'anulacion_venta',
        destino: 'admin',
        texto: 'Venta #120 anulada',
        creadaEn: new Date('2026-11-09T18:00:00Z'),
      },
    });

    await generar('2026-11-10T15:00:00Z');

    expect(await estadoDe(anulacion.id)).toBe('pendiente');
  });

  it('una segunda revisión del mismo día (ya_generado) no cambia ningún estado', async () => {
    await avisoAnterior('2026-11-09');
    expect(await generar('2026-11-10T15:00:00Z')).toBe('generado');
    // Un aviso de reposición pendiente que apareció después (por ejemplo, cargado a mano):
    // si la segunda revisión reemplazara, lo tocaría a él y al del 10/11.
    await avisoAnterior('2026-11-08');
    const antes = await prismaTest.notificacion.findMany({ orderBy: { id: 'asc' } });

    expect(await generar('2026-11-10T15:01:00Z')).toBe('ya_generado');

    expect(await prismaTest.notificacion.findMany({ orderBy: { id: 'asc' } })).toEqual(antes);
  });

  it('dos revisiones a la vez: los 3 anteriores quedan reemplazada y hay un solo pendiente de reposición', async () => {
    for (const fecha of ['2026-11-07', '2026-11-08', '2026-11-09']) await avisoAnterior(fecha);

    const resultados = await Promise.all([
      generar('2026-11-10T15:00:00Z'),
      generar('2026-11-10T15:00:00Z'),
    ]);

    expect([...resultados].sort()).toEqual(['generado', 'ya_generado']);
    const avisos = await avisosDeReposicion();
    expect(avisos).toHaveLength(4);
    expect(avisos.filter((a) => a.estado === 'reemplazada')).toHaveLength(3);
    expect(avisos.filter((a) => a.estado === 'pendiente')).toEqual([
      expect.objectContaining({ creadaEn: new Date('2026-11-10T15:00:00Z') }),
    ]);
    expect(await ejecuciones()).toHaveLength(1);
  });
});
