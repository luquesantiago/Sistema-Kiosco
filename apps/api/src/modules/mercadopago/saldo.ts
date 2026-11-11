import type { MotivoSaldoNoDisponible, SaldoMercadoPago } from '@kiosco/shared';
import {
  type ClienteMercadoPago,
  MercadoPagoNoDisponible,
  MercadoPagoRechazo,
  type SaldoLeido,
} from '../../integrations/mercadopago/cliente.js';

const VIGENCIA_MS = 60_000;

function motivoDeFalla(error: unknown): MotivoSaldoNoDisponible | null {
  if (error instanceof MercadoPagoNoDisponible) return 'no_responde';
  if (error instanceof MercadoPagoRechazo) {
    return error.status === 401 || error.status === 403 ? 'credenciales' : 'rechazo';
  }
  return null;
}

/**
 * Saldo de Mercado Pago con caché en memoria: el último saldo bueno se reutiliza
 * mientras tenga menos de `vigenciaMs` (contados desde que llegó la respuesta).
 * Las consultas simultáneas comparten una sola llamada a MP, y las fallas no se
 * guardan: la próxima consulta vuelve a intentar.
 */
export function crearServicioSaldo({
  cliente,
  ahora,
  vigenciaMs = VIGENCIA_MS,
}: {
  /** Sin cliente (no hay MP_ACCESS_TOKEN), el saldo es `no_configurado`. */
  cliente: ClienteMercadoPago | undefined;
  ahora: () => Date;
  vigenciaMs?: number;
}) {
  let ultimo: (SaldoLeido & { leidoEn: Date }) | null = null;
  let enCurso: Promise<SaldoMercadoPago> | null = null;

  const comoRespuesta = (saldo: SaldoLeido & { leidoEn: Date }) =>
    ({
      estado: 'disponible',
      disponible: saldo.disponible,
      aLiberar: saldo.aLiberar,
      leidoEn: saldo.leidoEn.toISOString(),
      desactualizado: false,
    }) as const;

  async function consultar(c: ClienteMercadoPago): Promise<SaldoMercadoPago> {
    try {
      const leido = await c.saldo();
      ultimo = { disponible: leido.disponible, aLiberar: leido.aLiberar, leidoEn: ahora() };
      return comoRespuesta(ultimo);
    } catch (error) {
      const motivo = motivoDeFalla(error);
      // Un error que no es de MP es un bug: que salga como error interno.
      if (motivo === null) throw error;
      if (ultimo) return { ...comoRespuesta(ultimo), desactualizado: true, motivo };
      return { estado: 'no_disponible', motivo };
    }
  }

  return {
    async obtener(): Promise<SaldoMercadoPago> {
      if (!cliente) return { estado: 'no_configurado' };
      if (ultimo && ahora().getTime() - ultimo.leidoEn.getTime() < vigenciaMs) {
        return comoRespuesta(ultimo);
      }
      enCurso ??= consultar(cliente).finally(() => {
        enCurso = null;
      });
      return enCurso;
    },
  };
}
