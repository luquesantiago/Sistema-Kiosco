import type { ClienteArca, ComprobanteArca, PedidoCae } from '../src/integrations/arca/cliente.js';

/*
 * Cliente de ARCA en memoria, como `whatsapp-falso.ts`. Por defecto los
 * servidores están bien, el punto de venta 5 no tiene comprobantes y todo se
 * autoriza; cada test cambia lo que necesita.
 *
 * Contrato que fija este archivo (lo cumple `src/integrations/arca/cliente.ts`):
 * - `new ArcaNoDisponible(motivo, mensaje?)`, con `motivo: 'caido' | 'autenticacion_bloqueada'`.
 * - `new ArcaRechazo(codigo, mensaje)`.
 * - `PedidoCae` con los nombres del detalle de `FECAESolicitar` (ver `pedidoEsperado`).
 * - `ComprobanteArca` = `{ numero, fecha: 'AAAA-MM-DD', importe: '3300.50', cae, vencimiento: 'AAAA-MM-DD' }`.
 *
 * Los errores se importan al usarlos: mientras el módulo real no exista, este
 * archivo carga igual y fallan solo los tests que llegan a ARCA.
 */
const errores = () => import('../src/integrations/arca/cliente.js');

export const PUNTO_VENTA = 5;
export const TIPO_FACTURA_C = 11;
/** Primer CAE que entrega el falso; los siguientes suman 1. */
export const PRIMER_CAE = '76451234567890';
export const VENCIMIENTO_CAE = '2026-11-20';

/**
 * Falla programada para el próximo `solicitarCae` (`null`: ese sale bien).
 * `timeout_autorizado` autoriza y después tira `ArcaNoDisponible`: es el corte
 * después de que ARCA autorizó, con la respuesta perdida.
 */
export type FallaArca = 'rechazo' | 'no_disponible' | 'timeout_autorizado' | null;

export interface ComprobanteFalso extends ComprobanteArca {
  ptoVta: number;
  tipo: number;
}

/** "20261109" → "2026-11-09". */
function aFechaConGuiones(cbteFch: string): string {
  return `${cbteFch.slice(0, 4)}-${cbteFch.slice(4, 6)}-${cbteFch.slice(6, 8)}`;
}

export function crearArcaFalso({
  ultimo = 0,
  fechaUltimo = null as string | null,
  ptoVta = PUNTO_VENTA,
} = {}) {
  let siguienteCae = BigInt(PRIMER_CAE);
  const falso = {
    /** Lo que responde `FEDummy`. */
    servidores: 'ok' as 'ok' | 'caido',
    /** Simula `coe.alreadyAuthenticated`: todo lo que necesita ticket falla así. */
    autenticacionBloqueada: false,
    /** Fallas programadas para los próximos `solicitarCae`, en orden. */
    fallas: [] as FallaArca[],
    /** Todos los `solicitarCae` recibidos, salgan bien o no. */
    pedidos: [] as PedidoCae[],
    /** Números consultados con `FECompConsultar`. */
    consultas: [] as number[],
    /** Cada llamada al cliente, por nombre de método. */
    llamadas: [] as string[],
    /** Lo que ARCA tiene autorizado. */
    comprobantes: [] as ComprobanteFalso[],
    /** Último número y fecha por punto de venta (para Factura C). */
    ultimos: new Map<number, { numero: number; fecha: string | null }>([
      [ptoVta, { numero: ultimo, fecha: fechaUltimo }],
    ]),
    vencimiento: VENCIMIENTO_CAE,
    /** Agrega un comprobante ya autorizado en ARCA (por ejemplo, uno hecho a mano). */
    agregarComprobante(c: Partial<ComprobanteFalso> & { numero: number }) {
      const completo: ComprobanteFalso = {
        ptoVta,
        tipo: TIPO_FACTURA_C,
        fecha: '2026-11-09',
        importe: '1.00',
        cae: String(siguienteCae++),
        vencimiento: VENCIMIENTO_CAE,
        ...c,
      };
      falso.comprobantes.push(completo);
      const actual = falso.ultimos.get(completo.ptoVta);
      if (!actual || actual.numero < completo.numero) {
        falso.ultimos.set(completo.ptoVta, { numero: completo.numero, fecha: completo.fecha });
      }
      return completo;
    },
  };

  async function exigirServicio() {
    const { ArcaNoDisponible } = await errores();
    if (falso.servidores === 'caido') throw new ArcaNoDisponible('caido', 'ARCA no responde.');
    if (falso.autenticacionBloqueada) {
      throw new ArcaNoDisponible(
        'autenticacion_bloqueada',
        'ARCA ya dio un ticket de acceso que no está guardado.',
      );
    }
  }

  const cliente: ClienteArca = {
    async estadoServidores() {
      falso.llamadas.push('estadoServidores');
      return falso.servidores;
    },

    async ultimoAutorizado(pv: number, tipo: number) {
      falso.llamadas.push('ultimoAutorizado');
      await exigirServicio();
      expectFacturaC(tipo);
      const u = falso.ultimos.get(pv) ?? { numero: 0, fecha: null };
      return { numero: u.numero, fecha: u.numero === 0 ? null : u.fecha };
    },

    async consultar(pv: number, tipo: number, numero: number) {
      falso.llamadas.push('consultar');
      falso.consultas.push(numero);
      await exigirServicio();
      const c = falso.comprobantes.find(
        (x) => x.ptoVta === pv && x.tipo === tipo && x.numero === numero,
      );
      if (!c) return null;
      return {
        numero: c.numero,
        fecha: c.fecha,
        importe: c.importe,
        cae: c.cae,
        vencimiento: c.vencimiento,
      };
    },

    async solicitarCae(pedido: PedidoCae) {
      falso.llamadas.push('solicitarCae');
      falso.pedidos.push(pedido);
      const falla = falso.fallas.shift() ?? null;
      await exigirServicio();
      const { ArcaNoDisponible, ArcaRechazo } = await errores();
      if (falla === 'no_disponible') throw new ArcaNoDisponible('caido', 'Timeout de 15 s.');
      if (falla === 'rechazo') {
        throw new ArcaRechazo('10016', 'Rechazo de prueba: el comprobante no cumple una regla.');
      }
      // Como ARCA: solo acepta el número siguiente al último autorizado.
      const ultimoActual = falso.ultimos.get(pedido.PtoVta) ?? { numero: 0, fecha: null };
      if (pedido.CbteDesde !== ultimoActual.numero + 1 || pedido.CbteHasta !== pedido.CbteDesde) {
        throw new ArcaRechazo(
          '10016',
          `El número ${pedido.CbteDesde} no es el siguiente al último autorizado (${ultimoActual.numero}).`,
        );
      }
      const autorizado = falso.agregarComprobante({
        ptoVta: pedido.PtoVta,
        tipo: pedido.CbteTipo,
        numero: pedido.CbteDesde,
        fecha: aFechaConGuiones(pedido.CbteFch),
        importe: pedido.ImpTotal,
      });
      if (falla === 'timeout_autorizado') {
        // ARCA autorizó, pero la respuesta no llegó.
        throw new ArcaNoDisponible('caido', 'Timeout de 15 s.');
      }
      return { cae: autorizado.cae, vencimiento: autorizado.vencimiento };
    },
  };

  return { falso, cliente };
}

function expectFacturaC(tipo: number) {
  if (tipo !== TIPO_FACTURA_C) throw new Error(`Tipo de comprobante inesperado: ${tipo}`);
}

/**
 * Pedido completo de una Factura C a consumidor final sin identificar, con los
 * datos del spec. Los importes van como texto con 2 decimales.
 */
export function pedidoEsperado({
  numero,
  cbteFch,
  importe,
  ptoVta = PUNTO_VENTA,
}: {
  numero: number;
  cbteFch: string;
  importe: string;
  ptoVta?: number;
}): PedidoCae {
  return {
    PtoVta: ptoVta,
    CbteTipo: 11,
    Concepto: 1,
    DocTipo: 99,
    DocNro: 0,
    CbteDesde: numero,
    CbteHasta: numero,
    CbteFch: cbteFch,
    ImpTotal: importe,
    ImpTotConc: '0.00',
    ImpNeto: importe,
    ImpOpEx: '0.00',
    ImpIVA: '0.00',
    ImpTrib: '0.00',
    MonId: 'PES',
    MonCotiz: 1,
    CondicionIVAReceptorId: 5,
  };
}
