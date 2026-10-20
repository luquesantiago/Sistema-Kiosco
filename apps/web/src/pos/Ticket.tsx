import { NOMBRE_MEDIO, type VentaDetalle } from '@kiosco/shared';
import { useCallback, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { formatearFechaHora } from '../lib/fechas.js';
import { formatearPesos } from '../lib/montos.js';

const ANCHO_MM = import.meta.env.VITE_ANCHO_TICKET === '58' ? 58 : 80;
const NOMBRE_KIOSCO: string = import.meta.env.VITE_NOMBRE_KIOSCO || 'Kiosco';

/** Ticket para la térmica (58 u 80 mm). Solo se ve al imprimir. */
export function Ticket({ venta }: { venta: VentaDetalle }) {
  return (
    <div className="ticket" data-testid="ticket" style={{ width: `${ANCHO_MM - 4}mm` }}>
      {/* El tamaño de página depende del ancho configurado, así que va en línea. */}
      <style>{`@page { size: ${ANCHO_MM}mm auto; margin: 0 }`}</style>
      <p className="ticket-centro ticket-titulo">{NOMBRE_KIOSCO}</p>
      <p className="ticket-centro">Venta #{venta.numero}</p>
      <p className="ticket-centro">{formatearFechaHora(venta.creadaEn)}</p>
      <hr />
      {venta.items.map((item, i) => (
        <div key={i}>
          <p>{item.descripcion}</p>
          <p className="ticket-fila">
            <span>
              {item.cantidad} x {formatearPesos(item.precioUnitario)}
            </span>
            <span>{formatearPesos(item.subtotal)}</span>
          </p>
        </div>
      ))}
      <hr />
      <p className="ticket-fila ticket-titulo">
        <span>TOTAL</span>
        <span>{formatearPesos(venta.total)}</span>
      </p>
      {venta.pagos.map((p) => (
        <div key={p.medio}>
          <p className="ticket-fila">
            <span>{NOMBRE_MEDIO[p.medio]}</span>
            <span>{formatearPesos(p.monto)}</span>
          </p>
          {p.montoRecibido && p.vuelto && (
            <>
              <p className="ticket-fila">
                <span>Paga con</span>
                <span>{formatearPesos(p.montoRecibido)}</span>
              </p>
              <p className="ticket-fila">
                <span>Vuelto</span>
                <span>{formatearPesos(p.vuelto)}</span>
              </p>
            </>
          )}
        </div>
      ))}
      <hr />
      <p className="ticket-centro">No válido como factura</p>
    </div>
  );
}

/**
 * Imprime un ticket solo cuando se pide: lo dibuja fuera de la app (en el
 * body) y llama a `window.print()`, que usa la térmica como impresora por defecto.
 */
export function useImpresionTicket() {
  const [venta, setVenta] = useState<VentaDetalle | null>(null);

  const imprimir = useCallback((aImprimir: VentaDetalle) => {
    // flushSync: el ticket tiene que estar dibujado antes de abrir la impresión.
    flushSync(() => setVenta(aImprimir));
    window.print();
  }, []);

  const ticket = venta
    ? createPortal(
        <div className="ticket-impresion">
          <Ticket venta={venta} />
        </div>,
        document.body,
      )
    : null;

  return { imprimir, ticket };
}
