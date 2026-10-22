import { beforeEach, describe, expect, it } from 'vitest';
import { iniciarEnvio, MAX_INTENTOS, procesarPendientes } from '../src/modules/whatsapp/envio.js';
import { limpiarBase, prismaTest } from './base.js';
import { crearUsuarioDePrueba } from './ayudas.js';
import { crearWhatsappFalso } from './whatsapp-falso.js';

const DESTINO = '5491123456789@c.us';
let ahora = new Date('2026-10-20T12:00:00Z');

function adelantar(ms: number) {
  ahora = new Date(ahora.getTime() + ms);
}

async function cargarDestino() {
  const admin = await crearUsuarioDePrueba('ana', 'admin');
  await prismaTest.configuracionWhatsapp.create({
    data: { numero: '1123456789', chatId: DESTINO, actualizadoPorId: admin.id },
  });
}

/** Crea avisos pendientes separados por un minuto, en el orden dado. */
async function crearAvisos(...textos: string[]) {
  const avisos = [];
  for (const [i, texto] of textos.entries()) {
    avisos.push(
      await prismaTest.notificacion.create({
        data: {
          tipo: 'gasto_caja',
          destino: 'admin',
          texto,
          creadaEn: new Date(Date.parse('2026-10-18T10:00:00Z') + i * 60_000),
        },
      }),
    );
  }
  return avisos;
}

function procesar(cliente: ReturnType<typeof crearWhatsappFalso>['cliente']) {
  return procesarPendientes({
    prisma: prismaTest,
    whatsapp: cliente,
    ahora: () => ahora,
    pausaEntreEnviosMs: 0,
  });
}

beforeEach(async () => {
  await limpiarBase();
  ahora = new Date('2026-10-20T12:00:00Z');
});

describe('envío automático por WhatsApp', () => {
  it('envía el aviso pendiente al destino y lo marca enviado', async () => {
    const { falso, cliente } = crearWhatsappFalso();
    await cargarDestino();
    const [aviso] = await crearAvisos('Venta #120 anulada');

    await procesar(cliente);

    expect(falso.enviados).toEqual([{ chatId: DESTINO, texto: 'Venta #120 anulada' }]);
    const guardado = await prismaTest.notificacion.findUniqueOrThrow({ where: { id: aviso!.id } });
    expect(guardado).toMatchObject({ estado: 'enviada', enviadaEn: ahora, error: null });
  });

  it('no vuelve a enviar un aviso ya enviado', async () => {
    const { falso, cliente } = crearWhatsappFalso();
    await cargarDestino();
    await crearAvisos('uno');

    await procesar(cliente);
    await procesar(cliente);

    expect(falso.enviados).toHaveLength(1);
  });
});

describe('espera mientras WhatsApp no está disponible', () => {
  for (const estado of ['desvinculado', 'esperando_qr', 'no_disponible'] as const) {
    it(`con el chip ${estado}, los avisos siguen pendientes sin intentos`, async () => {
      const { falso, cliente } = crearWhatsappFalso();
      falso.estadoActual = estado;
      await cargarDestino();
      await crearAvisos('uno', 'dos');

      await procesar(cliente);

      expect(falso.enviados).toEqual([]);
      const avisos = await prismaTest.notificacion.findMany();
      expect(avisos.every((a) => a.estado === 'pendiente' && a.intentos === 0)).toBe(true);
    });
  }

  it('sin número de destino no envía nada', async () => {
    const { falso, cliente } = crearWhatsappFalso();
    await crearAvisos('uno');

    await procesar(cliente);

    expect(falso.enviados).toEqual([]);
    expect((await prismaTest.notificacion.findFirstOrThrow()).intentos).toBe(0);
  });

  it('si WhatsApp se cae a mitad de la pasada, corta sin contar intentos', async () => {
    const { falso, cliente } = crearWhatsappFalso();
    await cargarDestino();
    await crearAvisos('uno', 'dos', 'tres');
    // El primero sale; en el segundo WhatsApp deja de responder.
    falso.fallas = [null, 'no_disponible'];

    await procesar(cliente);

    const avisos = await prismaTest.notificacion.findMany({ orderBy: { creadaEn: 'asc' } });
    expect(avisos.map((a) => [a.estado, a.intentos])).toEqual([
      ['enviada', 0],
      ['pendiente', 0],
      ['pendiente', 0],
    ]);
  });

  it('un rechazo con la sesión caída no cuenta como intento', async () => {
    const { falso, cliente } = crearWhatsappFalso();
    await cargarDestino();
    await crearAvisos('uno');
    const enviar = cliente.enviarTexto;
    cliente.enviarTexto = async (chatId, texto) => {
      falso.estadoActual = 'desvinculado';
      falso.fallas = ['rechazo'];
      return enviar(chatId, texto);
    };

    await procesar(cliente);

    expect(await prismaTest.notificacion.findFirstOrThrow()).toMatchObject({
      estado: 'pendiente',
      intentos: 0,
    });
  });

  it('al volver a vincular el chip se envían los acumulados', async () => {
    const { falso, cliente } = crearWhatsappFalso();
    falso.estadoActual = 'desvinculado';
    await cargarDestino();
    await crearAvisos('sábado', 'domingo', 'lunes');
    await procesar(cliente);

    falso.estadoActual = 'conectado';
    await procesar(cliente);

    expect(falso.enviados.map((e) => e.texto)).toEqual(['sábado', 'domingo', 'lunes']);
  });
});

describe('avisos acumulados en orden', () => {
  it('envía de a uno, del más antiguo al más reciente, con pausa entre envíos', async () => {
    const { falso, cliente } = crearWhatsappFalso();
    await cargarDestino();
    await crearAvisos('cierre 1', 'anulación', 'gasto 1', 'gasto 2', 'cierre 2');
    const momentos: number[] = [];
    const enviar = cliente.enviarTexto;
    cliente.enviarTexto = async (chatId, texto) => {
      momentos.push(performance.now());
      return enviar(chatId, texto);
    };

    await procesarPendientes({
      prisma: prismaTest,
      whatsapp: cliente,
      ahora: () => ahora,
      pausaEntreEnviosMs: 40,
    });

    expect(falso.enviados.map((e) => e.texto)).toEqual([
      'cierre 1',
      'anulación',
      'gasto 1',
      'gasto 2',
      'cierre 2',
    ]);
    for (let i = 1; i < momentos.length; i++) {
      expect(momentos[i]! - momentos[i - 1]!).toBeGreaterThanOrEqual(35);
    }
  });
});

describe('reintentos de un aviso que falla', () => {
  it('una falla pasajera se reintenta después de la espera y queda enviada', async () => {
    const { falso, cliente } = crearWhatsappFalso();
    await cargarDestino();
    const [aviso] = await crearAvisos('uno');
    falso.fallas = ['rechazo'];

    await procesar(cliente);
    const conFalla = await prismaTest.notificacion.findUniqueOrThrow({ where: { id: aviso!.id } });
    expect(conFalla).toMatchObject({ estado: 'pendiente', intentos: 1 });
    expect(conFalla.error).toMatch(/rechazó/);
    expect(conFalla.proximoIntentoEn).toEqual(new Date(ahora.getTime() + 30_000));

    // Antes de la espera no se reintenta.
    await procesar(cliente);
    expect(falso.enviados).toEqual([]);

    adelantar(30_000);
    await procesar(cliente);
    expect(
      await prismaTest.notificacion.findUniqueOrThrow({ where: { id: aviso!.id } }),
    ).toMatchObject({ estado: 'enviada', error: null, proximoIntentoEn: null });
  });

  it('la espera crece y al quinto intento queda en error sin reintentarse', async () => {
    const { falso, cliente } = crearWhatsappFalso();
    await cargarDestino();
    const [aviso] = await crearAvisos('uno');
    falso.fallas = Array(MAX_INTENTOS + 1).fill('rechazo');

    const esperas: number[] = [];
    for (let i = 0; i < MAX_INTENTOS; i++) {
      await procesar(cliente);
      const actual = await prismaTest.notificacion.findUniqueOrThrow({ where: { id: aviso!.id } });
      if (actual.proximoIntentoEn) {
        esperas.push(actual.proximoIntentoEn.getTime() - ahora.getTime());
        ahora = actual.proximoIntentoEn;
      }
    }

    expect(esperas).toEqual([30_000, 120_000, 600_000, 1_800_000]);
    const final = await prismaTest.notificacion.findUniqueOrThrow({ where: { id: aviso!.id } });
    expect(final).toMatchObject({ estado: 'error', intentos: 5, proximoIntentoEn: null });
    expect(final.error).toMatch(/rechazó/);

    adelantar(24 * 60 * 60_000);
    await procesar(cliente);
    expect(falso.fallas).toHaveLength(1);
  });

  it('un aviso en espera no frena a los siguientes', async () => {
    const { falso, cliente } = crearWhatsappFalso();
    await cargarDestino();
    await crearAvisos('falla', 'sale');
    falso.fallas = ['rechazo'];

    await procesar(cliente);

    expect(falso.enviados.map((e) => e.texto)).toEqual(['sale']);
  });
});

describe('iniciarEnvio', () => {
  it('nunca superpone dos pasadas y detener() corta el ciclo', async () => {
    const { falso, cliente } = crearWhatsappFalso();
    await cargarDestino();
    await crearAvisos('uno', 'dos', 'tres');
    let enCurso = 0;
    let maximo = 0;
    const enviar = cliente.enviarTexto;
    cliente.enviarTexto = async (chatId, texto) => {
      enCurso++;
      maximo = Math.max(maximo, enCurso);
      await new Promise((listo) => setTimeout(listo, 30));
      enCurso--;
      return enviar(chatId, texto);
    };

    const envio = iniciarEnvio({
      prisma: prismaTest,
      whatsapp: cliente,
      ahora: () => ahora,
      pausaEntreEnviosMs: 0,
      intervaloMs: 1,
    });
    await new Promise((listo) => setTimeout(listo, 300));
    await envio.detener();
    const enviadosAlDetener = falso.enviados.length;
    await crearAvisos('después');
    await new Promise((listo) => setTimeout(listo, 100));

    expect(maximo).toBe(1);
    expect(enviadosAlDetener).toBe(3);
    expect(falso.enviados).toHaveLength(3);
  });
});
