import { sumar } from '@kiosco/shared';
import { vi } from 'vitest';
import { crearApp } from '../src/app.js';
import { crearArcaFalso, PUNTO_VENTA } from './arca-falso.js';
import { prismaTest } from './base.js';

/*
 * Ayudas de los tests de facturación.
 *
 * Contrato asumido (el design no lo detalla y se eligió lo más simple):
 * - `crearApp({ facturacion })` recibe `{ config, arca, despertar, estado }`:
 *   `config` son las variables `ARCA_*` tal como las deja `cargarConfig`
 *   (punto de venta como número) y `estado()` devuelve el estado de la última
 *   pasada: 'disponible' | 'no_disponible' | 'autenticacion_bloqueada'.
 * - `encolarFacturaSiCorresponde(tx, venta, { facturacion, ahora })` recibe ese
 *   mismo objeto (o `undefined` sin configuración) y `ahora` como `Date`.
 * - `procesarFacturas({ prisma, arca, config, ahora })` recibe la misma `config`
 *   y `ahora` como función, igual que `procesarPendientes` de WhatsApp.
 */

export { PUNTO_VENTA };
export const CUIT = '20123456786';

/** Las variables `ARCA_*` ya validadas (como salen de `cargarConfig`). */
export function configArca(cambios: Record<string, unknown> = {}) {
  return {
    ARCA_CUIT: CUIT,
    ARCA_PUNTO_VENTA: PUNTO_VENTA,
    ARCA_ENTORNO: 'homologacion' as 'homologacion' | 'produccion',
    ARCA_CERT_PATH: '/run/secrets/arca/certificado.crt',
    ARCA_KEY_PATH: '/run/secrets/arca/clave.key',
    ARCA_NOMBRE_FANTASIA: 'Kiosco Las Flores',
    ARCA_RAZON_SOCIAL: 'Pérez Juan',
    ARCA_DOMICILIO: 'Av. Rivadavia 1234, Morón',
    ARCA_INICIO_ACTIVIDADES: '2020-03-01',
    ARCA_IIBB: 'Exento',
    ...cambios,
  };
}

export type EstadoArca = 'disponible' | 'no_disponible' | 'autenticacion_bloqueada';

/** Lo que `server.ts` le pasa a `crearApp` cuando hay configuración de ARCA. */
export function opcionesFacturacion(
  arca = crearArcaFalso().cliente,
  estado: EstadoArca = 'disponible',
  config = configArca(),
) {
  return { config, arca, despertar: vi.fn(), estado: () => estado };
}

export type OpcionesFacturacion = ReturnType<typeof opcionesFacturacion>;

/** App con reloj ajustable y, si se pasa, la facturación configurada. */
export async function crearAppConFacturacion(inicio: Date, facturacion?: OpcionesFacturacion) {
  let ahora = inicio;
  const app = await crearApp({ prisma: prismaTest, ahora: () => ahora, facturacion });
  return {
    app,
    fijarHora(instante: Date) {
      ahora = instante;
    },
  };
}

/** "2026-11-10" menos `dias` días → "2026-11-05" (cuenta propia del test, en UTC). */
export function fechaMenosDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** 00:00 de Argentina del día "AAAA-MM-DD" (UTC−3 fijo). */
export function inicioDelDiaEnArgentina(fecha: string): Date {
  return new Date(Date.parse(`${fecha}T03:00:00Z`));
}

type Medio = 'efectivo' | 'debito' | 'credito' | 'mercado_pago';

/**
 * Venta guardada directo en la base, sin turno ni stock: para los tests que
 * necesitan fechas pasadas o estados que la API no deja crear (total $0).
 */
export async function crearVentaDirecta({
  usuarioId,
  creadaEn,
  pagos,
  estado = 'pagada',
}: {
  usuarioId: string;
  creadaEn: Date;
  pagos: { medio: Medio; monto: string }[];
  estado?: 'pagada' | 'anulada';
}) {
  const total = sumar(...pagos.map((p) => p.monto));
  return prismaTest.venta.create({
    data: {
      usuarioId,
      total,
      estado,
      creadaEn,
      ...(estado === 'anulada' && {
        anuladaEn: creadaEn,
        anuladaPorId: usuarioId,
        motivoAnulacion: 'prueba',
      }),
      items: {
        create: [{ descripcion: 'Varios', cantidad: 1, precioUnitario: total, subtotal: total }],
      },
      pagos: { create: pagos },
    },
    include: { pagos: true },
  });
}

/** Factura guardada directo en la base: por defecto, automática y `pendiente` de $3.300. */
export function crearFacturaDirecta(ventaId: string, datos: Record<string, unknown> = {}) {
  return prismaTest.factura.create({
    data: {
      ventaId,
      parte: 'electronica',
      estado: 'pendiente',
      puntoVenta: PUNTO_VENTA,
      tipoComprobante: 11,
      importe: '3300.00',
      creadaEn: new Date('2026-11-10T13:00:00Z'),
      ...datos,
    },
  });
}

/** Facturas de una venta, la automática primero. */
export function facturasDe(ventaId: string) {
  return prismaTest.factura.findMany({ where: { ventaId }, orderBy: { parte: 'asc' } });
}

/** Avisos de tipo `factura`, del más viejo al más nuevo. */
export function avisosDeFactura() {
  return prismaTest.notificacion.findMany({
    where: { tipo: 'factura' },
    orderBy: [{ creadaEn: 'asc' }, { id: 'asc' }],
  });
}
