import {
  aumentoMasivoSchema,
  REDONDEOS,
  type ResultadoAumento,
  type VistaPreviaAumento,
} from '@kiosco/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { pedir } from '../../api/cliente.js';
import { MensajeError } from '../../app/MensajeError.js';
import { formatearPesos } from '../../lib/montos.js';
import { useProveedores } from '../Proveedores.js';
import { useCambioDeProductos } from './consultas.js';

type DatosAumento = ReturnType<typeof aumentoMasivoSchema.parse>;

interface Previa {
  datos: DatosAumento;
  productos: VistaPreviaAumento;
}

/** Aumento (o baja) de precios por porcentaje: primero vista previa, después confirmación. */
export function AumentoPrecios() {
  const { data: proveedores } = useProveedores({ incluirInactivos: false });
  const [campos, setCampos] = useState({
    proveedorId: '',
    porcentaje: '',
    redondeo: '10',
    incluirCosto: false,
  });
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [resultado, setResultado] = useState<ResultadoAumento | null>(null);

  const vistaPrevia = useMutation({
    mutationFn: (datos: DatosAumento) =>
      pedir<VistaPreviaAumento>('POST', '/productos/aumento/vista-previa', datos),
  });
  const aplicar = useCambioDeProductos((datos: DatosAumento) =>
    pedir<ResultadoAumento>('POST', '/productos/aumento', datos),
  );

  // Cualquier cambio en el formulario invalida la vista previa: hay que volver a verla.
  const cambiar = (cambios: Partial<typeof campos>) => {
    setCampos((actuales) => ({ ...actuales, ...cambios }));
    setPrevia(null);
    setResultado(null);
  };

  const pedirVistaPrevia = (e: FormEvent) => {
    e.preventDefault();
    const validado = aumentoMasivoSchema.safeParse({
      proveedorId: campos.proveedorId === '' ? null : campos.proveedorId,
      porcentaje: campos.porcentaje,
      redondeo: Number(campos.redondeo),
      incluirCosto: campos.incluirCosto,
    });
    if (!validado.success) {
      setErrorLocal(validado.error.issues[0]?.message ?? 'Revisá los datos.');
      return;
    }
    setErrorLocal(null);
    setResultado(null);
    const datos = validado.data;
    vistaPrevia.mutate(datos, { onSuccess: (productos) => setPrevia({ datos, productos }) });
  };

  const confirmar = () => {
    if (!previa) return;
    aplicar.mutate(previa.datos, {
      onSuccess: (r) => {
        setResultado(r);
        setPrevia(null);
      },
    });
  };

  return (
    <section className="space-y-4">
      <Link to="/admin/productos" className="text-sm text-blue-700 underline">
        ← Volver a productos
      </Link>
      <h1 className="text-2xl font-semibold">Aumento de precios</h1>

      <form
        onSubmit={pedirVistaPrevia}
        aria-label="Aumento de precios"
        className="grid gap-3 rounded-lg bg-white p-4 shadow md:grid-cols-2"
      >
        <label>
          <span className="text-sm font-medium">Productos</span>
          <select
            className="campo"
            value={campos.proveedorId}
            onChange={(e) => cambiar({ proveedorId: e.target.value })}
          >
            <option value="">Todos los productos</option>
            {proveedores?.map((p) => (
              <option key={p.id} value={p.id}>
                Proveedor: {p.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-sm font-medium">Porcentaje</span>
          <input
            className="campo"
            inputMode="decimal"
            required
            placeholder="Por ejemplo 10 o -5"
            value={campos.porcentaje}
            onChange={(e) => cambiar({ porcentaje: e.target.value })}
          />
        </label>
        <label>
          <span className="text-sm font-medium">Redondear hacia arriba a</span>
          <select
            className="campo"
            value={campos.redondeo}
            onChange={(e) => cambiar({ redondeo: e.target.value })}
          >
            {REDONDEOS.map((r) => (
              <option key={r} value={r}>
                ${r}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2">
          <input
            type="checkbox"
            className="size-4"
            checked={campos.incluirCosto}
            onChange={(e) => cambiar({ incluirCosto: e.target.checked })}
          />
          Aumentar también el costo
        </label>
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <button type="submit" className="boton" disabled={vistaPrevia.isPending}>
            Ver vista previa
          </button>
          {errorLocal ? (
            <p role="alert" className="text-sm text-red-700">
              {errorLocal}
            </p>
          ) : (
            <MensajeError error={vistaPrevia.error} />
          )}
        </div>
      </form>

      {resultado && (
        <p role="status" className="rounded-lg bg-green-50 p-4 text-green-800">
          Listo: se actualizaron {resultado.actualizados}{' '}
          {resultado.actualizados === 1 ? 'precio' : 'precios'}.
        </p>
      )}

      {previa && previa.productos.length === 0 && (
        <p className="rounded-lg bg-white p-4 shadow">
          Ningún producto cambia de precio con este aumento.
        </p>
      )}

      {previa && previa.productos.length > 0 && (
        <section aria-label="Vista previa" className="space-y-3">
          <p className="font-medium">
            {previa.productos.length}{' '}
            {previa.productos.length === 1 ? 'producto cambia' : 'productos cambian'} de precio:
          </p>
          <div className="overflow-x-auto rounded-lg bg-white shadow">
            <table className="w-full text-left">
              <thead className="border-b text-sm text-slate-600">
                <tr>
                  <th className="p-3">Producto</th>
                  <th className="p-3 text-right">Precio actual</th>
                  <th className="p-3 text-right">Precio nuevo</th>
                  {previa.datos.incluirCosto && <th className="p-3 text-right">Costo nuevo</th>}
                </tr>
              </thead>
              <tbody>
                {previa.productos.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="p-3">{p.nombre}</td>
                    <td className="p-3 text-right">{formatearPesos(p.precioActual)}</td>
                    <td className="p-3 text-right font-semibold">
                      {formatearPesos(p.precioNuevo)}
                    </td>
                    {previa.datos.incluirCosto && (
                      <td className="p-3 text-right">
                        {p.costoNuevo === null ? '—' : formatearPesos(p.costoNuevo)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="boton"
              disabled={aplicar.isPending}
              onClick={confirmar}
            >
              Confirmar aumento
            </button>
            <button type="button" className="boton-secundario" onClick={() => setPrevia(null)}>
              Cancelar
            </button>
            <MensajeError error={aplicar.error} />
          </div>
        </section>
      )}
    </section>
  );
}
