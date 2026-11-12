import type { FacturaVenta, VentaDetalle } from '@kiosco/shared';
import { MensajeError } from '../app/MensajeError.js';
import { formatearPesos } from '../lib/montos.js';

/** Cómo se ve cada factura en la franja: autorizada con su número, o en trámite. */
function estadoFactura(f: FacturaVenta): string | null {
  if (f.estado === 'autorizada') return `Factura ${f.numero}`;
  if (f.estado === 'pendiente' || f.estado === 'en_curso') {
    return `Factura en trámite (${formatearPesos(f.importe)})`;
  }
  if (f.estado === 'error') return 'Factura con error (la revisa el admin)';
  return null;
}

/** Lo que se ofrece facturar a pedido: el efectivo, o la venta entera si fue toda en efectivo. */
function textoPedirFactura(venta: VentaDetalle): string {
  const efectivo = venta.pagos.find((p) => p.medio === 'efectivo');
  const mixta = venta.pagos.some((p) => p.medio !== 'efectivo');
  return mixta && efectivo
    ? `Facturar efectivo (${formatearPesos(efectivo.monto)})`
    : 'Pedir factura';
}

/**
 * Franja de la última venta cobrada: vuelto, facturas, pedir factura (F10) e
 * imprimir el ticket (F9). Los atajos los maneja la pantalla de venta.
 */
export function UltimaVenta({
  venta,
  puedePedirFactura,
  pidiendoFactura,
  errorFactura,
  alPedirFactura,
  alImprimir,
}: {
  venta: VentaDetalle;
  /** La facturación está configurada y hay efectivo sin facturar. */
  puedePedirFactura: boolean;
  pidiendoFactura: boolean;
  errorFactura: Error | null;
  alPedirFactura: () => void;
  alImprimir: () => void;
}) {
  const facturas = (venta.facturas ?? []).map(estadoFactura).filter((t) => t !== null);
  // Pago mixto con el Point: el Point ya cobró su parte; ahora se cobra el efectivo.
  const efectivo = venta.pagos.find((p) => p.medio === 'efectivo');
  const efectivoACobrar = venta.cobro && efectivo ? efectivo : null;
  return (
    <div
      role="region"
      aria-label="Última venta"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-green-50 p-4 text-green-900"
    >
      <div>
        <p>
          <strong>Venta #{venta.numero} cobrada</strong> · {formatearPesos(venta.total)}
          {efectivoACobrar && (
            <span className="ml-2 block text-xl font-bold">
              {`Cobrá ${formatearPesos(efectivoACobrar.monto)} en efectivo`}
              {efectivoACobrar.vuelto ? ` · vuelto ${formatearPesos(efectivoACobrar.vuelto)}` : ''}
            </span>
          )}
          {venta.pagos.map((p) =>
            p.vuelto && !efectivoACobrar ? (
              <span key={p.medio} className="ml-2 text-xl font-bold">
                Vuelto: {formatearPesos(p.vuelto)}
              </span>
            ) : null,
          )}
        </p>
        {facturas.length > 0 && <p className="text-sm">{facturas.join(' · ')}</p>}
        <MensajeError error={errorFactura} />
      </div>
      <span className="flex flex-wrap gap-2">
        {puedePedirFactura && (
          <button
            type="button"
            className="boton-secundario"
            disabled={pidiendoFactura}
            onClick={alPedirFactura}
          >
            {textoPedirFactura(venta)} (F10)
          </button>
        )}
        <button type="button" className="boton-secundario" onClick={alImprimir}>
          Imprimir ticket (F9)
        </button>
      </span>
    </div>
  );
}
