import {
  CATEGORIAS_GASTO,
  comparar,
  MOVIMIENTOS_MP_POR_PAGINA,
  NOMBRE_CATEGORIA_GASTO,
  NOMBRE_MOVIMIENTO_CAJA,
  nombreMovimientoCaja,
  TIPOS_MOVIMIENTO_SUELTO,
  type CategoriaGasto,
  type MovimientoCaja,
  type MovimientoCajaEntrada,
  type TipoMovimientoSuelto,
} from '@kiosco/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { OpcionesBoton } from '../app/OpcionesBoton.js';
import { formatearFechaHora, hoyEnArgentina } from '../lib/fechas.js';
import { entradaAMonto, formatearPesos } from '../lib/montos.js';

const CLAVE_MP = ['caja', 'movimientos-mp'] as const;

/**
 * Lo que entra o sale de la cuenta de Mercado Pago del kiosco, pensado para el
 * celular del admin: no hace falta un turno abierto. El saldo llega en la Etapa 5.
 */
export function MercadoPago() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Mercado Pago</h1>
      <NuevoMovimientoMp />
      <ListaMovimientosMp />
    </section>
  );
}

function NuevoMovimientoMp() {
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<TipoMovimientoSuelto>('gasto');
  const [categoria, setCategoria] = useState<CategoriaGasto | null>(null);
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [problema, setProblema] = useState<string | null>(null);
  const registro = useMutation({
    mutationFn: (datos: MovimientoCajaEntrada) =>
      pedir<MovimientoCaja>('POST', '/caja/movimientos', datos),
    onSuccess: () => {
      setMonto('');
      setCategoria(null);
      setMotivo('');
      void queryClient.invalidateQueries({ queryKey: CLAVE_MP });
    },
  });

  const registrar = (e: FormEvent) => {
    e.preventDefault();
    const valor = entradaAMonto(monto);
    if (valor === null || comparar(valor, '0') <= 0) {
      setProblema('Escribí un monto mayor que cero.');
      return;
    }
    if (tipo === 'gasto' && categoria === null) {
      setProblema('Elegí la categoría del gasto.');
      return;
    }
    if (motivo.trim().length < 3) {
      setProblema('Escribí el motivo (al menos 3 letras).');
      return;
    }
    setProblema(null);
    if (registro.isPending) return;
    const base = { cuenta: 'mercado_pago' as const, monto: valor, motivo: motivo.trim() };
    if (tipo === 'gasto') {
      if (categoria !== null) registro.mutate({ tipo, categoria, ...base });
    } else {
      registro.mutate({ tipo, ...base });
    }
  };

  return (
    <form
      onSubmit={registrar}
      className="space-y-4 rounded-lg bg-white p-4 shadow"
      aria-label="Nuevo movimiento de Mercado Pago"
    >
      <OpcionesBoton
        leyenda="Movimiento"
        nombre="tipo"
        opciones={TIPOS_MOVIMIENTO_SUELTO}
        nombres={NOMBRE_MOVIMIENTO_CAJA}
        valor={tipo}
        alCambiar={setTipo}
      />
      {tipo === 'gasto' && (
        <OpcionesBoton
          leyenda="Categoría"
          nombre="categoria"
          opciones={CATEGORIAS_GASTO}
          nombres={NOMBRE_CATEGORIA_GASTO}
          valor={categoria}
          alCambiar={setCategoria}
        />
      )}
      <label className="block">
        <span className="text-sm font-medium">Monto</span>
        <input
          className="campo text-2xl"
          inputMode="decimal"
          autoComplete="off"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Motivo</span>
        <input
          className="campo"
          autoComplete="off"
          placeholder={
            tipo === 'retiro' ? 'Por ejemplo: a mi cuenta' : 'Por ejemplo: luz, internet'
          }
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </label>
      {problema && (
        <p role="alert" className="text-sm text-red-700">
          {problema}
        </p>
      )}
      {registro.isSuccess && (
        <p role="status" className="text-sm text-green-700">
          Registrado.
        </p>
      )}
      <button type="submit" className="boton w-full sm:w-auto" disabled={registro.isPending}>
        Registrar
      </button>
      <MensajeError error={registro.error} />
    </form>
  );
}

function ListaMovimientosMp() {
  const hoy = hoyEnArgentina();
  const [params, setParams] = useSearchParams();
  const desde = params.get('desde') || `${hoy.slice(0, 8)}01`;
  const hasta = params.get('hasta') || hoy;
  const [pagina, setPagina] = useState(1);
  const consulta = new URLSearchParams({ desde, hasta, pagina: String(pagina) });
  const {
    data: movimientos,
    isPending,
    error,
  } = useQuery({
    queryKey: [...CLAVE_MP, desde, hasta, pagina],
    queryFn: () => pedir<MovimientoCaja[]>('GET', `/caja/movimientos-mp?${consulta}`),
  });

  const cambiarFecha = (campo: 'desde' | 'hasta', valor: string) => {
    const siguiente = new URLSearchParams(params);
    siguiente.set(campo, valor);
    setParams(siguiente, { replace: true });
    setPagina(1);
  };

  return (
    <div className="space-y-3">
      <h2 className="font-semibold">Movimientos</h2>
      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Fechas">
        <label>
          <span className="text-sm font-medium">Desde</span>
          <input
            className="campo"
            type="date"
            value={desde}
            max={hoy}
            onChange={(e) => e.target.value && cambiarFecha('desde', e.target.value)}
          />
        </label>
        <label>
          <span className="text-sm font-medium">Hasta</span>
          <input
            className="campo"
            type="date"
            value={hasta}
            min={desde}
            max={hoy}
            onChange={(e) => e.target.value && cambiarFecha('hasta', e.target.value)}
          />
        </label>
      </div>

      {isPending && <p>Cargando movimientos…</p>}
      <MensajeError error={error} />
      {movimientos?.length === 0 && (
        <p className="text-slate-600">No hay movimientos de Mercado Pago en esas fechas.</p>
      )}
      <ul className="space-y-2" aria-label="Movimientos de Mercado Pago">
        {movimientos?.map((m) => (
          <li key={m.id} className="flex justify-between gap-2 rounded-lg bg-white p-3 shadow">
            <span>
              <span className="font-medium">{nombreMovimientoCaja(m)}</span>: {m.motivo}
              <span className="block text-sm text-slate-600">
                {formatearFechaHora(m.creadoEn)} · {m.usuario.nombre}
              </span>
            </span>
            <span className="font-medium whitespace-nowrap">
              {m.tipo === 'ingreso' ? '' : '−'}
              {formatearPesos(m.monto)}
            </span>
          </li>
        ))}
      </ul>

      {(pagina > 1 || movimientos?.length === MOVIMIENTOS_MP_POR_PAGINA) && (
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
            disabled={movimientos?.length !== MOVIMIENTOS_MP_POR_PAGINA}
            onClick={() => setPagina(pagina + 1)}
          >
            Más antiguos
          </button>
        </div>
      )}
    </div>
  );
}
