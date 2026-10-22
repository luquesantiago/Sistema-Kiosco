import {
  CODIGOS_ERROR,
  preciosActualesSchema,
  type MedioPago,
  type PagoEntrada,
  type ProductoVenta,
  type VentaDetalle,
  type VentaEntrada,
} from '@kiosco/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer, useRef, useState } from 'react';
import { ErrorDeApi, pedir } from '../api/cliente.js';
import { MensajeError } from '../app/MensajeError.js';
import { useSesion } from '../app/sesion.js';
import { formatearPesos } from '../lib/montos.js';
import { EscanerDeProductos } from '../stock/EscanerDeProductos.js';
import {
  cargarCarrito,
  guardarCarrito,
  itemsParaVenta,
  reducirCarrito,
  subtotal,
  totalCarrito,
} from './carrito.js';
import { CLAVE_ESTADO_CAJA, esErrorDeTurno, useEstadoCaja } from './estadoCaja.js';
import { AbrirTurno, DialogoCaja, DialogoCerrarTurno, TurnoDeOtro } from './Caja.js';
import { DialogoCobro, DialogoPagoMixto, DialogoVarios } from './Dialogos.js';
import { sonarError } from './sonido.js';
import { useImpresionTicket } from './Ticket.js';

type Dialogo =
  | { tipo: 'cobro'; medio: MedioPago }
  | { tipo: 'mixto' }
  | { tipo: 'varios' }
  | { tipo: 'caja' }
  | { tipo: 'cerrarTurno' }
  | null;

/** Atajos de la pantalla de venta; la barra del pie los muestra. */
const ATAJOS_COBRO: Record<string, MedioPago> = {
  F1: 'efectivo',
  F2: 'debito',
  F3: 'credito',
  F4: 'mercado_pago',
};

const REFERENCIA_ATAJOS: [string, string][] = [
  ['F1', 'Efectivo'],
  ['F2', 'Débito'],
  ['F3', 'Crédito'],
  ['F4', 'Mercado Pago'],
  ['F6', 'Pago mixto'],
  ['F7', 'Varios'],
  ['F8', 'Caja'],
  ['↑ ↓', 'Elegir ítem'],
  ['+ −', 'Cantidad'],
  ['Supr', 'Quitar'],
  ['Ctrl+Supr', 'Vaciar'],
  ['F9', 'Imprimir ticket'],
];

let contadorVarios = 0;

/**
 * Punto de venta. Sin turno abierto pide abrirlo; si el turno es de otro
 * empleado, pide cerrarlo antes. El admin vende en el turno abierto de cualquiera.
 */
export function Venta() {
  const { data: sesion } = useSesion();
  const { data: estado, error } = useEstadoCaja();

  if (error) return <MensajeError error={error} />;
  if (!estado || !sesion) return <p>Cargando caja…</p>;
  const turno = estado.turnoAbierto;
  if (!turno) return <AbrirTurno montoSugerido={estado.montoSugerido} />;
  if (!turno.esMio && sesion.rol !== 'admin') {
    return <TurnoDeOtro turnoId={turno.id} responsable={turno.responsable} />;
  }
  return (
    <PuntoDeVenta
      turnoId={turno.id}
      responsable={turno.responsable}
      esMio={turno.esMio}
      esAdmin={sesion.rol === 'admin'}
    />
  );
}

/** Lector + teclado, sin tocar el mouse. */
function PuntoDeVenta({
  turnoId,
  responsable,
  esMio,
  esAdmin,
}: {
  turnoId: string;
  responsable: { id: string; nombre: string };
  esMio: boolean;
  esAdmin: boolean;
}) {
  const [carrito, despachar] = useReducer(reducirCarrito, undefined, cargarCarrito);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [ultimaVenta, setUltimaVenta] = useState<VentaDetalle | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { imprimir, ticket } = useImpresionTicket();
  const total = totalCarrito(carrito);
  const vacio = carrito.items.length === 0;

  useEffect(() => guardarCarrito(carrito), [carrito]);

  // Al cerrar un diálogo, el foco vuelve al campo de escaneo.
  useEffect(() => {
    if (dialogo === null) campo.current?.focus();
  }, [dialogo]);

  const cobro = useMutation({
    mutationFn: (datos: VentaEntrada) => pedir<VentaDetalle>('POST', '/ventas', datos),
    onSuccess: (venta) => {
      setUltimaVenta(venta);
      setAviso(null);
      despachar({ tipo: 'vaciar' });
      setDialogo(null);
      void queryClient.invalidateQueries({ queryKey: ['ventas'] });
    },
    onError: (error) => {
      // El turno se cerró o cambió: la pantalla vuelve a pedir abrirlo, con el carrito intacto.
      if (esErrorDeTurno(error)) {
        setDialogo(null);
        void queryClient.invalidateQueries({ queryKey: CLAVE_ESTADO_CAJA });
        return;
      }
      if (error instanceof ErrorDeApi && error.codigo === CODIGOS_ERROR.preciosCambiaron) {
        const precios = preciosActualesSchema.safeParse(error.detalle);
        if (precios.success) despachar({ tipo: 'actualizarPrecios', precios: precios.data });
        setAviso('Cambiaron precios: el carrito tiene los nuevos (resaltados). Volvé a cobrar.');
        setDialogo(null);
      }
    },
  });

  const cobrar = (pagos: PagoEntrada[]) =>
    cobro.mutate({ items: itemsParaVenta(carrito), pagos, totalEsperado: total });

  const abrir = (nuevo: Exclude<Dialogo, null>) => {
    const esCobro = nuevo.tipo === 'cobro' || nuevo.tipo === 'mixto';
    if (esCobro && vacio) {
      setAviso('El carrito está vacío.');
      return;
    }
    cobro.reset();
    setDialogo(nuevo);
  };

  // Los atajos se escuchan en toda la ventana.
  useEffect(() => {
    const alPresionar = (e: KeyboardEvent) => {
      const medio = ATAJOS_COBRO[e.key];
      const esAtajoF = medio !== undefined || ['F6', 'F7', 'F8', 'F9'].includes(e.key);
      if (dialogo !== null) {
        // El diálogo maneja Enter y Esc; las F no tienen que llegar al navegador (F1 = ayuda).
        if (esAtajoF) e.preventDefault();
        return;
      }
      if (medio) {
        e.preventDefault();
        abrir({ tipo: 'cobro', medio });
        return;
      }
      if (['F6', 'F7', 'F8', 'F9'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'F6') abrir({ tipo: 'mixto' });
        if (e.key === 'F7') abrir({ tipo: 'varios' });
        if (e.key === 'F8') abrir({ tipo: 'caja' });
        if (e.key === 'F9' && ultimaVenta) imprimir(ultimaVenta);
        return;
      }
      if (e.key === 'Delete' && e.ctrlKey) {
        e.preventDefault();
        if (!vacio && window.confirm('¿Vaciar el carrito?')) despachar({ tipo: 'vaciar' });
        return;
      }
      // Flechas, +, - y Supr actúan sobre el carrito solo con el campo de escaneo vacío,
      // para no molestar mientras se escribe un nombre.
      const enEscaner = e.target === campo.current;
      const escribiendo =
        (enEscaner && campo.current?.value !== '') ||
        (!enEscaner && e.target instanceof HTMLInputElement);
      if (escribiendo || e.defaultPrevented) return;
      const seleccionado = carrito.items[carrito.seleccionado];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        despachar({ tipo: 'seleccionar', indice: carrito.seleccionado + delta });
      } else if ((e.key === '+' || e.key === '-') && seleccionado) {
        e.preventDefault();
        despachar({ tipo: 'sumar', clave: seleccionado.clave, delta: e.key === '+' ? 1 : -1 });
      } else if (e.key === 'Delete' && seleccionado) {
        e.preventDefault();
        despachar({ tipo: 'quitar', clave: seleccionado.clave });
      }
    };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  });

  const propsCobro = {
    total,
    enviando: cobro.isPending,
    error: cobro.error,
    alConfirmar: cobrar,
    alCerrar: () => setDialogo(null),
  };

  return (
    <section className="space-y-4 pb-28">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>
          Turno de <strong>{responsable.nombre}</strong>
        </span>
        <span className="flex gap-2">
          <button
            type="button"
            className="boton-secundario"
            onClick={() => abrir({ tipo: 'caja' })}
          >
            Caja (F8)
          </button>
          <button
            type="button"
            className="boton-secundario"
            disabled={!vacio}
            title={vacio ? undefined : 'Cobrá o vaciá el carrito antes de cerrar el turno.'}
            onClick={() => abrir({ tipo: 'cerrarTurno' })}
          >
            Cerrar turno
          </button>
        </span>
      </div>
      <div className="rounded-lg bg-white p-4 shadow">
        <EscanerDeProductos<ProductoVenta>
          campoRef={campo}
          alElegir={(producto) => {
            setAviso(null);
            despachar({ tipo: 'agregar', producto });
          }}
          alNoEncontrar={sonarError}
          avisoInexistente="Revisá el código o usá F7 para cobrarlo como Varios."
        />
      </div>

      {aviso && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">
          {aviso}
        </p>
      )}

      <div className="rounded-lg bg-white shadow">
        <table className="w-full text-left" aria-label="Carrito">
          <thead className="border-b text-sm text-slate-600">
            <tr>
              <th className="p-3">Producto</th>
              <th className="p-3 text-center">Cantidad</th>
              <th className="hidden p-3 text-right sm:table-cell">Precio</th>
              <th className="p-3 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {vacio && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-slate-500">
                  Escaneá un producto para empezar.
                </td>
              </tr>
            )}
            {carrito.items.map((item, i) => (
              <tr
                key={item.clave}
                aria-selected={i === carrito.seleccionado}
                onClick={() => despachar({ tipo: 'seleccionar', indice: i })}
                className={`border-b last:border-0 ${
                  i === carrito.seleccionado ? 'bg-slate-100' : ''
                } ${item.precioCambio ? 'bg-amber-100' : ''}`}
              >
                <td className="p-3">
                  {item.tipo === 'producto' ? item.nombre : item.descripcion}
                  {item.tipo === 'varios' && (
                    <span className="ml-2 rounded bg-slate-200 px-1.5 text-xs">Varios</span>
                  )}
                </td>
                <td className="p-3">
                  <span className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      tabIndex={-1}
                      className="boton-secundario px-2 py-0"
                      aria-label={`Restar uno a ${item.tipo === 'producto' ? item.nombre : item.descripcion}`}
                      onClick={() => despachar({ tipo: 'sumar', clave: item.clave, delta: -1 })}
                    >
                      −
                    </button>
                    <span className="w-8 text-center font-semibold">{item.cantidad}</span>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="boton-secundario px-2 py-0"
                      aria-label={`Sumar uno a ${item.tipo === 'producto' ? item.nombre : item.descripcion}`}
                      onClick={() => despachar({ tipo: 'sumar', clave: item.clave, delta: 1 })}
                    >
                      +
                    </button>
                  </span>
                </td>
                <td className="hidden p-3 text-right sm:table-cell">
                  {formatearPesos(item.precio)}
                </td>
                <td className="p-3 text-right">{formatearPesos(subtotal(item))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="flex items-center justify-between border-t p-4 text-2xl font-bold">
          <span>Total</span>
          <span data-testid="total">{formatearPesos(total)}</span>
        </p>
      </div>

      {ultimaVenta && (
        <div
          role="region"
          aria-label="Última venta"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-green-50 p-4 text-green-900"
        >
          <p>
            <strong>Venta #{ultimaVenta.numero} cobrada</strong> ·{' '}
            {formatearPesos(ultimaVenta.total)}
            {ultimaVenta.pagos.map((p) =>
              p.vuelto ? (
                <span key={p.medio} className="ml-2 text-xl font-bold">
                  Vuelto: {formatearPesos(p.vuelto)}
                </span>
              ) : null,
            )}
          </p>
          <button
            type="button"
            className="boton-secundario"
            onClick={() => {
              imprimir(ultimaVenta);
              campo.current?.focus();
            }}
          >
            Imprimir ticket (F9)
          </button>
        </div>
      )}

      {dialogo?.tipo === 'cobro' && <DialogoCobro medio={dialogo.medio} {...propsCobro} />}
      {dialogo?.tipo === 'mixto' && <DialogoPagoMixto {...propsCobro} />}
      {dialogo?.tipo === 'caja' && (
        <DialogoCaja esAdmin={esAdmin} alCerrar={() => setDialogo(null)} />
      )}
      {dialogo?.tipo === 'cerrarTurno' && (
        <DialogoCerrarTurno
          turnoId={turnoId}
          responsable={responsable}
          esMio={esMio}
          alCancelar={() => setDialogo(null)}
        />
      )}
      {dialogo?.tipo === 'varios' && (
        <DialogoVarios
          alCerrar={() => setDialogo(null)}
          alAgregar={(descripcion, precio) => {
            despachar({
              tipo: 'agregarVarios',
              descripcion,
              precio,
              clave: `varios-${Date.now()}-${++contadorVarios}`,
            });
            setDialogo(null);
          }}
        />
      )}

      <footer
        aria-label="Atajos de teclado"
        className="fixed right-0 bottom-0 left-0 border-t bg-slate-800 px-4 py-2 text-sm text-slate-100"
      >
        <ul className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1">
          {REFERENCIA_ATAJOS.map(([tecla, accion]) => (
            <li key={tecla}>
              <kbd className="rounded bg-slate-600 px-1.5 font-mono">{tecla}</kbd> {accion}
            </li>
          ))}
        </ul>
      </footer>
      {ticket}
    </section>
  );
}
