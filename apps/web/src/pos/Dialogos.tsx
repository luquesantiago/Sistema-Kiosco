import {
  calcularVuelto,
  comparar,
  MEDIOS_PAGO,
  NOMBRE_MEDIO,
  restar,
  sonIguales,
  sumar,
  type MedioPago,
  type PagoEntrada,
} from '@kiosco/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { MensajeError } from '../app/MensajeError.js';
import { entradaAMonto, formatearPesos } from '../lib/montos.js';

/** Diálogo modal del mostrador: Esc lo cierra. */
export function Dialogo({
  titulo,
  alCerrar,
  children,
}: {
  titulo: string;
  alCerrar: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          alCerrar();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 className="text-xl font-semibold">{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

function TotalGrande({ total }: { total: string }) {
  return (
    <p className="text-center">
      <span className="block text-sm text-slate-600">Total</span>
      <span className="text-4xl font-bold">{formatearPesos(total)}</span>
    </p>
  );
}

interface PropsCobro {
  total: string;
  enviando: boolean;
  error: Error | null;
  alConfirmar: (pagos: PagoEntrada[]) => void;
  alCerrar: () => void;
}

/** Cobro del total con un solo medio. En efectivo, "Paga con" opcional y el vuelto. */
export function DialogoCobro({
  medio,
  total,
  enviando,
  error,
  alConfirmar,
  alCerrar,
}: PropsCobro & { medio: MedioPago }) {
  const [pagaCon, setPagaCon] = useState('');
  const recibido = pagaCon.trim() === '' ? null : entradaAMonto(pagaCon);
  const invalido = pagaCon.trim() !== '' && recibido === null;
  const noAlcanza = recibido !== null && comparar(recibido, total) < 0;

  const confirmar = (e: FormEvent) => {
    e.preventDefault();
    if (enviando || invalido || noAlcanza) return;
    alConfirmar([{ medio, monto: total, ...(recibido ? { montoRecibido: recibido } : {}) }]);
  };

  return (
    <Dialogo titulo={`Cobro en ${NOMBRE_MEDIO[medio]}`} alCerrar={alCerrar}>
      <form onSubmit={confirmar} className="space-y-4">
        <TotalGrande total={total} />
        {medio === 'efectivo' && (
          <>
            <label className="block">
              <span className="text-sm font-medium">Paga con (opcional)</span>
              <input
                className="campo text-2xl"
                inputMode="decimal"
                autoFocus
                autoComplete="off"
                value={pagaCon}
                onChange={(e) => setPagaCon(e.target.value)}
              />
            </label>
            {recibido && !noAlcanza && (
              <p className="text-center" role="status">
                <span className="block text-sm text-slate-600">Vuelto</span>
                <span className="text-4xl font-bold text-green-700">
                  {formatearPesos(calcularVuelto(total, recibido))}
                </span>
              </p>
            )}
            {(invalido || noAlcanza) && (
              <p role="alert" className="text-sm text-red-700">
                {invalido ? 'Escribí un monto válido.' : 'Con eso no alcanza para el total.'}
              </p>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="boton"
            autoFocus={medio !== 'efectivo'}
            disabled={enviando || invalido || noAlcanza}
          >
            Confirmar (Enter)
          </button>
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cancelar (Esc)
          </button>
        </div>
        <MensajeError error={error} />
      </form>
    </Dialogo>
  );
}

/** Pago mixto: el total repartido entre varios medios, hasta que no falte nada. */
export function DialogoPagoMixto({ total, enviando, error, alConfirmar, alCerrar }: PropsCobro) {
  const [montos, setMontos] = useState<Record<MedioPago, string>>({
    efectivo: '',
    debito: '',
    credito: '',
    mercado_pago: '',
  });
  const cargados = MEDIOS_PAGO.filter((m) => montos[m].trim() !== '');
  const valores = cargados.map((m) => entradaAMonto(montos[m]));
  const hayInvalidos = valores.some((v) => v === null || comparar(v, '0') <= 0);
  const asignado = sumar(...valores.filter((v): v is string => v !== null));
  const falta = restar(total, asignado);
  const completo = !hayInvalidos && cargados.length > 0 && sonIguales(falta, '0');

  const confirmar = (e: FormEvent) => {
    e.preventDefault();
    if (!completo || enviando) return;
    alConfirmar(cargados.map((medio) => ({ medio, monto: entradaAMonto(montos[medio])! })));
  };

  return (
    <Dialogo titulo="Pago mixto" alCerrar={alCerrar}>
      <form onSubmit={confirmar} className="space-y-4">
        <TotalGrande total={total} />
        <div className="grid grid-cols-2 gap-3">
          {MEDIOS_PAGO.map((medio, i) => (
            <label key={medio}>
              <span className="text-sm font-medium">{NOMBRE_MEDIO[medio]}</span>
              <input
                className="campo"
                inputMode="decimal"
                autoFocus={i === 0}
                autoComplete="off"
                value={montos[medio]}
                onChange={(e) => setMontos({ ...montos, [medio]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <p role="status" className="text-center text-lg font-semibold">
          {hayInvalidos
            ? 'Revisá los montos.'
            : comparar(falta, '0') >= 0
              ? `Falta asignar ${formatearPesos(falta)}`
              : `Sobran ${formatearPesos(restar(asignado, total))}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="boton" disabled={!completo || enviando}>
            Confirmar (Enter)
          </button>
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cancelar (Esc)
          </button>
        </div>
        <MensajeError error={error} />
      </form>
    </Dialogo>
  );
}

/** Ítem "Varios": precio obligatorio y descripción opcional. */
export function DialogoVarios({
  alAgregar,
  alCerrar,
}: {
  alAgregar: (descripcion: string, precio: string) => void;
  alCerrar: () => void;
}) {
  const [precio, setPrecio] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [error, setError] = useState<string | null>(null);

  const agregar = (e: FormEvent) => {
    e.preventDefault();
    const monto = entradaAMonto(precio);
    if (monto === null || comparar(monto, '0') <= 0) {
      setError('Escribí un precio mayor que cero.');
      return;
    }
    alAgregar(descripcion.trim() || 'Varios', monto);
  };

  return (
    <Dialogo titulo='Agregar "Varios"' alCerrar={alCerrar}>
      <form onSubmit={agregar} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Precio</span>
          <input
            className="campo text-2xl"
            inputMode="decimal"
            autoFocus
            autoComplete="off"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Descripción (opcional)</span>
          <input
            className="campo"
            autoComplete="off"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="boton">
            Agregar (Enter)
          </button>
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cancelar (Esc)
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
