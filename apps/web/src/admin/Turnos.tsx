import {
  comparar,
  MEDIOS_PAGO,
  NOMBRE_MEDIO,
  nombreMovimientoCaja,
  type TurnoDetalle,
  type TurnoResumen,
} from '@kiosco/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { formatearFechaHora, formatearHora } from '../lib/fechas.js';
import { formatearPesos } from '../lib/montos.js';

/** Diferencia con signo y color: faltante en rojo, sobrante en verde. */
function Diferencia({ monto }: { monto: string }) {
  const signo = comparar(monto, '0');
  const clase = signo < 0 ? 'text-red-700' : signo > 0 ? 'text-green-700' : 'text-slate-600';
  return (
    <span className={`font-semibold ${clase}`}>
      {signo > 0 ? '+' : ''}
      {formatearPesos(monto)}
    </span>
  );
}

/** Lista de turnos con sus diferencias, del más reciente al más antiguo. */
export function Turnos() {
  const {
    data: turnos,
    isPending,
    error,
  } = useQuery({
    queryKey: ['caja', 'turnos'],
    queryFn: () => pedir<TurnoResumen[]>('GET', '/caja/turnos'),
  });

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Turnos de caja</h1>
      {isPending && <p>Cargando turnos…</p>}
      <MensajeError error={error} />
      {turnos?.length === 0 && <p className="text-slate-600">Todavía no hay turnos.</p>}
      <ul className="space-y-3" aria-label="Turnos">
        {turnos?.map((t) => (
          <li key={t.id}>
            <Link
              to={`/admin/turnos/${t.id}`}
              className="block space-y-1 rounded-lg bg-white p-4 shadow hover:bg-slate-50"
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{t.responsable.nombre}</span>
                {t.diferencia === null ? (
                  <span className="rounded bg-green-100 px-2 py-0.5 text-sm text-green-900">
                    Abierto
                  </span>
                ) : (
                  <Diferencia monto={t.diferencia} />
                )}
              </span>
              <span className="block text-sm text-slate-600">
                {formatearFechaHora(t.abiertoEn)}
                {t.cerradoEn && ` a ${formatearHora(t.cerradoEn)}`}
                {t.cerradoPor && t.cerradoPor.id !== t.responsable.id && (
                  <> · cerró {t.cerradoPor.nombre}</>
                )}
              </span>
              {comparar(t.diferenciaApertura, '0') !== 0 && (
                <span className="block text-sm">
                  Diferencia de apertura: <Diferencia monto={t.diferenciaApertura} />
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Fila({ nombre, monto, signo }: { nombre: string; monto: string; signo?: '+' | '−' }) {
  return (
    <div className="flex justify-between gap-2 py-1">
      <dt>
        {signo && <span className="mr-1 inline-block w-3 text-slate-500">{signo}</span>}
        {nombre}
      </dt>
      <dd className="font-medium">{formatearPesos(monto)}</dd>
    </div>
  );
}

/** Detalle de un turno: cómo se llega al esperado, línea por línea. */
export function DetalleTurno() {
  const { id } = useParams();
  const {
    data: turno,
    isPending,
    error,
  } = useQuery({
    queryKey: ['caja', 'turnos', id],
    queryFn: () => pedir<TurnoDetalle>('GET', `/caja/turnos/${id}`),
  });

  if (isPending) return <p>Cargando turno…</p>;
  if (!turno) return <MensajeError error={error} />;
  const r = turno.resumen;

  return (
    <section className="space-y-4">
      <Link to="/admin/turnos" className="text-sm text-slate-600 underline">
        ← Turnos
      </Link>
      <h1 className="text-2xl font-semibold">Turno de {turno.responsable.nombre}</h1>
      <p className="text-slate-600">
        {formatearFechaHora(turno.abiertoEn)}
        {turno.cerradoEn ? ` a ${formatearHora(turno.cerradoEn)}` : ' · abierto'}
        {turno.cerradoPor && turno.cerradoPor.id !== turno.responsable.id && (
          <> · cerró {turno.cerradoPor.nombre}</>
        )}
      </p>

      <div className="rounded-lg bg-white p-4 shadow">
        <h2 className="mb-2 font-semibold">Ventas ({r.cantidadVentas})</h2>
        <dl className="divide-y">
          {MEDIOS_PAGO.map((m) => (
            <Fila key={m} nombre={NOMBRE_MEDIO[m]} monto={r.porMedio[m]} />
          ))}
        </dl>
      </div>

      <div className="rounded-lg bg-white p-4 shadow">
        <h2 className="mb-2 font-semibold">Efectivo</h2>
        <dl className="divide-y" aria-label="Cálculo del esperado">
          <Fila nombre="Inicial" monto={r.montoInicial} />
          <Fila nombre="Ventas en efectivo" monto={r.efectivoVendido} signo="+" />
          <Fila nombre="Ingresos" monto={r.ingresos} signo="+" />
          <Fila nombre="Gastos" monto={r.gastos} signo="−" />
          <Fila nombre="Retiros" monto={r.retiros} signo="−" />
          <Fila nombre="Devoluciones de anulaciones" monto={r.devoluciones} signo="−" />
          <div className="flex justify-between gap-2 py-1 text-lg font-semibold">
            <dt>Esperado</dt>
            <dd>{formatearPesos(r.esperado)}</dd>
          </div>
          {turno.montoContado !== null && <Fila nombre="Contado" monto={turno.montoContado} />}
          {turno.diferencia !== null && (
            <div className="flex justify-between gap-2 py-1 text-lg">
              <dt>Diferencia</dt>
              <dd>
                <Diferencia monto={turno.diferencia} />
              </dd>
            </div>
          )}
          {turno.retiroCierre !== null && (
            <Fila
              nombre={`Retiro al cierre (${turno.motivoRetiroCierre})`}
              monto={turno.retiroCierre}
            />
          )}
          {turno.quedoEnCaja !== null && <Fila nombre="Quedó en caja" monto={turno.quedoEnCaja} />}
        </dl>
        {comparar(turno.diferenciaApertura, '0') !== 0 && (
          <p className="mt-2 text-sm">
            Al abrir se sugirieron {formatearPesos(turno.montoSugerido)} y se contaron{' '}
            {formatearPesos(turno.montoInicial)}: diferencia de apertura{' '}
            <Diferencia monto={turno.diferenciaApertura} />.
          </p>
        )}
      </div>

      <div className="rounded-lg bg-white p-4 shadow">
        <h2 className="mb-2 font-semibold">Movimientos</h2>
        {turno.movimientos.length === 0 && <p className="text-sm text-slate-600">Ninguno.</p>}
        <ul className="divide-y text-sm" aria-label="Movimientos">
          {turno.movimientos.map((m) => (
            <li key={m.id} className="flex justify-between gap-2 py-1">
              <span>
                {formatearHora(m.creadoEn)} · {nombreMovimientoCaja(m)}: {m.motivo} (
                {m.usuario.nombre})
              </span>
              <span className="font-medium">{formatearPesos(m.monto)}</span>
            </li>
          ))}
        </ul>
      </div>

      {turno.anulaciones.length > 0 && (
        <div className="rounded-lg bg-white p-4 shadow">
          <h2 className="mb-2 font-semibold">Anulaciones devueltas en este turno</h2>
          <ul className="divide-y text-sm" aria-label="Anulaciones">
            {turno.anulaciones.map((a) => (
              <li key={a.ventaId} className="flex justify-between gap-2 py-1">
                <Link to={`/ventas/${a.ventaId}`} className="underline">
                  Venta #{a.numero} · {a.motivo}
                </Link>
                <span className="font-medium">{formatearPesos(a.efectivo)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
