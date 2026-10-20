import {
  DIAS_SEMANA,
  NOMBRE_DIA,
  type AltaProveedor,
  type DiaSemana,
  type EdicionProveedor,
  type ProveedorListado,
} from '@kiosco/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';

export const CLAVE_PROVEEDORES = ['proveedores'] as const;

/** Proveedores para el admin. Sin `incluirInactivos`, solo los que se pueden asignar. */
export function useProveedores({ incluirInactivos }: { incluirInactivos: boolean }) {
  return useQuery({
    queryKey: [...CLAVE_PROVEEDORES, { incluirInactivos }],
    queryFn: () =>
      pedir<ProveedorListado[]>(
        'GET',
        `/proveedores${incluirInactivos ? '?incluirInactivos=true' : ''}`,
      ),
  });
}

function useCambioDeProveedores<T>(accion: (datos: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: accion,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_PROVEEDORES }),
  });
}

function resumirDias(dias: DiaSemana[]): string {
  if (dias.length === 0) return 'Sin días fijos';
  return dias.map((d) => NOMBRE_DIA[d].slice(0, 3)).join(', ');
}

/** Enlace para llamar desde el celular. */
function Telefono({ telefono }: { telefono: string | null }) {
  if (!telefono) return <span className="text-slate-500">Sin teléfono</span>;
  return (
    <a href={`tel:${telefono.replace(/[^\d+]/g, '')}`} className="text-blue-700 underline">
      {telefono}
    </a>
  );
}

function MarcaHoy({ proveedor }: { proveedor: ProveedorListado }) {
  if (!proveedor.tomaPedidoHoy || !proveedor.activo) return null;
  return (
    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      Toma pedido hoy
    </span>
  );
}

function CasillasDias({
  titulo,
  dias,
  alCambiar,
}: {
  titulo: string;
  dias: DiaSemana[];
  alCambiar: (dias: DiaSemana[]) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{titulo}</legend>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
        {DIAS_SEMANA.map((dia) => (
          <label key={dia} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="size-4"
              checked={dias.includes(dia)}
              onChange={(e) =>
                alCambiar(
                  e.target.checked
                    ? DIAS_SEMANA.filter((d) => d === dia || dias.includes(d))
                    : dias.filter((d) => d !== dia),
                )
              }
            />
            {NOMBRE_DIA[dia]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface DatosFormulario {
  nombre: string;
  telefono: string;
  notas: string;
  diasPedido: DiaSemana[];
  diasEntrega: DiaSemana[];
}

function FormularioProveedor({
  titulo,
  inicial,
  textoGuardar,
  guardar,
  alCerrar,
}: {
  titulo: string;
  inicial?: ProveedorListado;
  textoGuardar: string;
  guardar: (datos: AltaProveedor & EdicionProveedor) => Promise<unknown>;
  alCerrar: () => void;
}) {
  const [datos, setDatos] = useState<DatosFormulario>({
    nombre: inicial?.nombre ?? '',
    telefono: inicial?.telefono ?? '',
    notas: inicial?.notas ?? '',
    diasPedido: inicial?.diasPedido ?? [],
    diasEntrega: inicial?.diasEntrega ?? [],
  });
  const guardado = useCambioDeProveedores(guardar);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    guardado.mutate(datos, { onSuccess: alCerrar });
  };

  return (
    <form
      onSubmit={enviar}
      aria-label={titulo}
      className="grid gap-3 rounded-lg bg-white p-4 shadow md:grid-cols-2"
    >
      <label>
        <span className="text-sm font-medium">Nombre</span>
        <input
          className="campo"
          required
          value={datos.nombre}
          onChange={(e) => setDatos({ ...datos, nombre: e.target.value })}
        />
      </label>
      <label>
        <span className="text-sm font-medium">Teléfono</span>
        <input
          className="campo"
          type="tel"
          inputMode="tel"
          value={datos.telefono}
          onChange={(e) => setDatos({ ...datos, telefono: e.target.value })}
        />
      </label>
      <div className="md:col-span-2">
        <CasillasDias
          titulo="Días de pedido"
          dias={datos.diasPedido}
          alCambiar={(diasPedido) => setDatos({ ...datos, diasPedido })}
        />
      </div>
      <div className="md:col-span-2">
        <CasillasDias
          titulo="Días de entrega"
          dias={datos.diasEntrega}
          alCambiar={(diasEntrega) => setDatos({ ...datos, diasEntrega })}
        />
      </div>
      <label className="md:col-span-2">
        <span className="text-sm font-medium">Notas</span>
        <textarea
          className="campo"
          rows={2}
          value={datos.notas}
          onChange={(e) => setDatos({ ...datos, notas: e.target.value })}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <button type="submit" className="boton" disabled={guardado.isPending}>
          {textoGuardar}
        </button>
        <button type="button" className="boton-secundario" onClick={alCerrar}>
          Cancelar
        </button>
        <MensajeError error={guardado.error} />
      </div>
    </form>
  );
}

function AccionesProveedor({
  proveedor,
  alEditar,
}: {
  proveedor: ProveedorListado;
  alEditar: () => void;
}) {
  const cambiarEstado = useCambioDeProveedores((activo: boolean) =>
    pedir('PATCH', `/proveedores/${proveedor.id}`, { activo }),
  );
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="boton-secundario" onClick={alEditar}>
        Editar
      </button>
      <button
        type="button"
        className="boton-secundario"
        disabled={cambiarEstado.isPending}
        onClick={() => cambiarEstado.mutate(!proveedor.activo)}
      >
        {proveedor.activo ? 'Desactivar' : 'Activar'}
      </button>
      <MensajeError error={cambiarEstado.error} />
    </div>
  );
}

export function Proveedores() {
  const { data: proveedores, isPending, error } = useProveedores({ incluirInactivos: true });
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const formularioEdicion = (p: ProveedorListado) => (
    <FormularioProveedor
      titulo={`Editar ${p.nombre}`}
      inicial={p}
      textoGuardar="Guardar"
      guardar={(datos) => pedir('PATCH', `/proveedores/${p.id}`, datos)}
      alCerrar={() => setEditandoId(null)}
    />
  );

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Proveedores</h1>
        {!creando && (
          <button type="button" className="boton" onClick={() => setCreando(true)}>
            Nuevo proveedor
          </button>
        )}
      </div>
      {creando && (
        <FormularioProveedor
          titulo="Nuevo proveedor"
          textoGuardar="Crear proveedor"
          guardar={(datos) => pedir('POST', '/proveedores', datos)}
          alCerrar={() => setCreando(false)}
        />
      )}
      {isPending && <p>Cargando proveedores…</p>}
      <MensajeError error={error} />
      {proveedores?.length === 0 && (
        <p className="text-slate-600">Todavía no hay proveedores cargados.</p>
      )}

      {/* Celular: tarjetas */}
      <ul className="space-y-3 md:hidden" aria-label="Proveedores">
        {proveedores?.map((p) => (
          <li
            key={p.id}
            className={`rounded-lg bg-white p-4 shadow ${p.activo ? '' : 'opacity-60'}`}
          >
            {editandoId === p.id ? (
              formularioEdicion(p)
            ) : (
              <>
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {p.nombre} <MarcaHoy proveedor={p} />
                  {!p.activo && <span className="text-sm text-slate-500">(Desactivado)</span>}
                </p>
                <p className="mt-1">
                  <Telefono telefono={p.telefono} />
                </p>
                <p className="text-sm text-slate-600">
                  Pedido: {resumirDias(p.diasPedido)} · Entrega: {resumirDias(p.diasEntrega)}
                </p>
                <p className="text-sm text-slate-600">{p.productosActivos} productos activos</p>
                {p.notas && <p className="text-sm text-slate-600">{p.notas}</p>}
                <div className="mt-2">
                  <AccionesProveedor proveedor={p} alEditar={() => setEditandoId(p.id)} />
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      {/* Escritorio: tabla */}
      <table className="hidden w-full rounded-lg bg-white text-left shadow md:table">
        <thead className="border-b text-sm text-slate-600">
          <tr>
            <th className="p-3">Nombre</th>
            <th className="p-3">Teléfono</th>
            <th className="p-3">Pedido</th>
            <th className="p-3">Entrega</th>
            <th className="p-3">Productos</th>
            <th className="p-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {proveedores?.map((p) =>
            editandoId === p.id ? (
              <tr key={p.id} className="border-b last:border-0">
                <td className="p-3" colSpan={6}>
                  {formularioEdicion(p)}
                </td>
              </tr>
            ) : (
              <tr key={p.id} className={`border-b last:border-0 ${p.activo ? '' : 'opacity-60'}`}>
                <td className="p-3">
                  <span className="flex flex-wrap items-center gap-2">
                    {p.nombre} <MarcaHoy proveedor={p} />
                    {!p.activo && <span className="text-sm text-slate-500">(Desactivado)</span>}
                  </span>
                  {p.notas && <span className="block text-sm text-slate-600">{p.notas}</span>}
                </td>
                <td className="p-3">
                  <Telefono telefono={p.telefono} />
                </td>
                <td className="p-3">{resumirDias(p.diasPedido)}</td>
                <td className="p-3">{resumirDias(p.diasEntrega)}</td>
                <td className="p-3">{p.productosActivos}</td>
                <td className="p-3">
                  <AccionesProveedor proveedor={p} alEditar={() => setEditandoId(p.id)} />
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </section>
  );
}
