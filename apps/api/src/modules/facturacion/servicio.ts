import {
  CODIGOS_ERROR,
  comparar,
  ERRORES_FACTURA_NO_REINTENTABLES,
  type Emisor,
  type EstadoFacturacion,
  type FacturaListado,
  type FacturaVenta,
  formatearNumeroComprobante,
  type UsuarioSesion,
  urlQrFactura,
} from '@kiosco/shared';
import { ErrorHttp } from '../../errores.js';
import type { Factura, PrismaClient } from '../../generated/prisma/client.js';
import { fechaEnArgentina, sumarDias } from '../../lib/fechas.js';
import { crearFactura, importePorParte } from './encolado.js';
import { DIAS_ATRAS_MAXIMO, TIPO_FACTURA_C } from './reglas.js';
import type { Facturacion } from './tipos.js';

/** "AAAA-MM-DD" de una columna `Date` de Prisma (medianoche UTC). */
const aFecha = (fecha: Date | null) => fecha?.toISOString().slice(0, 10) ?? null;

/** Factura tal como va en el detalle de la venta, con el QR si está autorizada. */
export function aFacturaVenta(f: Factura, facturacion: Facturacion | undefined): FacturaVenta {
  const fecha = aFecha(f.fechaComprobante);
  const autorizada = f.estado === 'autorizada' && f.numero !== null && fecha !== null && f.cae;
  return {
    id: f.id,
    parte: f.parte,
    estado: f.estado,
    numero: f.numero === null ? null : formatearNumeroComprobante(f.puntoVenta, f.numero),
    fecha,
    importe: f.importe.toFixed(2),
    cae: f.cae,
    caeVencimiento: aFecha(f.caeVencimiento),
    qrUrl:
      autorizada && facturacion
        ? urlQrFactura({
            fecha,
            cuit: facturacion.config.ARCA_CUIT,
            ptoVta: f.puntoVenta,
            tipoCmp: f.tipoComprobante,
            nroCmp: f.numero!,
            importe: f.importe.toFixed(2),
            cae: f.cae!,
          })
        : null,
  };
}

/** Datos del emisor para el ticket, o null sin facturación configurada. */
export function emisorDe(facturacion: Facturacion | undefined): Emisor | null {
  if (!facturacion) return null;
  const { config } = facturacion;
  return {
    nombreFantasia: config.ARCA_NOMBRE_FANTASIA,
    razonSocial: config.ARCA_RAZON_SOCIAL,
    cuit: config.ARCA_CUIT,
    domicilio: config.ARCA_DOMICILIO,
    iibb: config.ARCA_IIBB,
    inicioActividades: config.ARCA_INICIO_ACTIVIDADES,
    entorno: config.ARCA_ENTORNO,
  };
}

const noConfigurada = () =>
  new ErrorHttp(
    409,
    CODIGOS_ERROR.facturacionNoConfigurada,
    'La facturación con ARCA no está configurada en el servidor.',
  );

/**
 * Factura a pedido del cliente por lo cobrado en efectivo
 * (`POST /api/ventas/:id/factura`). Pedirla de nuevo devuelve la misma; en
 * una venta sin efectivo devuelve la automática. El empleado solo pide de
 * ventas de hoy; el admin, hasta `DIAS_ATRAS_MAXIMO` días atrás.
 */
export async function pedirFactura(
  prisma: PrismaClient,
  ventaId: string,
  usuario: UsuarioSesion,
  ahora: Date,
  facturacion: Facturacion | undefined,
): Promise<{ factura: FacturaVenta; creada: boolean }> {
  if (!facturacion) throw noConfigurada();

  const resultado = await prisma.$transaction(async (tx) => {
    const venta = await tx.venta.findUnique({ where: { id: ventaId }, include: { pagos: true } });
    if (!venta) throw new ErrorHttp(404, CODIGOS_ERROR.noEncontrado, 'La venta no existe.');
    // Las ventas en espera o canceladas (cobro con el Point) nunca se facturan.
    if (venta.estado === 'pendiente' || venta.estado === 'cancelada') {
      throw venta.estado === 'pendiente'
        ? new ErrorHttp(
            409,
            CODIGOS_ERROR.cobroEnEspera,
            `La venta #${venta.numero} está esperando el cobro: se factura cuando quede cobrada.`,
          )
        : new ErrorHttp(
            409,
            CODIGOS_ERROR.ventaYaAnulada,
            `La venta #${venta.numero} no se cobró: no se puede facturar.`,
          );
    }
    if (venta.estado !== 'pagada') {
      throw new ErrorHttp(
        409,
        CODIGOS_ERROR.ventaYaAnulada,
        `La venta #${venta.numero} está anulada: no se puede facturar.`,
      );
    }
    const fechaVenta = fechaEnArgentina(venta.creadaEn);
    const hoy = fechaEnArgentina(ahora);
    if (usuario.rol !== 'admin' && fechaVenta !== hoy) {
      throw new ErrorHttp(
        403,
        CODIGOS_ERROR.fueraDePlazo,
        'Solo podés pedir factura de las ventas de hoy. Pedíselo al admin.',
      );
    }
    if (fechaVenta < sumarDias(hoy, -DIAS_ATRAS_MAXIMO)) {
      throw new ErrorHttp(
        422,
        CODIGOS_ERROR.facturaFueraDePlazo,
        `Ya pasaron más de ${DIAS_ATRAS_MAXIMO} días: ARCA no deja facturar esta venta.`,
      );
    }

    const partes = importePorParte(venta.pagos);
    if (comparar(partes.electronica, 0) <= 0 && comparar(partes.efectivo, 0) <= 0) {
      throw new ErrorHttp(422, CODIGOS_ERROR.facturaSinImporte, 'Una venta de $0 no se factura.');
    }
    // Sin efectivo, la factura de la venta es la automática.
    const parte = comparar(partes.efectivo, 0) > 0 ? 'efectivo' : 'electronica';
    const creada = await crearFactura(tx, {
      venta,
      parte,
      importe: partes[parte],
      pedidaPorId: parte === 'efectivo' ? usuario.id : null,
      facturacion,
      ahora,
    });
    const factura = await tx.factura.findUniqueOrThrow({
      where: { ventaId_parte: { ventaId, parte } },
    });
    return { factura, creada };
  });
  return { factura: aFacturaVenta(resultado.factura, facturacion), creada: resultado.creada };
}

/**
 * Estado de la facturación para el admin (`GET /api/facturacion`). El estado
 * de ARCA sale de la última pasada de la emisión: no se le pregunta a ARCA.
 */
export async function estadoDeFacturacion(
  prisma: PrismaClient,
  facturacion: Facturacion | undefined,
): Promise<EstadoFacturacion> {
  if (!facturacion) return { estado: 'no_configurado' };
  const { ARCA_PUNTO_VENTA: puntoVenta, ARCA_ENTORNO: entorno } = facturacion.config;

  const [trabadas, ultima] = await Promise.all([
    prisma.factura.findMany({
      where: { estado: { in: ['pendiente', 'en_curso', 'error'] } },
      include: { venta: { select: { numero: true } } },
      orderBy: [{ creadaEn: 'asc' }, { id: 'asc' }],
    }),
    prisma.factura.aggregate({
      where: { estado: 'autorizada', puntoVenta, tipoComprobante: TIPO_FACTURA_C },
      _max: { numero: true },
    }),
  ]);

  return {
    estado: facturacion.estado(),
    entorno,
    puntoVenta,
    ultimoNumero: ultima._max.numero ?? 0,
    pendientes: trabadas.filter((f) => f.estado !== 'error').length,
    enError: trabadas.filter((f) => f.estado === 'error').length,
    facturas: trabadas.map(aFacturaListado),
  };
}

function aFacturaListado(f: Factura & { venta: { numero: number } }): FacturaListado {
  return {
    id: f.id,
    ventaId: f.ventaId,
    ventaNumero: f.venta.numero,
    parte: f.parte,
    importe: f.importe.toFixed(2),
    estado: f.estado,
    intentos: f.intentos,
    codigoError: f.codigoError,
    error: f.error,
    creadaEn: f.creadaEn.toISOString(),
  };
}

/**
 * Reintento del admin: una factura en `error` vuelve a `pendiente` con 0
 * intentos y el número liberado. No se reintentan las del tope ni las fuera
 * de plazo (darían lo mismo), ni las de una venta anulada.
 */
export async function reintentarFactura(prisma: PrismaClient, id: string): Promise<FacturaListado> {
  const { count } = await prisma.factura.updateMany({
    where: {
      id,
      estado: 'error',
      OR: [
        { codigoError: null },
        { codigoError: { notIn: [...ERRORES_FACTURA_NO_REINTENTABLES] } },
      ],
      venta: { estado: 'pagada' },
    },
    data: {
      estado: 'pendiente',
      intentos: 0,
      proximoIntentoEn: null,
      numero: null,
      fechaComprobante: null,
      codigoError: null,
      error: null,
    },
  });
  const factura = await prisma.factura.findUnique({
    where: { id },
    include: { venta: { select: { numero: true } } },
  });
  if (!factura) throw new ErrorHttp(404, CODIGOS_ERROR.noEncontrado, 'La factura no existe.');
  if (count === 0) {
    throw new ErrorHttp(
      409,
      CODIGOS_ERROR.facturaNoReintentable,
      factura.estado !== 'error'
        ? 'Solo se reintenta una factura con error.'
        : 'Esta factura no se puede reintentar: daría el mismo error.',
    );
  }
  return aFacturaListado(factura);
}
