import { altaProductoSchema, type ProductoAdmin } from '@kiosco/shared';
import { useState, type FormEvent } from 'react';
import { MensajeError } from '../../app/MensajeError.js';
import { montoParaEditar } from '../../lib/montos.js';
import { useProveedores } from '../Proveedores.js';

/** Datos ya validados y normalizados (montos como "905.00"). */
export type DatosProducto = ReturnType<typeof altaProductoSchema.parse>;

interface Props {
  titulo: string;
  inicial?: ProductoAdmin;
  /** Código precargado, por ejemplo desde un escaneo sin resultado. */
  codigoInicial?: string;
  textoGuardar: string;
  guardando: boolean;
  error: Error | null;
  alGuardar: (datos: DatosProducto) => void;
  alCancelar: () => void;
}

/** Alta y edición de producto. El stock actual no se edita acá. */
export function FormularioProducto({
  titulo,
  inicial,
  codigoInicial,
  textoGuardar,
  guardando,
  error,
  alGuardar,
  alCancelar,
}: Props) {
  const { data: proveedores } = useProveedores({ incluirInactivos: false });
  const [campos, setCampos] = useState({
    nombre: inicial?.nombre ?? '',
    codigoBarras: inicial?.codigoBarras ?? codigoInicial ?? '',
    precio: montoParaEditar(inicial?.precio ?? null),
    costo: montoParaEditar(inicial?.costo ?? null),
    stockMinimo: String(inicial?.stockMinimo ?? 0),
    stockMaximo: String(inicial?.stockMaximo ?? 0),
    proveedorId: inicial?.proveedor?.id ?? '',
  });
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  // Un producto puede conservar un proveedor ya desactivado: se agrega a las opciones.
  const opciones = proveedores?.map((p) => ({ id: p.id, nombre: p.nombre })) ?? [];
  if (inicial?.proveedor && !opciones.some((p) => p.id === inicial.proveedor?.id)) {
    opciones.push({
      id: inicial.proveedor.id,
      nombre: `${inicial.proveedor.nombre} (desactivado)`,
    });
  }

  const cambiar = (campo: keyof typeof campos) => (valor: string) =>
    setCampos((actuales) => ({ ...actuales, [campo]: valor }));

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const validado = altaProductoSchema.safeParse({
      nombre: campos.nombre,
      codigoBarras: campos.codigoBarras,
      precio: campos.precio,
      costo: campos.costo.trim() === '' ? null : campos.costo,
      stockMinimo: Number(campos.stockMinimo),
      stockMaximo: Number(campos.stockMaximo),
      proveedorId: campos.proveedorId === '' ? null : campos.proveedorId,
    });
    if (!validado.success) {
      setErrorLocal(validado.error.issues[0]?.message ?? 'Revisá los datos.');
      return;
    }
    setErrorLocal(null);
    alGuardar(validado.data);
  };

  return (
    <form
      onSubmit={enviar}
      aria-label={titulo}
      className="grid gap-3 rounded-lg bg-white p-4 shadow md:grid-cols-2"
    >
      <label className="md:col-span-2">
        <span className="text-sm font-medium">Nombre</span>
        <input
          className="campo"
          required
          autoFocus={codigoInicial !== undefined}
          value={campos.nombre}
          onChange={(e) => cambiar('nombre')(e.target.value)}
        />
      </label>
      <label>
        <span className="text-sm font-medium">Código de barras</span>
        <input
          className="campo"
          autoComplete="off"
          value={campos.codigoBarras}
          onChange={(e) => cambiar('codigoBarras')(e.target.value)}
        />
      </label>
      <label>
        <span className="text-sm font-medium">Proveedor</span>
        <select
          className="campo"
          value={campos.proveedorId}
          onChange={(e) => cambiar('proveedorId')(e.target.value)}
        >
          <option value="">Sin proveedor</option>
          {opciones.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="text-sm font-medium">Precio de venta</span>
        <input
          className="campo"
          inputMode="decimal"
          required
          placeholder="0,00"
          value={campos.precio}
          onChange={(e) => cambiar('precio')(e.target.value)}
        />
      </label>
      <label>
        <span className="text-sm font-medium">Costo (opcional)</span>
        <input
          className="campo"
          inputMode="decimal"
          placeholder="0,00"
          value={campos.costo}
          onChange={(e) => cambiar('costo')(e.target.value)}
        />
      </label>
      <label>
        <span className="text-sm font-medium">Stock mínimo</span>
        <input
          className="campo"
          type="number"
          inputMode="numeric"
          min={0}
          required
          value={campos.stockMinimo}
          onChange={(e) => cambiar('stockMinimo')(e.target.value)}
        />
      </label>
      <label>
        <span className="text-sm font-medium">Stock máximo</span>
        <input
          className="campo"
          type="number"
          inputMode="numeric"
          min={0}
          required
          value={campos.stockMaximo}
          onChange={(e) => cambiar('stockMaximo')(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <button type="submit" className="boton" disabled={guardando}>
          {textoGuardar}
        </button>
        <button type="button" className="boton-secundario" onClick={alCancelar}>
          Cancelar
        </button>
        {errorLocal ? (
          <p role="alert" className="text-sm text-red-700">
            {errorLocal}
          </p>
        ) : (
          <MensajeError error={error} />
        )}
      </div>
    </form>
  );
}
