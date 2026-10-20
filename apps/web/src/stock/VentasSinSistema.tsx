import {
  ventasSinSistemaSchema,
  type ProductoVenta,
  type ResultadoVentasSinSistema,
  type VentasSinSistema as DatosVentas,
} from '@kiosco/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { useAvisoAlSalir } from './avisoAlSalir.js';
import { EscanerDeProductos } from './EscanerDeProductos.js';

interface Fila {
  producto: ProductoVenta;
  cantidad: string;
}

/** Carga de lo vendido durante un corte: descuenta todo junto con motivo "venta sin sistema". */
export function VentasSinSistema() {
  const queryClient = useQueryClient();
  const [filas, setFilas] = useState<Fila[]>([]);
  const [nota, setNota] = useState('');
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const [resumen, setResumen] = useState<string | null>(null);
  const carga = useMutation({
    mutationFn: (datos: DatosVentas) =>
      pedir<ResultadoVentasSinSistema>('POST', '/stock/ventas-sin-sistema', datos),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['productos'] }),
  });

  useAvisoAlSalir(filas.length > 0 && !carga.isPending);

  const agregar = (producto: ProductoVenta) => {
    setResumen(null);
    setFilas((actuales) =>
      actuales.some((f) => f.producto.id === producto.id)
        ? actuales.map((f) =>
            f.producto.id === producto.id
              ? { ...f, cantidad: String((Number(f.cantidad) || 0) + 1) }
              : f,
          )
        : [...actuales, { producto, cantidad: '1' }],
    );
  };

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const datos: DatosVentas = {
      nota,
      items: filas.map((f) => ({ productoId: f.producto.id, cantidad: Number(f.cantidad) })),
    };
    if (!ventasSinSistemaSchema.safeParse(datos).success) {
      setErrorLocal('Cada cantidad tiene que ser un número entero mayor que cero.');
      return;
    }
    setErrorLocal(null);
    carga.mutate(datos, {
      onSuccess: (r) => {
        setResumen(
          `Se descontó el stock de ${r.productos} ${r.productos === 1 ? 'producto' : 'productos'}.`,
        );
        setFilas([]);
        setNota('');
      },
    });
  };

  return (
    <section className="space-y-4">
      <Link to="/admin/stock" className="text-sm text-blue-700 underline">
        ← Volver a stock
      </Link>
      <h1 className="text-2xl font-semibold">Ventas sin sistema</h1>
      <p className="text-slate-600">
        Cargá lo que se vendió durante un corte de luz o de internet. Se descuenta del stock con el
        motivo "Venta sin sistema".
      </p>

      <form
        onSubmit={enviar}
        aria-label="Ventas sin sistema"
        className="space-y-4 rounded-lg bg-white p-4 shadow"
      >
        <EscanerDeProductos alElegir={agregar} avisoInexistente="Cargalo primero en Productos." />

        {filas.length > 0 && (
          <ul className="divide-y" aria-label="Productos vendidos">
            {filas.map((f) => (
              <li key={f.producto.id} className="flex flex-wrap items-end gap-3 py-2">
                <span className="min-w-40 flex-1">{f.producto.nombre}</span>
                <label>
                  <span className="sr-only">Cantidad de {f.producto.nombre}</span>
                  <input
                    className="campo w-24"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    aria-label={`Cantidad de ${f.producto.nombre}`}
                    value={f.cantidad}
                    onChange={(e) =>
                      setFilas((actuales) =>
                        actuales.map((x) =>
                          x.producto.id === f.producto.id ? { ...x, cantidad: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="boton-secundario"
                  onClick={() =>
                    setFilas((actuales) => actuales.filter((x) => x.producto.id !== f.producto.id))
                  }
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="block">
          <span className="text-sm font-medium">Nota (opcional)</span>
          <input className="campo" value={nota} onChange={(e) => setNota(e.target.value)} />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="boton" disabled={filas.length === 0 || carga.isPending}>
            Descontar del stock
          </button>
          {errorLocal ? (
            <p role="alert" className="text-sm text-red-700">
              {errorLocal}
            </p>
          ) : (
            <MensajeError error={carga.error} />
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
