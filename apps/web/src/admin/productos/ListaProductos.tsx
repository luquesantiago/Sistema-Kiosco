import { PRODUCTOS_POR_PAGINA, type ProductoAdmin } from '@kiosco/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { MensajeError } from '../../app/MensajeError.js';
import { formatearPesos } from '../../lib/montos.js';
import { useBusquedaProductos } from './consultas.js';

/** Lo que manda el lector: sin espacios y con al menos un dígito. */
function pareceCodigo(texto: string): boolean {
  return texto !== '' && !/\s/.test(texto) && /\d/.test(texto);
}

function Estado({ producto }: { producto: ProductoAdmin }) {
  return <>{producto.activo ? 'Activo' : 'Desactivado'}</>;
}

/** Catálogo del admin: búsqueda con el lector o por nombre, y alta rápida de códigos nuevos. */
export function ListaProductos() {
  const [params, setParams] = useSearchParams();
  const consulta = params.get('q') ?? '';
  const pagina = Number(params.get('pagina') ?? '1') || 1;
  const incluirInactivos = params.get('inactivos') === '1';
  const [texto, setTexto] = useState(consulta);
  const navigate = useNavigate();
  const creado = (useLocation().state as { creado?: string } | null)?.creado;

  const {
    data: productos,
    isPending,
    error,
  } = useBusquedaProductos(consulta, pagina, incluirInactivos);

  const actualizar = (cambios: { q?: string; pagina?: number; inactivos?: boolean }) => {
    const siguiente = new URLSearchParams(params);
    if (cambios.q !== undefined) siguiente.set('q', cambios.q);
    if (cambios.inactivos !== undefined) {
      if (cambios.inactivos) siguiente.set('inactivos', '1');
      else siguiente.delete('inactivos');
    }
    siguiente.set('pagina', String(cambios.pagina ?? 1));
    setParams(siguiente, { replace: true });
  };

  // Mientras se escribe a mano, busca solo después de una pausa corta.
  useEffect(() => {
    const limpio = texto.trim();
    if (limpio === consulta) return;
    const espera = setTimeout(() => actualizar({ q: limpio }), 300);
    return () => clearTimeout(espera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  // El lector escribe el código y manda Enter: busca al instante.
  const buscar = (e: FormEvent) => {
    e.preventDefault();
    actualizar({ q: texto.trim() });
  };

  const sinResultados = productos?.length === 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Productos</h1>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/productos/aumento" className="boton-secundario">
            Aumento de precios
          </Link>
          <Link to="/admin/productos/nuevo" className="boton">
            Nuevo producto
          </Link>
        </div>
      </div>

      {creado && (
        <p role="status" className="text-sm text-green-700">
          Producto creado: {creado}.
        </p>
      )}

      <form onSubmit={buscar} role="search" className="flex flex-wrap items-end gap-2">
        <label className="w-full sm:w-auto sm:min-w-0 sm:flex-1">
          <span className="text-sm font-medium">Buscar por código o nombre</span>
          <input
            className="campo"
            type="search"
            autoFocus
            autoComplete="off"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </label>
        <button type="submit" className="boton">
          Buscar
        </button>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={incluirInactivos}
            onChange={(e) => actualizar({ inactivos: e.target.checked })}
          />
          Incluir desactivados
        </label>
      </form>

      {isPending && <p>Buscando…</p>}
      <MensajeError error={error} />

      {sinResultados && (
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-slate-600">
            {consulta ? `No hay productos para "${consulta}".` : 'Todavía no hay productos.'}
          </p>
          {pareceCodigo(consulta) && (
            <button
              type="button"
              className="boton mt-3"
              onClick={() =>
                navigate(`/admin/productos/nuevo?codigo=${encodeURIComponent(consulta)}`)
              }
            >
              Crear producto con este código
            </button>
          )}
        </div>
      )}

      {/* Celular: tarjetas */}
      <ul className="space-y-3 md:hidden" aria-label="Productos">
        {productos?.map((p) => (
          <li key={p.id} className={`rounded-lg bg-white shadow ${p.activo ? '' : 'opacity-60'}`}>
            <Link to={`/admin/productos/${p.id}`} className="block p-4">
              <span className="font-medium">{p.nombre}</span>
              <span className="block text-sm text-slate-600">
                {p.codigoBarras ?? 'Sin código'} · Stock {p.stockActual} · <Estado producto={p} />
              </span>
              <span className="block text-lg font-semibold">{formatearPesos(p.precio)}</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Escritorio: tabla */}
      {productos && productos.length > 0 && (
        <table className="hidden w-full rounded-lg bg-white text-left shadow md:table">
          <thead className="border-b text-sm text-slate-600">
            <tr>
              <th className="p-3">Nombre</th>
              <th className="p-3">Código</th>
              <th className="p-3 text-right">Precio</th>
              <th className="p-3 text-right">Stock</th>
              <th className="p-3">Estado</th>
            </tr>
          </thead>
          <tbody>
            {productos.map((p) => (
              <tr key={p.id} className={`border-b last:border-0 ${p.activo ? '' : 'opacity-60'}`}>
                <td className="p-3">
                  <Link to={`/admin/productos/${p.id}`} className="text-blue-700 underline">
                    {p.nombre}
                  </Link>
                </td>
                <td className="p-3">{p.codigoBarras ?? '—'}</td>
                <td className="p-3 text-right">{formatearPesos(p.precio)}</td>
                <td className="p-3 text-right">{p.stockActual}</td>
                <td className="p-3">
                  <Estado producto={p} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(pagina > 1 || productos?.length === PRODUCTOS_POR_PAGINA) && (
        <div className="flex gap-2">
          <button
            type="button"
            className="boton-secundario"
            disabled={pagina === 1}
            onClick={() => actualizar({ pagina: pagina - 1 })}
          >
            Página anterior
          </button>
          <button
            type="button"
            className="boton-secundario"
            disabled={productos?.length !== PRODUCTOS_POR_PAGINA}
            onClick={() => actualizar({ pagina: pagina + 1 })}
          >
            Página siguiente
          </button>
        </div>
      )}
    </section>
  );
}
