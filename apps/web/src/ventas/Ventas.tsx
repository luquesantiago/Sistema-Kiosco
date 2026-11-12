import {
  comparar,
  NOMBRE_MEDIO,
  restar,
  sumar,
  VENTAS_POR_PAGINA,
  type Anulacion,
  type FacturaVenta,
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

/** "Factura" si todo está facturado y autorizado, "Factura parcial" si solo una parte. */
function MarcaFactura({ venta }: { venta: VentaResumen }) {
  const facturado = venta.importeFacturado ?? '0.00';
  if (comparar(facturado, 0) <= 0) return null;
  const completa = comparar(facturado, venta.total) >= 0;
  return (
    <span className="ml-2 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-900">
      {completa ? 'Factura' : 'Factura parcial'}
    </span>
  );
}

/** Cómo se lee el estado de una factura en el detalle. */
function textoFactura(f: FacturaVenta): string {
  if (f.estado === 'autorizada') return `Factura C ${f.numero}`;
  if (f.estado === 'pendiente' || f.estado === 'en_curso') return 'En trámite';
  if (f.estado === 'error') return 'Con error (la revisa el admin)';
  return 'Cancelada';
}

/** Facturas de la venta, lo que quedó sin facturar y el pedido de la factura del efectivo. */
function FacturasDeLaVenta({ venta }: { venta: VentaDetalle }) {
  const queryClient = useQueryClient();
  const pedido = useMutation({
    mutationFn: () => pedir<FacturaVenta>('POST', `/ventas/${venta.id}/factura`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ventas'] }),
  });
  const facturas = venta.facturas ?? [];
  // Sin facturación configurada y sin facturas, no hay nada que mostrar.
  if (!venta.emisor && facturas.length === 0) return null;

  const enTramite = sumar(
    '0',
    ...facturas
      .filter((f) => f.estado === 'pendiente' || f.estado === 'en_curso')
      .map((f) => f.importe),
  );
  const sinFacturar = restar(venta.sinFacturar ?? '0', enTramite);
  const puedePedir = venta.estado === 'pagada' && venta.puedePedirFactura === true;

  return (
    <section className="space-y-2 rounded-lg bg-white p-3 shadow">
      <h2 className="font-semibold">Factura</h2>
      {facturas.length === 0 ? (
        <p className="text-slate-600">Sin factura.</p>
      ) : (
        <ul className="space-y-1" aria-label="Facturas">
          {facturas.map((f) => (
            <li key={f.id} className="flex flex-wrap justify-between gap-2">
              <span>
                {textoFactura(f)}
                {f.estado === 'autorizada' && f.cae && (
                  <span className="text-sm text-slate-600">
                    {' '}
                    · CAE {f.cae}
                    {f.caeVencimiento &&
                      ` · vence ${f.caeVencimiento.split('-').reverse().join('/')}`}
                  </span>
                )}
              </span>
              <span>{formatearPesos(f.importe)}</span>
            </li>
          ))}
        </ul>
      )}
      {facturas.length > 0 && comparar(sinFacturar, 0) > 0 && (
        <p className="text-slate-600">Sin facturar: {formatearPesos(sinFacturar)}</p>
      )}
      {puedePedir && (
        <button
          type="button"
          className="boton-secundario"
          disabled={pedido.isPending}
          onClick={() => pedido.mutate()}
        >
          Pedir factura
        </button>
      )}
      <MensajeError error={pedido.error} />
    </section>
  );
}

/** Antes de anular: las facturas autorizadas siguen vigentes y no hay nota de crédito. */
function AvisoFacturasVigentes({ venta }: { venta: VentaDetalle }) {
  const vigentes = (venta.facturas ?? []).filter((f) => f.estado === 'autorizada');
  if (vigentes.length === 0) return null;
  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <ul>
        {vigentes.map((f) => (
          <li key={f.id}>
            Factura C {f.numero} por {formatearPesos(f.importe)}: sigue vigente en ARCA.
          </li>
        ))}
      </ul>
      <p>El sistema no hace notas de crédito: la nota de crédito se hace por fuera.</p>
    </div>
  );
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
              <MarcaFactura venta={v} />
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
                  <MarcaFactura venta={v} />
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
      <AvisoFacturasVigentes venta={venta} />
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
  const { imprimirConFactura, ticket } = useImpresionTicket();
  const {
    data: venta,
    isPending,
    error,
  } = useQuery({
    queryKey: ['ventas', 'detalle', id],
    queryFn: () => pedir<VentaDetalle>('GET', `/ventas/${id}`),
  });
  // La API manda el costo solo al admin: si viene, se muestra la columna.
  const conCostos = venta?.items.some((i) => i.costoUnitario !== undefined) ?? false;

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
                  {conCostos && <th className="p-3 text-right">Costo</th>}
                  <th className="p-3 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {venta.items.map((item, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="p-3">{item.descripcion}</td>
                    <td className="p-3 text-right">{item.cantidad}</td>
                    <td className="p-3 text-right">{formatearPesos(item.precioUnitario)}</td>
                    {conCostos && (
                      <td className="p-3 text-right text-slate-600">
                        {item.costoUnitario ? formatearPesos(item.costoUnitario) : '—'}
                      </td>
                    )}
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

          <FacturasDeLaVenta venta={venta} />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="boton-secundario"
              onClick={() => void imprimirConFactura(venta)}
            >
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
