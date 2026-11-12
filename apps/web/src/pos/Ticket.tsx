import {
  comparar,
  NOMBRE_MEDIO,
  restar,
  sumar,
  type Emisor,
  type FacturaVenta,
  type VentaDetalle,
} from '@kiosco/shared';
import QRCode from 'qrcode';
import { useCallback, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { pedir } from '../api/cliente.js';
import { formatearFechaHora } from '../lib/fechas.js';
import { formatearPesos } from '../lib/montos.js';

const ANCHO_MM = import.meta.env.VITE_ANCHO_TICKET === '58' ? 58 : 80;
const NOMBRE_KIOSCO: string = import.meta.env.VITE_NOMBRE_KIOSCO || 'Kiosco';

/** Lo que espera F9 a que se autorice una factura en trámite antes de imprimir igual. */
const ESPERA_FACTURA_MS = 5_000;
const CONSULTA_FACTURA_MS = 1_000;

/** Facturas de la venta (las ventas viejas o sin facturación pueden no traerlas). */
function facturasDe(venta: VentaDetalle): FacturaVenta[] {
  return venta.facturas ?? [];
}

const estaEnTramite = (f: FacturaVenta) => f.estado === 'pendiente' || f.estado === 'en_curso';

/** Alguna factura todavía se está emitiendo. */
export function tieneFacturaEnTramite(venta: VentaDetalle): boolean {
  return facturasDe(venta).some(estaEnTramite);
}

/** "2026-11-20" → "20/11/2026". */
function fechaCorta(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  return `${dia}/${mes}/${anio}`;
}

/** "20123456786" → "20-12345678-6". */
export function formatearCuit(cuit: string): string {
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

/** QR de ARCA dibujado en SVG. `QRCode.create` es sincrónico: entra en el render del ticket. */
function QrFactura({ texto }: { texto: string }) {
  const { modules } = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  let camino = '';
  for (let fila = 0; fila < modules.size; fila++) {
    for (let columna = 0; columna < modules.size; columna++) {
      if (modules.get(fila, columna)) camino += `M${columna} ${fila}h1v1h-1z`;
    }
  }
  const lado = modules.size + 4;
  return (
    <svg
      className="ticket-qr"
      viewBox={`-2 -2 ${lado} ${lado}`}
      role="img"
      aria-label="Código QR de ARCA"
      shapeRendering="crispEdges"
    >
      <rect x={-2} y={-2} width={lado} height={lado} fill="#fff" />
      <path d={camino} fill="#000" />
    </svg>
  );
}

/** Una Factura C autorizada: número, importe que ampara, CAE y QR. */
function BloqueFactura({ factura, emisor }: { factura: FacturaVenta; emisor: Emisor }) {
  return (
    <div data-testid="bloque-factura" className="ticket-bloque">
      <p className="ticket-centro ticket-titulo">FACTURA C – Cód. 011</p>
      {emisor.entorno === 'homologacion' && (
        <p className="ticket-centro ticket-titulo">HOMOLOGACIÓN – SIN VALIDEZ FISCAL</p>
      )}
      <p className="ticket-fila">
        <span>N.º</span>
        <span>{factura.numero}</span>
      </p>
      {factura.fecha && (
        <p className="ticket-fila">
          <span>Fecha</span>
          <span>{fechaCorta(factura.fecha)}</span>
        </p>
      )}
      <p className="ticket-fila ticket-titulo">
        <span>Facturado: {formatearPesos(factura.importe)}</span>
      </p>
      <p>CAE: {factura.cae}</p>
      {factura.caeVencimiento && <p>Vto. CAE: {fechaCorta(factura.caeVencimiento)}</p>}
      {factura.qrUrl && (
        <div className="ticket-centro">
          <QrFactura texto={factura.qrUrl} />
        </div>
      )}
    </div>
  );
}

/**
 * Parte fiscal del ticket de una venta con factura autorizada: los datos del
 * emisor una sola vez, un bloque por factura y lo que quedó sin facturar.
 */
function PieFiscal({ venta, emisor }: { venta: VentaDetalle; emisor: Emisor }) {
  const facturas = facturasDe(venta);
  const autorizadas = facturas.filter((f) => f.estado === 'autorizada');
  const enTramite = sumar('0', ...facturas.filter(estaEnTramite).map((f) => f.importe));
  // Lo que no tiene factura ni la está esperando.
  const sinFacturar = restar(venta.sinFacturar ?? '0', enTramite);
  return (
    <>
      <p>{emisor.domicilio}</p>
      <p>IIBB: {emisor.iibb}</p>
      <p>Inicio de actividades: {fechaCorta(emisor.inicioActividades)}</p>
      <p>Responsable Monotributo</p>
      <p>Consumidor final</p>
      {autorizadas.map((f) => (
        <div key={f.id}>
          <hr />
          <BloqueFactura factura={f} emisor={emisor} />
        </div>
      ))}
      {comparar(sinFacturar, 0) > 0 && (
        <>
          <hr />
          <p className="ticket-centro">
            Sin facturar: {formatearPesos(sinFacturar)} – no válido como factura
          </p>
        </>
      )}
    </>
  );
}

/**
 * Ticket para la térmica (58 u 80 mm). Solo se ve al imprimir. Con alguna
 * factura autorizada lleva arriba el emisor y abajo la parte fiscal; si no, es
 * el ticket de siempre, "No válido como factura".
 */
export function Ticket({ venta }: { venta: VentaDetalle }) {
  const facturas = facturasDe(venta);
  const emisor = venta.emisor ?? null;
  const conFactura = emisor !== null && facturas.some((f) => f.estado === 'autorizada');
  return (
    <div className="ticket" data-testid="ticket" style={{ width: `${ANCHO_MM - 4}mm` }}>
      {/* El tamaño de página depende del ancho configurado, así que va en línea. */}
      <style>{`@page { size: ${ANCHO_MM}mm auto; margin: 0 }`}</style>
      {conFactura ? (
        <>
          <p className="ticket-centro ticket-titulo ticket-grande">{emisor.nombreFantasia}</p>
          <p className="ticket-centro">
            {emisor.razonSocial} – CUIT {formatearCuit(emisor.cuit)}
          </p>
        </>
      ) : (
        <p className="ticket-centro ticket-titulo">{NOMBRE_KIOSCO}</p>
      )}
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
      {conFactura && <PieFiscal venta={venta} emisor={emisor} />}
      {facturas.filter(estaEnTramite).map((f) => (
        <p key={f.id} className="ticket-centro">
          Factura en trámite: {formatearPesos(f.importe)} – pedila de nuevo desde Ventas
        </p>
      ))}
      {!conFactura && <p className="ticket-centro">No válido como factura</p>}
    </div>
  );
}

const esperar = (ms: number) => new Promise((listo) => setTimeout(listo, ms));

/**
 * Imprime un ticket solo cuando se pide: lo dibuja fuera de la app (en el
 * body) y llama a `window.print()`, que usa la térmica como impresora por defecto.
 */
export function useImpresionTicket() {
  const [venta, setVenta] = useState<VentaDetalle | null>(null);
  const esperando = useRef(false);

  const imprimir = useCallback((aImprimir: VentaDetalle) => {
    // flushSync: el ticket tiene que estar dibujado antes de abrir la impresión.
    flushSync(() => setVenta(aImprimir));
    window.print();
  }, []);

  /**
   * Si alguna factura está en trámite, consulta la venta cada 1 s hasta 5 s y
   * después imprime lo que haya (lo autorizado como Factura C y el resto "en
   * trámite"). Devuelve la venta impresa, por si la pantalla quiere mostrarla.
   */
  const imprimirConFactura = useCallback(
    async (aImprimir: VentaDetalle): Promise<VentaDetalle> => {
      if (!tieneFacturaEnTramite(aImprimir)) {
        imprimir(aImprimir);
        return aImprimir;
      }
      if (esperando.current) return aImprimir;
      esperando.current = true;
      let actual = aImprimir;
      try {
        const inicio = Date.now();
        while (tieneFacturaEnTramite(actual) && Date.now() - inicio < ESPERA_FACTURA_MS) {
          await esperar(CONSULTA_FACTURA_MS);
          try {
            actual = await pedir<VentaDetalle>('GET', `/ventas/${actual.id}`);
          } catch {
            break; // Sin conexión: se imprime lo que hay.
          }
        }
        imprimir(actual);
      } finally {
        esperando.current = false;
      }
      return actual;
    },
    [imprimir],
  );

  const ticket = venta
    ? createPortal(
        <div className="ticket-impresion">
          <Ticket venta={venta} />
        </div>,
        document.body,
      )
    : null;

  return { imprimir, imprimirConFactura, ticket };
}
