import { restar, sumar } from '@kiosco/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase, prismaTest } from './base.js';
import { abrirTurnoDePrueba, crearUsuarioDePrueba, sesionDe } from './ayudas.js';
import { crearArcaFalso } from './arca-falso.js';
import {
  avisosDeFactura,
  crearAppConFacturacion,
  crearVentaDirecta,
  facturasDe,
  opcionesFacturacion,
  type OpcionesFacturacion,
} from './facturacion-ayudas.js';

/*
 * Qué parte de una venta se factura sola y cuándo se encola (specs/facturacion:
 * "Ventas que se facturan solas", "Encolado al quedar pagada" y "Tope para no
 * identificar al cliente").
 *
 * Firmas del design:
 * - `importePorParte(pagos)` → `{ electronica, efectivo }`, textos con 2 decimales.
 * - `encolarFacturaSiCorresponde(tx, venta, { facturacion, ahora })`.
 * Los módulos se importan dentro de cada test: mientras no existan, falla cada
 * test por su cuenta y no el archivo entero.
 */
const encolado = () => import('../src/modules/facturacion/encolado.js');
const reglas = () => import('../src/modules/facturacion/reglas.js');

/** Martes 10/11/2026 a las 10:00 de Argentina. */
const HOY = new Date('2026-11-10T13:00:00Z');

type Medio = 'efectivo' | 'debito' | 'credito' | 'mercado_pago';
type Pago = { medio: Medio; monto: string };

beforeEach(async () => {
  await limpiarBase();
});

async function preparar({ conFacturacion = true } = {}) {
  const { falso, cliente } = crearArcaFalso();
  const facturacion = conFacturacion ? opcionesFacturacion(cliente) : undefined;
  const { app } = await crearAppConFacturacion(HOY, facturacion);
  const juan = await crearUsuarioDePrueba('juan');
  const empleado = await sesionDe(app, 'juan');
  await abrirTurnoDePrueba(app, empleado);
  return { app, empleado, falso, facturacion, juan };
}

type Ctx = Awaited<ReturnType<typeof preparar>>;

/** Vende un "Varios" del total indicado con los pagos dados. */
async function vender(ctx: Ctx, total: string, pagos: Pago[]) {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/ventas',
    cookies: ctx.empleado,
    payload: { items: [{ varios: { precio: total }, cantidad: 1 }], pagos, totalEsperado: total },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; numero: number };
}

describe('importePorParte', () => {
  it.each<[string, Pago[], string, string]>([
    ['100% débito', [{ medio: 'debito', monto: '3300' }], '3300.00', '0.00'],
    [
      'débito, crédito y MP',
      [
        { medio: 'debito', monto: '1100' },
        { medio: 'credito', monto: '1100' },
        { medio: 'mercado_pago', monto: '1100' },
      ],
      '3300.00',
      '0.00',
    ],
    [
      'mixta $2.000 + $3.000',
      [
        { medio: 'efectivo', monto: '2000' },
        { medio: 'debito', monto: '3000' },
      ],
      '3000.00',
      '2000.00',
    ],
    [
      'parte electrónica de un centavo',
      [
        { medio: 'efectivo', monto: '4999.99' },
        { medio: 'mercado_pago', monto: '0.01' },
      ],
      '0.01',
      '4999.99',
    ],
    [
      'efectivo de un centavo',
      [
        { medio: 'efectivo', monto: '0.01' },
        { medio: 'credito', monto: '4999.99' },
      ],
      '4999.99',
      '0.01',
    ],
    [
      'efectivo, débito y MP',
      [
        { medio: 'efectivo', monto: '1000' },
        { medio: 'debito', monto: '2000' },
        { medio: 'mercado_pago', monto: '3000' },
      ],
      '5000.00',
      '1000.00',
    ],
    ['100% efectivo', [{ medio: 'efectivo', monto: '3300' }], '0.00', '3300.00'],
    ['débito de $0,00', [{ medio: 'debito', monto: '0' }], '0.00', '0.00'],
  ])('%s: separa la parte electrónica y la de efectivo', async (_caso, pagos, electronica, efectivo) => {
    const { importePorParte } = await encolado();

    const partes = importePorParte(pagos);

    expect(partes).toEqual({ electronica, efectivo });
    // Las dos partes suman siempre el total de la venta.
    expect(sumar(partes.electronica, partes.efectivo)).toBe(
      sumar(...pagos.map((p) => p.monto)),
    );
  });
});

describe('factura automática al registrar una venta', () => {
  it.each<Medio>(['debito', 'credito', 'mercado_pago'])(
    'venta toda en %s por $3.300 → una factura automática pendiente de $3.300',
    async (medio) => {
      const ctx = await preparar();

      const venta = await vender(ctx, '3300', [{ medio, monto: '3300' }]);

      const facturas = await facturasDe(venta.id);
      expect(facturas).toHaveLength(1);
      expect(facturas[0]).toMatchObject({
        parte: 'electronica',
        estado: 'pendiente',
        puntoVenta: 5,
        tipoComprobante: 11,
        numero: null,
        fechaComprobante: null,
        cae: null,
        intentos: 0,
        pedidaPorId: null,
        codigoError: null,
      });
      expect(facturas[0]!.importe.toFixed(2)).toBe('3300.00');
    },
  );

  it.each<[string, string, Pago[], string]>([
    [
      '$2.000 efectivo + $3.000 débito',
      '5000',
      [
        { medio: 'efectivo', monto: '2000' },
        { medio: 'debito', monto: '3000' },
      ],
      '3000.00',
    ],
    [
      '$4.999,99 efectivo + $0,01 MP',
      '5000',
      [
        { medio: 'efectivo', monto: '4999.99' },
        { medio: 'mercado_pago', monto: '0.01' },
      ],
      '0.01',
    ],
    [
      '$0,01 efectivo + $4.999,99 crédito',
      '5000',
      [
        { medio: 'efectivo', monto: '0.01' },
        { medio: 'credito', monto: '4999.99' },
      ],
      '4999.99',
    ],
    [
      '$1.000 efectivo + $2.000 débito + $3.000 MP',
      '6000',
      [
        { medio: 'efectivo', monto: '1000' },
        { medio: 'debito', monto: '2000' },
        { medio: 'mercado_pago', monto: '3000' },
      ],
      '5000.00',
    ],
  ])('venta mixta %s → factura automática solo por la parte electrónica', async (_caso, total, pagos, importe) => {
    const ctx = await preparar();

    const venta = await vender(ctx, total, pagos);

    const facturas = await facturasDe(venta.id);
    expect(facturas.map((f) => [f.parte, f.estado, f.importe.toFixed(2)])).toEqual([
      ['electronica', 'pendiente', importe],
    ]);
  });

  it('venta 100% en efectivo → no tiene factura', async () => {
    const ctx = await preparar();

    const venta = await vender(ctx, '3300', [{ medio: 'efectivo', monto: '3300' }]);

    expect(await facturasDe(venta.id)).toEqual([]);
  });

  it('venta en débito de $0,01 → factura pendiente de $0,01', async () => {
    const ctx = await preparar();

    const venta = await vender(ctx, '0.01', [{ medio: 'debito', monto: '0.01' }]);

    const facturas = await facturasDe(venta.id);
    expect(facturas.map((f) => [f.estado, f.importe.toFixed(2)])).toEqual([
      ['pendiente', '0.01'],
    ]);
  });

  it('venta en débito de $0,00 → no tiene factura', async () => {
    // La API no deja cobrar $0: se guarda directo y se llama a la función.
    const { encolarFacturaSiCorresponde } = await encolado();
    const { facturacion, juan } = await preparar();
    const venta = await crearVentaDirecta({
      usuarioId: juan.id,
      creadaEn: HOY,
      pagos: [{ medio: 'debito', monto: '0.00' }],
    });

    await prismaTest.$transaction((tx) =>
      encolarFacturaSiCorresponde(tx, venta, { facturacion, ahora: HOY }),
    );

    expect(await facturasDe(venta.id)).toEqual([]);
  });

  it('se registra con ARCA caído: la venta sale en el momento y la factura queda pendiente', async () => {
    const ctx = await preparar();
    ctx.falso.servidores = 'caido';

    const venta = await vender(ctx, '3300', [{ medio: 'credito', monto: '3300' }]);

    expect((await facturasDe(venta.id)).map((f) => f.estado)).toEqual(['pendiente']);
    // La venta no habla con ARCA: ni siquiera pregunta si está funcionando.
    expect(ctx.falso.llamadas).toEqual([]);
  });

  it('después de guardar la venta, despierta a la emisión', async () => {
    const ctx = await preparar();

    await vender(ctx, '3300', [{ medio: 'debito', monto: '3300' }]);

    expect(ctx.facturacion!.despertar).toHaveBeenCalled();
  });
});

describe('tope por factura para no identificar al cliente', () => {
  /** Valores alrededor del tope leídos de `reglas.ts`: si cambia la norma, se cambia ahí. */
  async function bordesDelTope() {
    const { TOPE_CONSUMIDOR_FINAL } = await reglas();
    return {
      debajo: restar(TOPE_CONSUMIDOR_FINAL, '0.01'),
      borde: sumar(TOPE_CONSUMIDOR_FINAL, '0'),
      arriba: sumar(TOPE_CONSUMIDOR_FINAL, '0.01'),
    };
  }

  it('un centavo debajo del tope ($9.999.999,99 hoy) → pendiente, sin aviso', async () => {
    const { debajo } = await bordesDelTope();
    const ctx = await preparar();

    const venta = await vender(ctx, debajo, [{ medio: 'debito', monto: debajo }]);

    const [factura] = await facturasDe(venta.id);
    expect(factura).toMatchObject({ estado: 'pendiente', codigoError: null });
    expect(factura!.importe.toFixed(2)).toBe(debajo);
    expect(await avisosDeFactura()).toEqual([]);
  });

  it.each([
    ['en el tope ($10.000.000,00 hoy), en débito', 'borde', 'debito'],
    ['un centavo arriba ($10.000.000,01 hoy), en crédito', 'arriba', 'credito'],
  ] as const)(
    '%s → error por tope, con aviso y sin llegar a ARCA',
    async (_caso, cual, medio) => {
      const importe = (await bordesDelTope())[cual];
      const ctx = await preparar();

      const venta = await vender(ctx, importe, [{ medio, monto: importe }]);

      const [factura] = await facturasDe(venta.id);
      expect(factura).toMatchObject({
        parte: 'electronica',
        estado: 'error',
        codigoError: 'tope',
        intentos: 0,
        numero: null,
      });
      expect(factura!.importe.toFixed(2)).toBe(importe);
      expect(factura!.error).toEqual(expect.any(String));

      const avisos = await avisosDeFactura();
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ destino: 'admin', estado: 'pendiente' });
      expect(avisos[0]!.texto).toContain(`#${venta.numero}`);
      expect(avisos[0]!.texto).toContain('10.000.000,0');
      expect(avisos[0]!.texto).toMatch(/no se emitió/i);
      expect(avisos[0]!.texto).toMatch(/tope/i);
      expect(avisos[0]!.texto).toContain('Administración → Facturación');

      expect(ctx.falso.llamadas).toEqual([]);
    },
  );

  it('$10.000.000 en crédito + $1 en efectivo → la automática por el tope queda en error', async () => {
    const { borde } = await bordesDelTope();
    const total = sumar(borde, '1');
    const ctx = await preparar();

    const venta = await vender(ctx, total, [
      { medio: 'efectivo', monto: '1' },
      { medio: 'credito', monto: borde },
    ]);

    const facturas = await facturasDe(venta.id);
    expect(facturas.map((f) => [f.parte, f.estado, f.codigoError, f.importe.toFixed(2)])).toEqual(
      [['electronica', 'error', 'tope', borde]],
    );
    expect(await avisosDeFactura()).toHaveLength(1);
  });
});

describe('cuándo no se encola nada', () => {
  it('sin facturación configurada, la venta en débito se registra como siempre y sin factura', async () => {
    const ctx = await preparar({ conFacturacion: false });

    const venta = await vender(ctx, '3300', [{ medio: 'debito', monto: '3300' }]);

    expect(venta.numero).toEqual(expect.any(Number));
    expect(await prismaTest.factura.count()).toBe(0);
  });

  it('sin facturación configurada, la función no hace nada', async () => {
    const { encolarFacturaSiCorresponde } = await encolado();
    const { juan } = await preparar({ conFacturacion: false });
    const venta = await crearVentaDirecta({
      usuarioId: juan.id,
      creadaEn: HOY,
      pagos: [{ medio: 'debito', monto: '3300' }],
    });

    await prismaTest.$transaction((tx) =>
      encolarFacturaSiCorresponde(tx, venta, { facturacion: undefined, ahora: HOY }),
    );

    expect(await prismaTest.factura.count()).toBe(0);
  });

  it('llamarla dos veces con la misma venta deja una sola factura automática', async () => {
    const { encolarFacturaSiCorresponde } = await encolado();
    const { facturacion, juan } = await preparar();
    const venta = await crearVentaDirecta({
      usuarioId: juan.id,
      creadaEn: HOY,
      pagos: [{ medio: 'debito', monto: '3300' }],
    });
    const encolar = (f: OpcionesFacturacion | undefined) =>
      prismaTest.$transaction((tx) =>
        encolarFacturaSiCorresponde(tx, venta, { facturacion: f, ahora: HOY }),
      );

    await encolar(facturacion);
    await encolar(facturacion);

    const facturas = await facturasDe(venta.id);
    expect(facturas.map((f) => [f.parte, f.importe.toFixed(2)])).toEqual([
      ['electronica', '3300.00'],
    ]);
  });

  it('una venta que no está pagada no se factura', async () => {
    // Hoy el único otro estado es `anulada`; `cobro-mercado-pago` va a sumar `pendiente`.
    const { encolarFacturaSiCorresponde } = await encolado();
    const { facturacion, juan } = await preparar();
    const venta = await crearVentaDirecta({
      usuarioId: juan.id,
      creadaEn: HOY,
      pagos: [{ medio: 'debito', monto: '3300' }],
      estado: 'anulada',
    });

    await prismaTest.$transaction((tx) =>
      encolarFacturaSiCorresponde(tx, venta, { facturacion, ahora: HOY }),
    );

    expect(await facturasDe(venta.id)).toEqual([]);
  });
});
