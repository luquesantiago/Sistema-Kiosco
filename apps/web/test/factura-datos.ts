import { EMPLEADO } from './ayudas.js';

/*
 * Datos de prueba de facturación para las pantallas (cambio facturacion-arca).
 *
 * Forma de `VentaDetalle` que asumen los tests (design, sección API):
 * - `facturas`: 0 a 2, la automática (`electronica`) primero, cada una con
 *   `id`, `parte`, `estado`, `numero` (formateado o null), `fecha`, `importe`,
 *   `cae`, `caeVencimiento` y `qrUrl` (solo si está autorizada).
 * - `sinFacturar`: total menos lo autorizado.
 * - `puedePedirFactura`: hay efectivo sin factura de la parte `efectivo`.
 * - `emisor`: datos de ARCA_* (null sin configuración).
 * `VentaResumen` suma `importeFacturado`.
 */

export const VENTA_ID = '0198a5b0-0000-7000-8000-000000000301';

export const EMISOR = {
  nombreFantasia: 'Kiosco Las Flores',
  razonSocial: 'Pérez Juan',
  cuit: '20123456786',
  domicilio: 'Av. Rivadavia 1234, Morón',
  iibb: 'Exento',
  inicioActividades: '2020-03-01',
  entorno: 'produccion' as 'produccion' | 'homologacion',
};

type Parte = 'electronica' | 'efectivo';

export function facturaAutorizada(numero: number, importe: string, parte: Parte = 'electronica') {
  return {
    id: `0198a5b0-0000-7000-8000-0000000005${String(numero).padStart(2, '0')}`,
    parte,
    estado: 'autorizada',
    numero: `00005-${String(numero).padStart(8, '0')}`,
    fecha: '2026-11-10',
    importe,
    cae: `7645123456789${numero % 10}`,
    caeVencimiento: '2026-11-20',
    qrUrl: `https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsIm5yb0NtcCI6${numero}fQ==`,
  };
}

export function facturaSinAutorizar(
  importe: string,
  parte: Parte = 'electronica',
  estado: 'pendiente' | 'en_curso' | 'error' | 'cancelada' = 'pendiente',
) {
  return {
    id: `0198a5b0-0000-7000-8000-0000000006${parte === 'electronica' ? '01' : '02'}`,
    parte,
    estado,
    numero: null,
    fecha: null,
    importe,
    cae: null,
    caeVencimiento: null,
    qrUrl: null,
  };
}

type Pago = { medio: 'efectivo' | 'debito' | 'credito' | 'mercado_pago'; monto: string };

/** Detalle de la venta #120 del 10/11/2026 con un "Varios" por el total. */
export function ventaDetalle({
  total = '3300.00',
  pagos = [{ medio: 'debito', monto: '3300.00' }] as Pago[],
  facturas = [] as unknown[],
  sinFacturar = total,
  puedePedirFactura = false,
  emisor = EMISOR as typeof EMISOR | null,
  estado = 'pagada',
} = {}) {
  return {
    id: VENTA_ID,
    numero: 120,
    creadaEn: '2026-11-10T13:00:00.000Z',
    usuario: { id: EMPLEADO.id, nombre: EMPLEADO.nombre },
    total,
    estado,
    medios: pagos.map((p) => p.medio),
    importeFacturado: '0.00',
    items: [
      {
        productoId: null,
        descripcion: 'Varios',
        cantidad: 1,
        precioUnitario: total,
        subtotal: total,
      },
    ],
    pagos: pagos.map((p) => ({ ...p, montoRecibido: null, vuelto: null })),
    anulacion: null,
    facturas,
    sinFacturar,
    puedePedirFactura,
    emisor,
  };
}

/** Venta mixta de $5.000: $2.000 en efectivo y $3.000 en débito. */
export const PAGOS_MIXTOS: Pago[] = [
  { medio: 'efectivo', monto: '2000.00' },
  { medio: 'debito', monto: '3000.00' },
];
