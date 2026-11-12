import {
  ERRORES_FACTURA_NO_REINTENTABLES,
  type EstadoConexionArca,
  type EstadoFacturacion,
  type FacturaListado,
  formatearNumeroComprobante,
} from '@kiosco/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { formatearPesos } from '../lib/montos.js';

export const CLAVE_FACTURACION = ['facturacion'] as const;

/** Estado de la facturación: se refresca cada 30 s (la cola avanza sola). */
export function useEstadoFacturacion() {
  return useQuery({
    queryKey: CLAVE_FACTURACION,
    queryFn: () => pedir<EstadoFacturacion>('GET', '/facturacion'),
    refetchInterval: 30_000,
  });
}

const CONEXION: Record<
  Exclude<EstadoConexionArca, 'no_configurado'>,
  { texto: string; color: string }
> = {
  disponible: { texto: 'ARCA disponible', color: 'bg-green-600' },
  no_disponible: {
    texto: 'ARCA no disponible: las facturas esperan sin gastar intentos',
    color: 'bg-red-600',
  },
  autenticacion_bloqueada: {
    texto:
      'Autenticación bloqueada: ARCA ya dio un ticket de acceso que se perdió. Se destraba solo cuando vence (hasta 12 h)',
    color: 'bg-amber-500',
  },
};

const ESTADO_FACTURA: Record<FacturaListado['estado'], string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  autorizada: 'Autorizada',
  error: 'Con error',
  cancelada: 'Cancelada',
};

const PARTE: Record<FacturaListado['parte'], string> = {
  electronica: 'Tarjeta / MP',
  efectivo: 'Efectivo',
};

const sePuedeReintentar = (f: FacturaListado) =>
  f.estado === 'error' &&
  !(ERRORES_FACTURA_NO_REINTENTABLES as readonly string[]).includes(f.codigoError ?? '');

function Reintentar({ factura }: { factura: FacturaListado }) {
  const queryClient = useQueryClient();
  const reintento = useMutation({
    mutationFn: () => pedir<FacturaListado>('POST', `/facturas/${factura.id}/reintentar`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_FACTURACION }),
  });
  return (
    <>
      <button
        type="button"
        className="boton-secundario"
        disabled={reintento.isPending}
        onClick={() => reintento.mutate()}
      >
        Reintentar
      </button>
      <MensajeError error={reintento.error} />
    </>
  );
}

/** Administración → Facturación: conexión con ARCA y facturas trabadas. */
export function Facturacion() {
  const { data: estado, isPending, error } = useEstadoFacturacion();

  if (!estado) {
    return (
      <section className="space-y-4">
        {isPending && <p>Consultando la facturación…</p>}
        <MensajeError error={error} />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Facturación</h1>
      <MensajeError error={error} />
      {estado.estado === 'no_configurado' && (
        <p className="rounded-lg bg-white p-4 shadow">
          La facturación con ARCA no está configurada en el servidor (faltan las variables{' '}
          <code>ARCA_*</code>). Las ventas se registran igual, sin factura.
        </p>
      )}
      {estado.estado !== 'no_configurado' && (
        <>
          <section className="space-y-2 rounded-lg bg-white p-4 shadow">
            {estado.entorno === 'homologacion' && (
              <p className="rounded bg-amber-100 p-2 text-lg font-bold text-amber-900">
                HOMOLOGACIÓN: las facturas son de prueba, sin validez fiscal
              </p>
            )}
            <p className="flex items-center gap-2">
              <span className={`size-3 rounded-full ${CONEXION[estado.estado].color}`} />
              {CONEXION[estado.estado].texto}
            </p>
            <p>
              Punto de venta: {String(estado.puntoVenta ?? 0).padStart(5, '0')} · Último número
              autorizado:{' '}
              {estado.ultimoNumero
                ? formatearNumeroComprobante(estado.puntoVenta ?? 0, estado.ultimoNumero)
                : 'ninguno todavía'}
            </p>
            <p className="text-slate-600">
              {estado.pendientes ?? 0} en cola · {estado.enError ?? 0} con error
            </p>
          </section>

          {(estado.facturas ?? []).length === 0 ? (
            <p className="text-slate-600">No hay facturas trabadas.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg bg-white shadow">
              <table className="w-full text-left" aria-label="Facturas trabadas">
                <thead className="border-b text-sm text-slate-600">
                  <tr>
                    <th className="p-3">Venta</th>
                    <th className="p-3">Parte</th>
                    <th className="p-3 text-right">Importe</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3 text-right">Intentos</th>
                    <th className="p-3">Motivo</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {(estado.facturas ?? []).map((f) => (
                    <tr key={f.id} className="border-b last:border-0">
                      <td className="p-3">
                        <Link to={`/ventas/${f.ventaId}`} className="text-blue-700 underline">
                          #{f.ventaNumero}
                        </Link>
                      </td>
                      <td className="p-3">{PARTE[f.parte]}</td>
                      <td className="p-3 text-right">{formatearPesos(f.importe)}</td>
                      <td className="p-3">{ESTADO_FACTURA[f.estado]}</td>
                      <td className="p-3 text-right">{f.intentos}</td>
                      <td className="p-3 text-sm">{f.error}</td>
                      <td className="p-3">{sePuedeReintentar(f) && <Reintentar factura={f} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Cartel del panel del admin: hay facturas con error que nadie va a reintentar solo. */
export function CartelFacturacion() {
  const { data: estado } = useEstadoFacturacion();
  const enError = estado?.estado === 'no_configurado' ? 0 : (estado?.enError ?? 0);
  if (enError === 0) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4">
      <p>
        <strong>{enError === 1 ? '1 factura con error.' : `${enError} facturas con error.`}</strong>{' '}
        Revisalas para que se emitan o resolvelas por fuera.
      </p>
      <Link to="/admin/facturacion" className="text-blue-700 underline">
        Ir a Facturación
      </Link>
    </div>
  );
}
