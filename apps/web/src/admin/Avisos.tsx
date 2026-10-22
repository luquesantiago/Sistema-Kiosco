import type { EstadoNotificacion, Notificacion } from '@kiosco/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { formatearFechaHora } from '../lib/fechas.js';

const CLAVE_AVISOS = ['notificaciones'] as const;

const ESTADO: Record<EstadoNotificacion, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente de envío', clase: 'bg-amber-100 text-amber-900' },
  enviada: { texto: 'Enviado', clase: 'bg-green-100 text-green-900' },
  error: { texto: 'Error al enviar', clase: 'bg-red-100 text-red-900' },
};

function Envio({ aviso }: { aviso: Notificacion }) {
  const queryClient = useQueryClient();
  const reintentar = useMutation({
    mutationFn: () => pedir<Notificacion>('POST', `/notificaciones/${aviso.id}/reintentar`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_AVISOS }),
  });

  if (aviso.estado === 'enviada' && aviso.enviadaEn) {
    return <p className="text-sm text-slate-600">Enviado {formatearFechaHora(aviso.enviadaEn)}</p>;
  }
  if (aviso.estado === 'pendiente' && aviso.intentos > 0) {
    return (
      <p className="text-sm text-slate-600">
        Falló {aviso.intentos === 1 ? '1 vez' : `${aviso.intentos} veces`}, se vuelve a intentar:{' '}
        {aviso.error}
      </p>
    );
  }
  if (aviso.estado !== 'error') return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm text-red-800">Motivo: {aviso.error}</p>
      <button
        type="button"
        className="boton-secundario"
        disabled={reintentar.isPending}
        onClick={() => reintentar.mutate()}
      >
        Reintentar
      </button>
      <MensajeError error={reintentar.error} />
    </div>
  );
}

/** Avisos para el admin, con su estado de envío por WhatsApp. */
export function Avisos() {
  const {
    data: avisos,
    isPending,
    error,
  } = useQuery({
    queryKey: CLAVE_AVISOS,
    queryFn: () => pedir<Notificacion[]>('GET', '/notificaciones'),
  });

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Avisos</h1>
      <p className="text-slate-600">
        Las anulaciones, los gastos y retiros de los empleados y cada cierre de turno dejan un aviso
        que se manda por WhatsApp. La conexión y el número se configuran en{' '}
        <Link to="/admin/whatsapp" className="text-blue-700 underline">
          WhatsApp
        </Link>
        .
      </p>
      {isPending && <p>Cargando avisos…</p>}
      <MensajeError error={error} />
      {avisos?.length === 0 && <p className="text-slate-600">No hay avisos.</p>}
      <ul className="space-y-3" aria-label="Avisos">
        {avisos?.map((a) => (
          <li key={a.id} className="space-y-2 rounded-lg bg-white p-4 shadow">
            <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-slate-600">{formatearFechaHora(a.creadaEn)}</span>
              <span className={`rounded px-2 py-0.5 ${ESTADO[a.estado].clase}`}>
                {ESTADO[a.estado].texto}
              </span>
            </p>
            <p className="whitespace-pre-wrap">{a.texto.replace(/\*/g, '')}</p>
            <Envio aviso={a} />
          </li>
        ))}
      </ul>
    </section>
  );
}
