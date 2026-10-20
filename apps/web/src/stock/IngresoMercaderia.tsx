import {
  ingresoMercaderiaSchema,
  type IngresoListado,
  type IngresoMercaderia as DatosIngreso,
  type ProductoAdmin,
  type ProductoVenta,
  type ProveedorOpcion,
} from '@kiosco/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { useSesion } from '../app/sesion.js';
import { montoParaEditar } from '../lib/montos.js';
import { useAvisoAlSalir } from './avisoAlSalir.js';
import { EscanerDeProductos } from './EscanerDeProductos.js';

interface Fila {
  producto: ProductoVenta | ProductoAdmin;
  cantidad: string;
  /** Solo para el admin: precargado con el costo actual; vacío es "sin cambios". */
  costo: string;
}

function costoActual(producto: ProductoVenta | ProductoAdmin): string | null {
  return 'costo' in producto ? producto.costo : null;
}

/**
 * Carga de la mercadería que llega del proveedor. Pensada para la PC del
 * kiosco: lector + teclado, Enter agrega y Ctrl+Enter confirma.
 */
export function IngresoMercaderia() {
  const { data: sesion } = useSesion();
  const esAdmin = sesion?.rol === 'admin';
  const queryClient = useQueryClient();
  const { data: proveedores } = useQuery({
    queryKey: ['stock', 'proveedores'],
    queryFn: () => pedir<ProveedorOpcion[]>('GET', '/stock/proveedores'),
  });
  const [proveedorId, setProveedorId] = useState('');
  const [nota, setNota] = useState('');
  const [filas, setFilas] = useState<Fila[]>([]);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const [resumen, setResumen] = useState<string | null>(null);

  const confirmar = useMutation({
    mutationFn: (datos: DatosIngreso) => pedir<IngresoListado>('POST', '/stock/ingresos', datos),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['productos'] }),
  });

  useAvisoAlSalir(filas.length > 0 && !confirmar.isPending);

  // Escanear un producto que ya está en la lista suma 1 en vez de agregar otra fila.
  const agregar = (producto: ProductoVenta | ProductoAdmin) => {
    setResumen(null);
    setFilas((actuales) => {
      const existente = actuales.find((f) => f.producto.id === producto.id);
      if (existente) {
        return actuales.map((f) =>
          f === existente ? { ...f, cantidad: String((Number(f.cantidad) || 0) + 1) } : f,
        );
      }
      return [
        ...actuales,
        { producto, cantidad: '1', costo: montoParaEditar(costoActual(producto)) },
      ];
    });
  };

  const cambiarFila = (id: string, cambios: Partial<Fila>) =>
    setFilas((actuales) => actuales.map((f) => (f.producto.id === id ? { ...f, ...cambios } : f)));

  const enviar = (e?: FormEvent) => {
    e?.preventDefault();
    if (confirmar.isPending) return;
    const datos: DatosIngreso = {
      proveedorId: proveedorId === '' ? null : proveedorId,
      nota,
      items: filas.map((f) => ({
        productoId: f.producto.id,
        cantidad: Number(f.cantidad),
        ...(esAdmin && f.costo.trim() !== '' ? { costoUnitario: f.costo } : {}),
      })),
    };
    const validado = ingresoMercaderiaSchema.safeParse(datos);
    if (!validado.success) {
      const problema = validado.error.issues[0];
      setErrorLocal(
        problema?.path.includes('cantidad')
          ? 'Cada cantidad tiene que ser un número entero mayor que cero.'
          : (problema?.message ?? 'Revisá los datos.'),
      );
      return;
    }
    setErrorLocal(null);
    confirmar.mutate(datos, {
      onSuccess: (ingreso) => {
        const unidades = filas.reduce((total, f) => total + Number(f.cantidad), 0);
        setResumen(
          `Ingreso registrado: ${ingreso.cantidadProductos} ${
            ingreso.cantidadProductos === 1 ? 'producto' : 'productos'
          }, ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}.`,
        );
        setFilas([]);
        setNota('');
      },
    });
  };

  const atajos = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      enviar();
    }
  };

  return (
    <section className="space-y-4" onKeyDown={atajos}>
      <h1 className="text-2xl font-semibold">Ingreso de mercadería</h1>

      <form
        onSubmit={enviar}
        aria-label="Ingreso de mercadería"
        className="space-y-4 rounded-lg bg-white p-4 shadow"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label>
            <span className="text-sm font-medium">Proveedor (opcional)</span>
            <select
              className="campo"
              value={proveedorId}
              onChange={(e) => setProveedorId(e.target.value)}
            >
              <option value="">Sin proveedor</option>
              {proveedores?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-sm font-medium">Nota (por ejemplo, n.º de remito)</span>
            <input className="campo" value={nota} onChange={(e) => setNota(e.target.value)} />
          </label>
        </div>

        <EscanerDeProductos
          alElegir={agregar}
          avisoInexistente={
            esAdmin
              ? 'Cargalo en Productos y volvé a escanearlo.'
              : 'Pedile al admin que lo cargue; podés seguir con el resto.'
          }
        />

        {filas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left" aria-label="Productos del ingreso">
              <thead className="border-b text-sm text-slate-600">
                <tr>
                  <th className="p-2">Producto</th>
                  <th className="w-28 p-2">Cantidad</th>
                  {esAdmin && <th className="w-36 p-2">Costo unitario</th>}
                  <th className="w-24 p-2">
                    <span className="sr-only">Quitar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.producto.id} className="border-b last:border-0">
                    <td className="p-2">
                      {f.producto.nombre}
                      <span className="block text-sm text-slate-500">
                        {f.producto.codigoBarras ?? 'Sin código'}
                      </span>
                    </td>
                    <td className="p-2">
                      <input
                        className="campo"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        aria-label={`Cantidad de ${f.producto.nombre}`}
                        value={f.cantidad}
                        onChange={(e) => cambiarFila(f.producto.id, { cantidad: e.target.value })}
                      />
                    </td>
                    {esAdmin && (
                      <td className="p-2">
                        <input
                          className="campo"
                          inputMode="decimal"
                          placeholder="Sin cambios"
                          aria-label={`Costo de ${f.producto.nombre}`}
                          value={f.costo}
                          onChange={(e) => cambiarFila(f.producto.id, { costo: e.target.value })}
                        />
                      </td>
                    )}
                    <td className="p-2">
                      <button
                        type="button"
                        className="boton-secundario"
                        aria-label={`Quitar ${f.producto.nombre}`}
                        onClick={() =>
                          setFilas((actuales) =>
                            actuales.filter((x) => x.producto.id !== f.producto.id),
                          )
                        }
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="boton"
            disabled={filas.length === 0 || confirmar.isPending}
          >
            Confirmar ingreso
          </button>
          <span className="text-sm text-slate-500">Ctrl+Enter para confirmar</span>
          {errorLocal ? (
            <p role="alert" className="text-sm text-red-700">
              {errorLocal}
            </p>
          ) : (
            <MensajeError error={confirmar.error} />
          )}
        </div>
      </form>

      {resumen && (
        <p role="status" className="rounded-lg bg-green-50 p-4 text-green-800">
          {resumen}
        </p>
      )}
    </section>
  );
}
