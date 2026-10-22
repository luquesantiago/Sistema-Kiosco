import {
  NOMBRE_CUENTA,
  NOMBRE_ESTADO_PEDIDO,
  proximoDiaDeEntrega,
  type AltaPedido,
  type Cuenta,
  type PedidoDetalle,
  type PedidoResumen,
  type ProveedorListado,
  type ProveedorOpcion,
  type RecepcionSinPedido,
} from '@kiosco/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { OpcionesBoton } from '../app/OpcionesBoton.js';
import { useSesion } from '../app/sesion.js';
import { formatearFechaHora, hoyEnArgentina } from '../lib/fechas.js';
import { entradaAMonto, formatearPesos, montoParaEditar } from '../lib/montos.js';
import { CargaDeMercaderia } from './CargaDeMercaderia.js';

export const CLAVE_PEDIDOS = ['pedidos'] as const;

/** "22/10" a partir de "2026-10-22". */
const diaMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;

/** Qué hay que hacer con el pedido, para las insignias de la lista y del POS. */
export function insignias(p: PedidoResumen, hoy: string): string[] {
  if (p.estado === 'cancelado') return ['Cancelado'];
  if (p.cerradoEn) return ['Cerrado'];
  const lista: string[] = [];
  if (p.estado === 'por_llegar') {
    if (p.llegaEl === hoy) lista.push('Hoy llega');
    else if (p.llegaEl < hoy) lista.push('Atrasado');
  }
  if (p.estado === 'llego') lista.push('Falta cargar');
  if (p.estado !== 'por_llegar' && !p.cuentaPago) lista.push('Debe');
  return lista;
}

/** Cómo se paga al recibir: con una cuenta, o queda debiendo. */
type FormaDePago = Cuenta | 'debe';
const FORMAS_DE_PAGO = ['efectivo', 'mercado_pago', 'debe'] as const;
const NOMBRE_FORMA_DE_PAGO: Record<FormaDePago, string> = {
  ...NOMBRE_CUENTA,
  debe: 'Queda debiendo',
};

function montoValido(texto: string): string | null {
  const valor = entradaAMonto(texto);
  return valor !== null && Number(valor) > 0 ? valor : null;
}

/** Pedidos abiertos (y, para el admin, los cerrados y cancelados por fechas). */
export function Pedidos() {
  const { data: sesion } = useSesion();
  const esAdmin = sesion?.rol === 'admin';
  const hoy = hoyEnArgentina();
  const [params, setParams] = useSearchParams();
  const vista = (esAdmin && params.get('vista')) || 'abiertos';
  const desde = params.get('desde') || `${hoy.slice(0, 8)}01`;
  const hasta = params.get('hasta') || hoy;
  const consulta = new URLSearchParams({ vista });
  if (vista !== 'abiertos') {
    consulta.set('desde', desde);
    consulta.set('hasta', hasta);
  }
  const {
    data: pedidos,
    isPending,
    error,
  } = useQuery({
    queryKey: [...CLAVE_PEDIDOS, vista, desde, hasta],
    queryFn: () => pedir<PedidoResumen[]>('GET', `/pedidos?${consulta}`),
    enabled: sesion !== undefined,
  });

  const cambiar = (campo: string, valor: string) => {
    const siguiente = new URLSearchParams(params);
    siguiente.set(campo, valor);
    setParams(siguiente, { replace: true });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Pedidos</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          {esAdmin && (
            <Link to="/admin/pedidos/nuevo" className="boton">
              Nuevo pedido
            </Link>
          )}
          <Link to="/pedidos/sin-pedido" className="boton-secundario">
            Recibir sin pedido
          </Link>
        </div>
      </div>

      {esAdmin && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Vista">
          {(['abiertos', 'cerrados', 'cancelados'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={vista === v}
              className={vista === v ? 'boton' : 'boton-secundario'}
              onClick={() => cambiar('vista', v)}
            >
              {v[0]!.toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      )}
      {vista !== 'abiertos' && (
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Fechas">
          <label>
            <span className="text-sm font-medium">Desde</span>
            <input
              className="campo"
              type="date"
              value={desde}
              max={hoy}
              onChange={(e) => e.target.value && cambiar('desde', e.target.value)}
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
              onChange={(e) => e.target.value && cambiar('hasta', e.target.value)}
            />
          </label>
        </div>
      )}

      {isPending && <p>Cargando pedidos…</p>}
      <MensajeError error={error} />
      {pedidos?.length === 0 && (
        <p className="text-slate-600">
          {vista === 'abiertos' ? 'No hay pedidos pendientes.' : 'No hay pedidos en esas fechas.'}
        </p>
      )}
      <ul className="space-y-2" aria-label="Pedidos">
        {pedidos?.map((p) => (
          <li key={p.id} className="rounded-lg bg-white shadow">
            <Link to={`/pedidos/${p.id}`} className="block p-4">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  #{p.numero} · {p.proveedor.nombre}
                </span>
                {insignias(p, hoy).map((i) => (
                  <span key={i} className="rounded bg-amber-100 px-2 text-sm text-amber-900">
                    {i}
                  </span>
                ))}
              </span>
              <span className="block text-sm text-slate-600">
                {p.estado === 'por_llegar'
                  ? `Llega el ${diaMes(p.llegaEl)}`
                  : NOMBRE_ESTADO_PEDIDO[p.estado]}
                {' · '}
                {formatearPesos(p.total ?? p.totalPedido)}
                {p.cuentaPago && ` · pagado con ${NOMBRE_CUENTA[p.cuentaPago]}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** El admin pide desde el celular: proveedor, total, cuándo llega y una nota. */
export function NuevoPedido() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: proveedores } = useQuery({
    queryKey: ['proveedores', 'lista'],
    queryFn: () => pedir<ProveedorListado[]>('GET', '/proveedores'),
  });
  const [proveedorId, setProveedorId] = useState('');
  const [total, setTotal] = useState('');
  const [llegaEl, setLlegaEl] = useState('');
  const [nota, setNota] = useState('');
  const [problema, setProblema] = useState<string | null>(null);
  const alta = useMutation({
    mutationFn: (datos: AltaPedido) => pedir<PedidoDetalle>('POST', '/pedidos', datos),
    onSuccess: (pedido) => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_PEDIDOS });
      void navigate(`/pedidos/${pedido.id}`);
    },
  });

  const elegirProveedor = (id: string) => {
    setProveedorId(id);
    const proveedor = proveedores?.find((p) => p.id === id);
    if (proveedor) setLlegaEl(proximoDiaDeEntrega(proveedor.diasEntrega, hoyEnArgentina()));
  };

  const guardar = (e: FormEvent) => {
    e.preventDefault();
    const valor = montoValido(total);
    if (!proveedorId) return setProblema('Elegí el proveedor.');
    if (!valor) return setProblema('Escribí el total a pagar.');
    if (!llegaEl) return setProblema('Elegí cuándo llega.');
    setProblema(null);
    if (!alta.isPending) alta.mutate({ proveedorId, totalPedido: valor, llegaEl, nota });
  };

  return (
    <section className="space-y-4">
      <Link to="/pedidos" className="text-sm text-blue-700 underline">
        ← Pedidos
      </Link>
      <h1 className="text-2xl font-semibold">Nuevo pedido</h1>
      <form
        onSubmit={guardar}
        className="space-y-4 rounded-lg bg-white p-4 shadow"
        aria-label="Nuevo pedido"
      >
        <label className="block">
          <span className="text-sm font-medium">Proveedor</span>
          <select
            className="campo"
            value={proveedorId}
            onChange={(e) => elegirProveedor(e.target.value)}
          >
            <option value="">Elegí el proveedor</option>
            {proveedores
              ?.filter((p) => p.activo)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Total a pagar</span>
          <input
            className="campo text-2xl"
            inputMode="decimal"
            autoComplete="off"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Llega</span>
          <input
            className="campo"
            type="date"
            value={llegaEl}
            onChange={(e) => setLlegaEl(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Nota (opcional)</span>
          <input className="campo" value={nota} onChange={(e) => setNota(e.target.value)} />
        </label>
        {problema && (
          <p role="alert" className="text-sm text-red-700">
            {problema}
          </p>
        )}
        <button type="submit" className="boton w-full sm:w-auto" disabled={alta.isPending}>
          Guardar pedido
        </button>
        <MensajeError error={alta.error} />
      </form>
    </section>
  );
}

/** Mercadería sin pedido previo (pan, hielo): proveedor, total y cómo se paga. */
export function RecibirSinPedido() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: proveedores } = useQuery({
    queryKey: ['stock', 'proveedores'],
    queryFn: () => pedir<ProveedorOpcion[]>('GET', '/stock/proveedores'),
  });
  const [proveedorId, setProveedorId] = useState('');
  const [total, setTotal] = useState('');
  const [nota, setNota] = useState('');
  const [forma, setForma] = useState<FormaDePago | null>(null);
  const [problema, setProblema] = useState<string | null>(null);
  const recepcion = useMutation({
    mutationFn: (datos: RecepcionSinPedido) =>
      pedir<PedidoDetalle>('POST', '/pedidos/sin-pedido', datos),
    onSuccess: (pedido) => {
      void queryClient.invalidateQueries({ queryKey: CLAVE_PEDIDOS });
      void navigate(`/pedidos/${pedido.id}`);
    },
  });

  const recibir = (e: FormEvent) => {
    e.preventDefault();
    const valor = montoValido(total);
    if (!proveedorId) return setProblema('Elegí el proveedor.');
    if (!valor) return setProblema('Escribí el total.');
    if (!forma) return setProblema('Elegí cómo se paga.');
    setProblema(null);
    if (!recepcion.isPending) {
      recepcion.mutate({
        proveedorId,
        total: valor,
        nota,
        cuenta: forma === 'debe' ? null : forma,
      });
    }
  };

  return (
    <section className="space-y-4">
      <Link to="/pedidos" className="text-sm text-blue-700 underline">
        ← Pedidos
      </Link>
      <h1 className="text-2xl font-semibold">Recibir sin pedido</h1>
      <form
        onSubmit={recibir}
        className="space-y-4 rounded-lg bg-white p-4 shadow"
        aria-label="Recibir sin pedido"
      >
        <label className="block">
          <span className="text-sm font-medium">Proveedor</span>
          <select
            className="campo"
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
          >
            <option value="">Elegí el proveedor</option>
            {proveedores?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Total</span>
          <input
            className="campo text-2xl"
            inputMode="decimal"
            autoComplete="off"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Nota (opcional)</span>
          <input className="campo" value={nota} onChange={(e) => setNota(e.target.value)} />
        </label>
        <OpcionesBoton
          leyenda="Pago"
          nombre="pago"
          opciones={FORMAS_DE_PAGO}
          nombres={NOMBRE_FORMA_DE_PAGO}
          valor={forma}
          alCambiar={setForma}
        />
        {problema && (
          <p role="alert" className="text-sm text-red-700">
            {problema}
          </p>
        )}
        <button type="submit" className="boton w-full sm:w-auto" disabled={recepcion.isPending}>
          Recibir
        </button>
        <MensajeError error={recepcion.error} />
      </form>
    </section>
  );
}

/** Detalle del pedido con lo que se puede hacer según su estado y el rol. */
export function DetallePedido() {
  const { id = '' } = useParams();
  const { data: sesion } = useSesion();
  const esAdmin = sesion?.rol === 'admin';
  const queryClient = useQueryClient();
  const clave = [...CLAVE_PEDIDOS, 'detalle', id];
  const {
    data: pedido,
    isPending,
    error,
  } = useQuery({
    queryKey: clave,
    queryFn: () => pedir<PedidoDetalle>('GET', `/pedidos/${id}`),
  });
  const actualizar = (p: PedidoDetalle) => {
    queryClient.setQueryData(clave, p);
    // Las listas (y el POS) se refrescan; el detalle ya quedó con la respuesta.
    void queryClient.invalidateQueries({
      queryKey: CLAVE_PEDIDOS,
      predicate: (q) => q.queryKey[1] !== 'detalle',
    });
  };

  return (
    <section className="space-y-4">
      <Link to="/pedidos" className="text-sm text-blue-700 underline">
        ← Pedidos
      </Link>
      {isPending && <p>Cargando pedido…</p>}
      <MensajeError error={error} />
      {pedido && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">
              Pedido #{pedido.numero} · {pedido.proveedor.nombre}
            </h1>
            {insignias(pedido, hoyEnArgentina()).map((i) => (
              <span key={i} className="rounded bg-amber-100 px-2 text-sm text-amber-900">
                {i}
              </span>
            ))}
          </div>
          <ul className="space-y-1 rounded-lg bg-white p-4 shadow" aria-label="Datos del pedido">
            <li>
              Total del pedido: {formatearPesos(pedido.totalPedido)}
              {pedido.total &&
                pedido.total !== pedido.totalPedido &&
                ` · final: ${formatearPesos(pedido.total)}`}
            </li>
            {pedido.estado === 'por_llegar' && <li>Llega el {diaMes(pedido.llegaEl)}</li>}
            {pedido.nota && <li>Nota: {pedido.nota}</li>}
            <li className="text-sm text-slate-600">
              Pidió {pedido.creado.usuario.nombre} el {formatearFechaHora(pedido.creado.en)}
            </li>
            {pedido.recibido && (
              <li className="text-sm text-slate-600">
                Recibió {pedido.recibido.usuario.nombre} el {formatearFechaHora(pedido.recibido.en)}
                {pedido.notaRecepcion && ` · ${pedido.notaRecepcion}`}
              </li>
            )}
            {pedido.carga && (
              <li className="text-sm text-slate-600">
                Cargó {pedido.carga.usuario.nombre} {pedido.carga.cantidadProductos}{' '}
                {pedido.carga.cantidadProductos === 1 ? 'producto' : 'productos'} el{' '}
                {formatearFechaHora(pedido.carga.en)}
              </li>
            )}
            {pedido.pago && (
              <li className="text-sm text-slate-600">
                Pagó {pedido.pago.usuario.nombre} {formatearPesos(pedido.pago.monto)} con{' '}
                {NOMBRE_CUENTA[pedido.pago.cuenta]} el {formatearFechaHora(pedido.pago.en)}
              </li>
            )}
            {pedido.cancelado && (
              <li className="text-sm text-slate-600">
                Canceló {pedido.cancelado.usuario.nombre}: {pedido.cancelado.motivo}
              </li>
            )}
          </ul>

          {pedido.estado === 'por_llegar' && <Llegada pedido={pedido} alGuardar={actualizar} />}
          {pedido.estado === 'llego' && <CargaDeMercaderia pedido={pedido} alCargar={actualizar} />}
          {pedido.estado !== 'por_llegar' && pedido.estado !== 'cancelado' && !pedido.pago && (
            <Pago pedido={pedido} alGuardar={actualizar} />
          )}
          {esAdmin && pedido.estado === 'por_llegar' && (
            <EdicionYCancelacion pedido={pedido} alGuardar={actualizar} />
          )}
        </>
      )}
    </section>
  );
}

type Accion = { pedido: PedidoDetalle; alGuardar: (p: PedidoDetalle) => void };

function Llegada({ pedido, alGuardar }: Accion) {
  const [total, setTotal] = useState(montoParaEditar(pedido.totalPedido));
  const [notaRecepcion, setNotaRecepcion] = useState('');
  const [forma, setForma] = useState<FormaDePago | null>(null);
  const [problema, setProblema] = useState<string | null>(null);
  const llegada = useMutation({
    mutationFn: (datos: { total: string; notaRecepcion: string; cuenta: Cuenta | null }) =>
      pedir<PedidoDetalle>('POST', `/pedidos/${pedido.id}/llego`, datos),
    onSuccess: alGuardar,
  });

  const guardar = (e: FormEvent) => {
    e.preventDefault();
    const valor = montoValido(total);
    if (!valor) return setProblema('Escribí el total.');
    if (!forma) return setProblema('Elegí cómo se paga.');
    setProblema(null);
    if (!llegada.isPending) {
      llegada.mutate({ total: valor, notaRecepcion, cuenta: forma === 'debe' ? null : forma });
    }
  };

  return (
    <form
      onSubmit={guardar}
      className="space-y-4 rounded-lg bg-white p-4 shadow"
      aria-label="Llegó el pedido"
    >
      <h2 className="font-semibold">Llegó el pedido</h2>
      <label className="block">
        <span className="text-sm font-medium">Total</span>
        <input
          className="campo text-2xl"
          inputMode="decimal"
          autoComplete="off"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Nota (por ejemplo, faltantes)</span>
        <input
          className="campo"
          value={notaRecepcion}
          onChange={(e) => setNotaRecepcion(e.target.value)}
        />
      </label>
      <OpcionesBoton
        leyenda="Pago"
        nombre="pago"
        opciones={FORMAS_DE_PAGO}
        nombres={NOMBRE_FORMA_DE_PAGO}
        valor={forma}
        alCambiar={setForma}
      />
      <p className="text-sm text-slate-600">
        La mercadería se puede cargar ahora o después de atender.
      </p>
      {problema && (
        <p role="alert" className="text-sm text-red-700">
          {problema}
        </p>
      )}
      <button type="submit" className="boton w-full sm:w-auto" disabled={llegada.isPending}>
        Llegó
      </button>
      <MensajeError error={llegada.error} />
    </form>
  );
}

function Pago({ pedido, alGuardar }: Accion) {
  const [total, setTotal] = useState(montoParaEditar(pedido.total ?? pedido.totalPedido));
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [problema, setProblema] = useState<string | null>(null);
  const pago = useMutation({
    mutationFn: (datos: { cuenta: Cuenta; total: string }) =>
      pedir<PedidoDetalle>('POST', `/pedidos/${pedido.id}/pago`, datos),
    onSuccess: alGuardar,
  });

  const pagar = (e: FormEvent) => {
    e.preventDefault();
    const valor = montoValido(total);
    if (!valor) return setProblema('Escribí el total.');
    if (!cuenta) return setProblema('Elegí con qué se paga.');
    setProblema(null);
    if (!pago.isPending) pago.mutate({ cuenta, total: valor });
  };

  return (
    <form
      onSubmit={pagar}
      className="space-y-4 rounded-lg bg-white p-4 shadow"
      aria-label="Pagar el pedido"
    >
      <h2 className="font-semibold">Pagar</h2>
      <label className="block">
        <span className="text-sm font-medium">Total a pagar</span>
        <input
          className="campo text-2xl"
          inputMode="decimal"
          autoComplete="off"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
        />
      </label>
      <OpcionesBoton
        leyenda="Paga con"
        nombre="cuenta"
        opciones={['efectivo', 'mercado_pago'] as const}
        nombres={NOMBRE_CUENTA}
        valor={cuenta}
        alCambiar={setCuenta}
      />
      {problema && (
        <p role="alert" className="text-sm text-red-700">
          {problema}
        </p>
      )}
      <button type="submit" className="boton w-full sm:w-auto" disabled={pago.isPending}>
        Pagar
      </button>
      <MensajeError error={pago.error} />
    </form>
  );
}

function EdicionYCancelacion({ pedido, alGuardar }: Accion) {
  const [total, setTotal] = useState(montoParaEditar(pedido.totalPedido));
  const [llegaEl, setLlegaEl] = useState(pedido.llegaEl);
  const [nota, setNota] = useState(pedido.nota ?? '');
  const [motivo, setMotivo] = useState('');
  const edicion = useMutation({
    mutationFn: (datos: { totalPedido: string; llegaEl: string; nota: string }) =>
      pedir<PedidoDetalle>('PATCH', `/pedidos/${pedido.id}`, datos),
    onSuccess: alGuardar,
  });
  const cancelacion = useMutation({
    mutationFn: (datos: { motivo: string }) =>
      pedir<PedidoDetalle>('POST', `/pedidos/${pedido.id}/cancelar`, datos),
    onSuccess: alGuardar,
  });

  const guardar = (e: FormEvent) => {
    e.preventDefault();
    const valor = montoValido(total);
    if (valor && !edicion.isPending) edicion.mutate({ totalPedido: valor, llegaEl, nota });
  };

  return (
    <details className="rounded-lg bg-white p-4 shadow">
      <summary className="cursor-pointer font-semibold">Editar o cancelar</summary>
      <form onSubmit={guardar} className="mt-3 space-y-3" aria-label="Editar el pedido">
        <label className="block">
          <span className="text-sm font-medium">Total a pagar</span>
          <input
            className="campo"
            inputMode="decimal"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Llega</span>
          <input
            className="campo"
            type="date"
            value={llegaEl}
            onChange={(e) => setLlegaEl(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Nota</span>
          <input className="campo" value={nota} onChange={(e) => setNota(e.target.value)} />
        </label>
        <button type="submit" className="boton-secundario" disabled={edicion.isPending}>
          Guardar cambios
        </button>
        <MensajeError error={edicion.error} />
      </form>
      <form
        className="mt-4 space-y-3 border-t pt-4"
        aria-label="Cancelar el pedido"
        onSubmit={(e) => {
          e.preventDefault();
          if (motivo.trim().length >= 3 && !cancelacion.isPending) cancelacion.mutate({ motivo });
        }}
      >
        <label className="block">
          <span className="text-sm font-medium">Motivo de la cancelación</span>
          <input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </label>
        <button type="submit" className="boton-secundario" disabled={motivo.trim().length < 3}>
          Cancelar pedido
        </button>
        <MensajeError error={cancelacion.error} />
      </form>
    </details>
  );
}
