import {
  NOMBRE_MOTIVO_SALDO,
  textoSaldoNoDisponible,
  type SaldoMercadoPago as Saldo,
} from '@kiosco/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { pedir } from '../api/cliente.js';
import { formatearHora } from '../lib/fechas.js';
import { formatearPesos } from '../lib/montos.js';

type SaldoLeido = Extract<Saldo, { estado: 'disponible' }>;

const UN_MINUTO = 60_000;

/**
 * Saldo de la cuenta de Mercado Pago, con su propia consulta: si MP tarda o la
 * consulta falla, el resto de la pantalla no espera. Se refresca solo cada 60 s,
 * igual que la caché de la API.
 */
export function useSaldoMercadoPago() {
  return useQuery({
    queryKey: ['mercado-pago', 'saldo'],
    queryFn: () => pedir<Saldo>('GET', '/mercado-pago/saldo'),
    staleTime: UN_MINUTO,
    refetchInterval: UN_MINUTO,
  });
}

/** Saldo desactualizado: en gris, con el motivo a la vista. */
function MarcaDesactualizado({ saldo, conHora }: { saldo: SaldoLeido; conHora: boolean }) {
  if (!saldo.desactualizado) return null;
  const motivo = saldo.motivo ? NOMBRE_MOTIVO_SALDO[saldo.motivo] : 'no se pudo volver a leer';
  return (
    <span className="block text-sm text-slate-500">
      Desactualizado{conHora && ` (actualizado a las ${formatearHora(saldo.leidoEn)})`}: {motivo}
    </span>
  );
}

function ALiberar({ saldo }: { saldo: SaldoLeido }) {
  if (saldo.aLiberar === null) return null;
  return (
    <span className="block text-sm text-slate-600">a liberar {formatearPesos(saldo.aLiberar)}</span>
  );
}

/**
 * El saldo para Administración → Mercado Pago y el dashboard: el disponible en
 * grande, lo a liberar chico debajo y la hora de la lectura.
 */
export function DetalleSaldoMercadoPago({ consulta }: { consulta: UseQueryResult<Saldo> }) {
  const { data: saldo, isPending, isError } = consulta;
  if (isPending) return <p className="text-sm text-slate-600">Cargando saldo…</p>;
  if (isError) return <p className="text-slate-600">Saldo no disponible</p>;
  if (saldo.estado === 'no_configurado') {
    return <p className="text-slate-600">Mercado Pago no configurado</p>;
  }
  if (saldo.estado === 'no_disponible') {
    return <p className="text-slate-600">{textoSaldoNoDisponible(saldo.motivo)}</p>;
  }
  return (
    <div>
      <span className={`block text-2xl font-bold ${saldo.desactualizado ? 'text-slate-500' : ''}`}>
        {formatearPesos(saldo.disponible)}
      </span>
      <ALiberar saldo={saldo} />
      <span className="block text-sm text-slate-600">
        actualizado a las {formatearHora(saldo.leidoEn)}
      </span>
      <MarcaDesactualizado saldo={saldo} conHora={false} />
    </div>
  );
}

/**
 * Línea del saldo en Caja (F8): "Mercado Pago: $ 250.000,00 (10:00)". Si no está
 * configurado o la consulta todavía no llegó (o falló), no se muestra nada.
 */
export function LineaSaldoMercadoPago() {
  const { data: saldo } = useSaldoMercadoPago();
  if (!saldo || saldo.estado === 'no_configurado') return null;
  if (saldo.estado === 'no_disponible') {
    return <p className="text-sm text-slate-600">{textoSaldoNoDisponible(saldo.motivo)}</p>;
  }
  return (
    <div className="text-sm">
      <p className={saldo.desactualizado ? 'text-slate-500' : ''}>
        Mercado Pago: <strong>{formatearPesos(saldo.disponible)}</strong> (
        {formatearHora(saldo.leidoEn)})
      </p>
      <ALiberar saldo={saldo} />
      <MarcaDesactualizado saldo={saldo} conHora />
    </div>
  );
}
