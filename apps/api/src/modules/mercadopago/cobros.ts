import {
  CODIGOS_ERROR,
  ESTADOS_COBRO_A_REVISAR,
  MOTIVO_COBRO_A_REVISAR,
  type CobroARevisar,
  type CobroMp as CobroMpRespuesta,
  type UsuarioSesion,
} from '@kiosco/shared';
import { ErrorHttp } from '../../errores.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { turnoParaOperar } from '../caja/servicio.js';
import { aCobro } from '../ventas/cobro.js';
import { textoAvisoCobroARevisar, textoAvisoDevolucionCobro } from './avisos-cobro.js';

/*
 * Cobros del Point que no terminan solos: la devolución en efectivo de un pago que entró
 * después de cancelar la venta (o el cliente que se fue sin ella) y los cobros que el
 * admin tiene que revisar (design "Pago aprobado después de cancelar").
 */

type Tx = Prisma.TransactionClient;

const cobroNoEncontrado = () =>
  new ErrorHttp(404, CODIGOS_ERROR.noEncontrado, 'El cobro no existe.');

const yaResuelto = (estado: string) =>
  new ErrorHttp(
    409,
    CODIGOS_ERROR.devolucionYaConfirmada,
    estado === 'devuelto'
      ? 'Esta devolución ya se confirmó.'
      : 'Este cobro ya no tiene una devolución pendiente.',
  );

async function cobroConVenta(tx: Tx, id: string) {
  const cobro = await tx.cobroMp.findUnique({
    where: { id },
    include: { venta: { select: { numero: true } } },
  });
  if (!cobro) throw cobroNoEncontrado();
  return cobro;
}

/**
 * "Ya devolví $X": sale del turno abierto, en efectivo y por el monto cobrado (el pedido
 * no lleva monto), con aviso al admin. El UPDATE condicionado hace que dos confirmaciones
 * a la vez dejen una sola salida.
 */
export async function confirmarDevolucion(
  prisma: PrismaClient,
  id: string,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<CobroMpRespuesta> {
  const cobro = await prisma.$transaction(async (tx) => {
    const cobro = await cobroConVenta(tx, id);
    const turno = await turnoParaOperar(tx, usuario);
    const { count } = await tx.cobroMp.updateMany({
      where: { id, estado: 'a_devolver' },
      data: { estado: 'devuelto' },
    });
    if (count === 0) {
      const actual = await tx.cobroMp.findUniqueOrThrow({ where: { id } });
      throw yaResuelto(actual.estado);
    }
    const monto = cobro.monto.toFixed(2);
    await tx.movimientoCaja.create({
      data: {
        turnoId: turno.id,
        tipo: 'devolucion_cobro',
        cuenta: 'efectivo',
        monto,
        motivo: `Devolución de cobro de Mercado Pago · venta #${cobro.venta.numero}`,
        usuarioId: usuario.id,
        cobroMpId: id,
        creadoEn: ahora,
      },
    });
    await tx.notificacion.create({
      data: {
        tipo: 'devolucion_cobro_mp',
        destino: 'admin',
        texto: textoAvisoDevolucionCobro({
          monto,
          ventaNumero: cobro.venta.numero,
          devolvio: usuario.nombre,
          en: ahora,
        }),
        creadaEn: ahora,
      },
    });
    return tx.cobroMp.findUniqueOrThrow({ where: { id } });
  });
  return aCobro(cobro);
}

/**
 * "El cliente ya se fue": el cobro queda `sin_devolver`, sin salida de efectivo, y el
 * admin lo resuelve desde Administración → Mercado Pago. El empleado solo desde su turno.
 */
export async function marcarSinDevolver(
  prisma: PrismaClient,
  id: string,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<CobroMpRespuesta> {
  const cobro = await prisma.$transaction(async (tx) => {
    const cobro = await cobroConVenta(tx, id);
    if (usuario.rol !== 'admin') await turnoParaOperar(tx, usuario);
    const { count } = await tx.cobroMp.updateMany({
      where: { id, estado: 'a_devolver' },
      data: { estado: 'sin_devolver' },
    });
    if (count === 0) {
      const actual = await tx.cobroMp.findUniqueOrThrow({ where: { id } });
      throw yaResuelto(actual.estado);
    }
    await tx.notificacion.create({
      data: {
        tipo: 'cobro_mp_a_revisar',
        destino: 'admin',
        texto: textoAvisoCobroARevisar({
          caso: 'sin_devolver',
          monto: cobro.monto.toFixed(2),
          medio: cobro.medio,
          ventaNumero: cobro.venta.numero,
          en: ahora,
        }),
        creadaEn: ahora,
      },
    });
    return tx.cobroMp.findUniqueOrThrow({ where: { id } });
  });
  return aCobro(cobro);
}

type CobroParaRevisar = Prisma.CobroMpGetPayload<{
  include: { venta: { select: { numero: true } } };
}>;

function aCobroARevisar(c: CobroParaRevisar): CobroARevisar {
  const estado = c.estado as CobroARevisar['estado'];
  return {
    id: c.id,
    ventaId: c.ventaId,
    ventaNumero: c.venta.numero,
    estado,
    monto: c.monto.toFixed(2),
    medio: c.medio,
    creadoEn: c.creadoEn.toISOString(),
    motivo: MOTIVO_COBRO_A_REVISAR[estado],
  };
}

/** Lo que el admin tiene que mirar: a revisar y sin devolver sin revisar, y las devoluciones pendientes. */
export async function cobrosARevisar(prisma: PrismaClient): Promise<CobroARevisar[]> {
  const cobros = await prisma.cobroMp.findMany({
    where: { estado: { in: [...ESTADOS_COBRO_A_REVISAR] }, revisadoEn: null },
    include: { venta: { select: { numero: true } } },
    orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
  });
  return cobros.map(aCobroARevisar);
}

/**
 * Marca revisado un cobro `a_revisar` o `sin_devolver`, con nota obligatoria. No cambia
 * ventas, stock ni caja. Una devolución pendiente no se revisa: se devuelve.
 */
export async function marcarRevisado(
  prisma: PrismaClient,
  id: string,
  nota: string,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<CobroARevisar> {
  const cobro = await prisma.cobroMp.findUnique({ where: { id } });
  if (!cobro) throw cobroNoEncontrado();
  const { count } = await prisma.cobroMp.updateMany({
    where: { id, estado: { in: ['a_revisar', 'sin_devolver'] }, revisadoEn: null },
    data: { revisadoPorId: usuario.id, revisadoEn: ahora, notaRevision: nota },
  });
  if (count === 0) {
    throw new ErrorHttp(
      409,
      CODIGOS_ERROR.devolucionPendiente,
      cobro.estado === 'a_devolver'
        ? 'Esta devolución está pendiente: se confirma desde la caja.'
        : 'Este cobro no está para revisar.',
    );
  }
  return aCobroARevisar(
    await prisma.cobroMp.findUniqueOrThrow({
      where: { id },
      include: { venta: { select: { numero: true } } },
    }),
  );
}
