import {
  CATEGORIAS_GASTO,
  CODIGOS_ERROR,
  MEDIOS_PAGO,
  periodoAnterior,
  restar,
  sumar,
  variacion,
  type Dashboard,
  type dashboardQuerySchema,
  type ProductoVendido,
  type Rango,
} from '@kiosco/shared';
import type { z } from 'zod';
import { ErrorHttp } from '../../errores.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { fechaEnArgentina, rangoDelDiaEnArgentina, ZONA_ARGENTINA } from '../../lib/fechas.js';
import { resumenDeCaja } from '../caja/servicio.js';

const monto = (valor: Prisma.Decimal | number | null | undefined) =>
  valor == null ? '0.00' : new Prisma.Decimal(valor).toFixed(2);

/** Instantes UTC del rango de días en Argentina: [desde 00:00, hasta+1 00:00). */
function instantes({ desde, hasta }: Rango) {
  return { gte: rangoDelDiaEnArgentina(desde).desde, lt: rangoDelDiaEnArgentina(hasta).hasta };
}

const DIA_MS = 86_400_000;
const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA_MS);
const sumarDias = (fecha: string, dias: number) =>
  new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);

/** Ganancia (ítems con costo), base del margen y lo vendido sin costo, de ventas pagadas. */
async function gananciaDe(prisma: PrismaClient, rango: Rango) {
  const { gte, lt } = instantes(rango);
  const [fila] = await prisma.$queryRaw<
    {
      ganancia: Prisma.Decimal | null;
      base: Prisma.Decimal | null;
      sin_costo: Prisma.Decimal | null;
    }[]
  >`
    SELECT
      SUM(iv.subtotal - iv.cantidad * iv.costo_unitario) FILTER (WHERE iv.costo_unitario IS NOT NULL) AS ganancia,
      SUM(iv.subtotal) FILTER (WHERE iv.costo_unitario IS NOT NULL) AS base,
      SUM(iv.subtotal) FILTER (WHERE iv.costo_unitario IS NULL) AS sin_costo
    FROM items_venta iv
    JOIN ventas v ON v.id = iv.venta_id
    WHERE v.estado = 'pagada' AND v.creada_en >= ${gte} AND v.creada_en < ${lt}`;
  return {
    ganancia: monto(fila?.ganancia),
    base: monto(fila?.base),
    sinCosto: monto(fila?.sin_costo),
  };
}

function ventasDe(prisma: PrismaClient, rango: Rango) {
  return prisma.venta.aggregate({
    where: { estado: 'pagada', creadaEn: instantes(rango) },
    _sum: { total: true },
    _count: true,
  });
}

/** Ventas agrupadas por hora (un día), por semana (más de 62 días) o por día, sin huecos. */
async function serieDe(prisma: PrismaClient, rango: Rango): Promise<Dashboard['serie']> {
  const dias = diasEntre(rango.desde, rango.hasta);
  const agrupacion = dias === 0 ? 'hora' : dias > 62 ? 'semana' : 'dia';
  const unidad = agrupacion === 'hora' ? 'hour' : agrupacion === 'semana' ? 'week' : 'day';
  const formato = agrupacion === 'hora' ? 'YYYY-MM-DD"T"HH24' : 'YYYY-MM-DD';
  const { gte, lt } = instantes(rango);
  const filas = await prisma.$queryRaw<{ inicio: string; total: Prisma.Decimal }[]>`
    SELECT to_char(date_trunc(${unidad}, v.creada_en AT TIME ZONE ${ZONA_ARGENTINA}), ${formato}) AS inicio,
           SUM(v.total) AS total
    FROM ventas v
    WHERE v.estado = 'pagada' AND v.creada_en >= ${gte} AND v.creada_en < ${lt}
    GROUP BY 1`;
  const porInicio = new Map(filas.map((f) => [f.inicio, monto(f.total)]));

  const inicios: string[] = [];
  if (agrupacion === 'hora') {
    for (let h = 0; h < 24; h++) inicios.push(`${rango.desde}T${String(h).padStart(2, '0')}`);
  } else {
    // La semana arranca el lunes, como date_trunc('week').
    const primero =
      agrupacion === 'semana'
        ? sumarDias(rango.desde, -((new Date(`${rango.desde}T00:00:00Z`).getUTCDay() + 6) % 7))
        : rango.desde;
    for (let f = primero; f <= rango.hasta; f = sumarDias(f, agrupacion === 'semana' ? 7 : 1)) {
      inicios.push(f);
    }
  }
  return {
    agrupacion,
    puntos: inicios.map((inicio) => ({ inicio, total: porInicio.get(inicio) ?? '0.00' })),
  };
}

/** Los 10 más vendidos en cada orden, sin "Varios". La ganancia es null si falta algún costo. */
async function masVendidosDe(
  prisma: PrismaClient,
  rango: Rango,
): Promise<Dashboard['masVendidos']> {
  const { gte, lt } = instantes(rango);
  const filas = await prisma.$queryRaw<
    {
      producto_id: string;
      nombre: string;
      unidades: number;
      importe: Prisma.Decimal;
      ganancia: Prisma.Decimal | null;
    }[]
  >`
    SELECT iv.producto_id, p.nombre, SUM(iv.cantidad)::int AS unidades, SUM(iv.subtotal) AS importe,
           CASE WHEN bool_and(iv.costo_unitario IS NOT NULL)
                THEN SUM(iv.subtotal - iv.cantidad * iv.costo_unitario) END AS ganancia
    FROM items_venta iv
    JOIN ventas v ON v.id = iv.venta_id
    JOIN productos p ON p.id = iv.producto_id
    WHERE v.estado = 'pagada' AND v.creada_en >= ${gte} AND v.creada_en < ${lt}
    GROUP BY iv.producto_id, p.nombre`;
  const productos: ProductoVendido[] = filas.map((f) => ({
    productoId: f.producto_id,
    nombre: f.nombre,
    unidades: f.unidades,
    importe: monto(f.importe),
    ganancia: f.ganancia === null ? null : monto(f.ganancia),
  }));
  const top = (lista: ProductoVendido[], valor: (p: ProductoVendido) => number) =>
    [...lista].sort((a, b) => valor(b) - valor(a) || a.nombre.localeCompare(b.nombre)).slice(0, 10);
  return {
    unidades: top(productos, (p) => p.unidades),
    importe: top(productos, (p) => Number(p.importe)),
    ganancia: top(
      productos.filter((p) => p.ganancia !== null),
      (p) => Number(p.ganancia),
    ),
  };
}

/** Efectivo en el cajón ahora y lo que falta pagar a proveedores. */
async function ahora(prisma: PrismaClient): Promise<Dashboard['ahora']> {
  const [abierto, ultimoCierre, porLlegar, deben] = await Promise.all([
    prisma.turno.findFirst({ where: { cerradoEn: null } }),
    prisma.turno.findFirst({
      where: { cerradoEn: { not: null } },
      orderBy: { cerradoEn: 'desc' },
      select: { quedoEnCaja: true },
    }),
    prisma.pedido.aggregate({
      where: { estado: 'por_llegar' },
      _sum: { totalPedido: true },
      _count: true,
    }),
    prisma.pedido.aggregate({
      where: { estado: { in: ['llego', 'cargado'] }, pago: { is: null } },
      _sum: { total: true },
      _count: true,
    }),
  ]);
  const efectivoEnCaja = abierto
    ? (await resumenDeCaja(prisma, abierto)).esperado
    : monto(ultimoCierre?.quedoEnCaja);
  const totalPorLlegar = monto(porLlegar._sum.totalPedido);
  const totalDeben = monto(deben._sum.total);
  return {
    efectivoEnCaja,
    turnoAbierto: abierto !== null,
    pendiente: {
      total: sumar(totalPorLlegar, totalDeben),
      porLlegar: { cantidad: porLlegar._count, total: totalPorLlegar },
      deben: { cantidad: deben._count, total: totalDeben },
    },
  };
}

/** Gastos por categoría, pagos a proveedores por cuenta, retiros e ingresos del período. */
async function movimientosDe(prisma: PrismaClient, rango: Rango) {
  const rangoInstantes = instantes(rango);
  const [movimientos, turnos, conDiferencia, anuladas] = await Promise.all([
    prisma.movimientoCaja.groupBy({
      by: ['tipo', 'cuenta', 'categoria'],
      where: { creadoEn: rangoInstantes },
      _sum: { monto: true },
    }),
    prisma.turno.aggregate({
      where: { cerradoEn: rangoInstantes },
      _sum: { diferencia: true, retiroCierre: true },
    }),
    prisma.turno.count({ where: { cerradoEn: rangoInstantes, diferencia: { not: 0 } } }),
    prisma.venta.aggregate({
      where: { estado: 'anulada', anuladaEn: rangoInstantes },
      _sum: { total: true },
      _count: true,
    }),
  ]);
  const suma = (filtro: (m: (typeof movimientos)[number]) => boolean) =>
    sumar('0', ...movimientos.filter(filtro).map((m) => monto(m._sum.monto)));
  const porCategoria = Object.fromEntries(
    CATEGORIAS_GASTO.map((c) => [c, suma((m) => m.tipo === 'gasto' && m.categoria === c)]),
  ) as Dashboard['gastos']['porCategoria'];
  const esPago = (m: (typeof movimientos)[number]) => m.tipo === 'pago_proveedor';
  return {
    gastos: { total: suma((m) => m.tipo === 'gasto'), porCategoria },
    movimientos: {
      pagosProveedor: {
        total: suma(esPago),
        efectivo: suma((m) => esPago(m) && m.cuenta === 'efectivo'),
        mercadoPago: suma((m) => esPago(m) && m.cuenta === 'mercado_pago'),
      },
      retiros: sumar(
        suma((m) => m.tipo === 'retiro'),
        monto(turnos._sum.retiroCierre),
      ),
      ingresos: suma((m) => m.tipo === 'ingreso'),
      diferencias: { total: monto(turnos._sum.diferencia), turnos: conDiferencia },
      anuladas: { cantidad: anuladas._count, total: monto(anuladas._sum.total) },
    },
  };
}

/**
 * Todo lo que muestra el dashboard del admin para un rango de días en
 * Argentina (sin fechas, hoy), comparado con el período anterior.
 */
export async function obtenerDashboard(
  prisma: PrismaClient,
  { desde, hasta }: z.output<typeof dashboardQuerySchema>,
  ahoraInstante: Date,
): Promise<Dashboard> {
  const hoy = fechaEnArgentina(ahoraInstante);
  const periodo = { desde: desde ?? hasta ?? hoy, hasta: hasta ?? desde ?? hoy };
  if (periodo.desde > periodo.hasta) {
    throw new ErrorHttp(400, CODIGOS_ERROR.validacion, 'La fecha "desde" es posterior a "hasta".');
  }
  const anterior = periodoAnterior(periodo);

  const [estado, ventas, ventasAnt, ganancia, gananciaAnt, serie, medios, masVendidos, plata] =
    await Promise.all([
      ahora(prisma),
      ventasDe(prisma, periodo),
      ventasDe(prisma, anterior),
      gananciaDe(prisma, periodo),
      gananciaDe(prisma, anterior),
      serieDe(prisma, periodo),
      prisma.pagoVenta.groupBy({
        by: ['medio'],
        where: { venta: { estado: 'pagada', creadaEn: instantes(periodo) } },
        _sum: { monto: true },
      }),
      masVendidosDe(prisma, periodo),
      movimientosDe(prisma, periodo),
    ]);

  const totalVentas = monto(ventas._sum.total);
  const totalVentasAnt = monto(ventasAnt._sum.total);
  return {
    periodo,
    anterior,
    ahora: estado,
    ventas: {
      total: totalVentas,
      cantidad: ventas._count,
      anterior: totalVentasAnt,
      variacion: variacion(totalVentas, totalVentasAnt),
    },
    ganancia: {
      total: ganancia.ganancia,
      anterior: gananciaAnt.ganancia,
      variacion: variacion(ganancia.ganancia, gananciaAnt.ganancia),
      margen:
        Number(ganancia.base) === 0
          ? null
          : Math.round((Number(ganancia.ganancia) / Number(ganancia.base)) * 100),
    },
    sinCosto: ganancia.sinCosto,
    gastos: plata.gastos,
    resultado: restar(ganancia.ganancia, plata.gastos.total),
    serie,
    medios: Object.fromEntries(
      MEDIOS_PAGO.map((m) => [m, monto(medios.find((p) => p.medio === m)?._sum.monto)]),
    ) as Dashboard['medios'],
    masVendidos,
    movimientos: plata.movimientos,
  };
}
