import type { EstadoNotificacion, Notificacion } from '@kiosco/shared';
import { useQuery } from '@tanstack/react-query';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { formatearFechaHora } from '../lib/fechas.js';

const ESTADO: Record<EstadoNotificacion, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente de envío', clase: 'bg-amber-100 text-amber-900' },
  enviada: { texto: 'Enviado', clase: 'bg-green-100 text-green-900' },
  error: { texto: 'Error al enviar', clase: 'bg-red-100 text-red-900' },
};

/** Avisos para el admin. El envío por WhatsApp llega con el cambio `envio-whatsapp`. */
export function Avisos() {
  const {
    data: avisos,
    isPending,
    error,
  } = useQuery({
    queryKey: ['notificaciones'],
    queryFn: () => pedir<Notificacion[]>('GET', '/notificaciones'),
  });

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Avisos</h1>
      <p className="text-slate-600">
        Las anulaciones, los gastos y retiros de los empleados y cada cierre de turno dejan un
        aviso. Por ahora se ven acá; el envío por WhatsApp se suma más adelante.
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
          </li>
        ))}
      </ul>
    </section>
  );
}
