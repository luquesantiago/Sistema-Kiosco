import { INGRESOS_POR_PAGINA, type IngresoDetalle, type IngresoListado } from '@kiosco/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { formatearFechaHora } from '../lib/fechas.js';
import { formatearPesos } from '../lib/montos.js';

/** Lista de ingresos de mercadería, del más reciente al más antiguo. */
export function Ingresos() {
  const [pagina, setPagina] = useState(1);
  const {
    data: ingresos,
    isPending,
    error,
  } = useQuery({
    queryKey: ['stock', 'ingresos', pagina],
    queryFn: () => pedir<IngresoListado[]>('GET', `/stock/ingresos?pagina=${pagina}`),
  });

  return (
    <section className="space-y-4">
      <Link to="/admin/stock" className="text-sm text-blue-700 underline">
        ← Volver a stock
      </Link>
      <h1 className="text-2xl font-semibold">Ingresos de mercadería</h1>
      {isPending && <p>Cargando ingresos…</p>}
      <MensajeError error={error} />
      {ingresos?.length === 0 && <p className="text-slate-600">Todavía no hay ingresos.</p>}

      {/* Celular: tarjetas */}
      <ul className="space-y-3 md:hidden" aria-label="Ingresos">
        {ingresos?.map((i) => (
          <li key={i.id} className="rounded-lg bg-white shadow">
            <Link to={`/admin/stock/ingresos/${i.id}`} className="block p-4">
              <span className="font-medium">{formatearFechaHora(i.creadoEn)}</span>
              <span className="block text-sm text-slate-600">
                {i.proveedor?.nombre ?? 'Sin proveedor'} · {i.cantidadProductos} productos ·{' '}
                {i.usuario.nombre}
              </span>
              {i.nota && <span className="block text-sm text-slate-600">{i.nota}</span>}
            </Link>
          </li>
        ))}
      </ul>

      {/* Escritorio: tabla */}
      {ingresos && ingresos.length > 0 && (
        <table className="hidden w-full rounded-lg bg-white text-left shadow md:table">
          <thead className="border-b text-sm text-slate-600">
            <tr>
              <th className="p-3">Fecha</th>
              <th className="p-3">Proveedor</th>
              <th className="p-3">Cargó</th>
              <th className="p-3 text-right">Productos</th>
              <th className="p-3">Nota</th>
            </tr>
          </thead>
          <tbody>
            {ingresos.map((i) => (
              <tr key={i.id} className="border-b last:border-0">
                <td className="p-3">
                  <Link to={`/admin/stock/ingresos/${i.id}`} className="text-blue-700 underline">
                    {formatearFechaHora(i.creadoEn)}
                  </Link>
                </td>
                <td className="p-3">{i.proveedor?.nombre ?? '—'}</td>
                <td className="p-3">{i.usuario.nombre}</td>
                <td className="p-3 text-right">{i.cantidadProductos}</td>
                <td className="p-3">{i.nota ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(pagina > 1 || ingresos?.length === INGRESOS_POR_PAGINA) && (
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
            disabled={ingresos?.length !== INGRESOS_POR_PAGINA}
            onClick={() => setPagina(pagina + 1)}
          >
            Más antiguos
          </button>
        </div>
      )}
    </section>
  );
}

export function DetalleIngreso() {
  const { id = '' } = useParams();
  const {
    data: ingreso,
    isPending,
    error,
  } = useQuery({
    queryKey: ['stock', 'ingresos', 'detalle', id],
    queryFn: () => pedir<IngresoDetalle>('GET', `/stock/ingresos/${id}`),
  });

  return (
    <section className="space-y-4">
      <Link to="/admin/stock/ingresos" className="text-sm text-blue-700 underline">
        ← Volver a ingresos
      </Link>
      {isPending && <p>Cargando ingreso…</p>}
      <MensajeError error={error} />
      {ingreso && (
        <>
          <h1 className="text-2xl font-semibold">
            Ingreso del {formatearFechaHora(ingreso.creadoEn)}
          </h1>
          <p className="text-slate-700">
            Cargó: <strong>{ingreso.usuario.nombre}</strong> · Proveedor:{' '}
            {ingreso.proveedor?.nombre ?? 'sin proveedor'}
            {ingreso.nota && ` · ${ingreso.nota}`}
          </p>
          <div className="overflow-x-auto rounded-lg bg-white shadow">
            <table className="w-full text-left" aria-label="Productos recibidos">
              <thead className="border-b text-sm text-slate-600">
                <tr>
                  <th className="p-3">Producto</th>
                  <th className="p-3 text-right">Cantidad</th>
                  <th className="p-3 text-right">Costo unitario</th>
                </tr>
              </thead>
              <tbody>
                {ingreso.items.map((item) => (
                  <tr key={item.producto.id} className="border-b last:border-0">
                    <td className="p-3">
                      {item.producto.nombre}
                      <span className="block text-sm text-slate-500">
                        {item.producto.codigoBarras ?? 'Sin código'}
                      </span>
                    </td>
                    <td className="p-3 text-right">{item.cantidad}</td>
                    <td className="p-3 text-right">
                      {item.costoUnitario === null
                        ? 'Sin cambios'
                        : formatearPesos(item.costoUnitario)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
