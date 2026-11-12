import { MercadoPagoRechazo } from './errores.js';

/*
 * Órdenes Point de la Orders API (`type: "point"`), con la terminal en modo PDV.
 * Ver el design de cobro-mercado-pago ("API de Mercado Pago") y sus fuentes:
 *
 *   POST /v1/orders              crea el cobro en la terminal (X-Idempotency-Key)
 *   GET  /v1/orders/{id}         estado real del cobro
 *   POST /v1/orders/{id}/cancel  200 cancelada, 202 pedida (at_terminal), 409 ya no se puede
 *
 * Supuestos que se confirman con credenciales de prueba (tareas 8.1 y 8.2): los errores
 * vienen como `{ errors: [{ code }] }`, el `status_detail` está en la orden (o en su pago) y
 * el tipo de pago en `transactions.payments[0].payment_method.type`.
 */

/** Estado de una orden ya traducido (tabla "Estados de MP traducidos" del design). */
export type EstadoOrden =
  'en_espera' | 'cancelando' | 'aprobado' | 'rechazado' | 'vencido' | 'cancelado' | 'a_revisar';

export type MedioPoint = 'debito' | 'credito' | 'mercado_pago';

/** Lo que el sistema le pide a MP para crear un cobro en la terminal. */
export interface PedidoOrden {
  /** UUID guardado antes de llamar; va en `X-Idempotency-Key`. */
  claveIdempotencia: string;
  /** `venta-{numero}-{intento}`. */
  referenciaExterna: string;
  /** Con 2 decimales, sin redondear: "1500.00". */
  monto: string;
  medio: MedioPoint;
  terminalId: string;
}

export interface OrdenPoint {
  id: string;
  estado: EstadoOrden;
  /** `status_detail` de MP, o null. */
  detalle: string | null;
  /** Tipo de pago que informó MP (`debit_card`, `credit_card`, `qr`...), o null. */
  tipoInformado: string | null;
  referenciaExterna: string;
}

export type ResultadoCancelacion = 'cancelada' | 'pedida' | 'no_cancelable';

export type PedirOrden = (
  metodo: 'GET' | 'POST',
  ruta: string,
  opciones?: { cuerpo?: unknown; encabezados?: Record<string, string> },
) => Promise<{ status: number; datos: unknown }>;

/** Vencimiento del cobro en MP si nadie paga (MP acepta de PT30S a PT3H). */
const VENCIMIENTO_ORDEN = 'PT3M';

/** El medio que eligió el empleado: la terminal acepta solo ese. `qr` funciona solo en PDV. */
const TIPO_POR_MEDIO: Record<MedioPoint, string> = {
  debito: 'debit_card',
  credito: 'credit_card',
  mercado_pago: 'qr',
};

interface PagoMp {
  status?: unknown;
  status_detail?: unknown;
  payment_method?: { type?: unknown } | null;
}

interface OrdenMp {
  id?: unknown;
  status?: unknown;
  status_detail?: unknown;
  external_reference?: unknown;
  transactions?: { payments?: PagoMp[] | null } | null;
}

const texto = (valor: unknown) => (typeof valor === 'string' && valor ? valor : null);

/** Estado de MP (orden y detalle) → estado del cobro. */
export function traducirEstado(status: string | null, detalle: string | null): EstadoOrden {
  switch (status) {
    case 'created':
    case 'at_terminal':
      return detalle === 'cancellation_requested' ? 'cancelando' : 'en_espera';
    case 'action_required':
      return detalle === 'check_on_terminal' ? 'a_revisar' : 'en_espera';
    case 'processed':
      return 'aprobado';
    case 'failed':
      return 'rechazado';
    case 'expired':
      return 'vencido';
    case 'canceled':
      return 'cancelado';
    case 'refunded':
      return 'a_revisar';
    default:
      // Un estado que no se conoce no confirma nada: se sigue consultando.
      return 'en_espera';
  }
}

function leerOrden(datos: unknown, status: number): OrdenPoint {
  const orden = (datos ?? {}) as OrdenMp;
  const id = texto(orden.id);
  if (!id) throw new MercadoPagoRechazo(status, 'respuesta_invalida');
  const pago = orden.transactions?.payments?.[0];
  const detalle = texto(orden.status_detail) ?? texto(pago?.status_detail);
  return {
    id,
    estado: traducirEstado(texto(orden.status) ?? texto(pago?.status), detalle),
    detalle,
    tipoInformado: texto(pago?.payment_method?.type),
    referenciaExterna: texto(orden.external_reference) ?? '',
  };
}

/** Primer código de error de MP (`{ errors: [{ code }] }`), o null. */
function codigoDeError(datos: unknown): string | null {
  const errores = (datos as { errors?: { code?: unknown }[] } | null)?.errors;
  return Array.isArray(errores) ? texto(errores[0]?.code) : null;
}

/** Rechazo de MP con un código propio corto (el detalle de MP nunca sale de acá). */
function rechazo(status: number, datos: unknown): MercadoPagoRechazo {
  const codigo = codigoDeError(datos) ?? '';
  if (status === 409 && codigo === 'already_queued_order_for_terminal') {
    return new MercadoPagoRechazo(status, 'terminal_ocupada');
  }
  if (status === 400 && codigo.includes('amount')) {
    return new MercadoPagoRechazo(status, 'monto_invalido');
  }
  return new MercadoPagoRechazo(status);
}

export function crearOperacionesDeOrdenes(pedir: PedirOrden) {
  return {
    async crearOrden(pedido: PedidoOrden): Promise<OrdenPoint> {
      const { status, datos } = await pedir('POST', '/v1/orders', {
        encabezados: { 'X-Idempotency-Key': pedido.claveIdempotencia },
        cuerpo: {
          type: 'point',
          external_reference: pedido.referenciaExterna,
          expiration_time: VENCIMIENTO_ORDEN,
          transactions: { payments: [{ amount: pedido.monto }] },
          config: {
            point: { terminal_id: pedido.terminalId, print_on_terminal: 'no_ticket' },
            payment_method: { default_type: TIPO_POR_MEDIO[pedido.medio] },
          },
        },
      });
      if (status < 200 || status >= 300) throw rechazo(status, datos);
      return leerOrden(datos, status);
    },

    async consultarOrden(ordenId: string): Promise<OrdenPoint> {
      const { status, datos } = await pedir('GET', `/v1/orders/${encodeURIComponent(ordenId)}`);
      if (status < 200 || status >= 300) throw rechazo(status, datos);
      return leerOrden(datos, status);
    },

    async cancelarOrden(ordenId: string): Promise<ResultadoCancelacion> {
      const { status, datos } = await pedir(
        'POST',
        `/v1/orders/${encodeURIComponent(ordenId)}/cancel`,
        // Sin este encabezado, una orden en la pantalla del Point responde 409.
        { encabezados: { 'x-allow-cancelable-status': 'at_terminal' } },
      );
      if (status === 202) return 'pedida';
      if (status >= 200 && status < 300) return 'cancelada';
      if (status === 409) return 'no_cancelable';
      throw rechazo(status, datos);
    },
  };
}
