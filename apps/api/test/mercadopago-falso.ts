import {
  type ClienteMercadoPago,
  MercadoPagoNoDisponible,
  MercadoPagoRechazo,
  type SaldoLeido,
} from '../src/integrations/mercadopago/cliente.js';

/*
 * Órdenes Point (cambio cobro-mercado-pago). Contrato que fija este archivo y
 * que cumple `ClienteMercadoPago` en `src/integrations/mercadopago/cliente.ts`
 * (el design nombra las operaciones pero no sus tipos; se eligió lo más simple):
 *
 * - `crearOrden(pedido: PedidoOrden): Promise<OrdenPoint>`: `POST /v1/orders` con
 *   `X-Idempotency-Key = pedido.claveIdempotencia`. Repetir la clave devuelve la
 *   misma orden (así se comporta MP).
 * - `consultarOrden(ordenId): Promise<OrdenPoint>`: `GET /v1/orders/{id}`.
 * - `cancelarOrden(ordenId): Promise<ResultadoCancelacion>`: `200` → `'cancelada'`,
 *   `202` → `'pedida'` (la orden estaba en la pantalla del Point), `409` → `'no_cancelable'`.
 * - El cliente ya traduce el estado de MP (tabla del design) a `EstadoOrden`, y deja el
 *   `status_detail` en `detalle` y el tipo de pago que informó MP en `tipoInformado`.
 * - Errores: `MercadoPagoNoDisponible` (red, timeout de 10 s o 5xx) y `MercadoPagoRechazo`
 *   con `codigo` `'terminal_ocupada'` (`409 already_queued_order_for_terminal`) o
 *   `'monto_invalido'` (`400` por el monto, por ejemplo `minimum_amount_not_met`).
 */

/** Estado de una orden Point ya traducido por el cliente (ver la tabla del design). */
export type EstadoOrden =
  | 'en_espera'
  | 'cancelando'
  | 'aprobado'
  | 'rechazado'
  | 'vencido'
  | 'cancelado'
  | 'a_revisar';

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
  /** `status_detail` de MP (por ejemplo `insufficient_amount`), o null. */
  detalle: string | null;
  /** Tipo de pago que informó MP (`debit_card`, `credit_card`, `qr`...), o null. */
  tipoInformado: string | null;
  referenciaExterna: string;
}

export type ResultadoCancelacion = 'cancelada' | 'pedida' | 'no_cancelable';

/** Falla programada de `crearOrden`. */
export type FallaCrear =
  | null
  | 'no_responde'
  /** La orden llega a MP pero la respuesta se pierde (timeout después de crearla). */
  | 'no_responde_pero_creada'
  | { status: number; codigo: string };

interface OrdenFalsa extends OrdenPoint {
  clave: string;
  monto: string;
  medio: MedioPoint;
  terminalId: string;
  /** La terminal ya la tomó: cancelarla es asíncrono (`202`). */
  enTerminal: boolean;
}

/**
 * Cliente de Mercado Pago en memoria. Por defecto responde enseguida con
 * $250.000,00 disponibles y $40.000,00 a liberar; cada test cambia lo que necesita.
 * Las órdenes nacen `en_espera` y sin tomar por la terminal.
 */
export function crearMercadoPagoFalso() {
  let siguiente = 1;
  const ordenes: OrdenFalsa[] = [];
  const falso = {
    saldo: { disponible: '250000.00', aLiberar: '40000.00' } as SaldoLeido,
    /** Cuánto tarda en contestar (con timers falsos de Vitest se adelanta a mano). */
    demoraMs: 0,
    /**
     * Falla de las próximas consultas, después de la demora:
     * `'no_responde'` (red, timeout o 5xx) o un número de estado HTTP 4xx (rechazo).
     */
    falla: null as null | 'no_responde' | number,
    /** No contesta nunca (la promesa queda pendiente). */
    colgado: false,
    /** Cuántas veces se le pidió el saldo. */
    llamadas: 0,

    // --- Órdenes Point ---
    /** Las órdenes que existen "en MP", en el orden en que se crearon. */
    ordenes: ordenes as readonly OrdenPoint[],
    /** Cada `crearOrden` recibido, salga bien o no (incluidos los repetidos). */
    pedidosCreacion: [] as PedidoOrden[],
    /** Ids pedidos a `consultarOrden`, en orden. */
    consultas: [] as string[],
    /** Ids pedidos a `cancelarOrden`, en orden. */
    cancelaciones: [] as string[],
    fallaCrear: null as FallaCrear,
    fallaConsultar: null as null | 'no_responde',
    fallaCancelar: null as null | 'no_responde',
    /** Si es true, las órdenes nuevas nacen ya tomadas por la terminal. */
    nacenEnTerminal: false,

    /** Programa lo que va a informar MP de una orden en las próximas consultas. */
    fijar(ordenId: string, cambios: Partial<Omit<OrdenFalsa, 'id' | 'clave'>>) {
      const orden = ordenes.find((o) => o.id === ordenId);
      if (!orden) throw new Error(`El falso no tiene la orden ${ordenId}`);
      Object.assign(orden, cambios);
    },
    /** Pago aprobado con el tipo informado según el medio pedido. */
    aprobar(ordenId: string) {
      const orden = ordenes.find((o) => o.id === ordenId);
      const tipo = { debito: 'debit_card', credito: 'credit_card', mercado_pago: 'qr' } as const;
      falso.fijar(ordenId, {
        estado: 'aprobado',
        detalle: 'accredited',
        tipoInformado: orden ? tipo[orden.medio] : null,
      });
    },
    ultimaOrden(): OrdenPoint {
      const orden = ordenes.at(-1);
      if (!orden) throw new Error('El falso no tiene órdenes');
      return orden;
    },
  };

  const esperar = async () => {
    if (falso.colgado) await new Promise(() => {});
    if (falso.demoraMs > 0) await new Promise((listo) => setTimeout(listo, falso.demoraMs));
  };
  const noResponde = () => new MercadoPagoNoDisponible('Mercado Pago no responde.');
  const copia = ({ id, estado, detalle, tipoInformado, referenciaExterna }: OrdenFalsa) => ({
    id,
    estado,
    detalle,
    tipoInformado,
    referenciaExterna,
  });
  const buscar = (ordenId: string) => {
    const orden = ordenes.find((o) => o.id === ordenId);
    if (!orden) throw new MercadoPagoRechazo(404, 'orden_inexistente');
    return orden;
  };

  const completo = {
    async saldo(): Promise<SaldoLeido> {
      falso.llamadas += 1;
      if (falso.colgado) return new Promise<SaldoLeido>(() => {});
      if (falso.demoraMs > 0) {
        await new Promise((listo) => setTimeout(listo, falso.demoraMs));
      }
      if (falso.falla === 'no_responde') {
        throw new MercadoPagoNoDisponible('Mercado Pago no responde.');
      }
      if (typeof falso.falla === 'number') {
        // El código imita el detalle interno que manda MP: nunca tiene que llegar a la web.
        throw new MercadoPagoRechazo(falso.falla, 'detalle-interno-de-mp');
      }
      return { ...falso.saldo };
    },

    async crearOrden(pedido: PedidoOrden): Promise<OrdenPoint> {
      falso.pedidosCreacion.push({ ...pedido });
      await esperar();
      const falla = falso.fallaCrear;
      if (falla === 'no_responde') throw noResponde();
      if (falla !== null && typeof falla === 'object') {
        throw new MercadoPagoRechazo(falla.status, falla.codigo);
      }
      // Idempotencia: la misma clave devuelve la misma orden, sin crear otra.
      let orden = ordenes.find((o) => o.clave === pedido.claveIdempotencia);
      if (!orden) {
        orden = {
          id: `ORD0000000000${siguiente++}`,
          clave: pedido.claveIdempotencia,
          estado: 'en_espera',
          detalle: null,
          tipoInformado: null,
          referenciaExterna: pedido.referenciaExterna,
          monto: pedido.monto,
          medio: pedido.medio,
          terminalId: pedido.terminalId,
          enTerminal: falso.nacenEnTerminal,
        };
        ordenes.push(orden);
      }
      if (falla === 'no_responde_pero_creada') throw noResponde();
      return copia(orden);
    },

    async consultarOrden(ordenId: string): Promise<OrdenPoint> {
      falso.consultas.push(ordenId);
      await esperar();
      if (falso.fallaConsultar === 'no_responde') throw noResponde();
      return copia(buscar(ordenId));
    },

    async cancelarOrden(ordenId: string): Promise<ResultadoCancelacion> {
      falso.cancelaciones.push(ordenId);
      await esperar();
      if (falso.fallaCancelar === 'no_responde') throw noResponde();
      const orden = buscar(ordenId);
      if (orden.estado !== 'en_espera' && orden.estado !== 'cancelando') return 'no_cancelable';
      if (orden.enTerminal) {
        orden.estado = 'cancelando';
        orden.detalle = 'cancellation_requested';
        return 'pedida';
      }
      orden.estado = 'cancelado';
      return 'cancelada';
    },
  };

  // Asignado desde una variable (no un literal) para que el falso pueda tener las
  // operaciones de órdenes antes de que la interfaz real las declare.
  const cliente: ClienteMercadoPago = completo;

  return { falso, cliente };
}

export type MercadoPagoFalso = ReturnType<typeof crearMercadoPagoFalso>['falso'];
