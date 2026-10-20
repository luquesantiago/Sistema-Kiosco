import {
  ajusteStockSchema,
  MOTIVOS_AJUSTE,
  MOVIMIENTOS_POR_PAGINA,
  NOMBRE_MOTIVO,
  NOMBRE_TIPO_MOVIMIENTO,
  type AjusteStock,
  type MotivoAjuste,
  type MovimientoStock,
  type ProductoAdmin,
  type ResultadoConteo,
} from '@kiosco/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { formatearFechaHora } from '../lib/fechas.js';
import { EscanerDeProductos } from './EscanerDeProductos.js';

type Accion = 'ajustar' | 'contar' | 'movimientos';

function conSigno(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function descripcion(m: MovimientoStock): string {
  return m.motivo
    ? `${NOMBRE_TIPO_MOVIMIENTO[m.tipo]} · ${NOMBRE_MOTIVO[m.motivo]}`
    : NOMBRE_TIPO_MOVIMIENTO[m.tipo];
}

function FormularioAjuste({
  producto,
  alRegistrar,
}: {
  producto: ProductoAdmin;
  alRegistrar: (stockActual: number) => void;
}) {
  const [sentido, setSentido] = useState<'restar' | 'sumar'>('restar');
  const [cantidad, setCantidad] = useState('1');
  const [motivo, setMotivo] = useState<MotivoAjuste>('rotura');
  const [nota, setNota] = useState('');
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const ajuste = useMutation({
    mutationFn: (datos: AjusteStock) => pedir<MovimientoStock>('POST', '/stock/ajustes', datos),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(cantidad);
    const validado = ajusteStockSchema.safeParse({
      productoId: producto.id,
      cantidad: sentido === 'restar' ? -n : n,
      motivo,
      nota,
    });
    if (!validado.success || n <= 0) {
      setErrorLocal(
        n > 0
          ? (validado.error?.issues[0]?.message ?? 'Revisá los datos.')
          : 'La cantidad tiene que ser un entero mayor que cero.',
      );
      return;
    }
    setErrorLocal(null);
    ajuste.mutate(validado.data, {
      onSuccess: (m) => {
        alRegistrar(m.stockResultante);
        setCantidad('1');
        setNota('');
      },
    });
  };

  return (
    <form onSubmit={enviar} aria-label="Ajuste de stock" className="grid gap-3 md:grid-cols-2">
      <fieldset className="flex items-center gap-4 md:col-span-2">
        <legend className="sr-only">Sumar o restar</legend>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="sentido"
            checked={sentido === 'restar'}
            onChange={() => setSentido('restar')}
          />
          Restar
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="sentido"
            checked={sentido === 'sumar'}
            onChange={() => setSentido('sumar')}
          />
          Sumar
        </label>
      </fieldset>
      <label>
        <span className="text-sm font-medium">Cantidad</span>
        <input
          className="campo"
          type="number"
          inputMode="numeric"
          min={1}
          required
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
        />
      </label>
      <label>
        <span className="text-sm font-medium">Motivo</span>
        <select
          className="campo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value as MotivoAjuste)}
        >
          {MOTIVOS_AJUSTE.map((m) => (
            <option key={m} value={m}>
              {NOMBRE_MOTIVO[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="md:col-span-2">
        <span className="text-sm font-medium">Nota{motivo === 'otro' ? '' : ' (opcional)'}</span>
        <input className="campo" value={nota} onChange={(e) => setNota(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <button type="submit" className="boton" disabled={ajuste.isPending}>
          Registrar ajuste
        </button>
        {errorLocal ? (
          <p role="alert" className="text-sm text-red-700">
            {errorLocal}
          </p>
        ) : (
          <MensajeError error={ajuste.error} />
        )}
        {ajuste.isSuccess && !errorLocal && (
          <p role="status" className="text-sm text-green-700">
            Ajuste registrado: {conSigno(ajuste.data.cantidad)}.
          </p>
        )}
      </div>
    </form>
  );
}

function FormularioConteo({
  producto,
  alRegistrar,
}: {
  producto: ProductoAdmin;
  alRegistrar: (stockActual: number) => void;
}) {
  const [contada, setContada] = useState('');
  const conteo = useMutation({
    mutationFn: (cantidadContada: number) =>
      pedir<ResultadoConteo>('POST', '/stock/conteos', {
        productoId: producto.id,
        cantidadContada,
      }),
  });

  return (
    <form
      aria-label="Conteo"
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        conteo.mutate(Number(contada), {
          onSuccess: (r) => {
            alRegistrar(r.stockActual);
            setContada('');
          },
        });
      }}
    >
      <label>
        <span className="text-sm font-medium">Cantidad contada</span>
        <input
          className="campo"
          type="number"
          inputMode="numeric"
          min={0}
          required
          value={contada}
          onChange={(e) => setContada(e.target.value)}
        />
      </label>
      <button type="submit" className="boton" disabled={conteo.isPending}>
        Registrar conteo
      </button>
      <MensajeError error={conteo.error} />
      {conteo.data && (
        <p role="status" className="w-full text-sm text-green-700">
          {conteo.data.diferencia === 0
            ? `Sin diferencia: el stock sigue en ${conteo.data.stockActual}.`
            : `Diferencia ${conSigno(conteo.data.diferencia)}: el stock quedó en ${conteo.data.stockActual}.`}
        </p>
      )}
    </form>
  );
}

function Movimientos({ productoId }: { productoId: string }) {
  const [pagina, setPagina] = useState(1);
  const {
    data: movimientos,
    isPending,
    error,
  } = useQuery({
    queryKey: ['stock', 'movimientos', productoId, pagina],
    queryFn: () =>
      pedir<MovimientoStock[]>(
        'GET',
        `/stock/productos/${productoId}/movimientos?pagina=${pagina}`,
      ),
  });

  return (
    <div className="space-y-2">
      {isPending && <p>Cargando movimientos…</p>}
      <MensajeError error={error} />
      {movimientos?.length === 0 && <p className="text-slate-600">Sin movimientos todavía.</p>}
      {movimientos && movimientos.length > 0 && (
        <ul className="divide-y" aria-label="Movimientos">
          {movimientos.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-x-4 py-2">
              <span className="min-w-0">
                <span className="font-medium">{descripcion(m)}</span>
                {m.nota && <span className="block text-sm text-slate-600">{m.nota}</span>}
                <span className="block text-sm text-slate-500">
                  {formatearFechaHora(m.creadoEn)} · {m.usuario.nombre}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span
                  className={`font-semibold ${m.cantidad < 0 ? 'text-red-700' : 'text-green-700'}`}
                >
                  {conSigno(m.cantidad)}
                </span>
                <span className="block text-sm text-slate-500">Queda {m.stockResultante}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {(pagina > 1 || movimientos?.length === MOVIMIENTOS_POR_PAGINA) && (
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
            disabled={movimientos?.length !== MOVIMIENTOS_POR_PAGINA}
            onClick={() => setPagina(pagina + 1)}
          >
            Más antiguos
          </button>
        </div>
      )}
    </div>
  );
}

/** Stock del admin: buscar un producto y ajustarlo, contarlo o ver sus movimientos. */
export function StockAdmin() {
  const [producto, setProducto] = useState<ProductoAdmin | null>(null);
  const [accion, setAccion] = useState<Accion>('ajustar');
  const queryClient = useQueryClient();

  const actualizarStock = (stockActual: number) => {
    setProducto((p) => (p ? { ...p, stockActual } : p));
    void queryClient.invalidateQueries({ queryKey: ['stock', 'movimientos'] });
    void queryClient.invalidateQueries({ queryKey: ['productos'] });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Stock</h1>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/stock/ingresos" className="boton-secundario">
            Ingresos
          </Link>
          <Link to="/admin/stock/ventas-sin-sistema" className="boton-secundario">
            Ventas sin sistema
          </Link>
        </div>
      </div>

      <div className="rounded-lg bg-white p-4 shadow">
        <EscanerDeProductos<ProductoAdmin>
          etiqueta="Buscá el producto"
          avisoInexistente="Cargalo primero en Productos."
          alElegir={(p) => {
            setProducto(p);
            setAccion('ajustar');
          }}
        />
      </div>

      {producto && (
        <div className="space-y-4 rounded-lg bg-white p-4 shadow">
          <div>
            <h2 className="text-lg font-semibold">{producto.nombre}</h2>
            <p className="text-slate-700">
              Stock actual: <strong>{producto.stockActual}</strong>
              <span className="text-sm text-slate-500">
                {' '}
                · {producto.codigoBarras ?? 'Sin código'}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Acción">
            {(
              [
                ['ajustar', 'Ajustar'],
                ['contar', 'Contar'],
                ['movimientos', 'Ver movimientos'],
              ] as const
            ).map(([valor, texto]) => (
              <button
                key={valor}
                type="button"
                aria-pressed={accion === valor}
                className={accion === valor ? 'boton' : 'boton-secundario'}
                onClick={() => setAccion(valor)}
              >
                {texto}
              </button>
            ))}
          </div>
          {accion === 'ajustar' && (
            <FormularioAjuste key={producto.id} producto={producto} alRegistrar={actualizarStock} />
          )}
          {accion === 'contar' && (
            <FormularioConteo key={producto.id} producto={producto} alRegistrar={actualizarStock} />
          )}
          {accion === 'movimientos' && <Movimientos productoId={producto.id} />}
        </div>
      )}
    </section>
  );
}
