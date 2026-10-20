import {
  NOMBRE_MEDIO,
  VENTAS_POR_PAGINA,
  type Anulacion,
  type VentaDetalle,
  type VentaResumen,
} from '@kiosco/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { useSesion } from '../app/sesion.js';
import { formatearFechaHora, formatearHora, hoyEnArgentina } from '../lib/fechas.js';
import { formatearPesos } from '../lib/montos.js';
import { useImpresionTicket } from '../pos/Ticket.js';

function Estado({ venta }: { venta: VentaResumen }) {
  return venta.estado === 'anulada' ? (
    <span className="rounded bg-red-100 px-2 py-0.5 text-sm text-red-800">Anulada</span>
  ) : (
    <span className="text-sm text-slate-600">Pagada</span>
  );
}

function medios(venta: VentaResumen): string {
  return venta.medios.map((m) => NOMBRE_MEDIO[m]).join(' + ');
}

/** Ventas del día (el admin puede elegir fechas), para reimprimir o anular. */
export function Ventas() {
  const { data: sesion } = useSesion();
  const esAdmin = sesion?.rol === 'admin';
  const hoy = hoyEnArgentina();
  const [params, setParams] = useSearchParams();
  const desde = (esAdmin && params.get('desde')) || hoy;
  const hasta = (esAdmin && params.get('hasta')) || desde;
  const [pagina, setPagina] = useState(1);

  const consulta = new URLSearchParams({ pagina: String(pagina) });
  if (esAdmin) {
    consulta.set('desde', desde);
    consulta.set('hasta', hasta);
  }
  const {
    data: ventas,
    isPending,
    error,
  } = useQuery({
    queryKey: ['ventas', 'lista', esAdmin ? desde : 'hoy', esAdmin ? hasta : 'hoy', pagina],
    queryFn: () => pedir<VentaResumen[]>('GET', `/ventas?${consulta}`),
    enabled: sesion !== undefined,
  });

  const cambiarFecha = (campo: 'desde' | 'hasta', valor: string) => {
    const siguiente = new URLSearchParams(params);
    siguiente.set(campo, valor);
    setParams(siguiente, { replace: true });
    setPagina(1);
  };

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{esAdmin ? 'Ventas' : 'Ventas de hoy'}</h1>

      {esAdmin && (
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Fechas">
          <label>
            <span className="text-sm font-medium">Desde</span>
            <input
              className="campo"
              type="date"
              value={desde}
              max={hoy}
              onChange={(e) => e.target.value && cambiarFecha('desde', e.target.value)}
            />
          </label>
          <label>
            <span className="text-sm font-medium">Hasta</span>
            <input
              className="campo"
              type="date"
              value={hasta}
              min={desde}
              max={hoy}
              onChange={(e) => e.target.value && cambiarFecha('hasta', e.target.value)}
            />
          </label>
        </div>
      )}

      {isPending && <p>Cargando ventas…</p>}
      <MensajeError error={error} />
      {ventas?.length === 0 && <p className="text-slate-600">No hay ventas en esas fechas.</p>}

      {/* Celular: tarjetas */}
      <ul className="space-y-3 md:hidden" aria-label="Ventas">
        {ventas?.map((v) => (
          <li key={v.id} className="rounded-lg bg-white shadow">
            <Link to={`/ventas/${v.id}`} className="block p-4">
              <span className={`font-medium ${v.estado === 'anulada' ? 'line-through' : ''}`}>
                #{v.numero} · {formatearPesos(v.total)}
              </span>
              <span className="block text-sm text-slate-600">
                {esAdmin ? formatearFechaHora(v.creadaEn) : formatearHora(v.creadaEn)} ·{' '}
                {v.usuario.nombre} · {medios(v)}
              </span>
              <Estado venta={v} />
            </Link>
          </li>
        ))}
      </ul>

      {/* Escritorio: tabla */}
      {ventas && ventas.length > 0 && (
        <table className="hidden w-full rounded-lg bg-white text-left shadow md:table">
          <thead className="border-b text-sm text-slate-600">
            <tr>
              <th className="p-3">N.º</th>
              <th className="p-3">{esAdmin ? 'Fecha' : 'Hora'}</th>
              <th className="p-3">Vendió</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3">Pago</th>
              <th className="p-3">Estado</th>
            </tr>
          </thead>
          <tbody>
            {ventas.map((v) => (
              <tr
                key={v.id}
                className={`border-b last:border-0 ${v.estado === 'anulada' ? 'text-slate-500' : ''}`}
              >
                <td className="p-3">
                  <Link
                    to={`/ventas/${v.id}`}
                    className={`text-blue-700 underline ${v.estado === 'anulada' ? 'line-through' : ''}`}
                  >
                    #{v.numero}
                  </Link>
                </td>
                <td className="p-3">
                  {esAdmin ? formatearFechaHora(v.creadaEn) : formatearHora(v.creadaEn)}
                </td>
                <td className="p-3">{v.usuario.nombre}</td>
                <td className={`p-3 text-right ${v.estado === 'anulada' ? 'line-through' : ''}`}>
                  {formatearPesos(v.total)}
                </td>
                <td className="p-3">{medios(v)}</td>
                <td className="p-3">
                  <Estado venta={v} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(pagina > 1 || ventas?.length === VENTAS_POR_PAGINA) && (
        <div className="flex gap-2">
          <button
            type="button"
            className="boton-secundario"
            disabled={pagina === 1}
            onClick={() => setPagina(pagina - 1)}
          >
            Más recientes
          </button>
          <button
            type="button"
            className="boton-secundario"
            disabled={ventas?.length !== VENTAS_POR_PAGINA}
            onClick={() => setPagina(pagina + 1)}
          >
            Más antiguas
          </button>
        </div>
      )}
    </section>
  );
}

function FormularioAnulacion({ venta }: { venta: VentaDetalle }) {
  const queryClient = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const anulacion = useMutation({
    mutationFn: (datos: Anulacion) =>
      pedir<VentaDetalle>('POST', `/ventas/${venta.id}/anular`, datos),
    onSuccess: (actualizada) => {
      queryClient.setQueryData(['ventas', 'detalle', venta.id], actualizada);
      void queryClient.invalidateQueries({ queryKey: ['ventas', 'lista'] });
      setAbierto(false);
    },
  });

  if (!abierto) {
    return (
      <button type="button" className="boton-secundario" onClick={() => setAbierto(true)}>
        Anular venta
      </button>
    );
  }

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    anulacion.mutate({ motivo });
  };

  return (
    <form
      onSubmit={enviar}
      aria-label="Anular venta"
      className="w-full space-y-3 rounded-lg bg-white p-4 shadow"
    >
      <label className="block">
        <span className="text-sm font-medium">Motivo de la anulación</span>
        <input
          className="campo"
          required
          minLength={3}
          maxLength={200}
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </label>
      <p className="text-sm text-slate-600">
        El stock vuelve a sumar lo vendido y se le avisa al admin.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="boton"
          disabled={anulacion.isPending || motivo.trim().length < 3}
        >
          Confirmar anulación
        </button>
        <button type="button" className="boton-secundario" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
        <MensajeError error={anulacion.error} />
      </div>
    </form>
  );
}

export function DetalleVenta() {
  const { id = '' } = useParams();
  const { imprimir, ticket } = useImpresionTicket();
  const {
    data: venta,
    isPending,
    error,
  } = useQuery({
    queryKey: ['ventas', 'detalle', id],
    queryFn: () => pedir<VentaDetalle>('GET', `/ventas/${id}`),
  });

  return (
    <section className="space-y-4">
      <Link to="/ventas" className="text-sm text-blue-700 underline">
        ← Volver a ventas
      </Link>
      {isPending && <p>Cargando venta…</p>}
      <MensajeError error={error} />
      {venta && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1
              className={`text-2xl font-semibold ${venta.estado === 'anulada' ? 'line-through' : ''}`}
            >
              Venta #{venta.numero}
            </h1>
            <Estado venta={venta} />
          </div>
          <p className="text-slate-700">
            {formatearFechaHora(venta.creadaEn)} · Vendió {venta.usuario.nombre}
          </p>
          {venta.anulacion && (
            <p className="rounded-lg bg-red-50 p-3 text-red-900">
              Anulada el {formatearFechaHora(venta.anulacion.en)} por {venta.anulacion.por.nombre}:{' '}
              {venta.anulacion.motivo}
            </p>
          )}

          <div className="overflow-x-auto rounded-lg bg-white shadow">
            <table className="w-full text-left" aria-label="Ítems de la venta">
              <thead className="border-b text-sm text-slate-600">
                <tr>
                  <th className="p-3">Producto</th>
                  <th className="p-3 text-right">Cant.</th>
                  <th className="p-3 text-right">Precio</th>
                  <th className="p-3 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {venta.items.map((item, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="p-3">{item.descripcion}</td>
                    <td className="p-3 text-right">{item.cantidad}</td>
                    <td className="p-3 text-right">{formatearPesos(item.precioUnitario)}</td>
                    <td className="p-3 text-right">{formatearPesos(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="flex justify-between border-t p-3 text-lg font-bold">
              <span>Total</span>
              <span>{formatearPesos(venta.total)}</span>
            </p>
          </div>

          <ul className="space-y-1 rounded-lg bg-white p-3 shadow" aria-label="Pagos">
            {venta.pagos.map((p) => (
              <li key={p.medio} className="flex flex-wrap justify-between gap-2">
                <span>{NOMBRE_MEDIO[p.medio]}</span>
                <span>
                  {formatearPesos(p.monto)}
                  {p.montoRecibido && p.vuelto && (
                    <span className="text-sm text-slate-600">
                      {' '}
                      (pagó {formatearPesos(p.montoRecibido)}, vuelto {formatearPesos(p.vuelto)})
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="boton-secundario" onClick={() => imprimir(venta)}>
              Reimprimir ticket
            </button>
            {venta.estado === 'pagada' && <FormularioAnulacion venta={venta} />}
          </div>
        </>
      )}
      {ticket}
    </section>
  );
}
