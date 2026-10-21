import {
  CODIGOS_ERROR,
  MEDIOS_PAGO,
  restar,
  sumar,
  TURNOS_POR_PAGINA,
  type aperturaSchema,
  type CierreRespuesta,
  type cierreSchema,
  type EstadoCaja,
  type MovimientoCaja,
  type movimientoCajaEntradaSchema,
  type ResumenCaja,
  type TurnoDetalle,
  type TurnoResumen,
  type UsuarioSesion,
} from '@kiosco/shared';
import type { z } from 'zod';
import { ErrorHttp } from '../../errores.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { textoAvisoCierre, textoAvisoMovimiento } from './avisos.js';

type Tx = Prisma.TransactionClient;

const monto = (valor: Prisma.Decimal | null | undefined) => (valor ? valor.toFixed(2) : '0.00');

export interface TurnoOperable {
  id: string;
  abiertoPorId: string;
}

/**
 * Turno abierto, bloqueado con `FOR SHARE` hasta el fin de la transacción:
 * un cierre (que toma `FOR UPDATE`) espera a que terminen las ventas y los
 * movimientos en curso, y los que llegan durante el cierre ya no lo encuentran.
 */
export async function turnoAbiertoBloqueado(tx: Tx): Promise<TurnoOperable | null> {
  const filas = await tx.$queryRaw<{ id: string; abierto_por_id: string }[]>`
    SELECT id, abierto_por_id FROM turnos WHERE cerrado_en IS NULL FOR SHARE`;
  const fila = filas[0];
  return fila ? { id: fila.id, abiertoPorId: fila.abierto_por_id } : null;
}

async function errorTurnoDeOtro(db: Tx | PrismaClient, abiertoPorId: string) {
  const { nombre } = await db.usuario.findUniqueOrThrow({ where: { id: abiertoPorId } });
  return new ErrorHttp(
    409,
    CODIGOS_ERROR.turnoDeOtro,
    `El turno de ${nombre} sigue abierto. Cerralo contando la caja antes de seguir.`,
    { responsable: nombre },
  );
}

/**
 * Turno en el que el usuario puede vender o mover la caja: el abierto, si es
 * suyo o si el usuario es admin. Lo bloquea como `turnoAbiertoBloqueado`.
 */
export async function turnoParaOperar(tx: Tx, usuario: UsuarioSesion): Promise<TurnoOperable> {
  const turno = await turnoAbiertoBloqueado(tx);
  if (!turno) {
    throw new ErrorHttp(
      409,
      CODIGOS_ERROR.sinTurnoAbierto,
      'No hay un turno abierto. Abrí el turno para seguir.',
    );
  }
  if (usuario.rol !== 'admin' && turno.abiertoPorId !== usuario.id) {
    throw await errorTurnoDeOtro(tx, turno.abiertoPorId);
  }
  return turno;
}

/**
 * Cómo se llega al efectivo esperado. Las ventas del turno cuentan aunque se
 * hayan anulado después: la devolución resta en el turno donde se anuló.
 */
export async function resumenDeCaja(
  db: Tx | PrismaClient,
  turno: { id: string; montoInicial: Prisma.Decimal },
): Promise<ResumenCaja> {
  const [porMedio, cantidadVentas, anulado, movimientos] = await Promise.all([
    db.pagoVenta.groupBy({
      by: ['medio'],
      where: { venta: { turnoId: turno.id } },
      _sum: { monto: true },
    }),
    db.venta.count({ where: { turnoId: turno.id } }),
    db.pagoVenta.aggregate({
      where: { medio: 'efectivo', venta: { anulacionTurnoId: turno.id } },
      _sum: { monto: true },
    }),
    db.movimientoCaja.groupBy({
      by: ['tipo'],
      where: { turnoId: turno.id },
      _sum: { monto: true },
    }),
  ]);
  const deMedio = (m: string) => monto(porMedio.find((p) => p.medio === m)?._sum.monto);
  const deTipo = (t: string) => monto(movimientos.find((m) => m.tipo === t)?._sum.monto);

  const montoInicial = turno.montoInicial.toFixed(2);
  const efectivoVendido = deMedio('efectivo');
  const ingresos = deTipo('ingreso');
  const gastos = deTipo('gasto');
  const retiros = deTipo('retiro');
  const efectivoAnulado = monto(anulado._sum.monto);
  return {
    cantidadVentas,
    porMedio: Object.fromEntries(
      MEDIOS_PAGO.map((m) => [m, deMedio(m)]),
    ) as ResumenCaja['porMedio'],
    montoInicial,
    efectivoVendido,
    ingresos,
    gastos,
    retiros,
    efectivoAnulado,
    esperado: restar(
      sumar(montoInicial, efectivoVendido, ingresos),
      sumar(gastos, retiros, efectivoAnulado),
    ),
  };
}

/** Lo que quedó en caja al cerrar el último turno, o $0 si nunca hubo uno. */
async function montoSugerido(db: Tx | PrismaClient): Promise<string> {
  const ultimo = await db.turno.findFirst({
    where: { cerradoEn: { not: null } },
    orderBy: { cerradoEn: 'desc' },
    select: { quedoEnCaja: true },
  });
  return monto(ultimo?.quedoEnCaja);
}

const incluirAbiertoPor = { abiertoPor: { select: { id: true, nombre: true } } } as const;

export async function estadoDeCaja(
  prisma: PrismaClient,
  usuario: UsuarioSesion,
): Promise<EstadoCaja> {
  const abierto = await prisma.turno.findFirst({
    where: { cerradoEn: null },
    include: incluirAbiertoPor,
  });
  return {
    turnoAbierto: abierto && {
      id: abierto.id,
      responsable: abierto.abiertoPor,
      abiertoEn: abierto.abiertoEn.toISOString(),
      esMio: abierto.abiertoPorId === usuario.id,
    },
    montoSugerido: await montoSugerido(prisma),
  };
}

const yaHayTurno = () =>
  new ErrorHttp(409, CODIGOS_ERROR.turnoYaAbierto, 'Ya hay un turno abierto.');

export async function abrirTurno(
  prisma: PrismaClient,
  { montoInicial }: z.output<typeof aperturaSchema>,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<EstadoCaja> {
  try {
    await prisma.turno.create({
      data: {
        abiertoPorId: usuario.id,
        abiertoEn: ahora,
        montoSugerido: await montoSugerido(prisma),
        montoInicial,
      },
    });
  } catch (error) {
    // El índice único parcial `turnos_un_solo_abierto` rechaza un segundo turno abierto.
    if ((error as { code?: string }).code === 'P2002') throw yaHayTurno();
    throw error;
  }
  return estadoDeCaja(prisma, usuario);
}

const turnoNoEncontrado = () =>
  new ErrorHttp(404, CODIGOS_ERROR.noEncontrado, 'El turno no existe.');

/**
 * Cierre ciego: toma el turno con `FOR UPDATE` (espera a las ventas en curso),
 * guarda la foto del esperado y deja el aviso para el admin, todo junto.
 */
export async function cerrarTurno(
  prisma: PrismaClient,
  id: string,
  { montoContado, retiro, motivoRetiro }: z.output<typeof cierreSchema>,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<CierreRespuesta> {
  const cierre = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM turnos WHERE id = ${id}::uuid FOR UPDATE`;
      const turno = await tx.turno.findUnique({ where: { id }, include: incluirAbiertoPor });
      if (!turno) throw turnoNoEncontrado();
      if (turno.cerradoEn) {
        throw new ErrorHttp(409, CODIGOS_ERROR.turnoYaCerrado, 'Este turno ya está cerrado.');
      }

      const resumen = await resumenDeCaja(tx, turno);
      const diferencia = restar(montoContado, resumen.esperado);
      const quedoEnCaja = restar(montoContado, retiro ?? 0);
      await tx.turno.update({
        where: { id },
        data: {
          cerradoPorId: usuario.id,
          cerradoEn: ahora,
          montoContado,
          retiroCierre: retiro,
          motivoRetiroCierre: motivoRetiro,
          esperado: resumen.esperado,
          diferencia,
          quedoEnCaja,
        },
      });
      await tx.notificacion.create({
        data: {
          tipo: 'cierre_turno',
          destino: 'admin',
          texto: textoAvisoCierre({
            responsable: turno.abiertoPor.nombre,
            cerradoPor: usuario.nombre,
            abiertoEn: turno.abiertoEn,
            cerradoEn: ahora,
            montoSugerido: turno.montoSugerido.toFixed(2),
            resumen,
            montoContado,
            diferencia,
            retiro,
            motivoRetiro,
            quedoEnCaja,
          }),
          creadaEn: ahora,
        },
      });
      return { id, quedoEnCaja, esperado: resumen.esperado, diferencia };
    },
    { timeout: 30_000 },
  );

  // Cierre ciego: el empleado no ve cuánto debería haber ni la diferencia.
  if (usuario.rol !== 'admin') return { id: cierre.id, quedoEnCaja: cierre.quedoEnCaja };
  return cierre;
}

const incluirUsuario = { usuario: { select: { id: true, nombre: true } } } as const;

type MovimientoConUsuario = Prisma.MovimientoCajaGetPayload<{ include: typeof incluirUsuario }>;

function aMovimiento(m: MovimientoConUsuario): MovimientoCaja {
  return {
    id: m.id,
    tipo: m.tipo,
    monto: m.monto.toFixed(2),
    motivo: m.motivo,
    usuario: m.usuario,
    creadoEn: m.creadoEn.toISOString(),
  };
}

/**
 * Gasto, retiro o ingreso en el turno abierto. Los gastos y retiros de un
 * empleado dejan un aviso para el admin en la misma operación.
 */
export async function registrarMovimientoCaja(
  prisma: PrismaClient,
  { tipo, monto: montoMovimiento, motivo }: z.output<typeof movimientoCajaEntradaSchema>,
  usuario: UsuarioSesion,
  ahora: Date,
): Promise<MovimientoCaja> {
  if (tipo === 'ingreso' && usuario.rol !== 'admin') {
    throw new ErrorHttp(
      403,
      CODIGOS_ERROR.sinPermiso,
      'Solo el admin puede registrar ingresos de caja.',
    );
  }
  const movimiento = await prisma.$transaction(async (tx) => {
    const turno = await turnoParaOperar(tx, usuario);
    const creado = await tx.movimientoCaja.create({
      data: {
        turnoId: turno.id,
        tipo,
        monto: montoMovimiento,
        motivo,
        usuarioId: usuario.id,
        creadoEn: ahora,
      },
      include: incluirUsuario,
    });
    if (usuario.rol !== 'admin' && tipo !== 'ingreso') {
      await tx.notificacion.create({
        data: {
          tipo: tipo === 'gasto' ? 'gasto_caja' : 'retiro_caja',
          destino: 'admin',
          texto: textoAvisoMovimiento({
            tipo,
            monto: montoMovimiento,
            motivo,
            usuario: usuario.nombre,
            creadoEn: ahora,
          }),
          creadaEn: ahora,
        },
      });
    }
    return creado;
  });
  return aMovimiento(movimiento);
}

/** Movimientos del turno abierto. El empleado solo ve los del turno que abrió. */
export async function movimientosDelTurnoAbierto(
  prisma: PrismaClient,
  usuario: UsuarioSesion,
): Promise<MovimientoCaja[]> {
  const turno = await prisma.turno.findFirst({ where: { cerradoEn: null } });
  if (!turno) return [];
  if (usuario.rol !== 'admin' && turno.abiertoPorId !== usuario.id) {
    throw await errorTurnoDeOtro(prisma, turno.abiertoPorId);
  }
  const movimientos = await prisma.movimientoCaja.findMany({
    where: { turnoId: turno.id },
    include: incluirUsuario,
    orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
  });
  return movimientos.map(aMovimiento);
}

const incluirTurno = {
  abiertoPor: { select: { id: true, nombre: true } },
  cerradoPor: { select: { id: true, nombre: true } },
} as const;

type TurnoConUsuarios = Prisma.TurnoGetPayload<{ include: typeof incluirTurno }>;

function aResumenTurno(t: TurnoConUsuarios): TurnoResumen {
  return {
    id: t.id,
    responsable: t.abiertoPor,
    cerradoPor: t.cerradoPor,
    abiertoEn: t.abiertoEn.toISOString(),
    cerradoEn: t.cerradoEn?.toISOString() ?? null,
    montoSugerido: t.montoSugerido.toFixed(2),
    montoInicial: t.montoInicial.toFixed(2),
    diferenciaApertura: restar(t.montoInicial.toFixed(2), t.montoSugerido.toFixed(2)),
    diferencia: t.diferencia?.toFixed(2) ?? null,
  };
}

export async function listarTurnos(prisma: PrismaClient, pagina: number): Promise<TurnoResumen[]> {
  const turnos = await prisma.turno.findMany({
    include: incluirTurno,
    orderBy: [{ abiertoEn: 'desc' }, { id: 'desc' }],
    skip: (pagina - 1) * TURNOS_POR_PAGINA,
    take: TURNOS_POR_PAGINA,
  });
  return turnos.map(aResumenTurno);
}

export async function obtenerTurno(prisma: PrismaClient, id: string): Promise<TurnoDetalle> {
  const turno = await prisma.turno.findUnique({ where: { id }, include: incluirTurno });
  if (!turno) throw turnoNoEncontrado();

  const [resumen, movimientos, anuladas] = await Promise.all([
    resumenDeCaja(prisma, turno),
    prisma.movimientoCaja.findMany({
      where: { turnoId: id },
      include: incluirUsuario,
      orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
    }),
    prisma.venta.findMany({
      where: { anulacionTurnoId: id, pagos: { some: { medio: 'efectivo' } } },
      include: { pagos: { where: { medio: 'efectivo' } } },
      orderBy: { anuladaEn: 'asc' },
    }),
  ]);

  return {
    ...aResumenTurno(turno),
    // Cerrado: el esperado es la foto del cierre, no se recalcula.
    resumen: turno.esperado ? { ...resumen, esperado: turno.esperado.toFixed(2) } : resumen,
    montoContado: turno.montoContado?.toFixed(2) ?? null,
    retiroCierre: turno.retiroCierre?.toFixed(2) ?? null,
    motivoRetiroCierre: turno.motivoRetiroCierre,
    quedoEnCaja: turno.quedoEnCaja?.toFixed(2) ?? null,
    movimientos: movimientos.map(aMovimiento),
    anulaciones: anuladas.map((v) => ({
      ventaId: v.id,
      numero: v.numero,
      efectivo: monto(v.pagos[0]?.monto),
      anuladaEn: v.anuladaEn!.toISOString(),
      motivo: v.motivoAnulacion!,
    })),
  };
}
