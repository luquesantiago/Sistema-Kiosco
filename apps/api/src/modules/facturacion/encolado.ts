import { comparar, sumar } from '@kiosco/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { MOTIVOS, textoAvisoFacturaConError } from './avisos.js';
import { TIPO_FACTURA_C, TOPE_CONSUMIDOR_FINAL } from './reglas.js';
import type { Facturacion } from './tipos.js';

type Tx = Prisma.TransactionClient;
type Parte = 'electronica' | 'efectivo';

/** Un pago de la venta: `monto` como texto o como el Decimal de Prisma. */
interface PagoParaFacturar {
  medio: string;
  monto: string | { toString(): string };
}

/**
 * Lo que vale cada parte de la venta: la electrónica (débito, crédito y MP) y
 * el efectivo, con 2 decimales. Como hay un pago por medio y los pagos suman
 * el total, las dos partes suman siempre el total de la venta.
 */
export function importePorParte(pagos: PagoParaFacturar[]): {
  electronica: string;
  efectivo: string;
} {
  const de = (esEfectivo: boolean) =>
    sumar(
      '0',
      ...pagos.filter((p) => (p.medio === 'efectivo') === esEfectivo).map((p) => String(p.monto)),
    );
  return { electronica: de(false), efectivo: de(true) };
}

/** Lo que hace falta de la venta para encolar su factura. */
export interface VentaParaFacturar {
  id: string;
  numero: number;
  estado: string;
  creadaEn: Date;
  pagos: PagoParaFacturar[];
}

/**
 * Crea la factura de una parte de la venta, si no existe (el único
 * `(ventaId, parte)` la hace idempotente). Si su importe alcanza el tope de
 * consumidor final, nace en `error` y en la misma transacción se crea el aviso
 * al admin: así la cola nunca la ve. Devuelve si la creó.
 */
export async function crearFactura(
  tx: Tx,
  {
    venta,
    parte,
    importe,
    pedidaPorId = null,
    facturacion,
    ahora,
  }: {
    venta: Pick<VentaParaFacturar, 'id' | 'numero' | 'creadaEn'>;
    parte: Parte;
    importe: string;
    pedidaPorId?: string | null;
    facturacion: Facturacion;
    ahora: Date;
  },
): Promise<boolean> {
  const alcanzaTope = comparar(importe, TOPE_CONSUMIDOR_FINAL) >= 0;
  const motivo = alcanzaTope ? MOTIVOS.tope(TOPE_CONSUMIDOR_FINAL) : null;
  const { count } = await tx.factura.createMany({
    data: {
      ventaId: venta.id,
      parte,
      pedidaPorId,
      estado: alcanzaTope ? 'error' : 'pendiente',
      puntoVenta: facturacion.config.ARCA_PUNTO_VENTA,
      tipoComprobante: TIPO_FACTURA_C,
      importe,
      codigoError: alcanzaTope ? 'tope' : null,
      error: motivo,
      creadaEn: ahora,
    },
    skipDuplicates: true,
  });
  if (count === 1 && motivo) {
    await tx.notificacion.create({
      data: {
        tipo: 'factura',
        destino: 'admin',
        texto: textoAvisoFacturaConError({
          ventaNumero: venta.numero,
          ventaCreadaEn: venta.creadaEn,
          importe,
          motivo,
        }),
        creadaEn: ahora,
      },
    });
  }
  return count === 1;
}

/**
 * Punto de enganche de la facturación automática: encola la factura de la
 * parte electrónica de una venta que quedó `pagada`. Se llama dentro de la
 * transacción que deja la venta pagada, para que se guarden las dos o ninguna:
 * hoy `registrarVenta` (toda venta nace pagada); `cobro-mercado-pago` la va a
 * llamar también en la transacción que pasa una venta `pendiente` a `pagada`.
 *
 * No hace nada sin facturación configurada, si la venta no está `pagada` o si
 * no tiene parte electrónica. Llamarla dos veces deja una sola factura. Nunca
 * habla con ARCA: la emisión corre por detrás (`emision.ts`).
 */
export async function encolarFacturaSiCorresponde(
  tx: Tx,
  venta: VentaParaFacturar,
  { facturacion, ahora }: { facturacion: Facturacion | undefined; ahora: Date },
): Promise<void> {
  if (!facturacion || venta.estado !== 'pagada') return;
  const { electronica } = importePorParte(venta.pagos);
  if (comparar(electronica, 0) <= 0) return;
  await crearFactura(tx, { venta, parte: 'electronica', importe: electronica, facturacion, ahora });
}
