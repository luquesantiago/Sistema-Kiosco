import {
  NOMBRE_MEDIO,
  TEXTO_MP_NO_RESPONDE,
  type CobroMp,
  type DevolucionPendiente,
  type EstadoCaja,
  type VentaDetalle,
} from '@kiosco/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { formatearPesos } from '../lib/montos.js';
import { CLAVE_ESTADO_CAJA } from './estadoCaja.js';

/*
 * Cobro con la terminal Point (cambio cobro-mercado-pago): la pantalla de espera del
 * cobro y el aviso de una devolución pendiente. El estado del cobro se pide cada 1 s; el
 * de la caja (con las devoluciones), cada 5 s desde la pantalla de venta.
 */

/** Cada cuánto el mostrador pide el estado del cobro. */
const SONDEO_COBRO_MS = 1_000;

const claveCobro = (ventaId: string) => ['ventas', ventaId, 'cobro'] as const;

/** "Tarjeta rechazada por el banco" → "tarjeta rechazada por el banco". */
const enMinuscula = (texto: string) => texto.charAt(0).toLowerCase() + texto.slice(1);

/** Diálogo del mostrador que no se cierra solo: Esc y Enter los maneja quien lo usa. */
function Modal({
  titulo,
  rol = 'dialog',
  children,
}: {
  titulo: string;
  rol?: 'dialog' | 'alertdialog';
  children: ReactNode;
}) {
  const caja = useRef<HTMLDivElement>(null);
  // El foco queda en el diálogo (no en un botón): así Enter no aprieta nada por accidente
  // y lo que se escanee no llega al campo de productos.
  useEffect(() => caja.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/60 p-4">
      <div
        ref={caja}
        role={rol}
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-xl outline-none"
      >
        <h2 className="text-xl font-semibold">{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

/** Qué ve el empleado y qué puede hacer en cada estado del cobro. */
function situacion(cobro: CobroMp): {
  texto: string;
  esperando: boolean;
  reintentar: boolean;
  otraForma: boolean;
  cancelar: boolean;
} {
  const instruccion =
    cobro.medio === 'mercado_pago'
      ? 'Mostrale el QR del Point al cliente'
      : 'Pasá la tarjeta por el Point';
  const fallo = { esperando: false, reintentar: true, otraForma: true, cancelar: true };
  switch (cobro.estado) {
    case 'creando':
      return { texto: TEXTO_MP_NO_RESPONDE, ...fallo };
    case 'en_espera':
      return {
        texto: cobro.cancelacionPedida ? 'Cancelando en el Point…' : instruccion,
        esperando: true,
        reintentar: false,
        otraForma: !cobro.cancelacionPedida,
        cancelar: !cobro.cancelacionPedida,
      };
    case 'cancelando':
      return {
        texto: 'Cancelando en el Point…',
        esperando: true,
        reintentar: false,
        otraForma: false,
        cancelar: false,
      };
    case 'rechazado':
      return { texto: `Rechazado: ${enMinuscula(cobro.motivo ?? 'Pago rechazado')}`, ...fallo };
    case 'vencido':
      return { texto: 'El cobro venció en el Point sin que nadie pagara.', ...fallo };
    case 'cancelado':
      return { texto: 'El cobro se canceló en el Point.', ...fallo };
    case 'a_revisar':
      return {
        texto:
          'Mirá el Point: pide revisar si el pago se aprobó. Si no se cobró, cancelá la venta.',
        esperando: false,
        reintentar: false,
        otraForma: false,
        cancelar: true,
      };
    default:
      return { texto: '', esperando: false, reintentar: false, otraForma: false, cancelar: false };
  }
}

/**
 * Pantalla de espera del cobro en el Point. Termina en `alAprobar` (la venta quedó
 * cobrada; `llegoAPagar` si se había pedido cancelar) o en `alVolverAlCarrito` (la venta
 * se canceló y el carrito sigue intacto; `aviso` si MP no respondía).
 */
export function DialogoEsperaCobro({
  venta,
  alAprobar,
  alVolverAlCarrito,
}: {
  venta: VentaDetalle;
  alAprobar: (venta: VentaDetalle, llegoAPagar: boolean) => void;
  alVolverAlCarrito: (aviso: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const { data: cobro } = useQuery({
    queryKey: claveCobro(venta.id),
    queryFn: () => pedir<CobroMp>('GET', `/ventas/${venta.id}/cobro`),
    initialData: venta.cobro ?? undefined,
    refetchInterval: SONDEO_COBRO_MS,
  });
  const terminado = useRef(false);
  // Si MP no respondía al pedir "otra forma", el carrito vuelve con ese aviso.
  const avisoAlVolver = useRef<string | null>(null);

  const terminar = (accion: () => void) => {
    if (terminado.current) return;
    terminado.current = true;
    queryClient.removeQueries({ queryKey: claveCobro(venta.id) });
    accion();
  };

  const aprobada = useMutation({
    mutationFn: () => pedir<VentaDetalle>('GET', `/ventas/${venta.id}`),
    onSuccess: (pagada) => terminar(() => alAprobar(pagada, cobro?.cancelacionPedida === true)),
  });

  const reintento = useMutation({
    mutationFn: () => pedir<CobroMp>('POST', `/ventas/${venta.id}/cobro/reintentar`),
    onSuccess: (nuevo) => queryClient.setQueryData(claveCobro(venta.id), nuevo),
  });

  const cancelacion = useMutation({
    mutationFn: () => pedir<VentaDetalle>('POST', `/ventas/${venta.id}/cancelar`),
    onSuccess: (actual) => {
      if (actual.estado === 'cancelada') {
        terminar(() => alVolverAlCarrito(avisoAlVolver.current));
      } else if (actual.estado === 'pagada') {
        terminar(() => alAprobar(actual, true));
      } else if (actual.cobro) {
        // MP tiene que confirmar la cancelación: se sigue esperando.
        queryClient.setQueryData(claveCobro(venta.id), actual.cobro);
      }
    },
  });

  // Lo que informa el servidor resuelve la espera.
  const estado = cobro?.estado;
  const pedidaCancelacion = cobro?.cancelacionPedida === true;
  useEffect(() => {
    if (terminado.current || !estado) return;
    if (estado === 'aprobado') {
      if (!aprobada.isPending && !aprobada.isSuccess) aprobada.mutate();
    } else if (
      (estado === 'cancelado' && pedidaCancelacion) ||
      estado === 'a_devolver' ||
      estado === 'devuelto' ||
      estado === 'sin_devolver'
    ) {
      terminar(() => alVolverAlCarrito(avisoAlVolver.current));
    }
  });

  const s = cobro ? situacion(cobro) : null;
  const ocupado = reintento.isPending || cancelacion.isPending;

  const reintentar = () => {
    if (s?.reintentar && !ocupado) reintento.mutate();
  };
  const cancelar = (confirmar: boolean) => {
    if (ocupado) return;
    if (confirmar && !window.confirm('¿Cancelar el cobro y volver al carrito?')) return;
    avisoAlVolver.current = cobro?.estado === 'creando' ? TEXTO_MP_NO_RESPONDE : null;
    cancelacion.mutate();
  };

  // Enter reintenta y Esc cancela (con confirmación), estén donde estén el foco.
  useEffect(() => {
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        reintentar();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (s?.cancelar) cancelar(true);
      }
    };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  });

  const monto = cobro?.monto ?? venta.total;
  const medio = cobro?.medio ?? venta.pagos.find((p) => p.medio !== 'efectivo')?.medio;

  return (
    <Modal titulo="Cobro en el Point">
      <p className="text-center">
        <span className="block text-sm text-slate-600">
          Venta #{venta.numero}
          {medio ? ` · ${NOMBRE_MEDIO[medio]}` : ''}
        </span>
        <span className="text-4xl font-bold">{formatearPesos(monto)}</span>
      </p>
      {s && (
        <p
          role="status"
          className={`text-center text-lg ${s.esperando ? 'text-slate-800' : 'font-semibold text-red-700'}`}
        >
          {s.texto}
        </p>
      )}
      {s?.esperando && <p className="text-center text-sm text-slate-500">Esperando el pago…</p>}
      <div className="flex flex-wrap justify-center gap-2">
        {s?.reintentar && (
          <button type="button" className="boton" disabled={ocupado} onClick={reintentar}>
            Reintentar (Enter)
          </button>
        )}
        {s?.otraForma && (
          <button
            type="button"
            className="boton-secundario"
            disabled={ocupado}
            onClick={() => cancelar(false)}
          >
            Cobrar de otra forma
          </button>
        )}
        {s?.cancelar && (
          <button
            type="button"
            className="boton-secundario"
            disabled={ocupado}
            onClick={() => cancelar(true)}
          >
            Cancelar (Esc)
          </button>
        )}
      </div>
      <MensajeError error={reintento.error ?? cancelacion.error ?? aprobada.error} />
    </Modal>
  );
}

/**
 * Aviso de un pago que entró después de cancelar la venta: no se cierra con Esc ni con
 * clic afuera, y mientras está no se puede seguir vendiendo.
 */
export function DialogoDevolucionCobro({ devolucion }: { devolucion: DevolucionPendiente }) {
  const queryClient = useQueryClient();
  const monto = formatearPesos(devolucion.monto);
  const resolver = useMutation({
    mutationFn: (accion: 'devolucion' | 'sin-devolver') =>
      pedir<CobroMp>('POST', `/mercado-pago/cobros/${devolucion.cobroId}/${accion}`),
    onSuccess: () => {
      queryClient.setQueryData<EstadoCaja>(CLAVE_ESTADO_CAJA, (estado) =>
        estado
          ? {
              ...estado,
              devolucionesPendientes: (estado.devolucionesPendientes ?? []).filter(
                (d) => d.cobroId !== devolucion.cobroId,
              ),
            }
          : estado,
      );
      void queryClient.invalidateQueries({ queryKey: CLAVE_ESTADO_CAJA });
    },
    // Si ya la resolvió otra pantalla, el estado nuevo lo saca de la lista.
    onError: () => void queryClient.invalidateQueries({ queryKey: CLAVE_ESTADO_CAJA }),
  });

  return (
    <Modal titulo="Devolución pendiente" rol="alertdialog">
      <p className="text-lg">
        {`Entró un pago de ${monto} de un cobro cancelado (venta #${devolucion.ventaNumero}): devolvé ${monto} en efectivo`}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="boton"
          disabled={resolver.isPending}
          onClick={() => resolver.mutate('devolucion')}
        >
          {`Ya devolví ${monto}`}
        </button>
        <button
          type="button"
          className="boton-secundario"
          disabled={resolver.isPending}
          onClick={() => resolver.mutate('sin-devolver')}
        >
          El cliente ya se fue
        </button>
      </div>
      <MensajeError error={resolver.error} />
    </Modal>
  );
}
