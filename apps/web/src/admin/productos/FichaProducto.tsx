import type { CambioPrecio, EdicionProducto, ProductoAdmin } from '@kiosco/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { pedir } from '../../api/cliente.js';
import { MensajeError } from '../../app/MensajeError.js';
import { formatearPesos } from '../../lib/montos.js';
import { useCambioDeProductos, useHistorialPrecios, useProducto } from './consultas.js';
import { FormularioProducto } from './FormularioProducto.js';

function formatearFecha(fecha: string): string {
  return new Date(fecha).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function cambioDeMonto(anterior: string | null, nuevo: string | null): string {
  const texto = (m: string | null) => (m === null ? 'sin costo' : formatearPesos(m));
  return anterior === nuevo ? texto(nuevo) : `${texto(anterior)} → ${texto(nuevo)}`;
}

const NOMBRE_ORIGEN: Record<CambioPrecio['origen'], string> = {
  manual: 'Manual',
  aumento_masivo: 'Aumento masivo',
};

function Historial({ id }: { id: string }) {
  const { data: cambios, isPending, error } = useHistorialPrecios(id);
  return (
    <section aria-labelledby="titulo-historial" className="space-y-2">
      <h2 id="titulo-historial" className="text-lg font-semibold">
        Historial de precios
      </h2>
      {isPending && <p>Cargando historial…</p>}
      <MensajeError error={error} />
      {cambios?.length === 0 && <p className="text-slate-600">Sin cambios de precio todavía.</p>}
      {cambios && cambios.length > 0 && (
        <ul className="divide-y rounded-lg bg-white shadow" aria-label="Cambios de precio">
          {cambios.map((c) => (
            <li key={c.id} className="p-3">
              <p className="font-medium">
                Precio: {cambioDeMonto(c.precioAnterior, c.precioNuevo)}
              </p>
              <p className="text-sm text-slate-600">
                Costo: {cambioDeMonto(c.costoAnterior, c.costoNuevo)}
              </p>
              <p className="text-sm text-slate-600">
                {formatearFecha(c.creadoEn)} · {c.usuario.nombre} · {NOMBRE_ORIGEN[c.origen]}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Ficha({ producto }: { producto: ProductoAdmin }) {
  const [guardado, setGuardado] = useState(false);
  const navigate = useNavigate();
  const edicion = useCambioDeProductos((cambios: EdicionProducto) =>
    pedir<ProductoAdmin>('PATCH', `/productos/${producto.id}`, cambios),
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{producto.nombre}</h1>
        {!producto.activo && (
          <span className="rounded bg-slate-200 px-2 py-0.5 text-sm">Desactivado</span>
        )}
      </div>
      <p className="text-slate-700">
        Stock actual: <strong>{producto.stockActual}</strong>
        <span className="text-sm text-slate-500"> (se mueve con ingresos, ventas y ajustes)</span>
      </p>
      {/* key: al guardar, el formulario se vuelve a armar con los datos nuevos. */}
      <FormularioProducto
        key={`${producto.precio}-${producto.costo}-${producto.nombre}`}
        titulo="Editar producto"
        inicial={producto}
        textoGuardar="Guardar cambios"
        guardando={edicion.isPending}
        error={edicion.error}
        alGuardar={(datos) => {
          setGuardado(false);
          edicion.mutate(datos, { onSuccess: () => setGuardado(true) });
        }}
        alCancelar={() => navigate('/admin/productos')}
      />
      {guardado && (
        <p role="status" className="text-sm text-green-700">
          Cambios guardados.
        </p>
      )}
      <div>
        <button
          type="button"
          className="boton-secundario"
          disabled={edicion.isPending}
          onClick={() => {
            setGuardado(false);
            edicion.mutate({ activo: !producto.activo });
          }}
        >
          {producto.activo ? 'Desactivar producto' : 'Activar producto'}
        </button>
      </div>
      <Historial id={producto.id} />
    </>
  );
}

export function FichaProducto() {
  const { id = '' } = useParams();
  const { data: producto, isPending, error } = useProducto(id);

  return (
    <section className="space-y-4">
      <Link to="/admin/productos" className="text-sm text-blue-700 underline">
        ← Volver a productos
      </Link>
      {isPending && <p>Cargando producto…</p>}
      <MensajeError error={error} />
      {producto && <Ficha producto={producto} />}
    </section>
  );
}
