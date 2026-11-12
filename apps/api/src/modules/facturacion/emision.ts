import { formatearNumeroComprobante } from '@kiosco/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { ConfigArca } from '../../config.js';
import type { Factura, PrismaClient } from '../../generated/prisma/client.js';
import {
  ArcaNoDisponible,
  ArcaRechazo,
  type ClienteArca,
  type PedidoCae,
} from '../../integrations/arca/cliente.js';
import { fechaEnArgentina, sumarDias } from '../../lib/fechas.js';
import { ESPERAS_MS, MAX_INTENTOS } from '../whatsapp/envio.js';
import { MOTIVOS, textoAvisoFacturaConError, textoAvisoFacturaDeVentaAnulada } from './avisos.js';
import {
  CONCEPTO_PRODUCTOS,
  CONDICION_IVA_CONSUMIDOR_FINAL,
  DIAS_ATRAS_MAXIMO,
  DOC_TIPO_SIN_IDENTIFICAR,
  NUMERO_MAXIMO,
} from './reglas.js';
import type { EstadoArca } from './tipos.js';

/** Tope por pasada; lo que quede sale en la siguiente. */
const FACTURAS_POR_PASADA = 20;

export interface OpcionesEmision {
  prisma: PrismaClient;
  arca: ClienteArca;
  config: ConfigArca;
  ahora: () => Date;
  log?: FastifyBaseLogger;
}

type VentaDeFactura = { numero: number; creadaEn: Date; estado: string };
type FacturaConVenta = Factura & { venta: VentaDeFactura };

const conVenta = { venta: { select: { numero: true, creadaEn: true, estado: true } } } as const;

/** "AAAA-MM-DD" → la columna `Date` de Prisma. */
const aColumnaFecha = (fecha: string) => new Date(`${fecha}T00:00:00Z`);
const deColumnaFecha = (fecha: Date | null) => fecha?.toISOString().slice(0, 10) ?? null;

/** La pasada termina acá (la factura en curso queda como está). */
class FinDePasada extends Error {}

/**
 * Una pasada de la emisión de facturas. Corre de a una factura y nunca deja
 * dos números sin resolver: la base y ARCA son la fuente de verdad.
 *
 * 1. Si ARCA informa sus servidores caídos, termina sin tocar nada.
 * 2. Si hay una factura con la numeración inconsistente, termina: se destraba
 *    cuando el admin la reintenta.
 * 3. Resuelve la factura `en_curso` (corte entre el pedido y la respuesta)
 *    consultando su número en ARCA.
 * 4. Emite las pendientes vencidas, de la más vieja a la más nueva.
 *
 * Si ARCA no responde, nada gasta intentos. Devuelve el estado de ARCA que vio.
 */
export async function procesarFacturas(opciones: OpcionesEmision): Promise<EstadoArca> {
  const { arca, log } = opciones;
  if ((await arca.estadoServidores()) !== 'ok') return 'no_disponible';
  try {
    await pasada(opciones);
    return 'disponible';
  } catch (error) {
    if (error instanceof FinDePasada) return 'disponible';
    if (error instanceof ArcaNoDisponible) {
      log?.warn({ motivo: error.motivo }, `ARCA no disponible: ${error.message}`);
      return error.motivo === 'autenticacion_bloqueada'
        ? 'autenticacion_bloqueada'
        : 'no_disponible';
    }
    if (error instanceof ArcaRechazo) {
      // Un rechazo fuera de un pedido de CAE (último número, consulta) no es culpa
      // de ninguna factura: suele ser el certificado o el servicio sin asociar.
      log?.error({ codigo: error.codigo }, `ARCA rechazó una consulta: ${error.message}`);
      return 'no_disponible';
    }
    throw error;
  }
}

async function pasada(opciones: OpcionesEmision): Promise<void> {
  const { prisma, ahora } = opciones;

  const bloqueante = await prisma.factura.findFirst({
    where: { estado: 'error', codigoError: 'numeracion_inconsistente' },
    select: { id: true },
  });
  if (bloqueante) return;

  const enCurso = await prisma.factura.findFirst({
    where: { estado: 'en_curso' },
    include: conVenta,
    orderBy: [{ creadaEn: 'asc' }, { id: 'asc' }],
  });
  if (enCurso) await resolverEnCurso(opciones, enCurso);

  const pendientes = await prisma.factura.findMany({
    where: {
      estado: 'pendiente',
      OR: [{ proximoIntentoEn: null }, { proximoIntentoEn: { lte: ahora() } }],
    },
    include: conVenta,
    orderBy: [{ creadaEn: 'asc' }, { id: 'asc' }],
    take: FACTURAS_POR_PASADA,
  });
  for (const factura of pendientes) await emitirPendiente(opciones, factura);
}

/** Una factura `en_curso`: no se sabe si ARCA la autorizó. Se consulta antes de reenviar. */
async function resolverEnCurso(opciones: OpcionesEmision, factura: FacturaConVenta): Promise<void> {
  const { prisma, arca, log } = opciones;
  const fecha = deColumnaFecha(factura.fechaComprobante);
  if (factura.numero === null || fecha === null) {
    // No debería pasar: el número y la fecha se fijan juntos al reservar.
    await liberar(prisma, factura.id, 'en_curso');
    return;
  }
  const numero = factura.numero;
  const enArca = await arca.consultar(factura.puntoVenta, factura.tipoComprobante, numero);
  const numeroImpreso = formatearNumeroComprobante(factura.puntoVenta, numero);

  if (enArca) {
    const coincide = enArca.importe === factura.importe.toFixed(2) && enArca.fecha === fecha;
    if (coincide) {
      log?.info(
        { ventaId: factura.ventaId, numero },
        'Factura en curso encontrada autorizada en ARCA',
      );
      await autorizar(opciones, factura, enArca);
      return;
    }
    log?.error({ ventaId: factura.ventaId, numero }, 'Numeración inconsistente con ARCA');
    await pasarAError(opciones, factura, {
      estadoActual: 'en_curso',
      codigo: 'numeracion_inconsistente',
      motivo: MOTIVOS.numeracionInconsistente(numeroImpreso),
    });
    throw new FinDePasada();
  }

  if (factura.venta.estado !== 'pagada') {
    // ARCA no la registró y la venta se anuló: no se manda más.
    await prisma.factura.updateMany({
      where: { id: factura.id, estado: 'en_curso' },
      data: { estado: 'cancelada', numero: null, fechaComprobante: null, proximoIntentoEn: null },
    });
    return;
  }

  const ultimo = await arca.ultimoAutorizado(factura.puntoVenta, factura.tipoComprobante);
  if (ultimo.numero === numero - 1) {
    // ARCA no la registró y el número sigue libre: se reenvía igual.
    await solicitar(opciones, factura, numero, fecha);
    return;
  }
  // El número ya no es el siguiente: se libera y vuelve a la cola sin gastar intento.
  await liberar(prisma, factura.id, 'en_curso');
}

/** Una factura `pendiente`: plazo, número, reserva y pedido del CAE. */
async function emitirPendiente(opciones: OpcionesEmision, factura: FacturaConVenta): Promise<void> {
  const { prisma, arca, ahora } = opciones;

  if (factura.venta.estado !== 'pagada') {
    // Defensa: la anulación ya cancela las pendientes de su venta.
    await prisma.factura.updateMany({
      where: { id: factura.id, estado: 'pendiente' },
      data: { estado: 'cancelada', proximoIntentoEn: null },
    });
    return;
  }

  const fechaVenta = fechaEnArgentina(factura.venta.creadaEn);
  const hoy = fechaEnArgentina(ahora());
  if (fechaVenta < sumarDias(hoy, -DIAS_ATRAS_MAXIMO)) {
    await pasarAError(opciones, factura, {
      estadoActual: 'pendiente',
      codigo: 'fuera_de_plazo',
      motivo: MOTIVOS.fueraDePlazo(DIAS_ATRAS_MAXIMO),
    });
    return;
  }

  const ultimo = await arca.ultimoAutorizado(factura.puntoVenta, factura.tipoComprobante);
  const numero = ultimo.numero + 1;
  if (numero > NUMERO_MAXIMO) {
    await pasarAError(opciones, factura, {
      estadoActual: 'pendiente',
      codigo: 'numeracion_agotada',
      motivo: MOTIVOS.numeracionAgotada(String(factura.puntoVenta).padStart(5, '0')),
    });
    return;
  }
  // Nunca anterior a la del último comprobante (ARCA exige fechas crecientes) ni posterior a hoy.
  const fecha = ultimo.fecha !== null && ultimo.fecha > fechaVenta ? ultimo.fecha : fechaVenta;

  // Reserva: el número y la fecha se guardan antes de mandarla a ARCA.
  let reservada: number;
  try {
    ({ count: reservada } = await prisma.factura.updateMany({
      where: { id: factura.id, estado: 'pendiente' },
      data: { estado: 'en_curso', numero, fechaComprobante: aColumnaFecha(fecha) },
    }));
  } catch (error) {
    // Otro proceso reservó ese número: que lo resuelva él; esta pasada termina.
    if ((error as { code?: string }).code === 'P2002') {
      throw new FinDePasada();
    }
    throw error;
  }
  // La anularon (o la tomó otro proceso) en el medio: sigue con la siguiente.
  if (reservada === 0) return;

  await solicitar(opciones, factura, numero, fecha);
}

/** Pide el CAE de una factura ya reservada (`en_curso`) con ese número y fecha. */
async function solicitar(
  opciones: OpcionesEmision,
  factura: FacturaConVenta,
  numero: number,
  fecha: string,
): Promise<void> {
  const { arca, log } = opciones;
  const importe = factura.importe.toFixed(2);
  const pedido: PedidoCae = {
    PtoVta: factura.puntoVenta,
    CbteTipo: factura.tipoComprobante,
    Concepto: CONCEPTO_PRODUCTOS,
    DocTipo: DOC_TIPO_SIN_IDENTIFICAR,
    DocNro: 0,
    CbteDesde: numero,
    CbteHasta: numero,
    CbteFch: fecha.replaceAll('-', ''),
    ImpTotal: importe,
    ImpTotConc: '0.00',
    ImpNeto: importe,
    ImpOpEx: '0.00',
    ImpIVA: '0.00',
    ImpTrib: '0.00',
    MonId: 'PES',
    MonCotiz: 1,
    CondicionIVAReceptorId: CONDICION_IVA_CONSUMIDOR_FINAL,
  };

  let autorizacion: { cae: string; vencimiento: string };
  try {
    autorizacion = await arca.solicitarCae(pedido);
  } catch (error) {
    if (!(error instanceof ArcaRechazo)) {
      // ARCA no contestó: no se sabe si la autorizó. Queda en curso con su número
      // y la pasada siguiente la consulta antes de reenviarla.
      throw error;
    }
    log?.warn(
      { ventaId: factura.ventaId, numero, codigo: error.codigo },
      'ARCA rechazó la factura',
    );
    await registrarRechazo(opciones, factura, numero, error.message);
    return;
  }
  log?.info({ ventaId: factura.ventaId, numero }, 'Factura autorizada');
  await autorizar(
    opciones,
    { ...factura, numero, fechaComprobante: aColumnaFecha(fecha) },
    {
      cae: autorizacion.cae,
      vencimiento: autorizacion.vencimiento,
    },
  );
}

/**
 * Deja la factura `autorizada` con el CAE tal como lo dio ARCA. Es la fuente
 * de verdad, así que se escribe por id aunque otro proceso la haya tocado. Si
 * la venta se anuló mientras tanto, avisa al admin en la misma transacción.
 */
async function autorizar(
  { prisma, ahora }: OpcionesEmision,
  factura: FacturaConVenta,
  { cae, vencimiento }: { cae: string; vencimiento: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.factura.update({
      where: { id: factura.id },
      data: {
        estado: 'autorizada',
        numero: factura.numero,
        fechaComprobante: factura.fechaComprobante,
        cae,
        caeVencimiento: aColumnaFecha(vencimiento),
        autorizadaEn: ahora(),
        proximoIntentoEn: null,
        codigoError: null,
        error: null,
      },
    });
    const venta = await tx.venta.findUniqueOrThrow({
      where: { id: factura.ventaId },
      select: { estado: true, numero: true },
    });
    if (venta.estado !== 'pagada') {
      await tx.notificacion.create({
        data: {
          tipo: 'factura',
          destino: 'admin',
          texto: textoAvisoFacturaDeVentaAnulada({
            ventaNumero: venta.numero,
            numero: formatearNumeroComprobante(factura.puntoVenta, factura.numero!),
            importe: factura.importe.toFixed(2),
          }),
          creadaEn: ahora(),
        },
      });
    }
  });
}

/**
 * ARCA rechazó la factura: se libera el número (ARCA no lo consumió), se suma
 * un intento y se reintenta con las esperas de WhatsApp. Al quinto, `error`.
 */
async function registrarRechazo(
  opciones: OpcionesEmision,
  factura: FacturaConVenta,
  numero: number,
  mensaje: string,
): Promise<void> {
  const { prisma, ahora } = opciones;
  const intentos = factura.intentos + 1;
  if (intentos >= MAX_INTENTOS) {
    await pasarAError(opciones, factura, {
      estadoActual: 'en_curso',
      codigo: 'rechazo_arca',
      motivo: MOTIVOS.rechazoArca(intentos, mensaje),
      intentos,
      numero,
    });
    return;
  }
  await prisma.factura.updateMany({
    where: { id: factura.id, estado: 'en_curso', numero },
    data: {
      estado: 'pendiente',
      intentos,
      error: mensaje,
      numero: null,
      fechaComprobante: null,
      proximoIntentoEn: new Date(ahora().getTime() + ESPERAS_MS[intentos - 1]!),
    },
  });
}

/** Vuelve a la cola con el número liberado, sin gastar intento. */
async function liberar(prisma: PrismaClient, id: string, estadoActual: 'en_curso'): Promise<void> {
  await prisma.factura.updateMany({
    where: { id, estado: estadoActual },
    data: { estado: 'pendiente', numero: null, fechaComprobante: null },
  });
}

/** Pasa la factura a `error` y crea, en la misma transacción, un solo aviso al admin. */
async function pasarAError(
  { prisma, ahora }: OpcionesEmision,
  factura: FacturaConVenta,
  {
    estadoActual,
    codigo,
    motivo,
    intentos,
    numero,
  }: {
    estadoActual: 'pendiente' | 'en_curso';
    codigo: string;
    motivo: string;
    intentos?: number;
    /** Si la factura estaba en curso, el número que tenía reservado. */
    numero?: number;
  },
): Promise<void> {
  const inconsistente = codigo === 'numeracion_inconsistente';
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.factura.updateMany({
      where: { id: factura.id, estado: estadoActual, ...(numero !== undefined && { numero }) },
      data: {
        estado: 'error',
        codigoError: codigo,
        error: motivo,
        proximoIntentoEn: null,
        ...(intentos !== undefined && { intentos }),
        // La inconsistente conserva el número para que el admin vea cuál choca.
        ...(!inconsistente && { numero: null, fechaComprobante: null }),
      },
    });
    if (count === 0) return;
    await tx.notificacion.create({
      data: {
        tipo: 'factura',
        destino: 'admin',
        texto: textoAvisoFacturaConError({
          ventaNumero: factura.venta.numero,
          ventaCreadaEn: factura.venta.creadaEn,
          importe: factura.importe.toFixed(2),
          motivo,
        }),
        creadaEn: ahora(),
      },
    });
  });
}
