import {
  CATEGORIAS_GASTO,
  MEDIOS_PAGO,
  NOMBRE_CATEGORIA_GASTO,
  NOMBRE_MEDIO,
  NOMBRE_PERIODO,
  PERIODOS,
  rangoDelPeriodo,
  type Dashboard as DatosDashboard,
  type Periodo,
  type ProductoVendido,
} from '@kiosco/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { OpcionesBoton } from '../app/OpcionesBoton.js';
import { hoyEnArgentina } from '../lib/fechas.js';
import { formatearPesos } from '../lib/montos.js';

/** "22/10" a partir de "2026-10-22". */
const diaMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;

/** Contra qué se compara, en palabras. */
function nombreAnterior({ desde, hasta }: { desde: string; hasta: string }, hoy: string): string {
  if (desde === hasta) {
    const ayer = new Date(Date.parse(`${hoy}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    return desde === ayer ? 'ayer' : diaMes(desde);
  }
  return `${diaMes(desde)}–${diaMes(hasta)}`;
}

function Variacion({ valor, contra }: { valor: number | null; contra: string }) {
  if (valor === null) return null;
  const color = valor > 0 ? 'text-green-700' : valor < 0 ? 'text-red-700' : 'text-slate-600';
  return (
    <span className={`text-sm ${color}`}>
      {valor > 0 ? '+' : ''}
      {valor}% vs. {contra}
    </span>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg bg-white p-4 shadow" aria-label={titulo}>
      <h2 className="font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

function Fila({ nombre, valor, fuerte }: { nombre: ReactNode; valor: string; fuerte?: boolean }) {
  return (
    <p className={`flex justify-between gap-2 ${fuerte ? 'text-lg font-semibold' : ''}`}>
      <span>{nombre}</span>
      <span className="whitespace-nowrap">{valor}</span>
    </p>
  );
}

/** Cómo se lee un punto de la serie: "08 h", "22/10" o "sem. 19/10". */
function etiquetaPunto(inicio: string, agrupacion: DatosDashboard['serie']['agrupacion']): string {
  if (agrupacion === 'hora') return `${inicio.slice(11, 13)} h`;
  return agrupacion === 'semana' ? `sem. ${diaMes(inicio)}` : diaMes(inicio);
}

function Serie({ serie }: { serie: DatosDashboard['serie'] }) {
  const [elegido, setElegido] = useState<string | null>(null);
  const maximo = Math.max(...serie.puntos.map((p) => Number(p.total)), 1);
  const punto = serie.puntos.find((p) => p.inicio === elegido);
  return (
    <div className="space-y-1">
      <div className="flex h-28 items-end gap-0.5" role="list" aria-label="Ventas por período">
        {serie.puntos.map((p) => (
          <button
            key={p.inicio}
            type="button"
            role="listitem"
            aria-label={`${etiquetaPunto(p.inicio, serie.agrupacion)}: ${formatearPesos(p.total)}`}
            onClick={() => setElegido(p.inicio)}
            className={`min-w-0 flex-1 rounded-t ${p.inicio === elegido ? 'bg-slate-800' : 'bg-slate-400'}`}
            style={{ height: `${Math.max((Number(p.total) / maximo) * 100, 2)}%` }}
          />
        ))}
      </div>
      <p className="text-sm text-slate-600" aria-live="polite">
        {punto
          ? `${etiquetaPunto(punto.inicio, serie.agrupacion)}: ${formatearPesos(punto.total)}`
          : 'Tocá una barra para ver el monto.'}
      </p>
    </div>
  );
}

function Medios({ medios }: { medios: DatosDashboard['medios'] }) {
  const total = MEDIOS_PAGO.reduce((s, m) => s + Number(medios[m]), 0);
  return (
    <ul className="space-y-2" aria-label="Ventas por medio de pago">
      {MEDIOS_PAGO.map((m) => {
        const porcentaje = total === 0 ? 0 : Math.round((Number(medios[m]) / total) * 100);
        return (
          <li key={m}>
            <span className="flex justify-between text-sm">
              <span>{NOMBRE_MEDIO[m]}</span>
              <span>
                {formatearPesos(medios[m])} · {porcentaje}%
              </span>
            </span>
            <span className="block h-2 rounded bg-slate-200">
              <span
                className="block h-2 rounded bg-slate-700"
                style={{ width: `${porcentaje}%` }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const ORDENES = ['unidades', 'importe', 'ganancia'] as const;
type Orden = (typeof ORDENES)[number];
const NOMBRE_ORDEN: Record<Orden, string> = {
  unidades: 'Unidades',
  importe: 'Importe',
  ganancia: 'Ganancia',
};

function MasVendidos({ masVendidos }: { masVendidos: DatosDashboard['masVendidos'] }) {
  const [orden, setOrden] = useState<Orden>('unidades');
  const lista: ProductoVendido[] = masVendidos[orden];
  return (
    <div className="space-y-3">
      <OpcionesBoton
        leyenda="Ordenar por"
        nombre="orden"
        opciones={ORDENES}
        nombres={NOMBRE_ORDEN}
        valor={orden}
        alCambiar={setOrden}
      />
      {lista.length === 0 ? (
        <p className="text-sm text-slate-600">No hay ventas de productos en este período.</p>
      ) : (
        <ol className="space-y-1" aria-label="Más vendidos">
          {lista.map((p, i) => (
            <li key={p.productoId} className="flex justify-between gap-2 text-sm">
              <span>
                {i + 1}. {p.nombre}
              </span>
              <span className="whitespace-nowrap text-slate-700">
                {orden === 'unidades' && `${p.unidades} u.`}
                {orden === 'importe' && formatearPesos(p.importe)}
                {orden === 'ganancia' && formatearPesos(p.ganancia ?? '0')}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Período elegido en la URL: un atajo o "fechas" con desde/hasta. */
function usePeriodo(hoy: string) {
  const [params, setParams] = useSearchParams();
  const elegido = params.get('periodo') ?? 'hoy';
  const esAtajo = (PERIODOS as readonly string[]).includes(elegido);
  const rango = esAtajo
    ? rangoDelPeriodo(elegido as Periodo, hoy)
    : { desde: params.get('desde') ?? hoy, hasta: params.get('hasta') ?? hoy };
  const cambiar = (cambios: Record<string, string>) => {
    const siguiente = new URLSearchParams(params);
    for (const [clave, valor] of Object.entries(cambios)) siguiente.set(clave, valor);
    setParams(siguiente, { replace: true });
  };
  return { elegido: esAtajo ? elegido : 'fechas', rango, cambiar };
}

/** Cómo va el kiosco, para el admin desde el celular. Mercado Pago llega en la Etapa 5. */
export function Dashboard() {
  const hoy = hoyEnArgentina();
  const { elegido, rango, cambiar } = usePeriodo(hoy);
  const {
    data: d,
    isPending,
    error,
  } = useQuery({
    queryKey: ['dashboard', rango.desde, rango.hasta],
    queryFn: () =>
      pedir<DatosDashboard>(
        'GET',
        `/dashboard?${new URLSearchParams({ desde: rango.desde, hasta: rango.hasta }).toString()}`,
      ),
  });
  const contra = d ? nombreAnterior(d.anterior, hoy) : '';

  return (
    <section className="space-y-4" aria-label="Dashboard">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
        {PERIODOS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={elegido === p}
            className={elegido === p ? 'boton' : 'boton-secundario'}
            onClick={() => cambiar({ periodo: p })}
          >
            {NOMBRE_PERIODO[p]}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={elegido === 'fechas'}
          className={elegido === 'fechas' ? 'boton' : 'boton-secundario'}
          onClick={() => cambiar({ periodo: 'fechas', desde: rango.desde, hasta: rango.hasta })}
        >
          Fechas
        </button>
      </div>
      {elegido === 'fechas' && (
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Fechas">
          <label>
            <span className="text-sm font-medium">Desde</span>
            <input
              className="campo"
              type="date"
              value={rango.desde}
              max={hoy}
              onChange={(e) => e.target.value && cambiar({ desde: e.target.value })}
            />
          </label>
          <label>
            <span className="text-sm font-medium">Hasta</span>
            <input
              className="campo"
              type="date"
              value={rango.hasta}
              min={rango.desde}
              max={hoy}
              onChange={(e) => e.target.value && cambiar({ hasta: e.target.value })}
            />
          </label>
        </div>
      )}

      {isPending && <p>Cargando números…</p>}
      <MensajeError error={error} />

      {d && (
        <div className="grid gap-4 md:grid-cols-2">
          <Bloque titulo="Ahora">
            <Fila
              nombre={
                <>
                  Efectivo en caja
                  <span className="block text-xs text-slate-500">
                    {d.ahora.turnoAbierto ? 'turno abierto, en vivo' : 'lo que quedó al cerrar'}
                  </span>
                </>
              }
              valor={formatearPesos(d.ahora.efectivoEnCaja)}
              fuerte
            />
            <Link to="/pedidos" className="block rounded hover:bg-slate-50">
              <Fila
                nombre="Pendiente de pagar"
                valor={formatearPesos(d.ahora.pendiente.total)}
                fuerte
              />
              <span className="block text-sm text-slate-600">
                Por llegar ({d.ahora.pendiente.porLlegar.cantidad}):{' '}
                {formatearPesos(d.ahora.pendiente.porLlegar.total)} · Deben (
                {d.ahora.pendiente.deben.cantidad}): {formatearPesos(d.ahora.pendiente.deben.total)}
              </span>
            </Link>
          </Bloque>

          <Bloque titulo="Ventas y resultado">
            <Fila
              nombre={`Ventas (${d.ventas.cantidad})`}
              valor={formatearPesos(d.ventas.total)}
              fuerte
            />
            <Variacion valor={d.ventas.variacion} contra={contra} />
            <Fila
              nombre={`Ganancia${d.ganancia.margen === null ? '' : ` (${d.ganancia.margen}%)`}`}
              valor={formatearPesos(d.ganancia.total)}
              fuerte
            />
            <Variacion valor={d.ganancia.variacion} contra={contra} />
            {Number(d.sinCosto) > 0 && (
              <Link
                to="/admin/productos?sinCosto=1"
                className="block rounded bg-amber-50 p-2 text-sm text-amber-900 underline"
              >
                {formatearPesos(d.sinCosto)} vendidos sin costo: completá los costos
              </Link>
            )}
            <Fila nombre="Gastos" valor={`−${formatearPesos(d.gastos.total)}`} />
            <ul className="pl-3 text-sm text-slate-600" aria-label="Gastos por categoría">
              {CATEGORIAS_GASTO.filter((c) => Number(d.gastos.porCategoria[c]) > 0).map((c) => (
                <li key={c} className="flex justify-between">
                  <span>{NOMBRE_CATEGORIA_GASTO[c]}</span>
                  <span>{formatearPesos(d.gastos.porCategoria[c])}</span>
                </li>
              ))}
            </ul>
            <Fila nombre="Resultado" valor={formatearPesos(d.resultado)} fuerte />
          </Bloque>

          <Bloque titulo="Ventas en el tiempo">
            <Serie serie={d.serie} />
          </Bloque>

          <Bloque titulo="Por medio de pago">
            <Medios medios={d.medios} />
          </Bloque>

          <Bloque titulo="Más vendidos">
            <MasVendidos masVendidos={d.masVendidos} />
          </Bloque>

          <Bloque titulo="Plata que se movió">
            <Fila
              nombre="Pagos a proveedores"
              valor={formatearPesos(d.movimientos.pagosProveedor.total)}
            />
            <p className="pl-3 text-sm text-slate-600">
              Efectivo {formatearPesos(d.movimientos.pagosProveedor.efectivo)} · Mercado Pago{' '}
              {formatearPesos(d.movimientos.pagosProveedor.mercadoPago)}
            </p>
            <Fila nombre="Retiros" valor={formatearPesos(d.movimientos.retiros)} />
            <Fila nombre="Ingresos" valor={formatearPesos(d.movimientos.ingresos)} />
            <Link to="/admin/turnos" className="block rounded hover:bg-slate-50">
              <Fila
                nombre={`Diferencias de caja (${d.movimientos.diferencias.turnos})`}
                valor={formatearPesos(d.movimientos.diferencias.total)}
              />
            </Link>
            <Fila
              nombre={`Anuladas (${d.movimientos.anuladas.cantidad})`}
              valor={formatearPesos(d.movimientos.anuladas.total)}
            />
          </Bloque>
        </div>
      )}
    </section>
  );
}
