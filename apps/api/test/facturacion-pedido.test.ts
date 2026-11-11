import { comparar, sumar } from '@kiosco/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase, prismaTest } from './base.js';
import { crearUsuarioDePrueba, sesionDe } from './ayudas.js';
import { crearArcaFalso } from './arca-falso.js';
import {
  avisosDeFactura,
  crearAppConFacturacion,
  crearFacturaDirecta,
  crearVentaDirecta,
  facturasDe,
  fechaMenosDias,
  inicioDelDiaEnArgentina,
  opcionesFacturacion,
} from './facturacion-ayudas.js';

/*
 * `POST /api/ventas/:id/factura`: factura a pedido del cliente por lo cobrado en
 * efectivo (specs/facturacion: "Factura a pedido del cliente", "Facturas de una
 * venta", "Plazo para facturar días anteriores" y "Tope ...").
 *
 * Respuesta: la factura (`facturaVentaSchema`), con `201` si la crea y `200` si
 * ya existía o si devuelve la automática.
 */
const reglas = () => import('../src/modules/facturacion/reglas.js');

/** 10/11/2026 a las 00:01 de Argentina. */
const HOY_0001 = new Date('2026-11-10T03:01:00Z');
/** 10/11/2026 a las 10:00 de Argentina, para los casos sin borde de horario. */
const HOY_1000 = new Date('2026-11-10T13:00:00Z');

beforeEach(async () => {
  await limpiarBase();
});

/** Invariante: en ninguna venta las facturas suman más que el total. */
afterEach(async () => {
  const ventas = await prismaTest.venta.findMany({ include: { facturas: true } });
  for (const v of ventas) {
    const facturado = sumar('0', ...v.facturas.map((f) => f.importe.toFixed(2)));
    expect(
      comparar(facturado, v.total.toFixed(2)),
      `venta #${v.numero}: facturas ${facturado} > total ${v.total.toFixed(2)}`,
    ).toBeLessThanOrEqual(0);
    expect(v.facturas.length, `venta #${v.numero}`).toBeLessThanOrEqual(2);
  }
});

async function preparar({ ahora = HOY_1000, conFacturacion = true } = {}) {
  const { falso, cliente } = crearArcaFalso();
  const facturacion = conFacturacion ? opcionesFacturacion(cliente) : undefined;
  const { app, fijarHora } = await crearAppConFacturacion(ahora, facturacion);
  const ana = await crearUsuarioDePrueba('ana', 'admin');
  const juan = await crearUsuarioDePrueba('juan');
  const admin = await sesionDe(app, 'ana');
  const empleado = await sesionDe(app, 'juan');
  return { app, fijarHora, falso, facturacion, ana, juan, admin, empleado };
}

type Ctx = Awaited<ReturnType<typeof preparar>>;
type Medio = 'efectivo' | 'debito' | 'credito' | 'mercado_pago';

function pedirFactura(ctx: Ctx, ventaId: string, cookies = ctx.empleado) {
  return ctx.app.inject({ method: 'POST', url: `/api/ventas/${ventaId}/factura`, cookies });
}

function venta(
  ctx: Ctx,
  pagos: { medio: Medio; monto: string }[],
  creadaEn: Date = HOY_1000,
  estado: 'pagada' | 'anulada' = 'pagada',
) {
  return crearVentaDirecta({ usuarioId: ctx.juan.id, creadaEn, pagos, estado });
}

/** Venta mixta de $5.000: $2.000 en efectivo y $3.000 en débito. */
const MIXTA = [
  { medio: 'efectivo', monto: '2000' },
  { medio: 'debito', monto: '3000' },
] as const;

const AUTORIZADA_42 = {
  estado: 'autorizada',
  importe: '3000.00',
  numero: 42,
  fechaComprobante: new Date('2026-11-10T00:00:00Z'),
  cae: '76451234567890',
  caeVencimiento: new Date('2026-11-20T00:00:00Z'),
  autorizadaEn: HOY_1000,
};

describe('el cliente pide factura de una venta en efectivo', () => {
  it('el empleado la pide → 201 con una factura del efectivo por el total; la segunda vez → 200 con la misma', async () => {
    const ctx = await preparar();
    const v = await venta(ctx, [{ medio: 'efectivo', monto: '3300' }]);

    const primera = await pedirFactura(ctx, v.id);
    const segunda = await pedirFactura(ctx, v.id);

    expect(primera.statusCode, primera.body).toBe(201);
    expect(primera.json()).toMatchObject({
      parte: 'efectivo',
      estado: 'pendiente',
      importe: '3300.00',
      numero: null,
      qrUrl: null,
    });
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json().id).toBe(primera.json().id);
    const facturas = await facturasDe(v.id);
    expect(facturas).toHaveLength(1);
    expect(facturas[0]).toMatchObject({ parte: 'efectivo', pedidaPorId: ctx.juan.id });
  });

  it('después de crearla despierta a la emisión', async () => {
    const ctx = await preparar();
    const v = await venta(ctx, [{ medio: 'efectivo', monto: '3300' }]);

    await pedirFactura(ctx, v.id);

    expect(ctx.facturacion!.despertar).toHaveBeenCalled();
  });
});

describe('venta mixta: factura del efectivo además de la automática', () => {
  it('con la automática autorizada → 201 con la del efectivo por $2.000; las dos suman $5.000', async () => {
    const ctx = await preparar();
    const v = await venta(ctx, [...MIXTA]);
    await crearFacturaDirecta(v.id, AUTORIZADA_42);

    const res = await pedirFactura(ctx, v.id);

    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ parte: 'efectivo', estado: 'pendiente', importe: '2000.00' });
    const facturas = await facturasDe(v.id);
    expect(facturas.map((f) => [f.parte, f.importe.toFixed(2)])).toEqual([
      ['electronica', '3000.00'],
      ['efectivo', '2000.00'],
    ]);
    expect(sumar(...facturas.map((f) => f.importe.toFixed(2)))).toBe('5000.00');
  });

  it('un tercer pedido → 200 con la de $2.000 y siguen siendo dos', async () => {
    const ctx = await preparar();
    const v = await venta(ctx, [...MIXTA]);
    await crearFacturaDirecta(v.id, AUTORIZADA_42);
    const segunda = await pedirFactura(ctx, v.id);

    const tercera = await pedirFactura(ctx, v.id);

    expect(tercera.statusCode).toBe(200);
    expect(tercera.json()).toMatchObject({ id: segunda.json().id, importe: '2000.00' });
    expect(await facturasDe(v.id)).toHaveLength(2);
  });

  it('con la automática todavía pendiente → igual queda con dos facturas', async () => {
    const ctx = await preparar();
    const v = await venta(ctx, [...MIXTA]);
    await crearFacturaDirecta(v.id, { importe: '3000.00' });

    const res = await pedirFactura(ctx, v.id);

    expect(res.statusCode).toBe(201);
    const facturas = await facturasDe(v.id);
    expect(facturas.map((f) => [f.parte, f.estado, f.importe.toFixed(2)])).toEqual([
      ['electronica', 'pendiente', '3000.00'],
      ['efectivo', 'pendiente', '2000.00'],
    ]);
  });

  it('efectivo de $0,01 ($0,01 + $4.999,99 en crédito) → factura de $0,01', async () => {
    const ctx = await preparar();
    const v = await venta(ctx, [
      { medio: 'efectivo', monto: '0.01' },
      { medio: 'credito', monto: '4999.99' },
    ]);
    await crearFacturaDirecta(v.id, { importe: '4999.99' });

    const res = await pedirFactura(ctx, v.id);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ parte: 'efectivo', importe: '0.01' });
  });
});

describe('ventas sin nada en efectivo para facturar', () => {
  it('venta 100% en débito → 200 con la automática y no crea otra', async () => {
    const ctx = await preparar();
    const v = await venta(ctx, [{ medio: 'debito', monto: '3300' }]);
    const automatica = await crearFacturaDirecta(v.id);

    const res = await pedirFactura(ctx, v.id);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: automatica.id, parte: 'electronica' });
    expect(await facturasDe(v.id)).toHaveLength(1);
  });

  it('venta de total $0,00 → 422 y no crea factura', async () => {
    const ctx = await preparar();
    const v = await venta(ctx, [{ medio: 'efectivo', monto: '0.00' }]);

    const res = await pedirFactura(ctx, v.id);

    expect(res.statusCode).toBe(422);
    expect(await facturasDe(v.id)).toEqual([]);
  });
});

describe('tope por factura en el pedido', () => {
  it('$12.000.000 con $6.000.000 en débito y $6.000.000 en efectivo → las dos de $6.000.000 quedan pendientes', async () => {
    const ctx = await preparar();
    const v = await venta(ctx, [
      { medio: 'efectivo', monto: '6000000' },
      { medio: 'debito', monto: '6000000' },
    ]);
    await crearFacturaDirecta(v.id, { importe: '6000000.00' });

    const res = await pedirFactura(ctx, v.id);

    expect(res.statusCode).toBe(201);
    const facturas = await facturasDe(v.id);
    expect(facturas.map((f) => [f.parte, f.estado, f.importe.toFixed(2)])).toEqual([
      ['electronica', 'pendiente', '6000000.00'],
      ['efectivo', 'pendiente', '6000000.00'],
    ]);
    expect(await avisosDeFactura()).toEqual([]);
  });

  it.each([
    ['un centavo debajo', '-0.01', 'pendiente', null, 0],
    ['en el tope', '0', 'error', 'tope', 1],
    ['un centavo arriba', '0.01', 'error', 'tope', 1],
  ] as const)(
    'efectivo %s del tope → la factura del efectivo queda como corresponde',
    async (_caso, delta, estado, codigoError, avisos) => {
      const { TOPE_CONSUMIDOR_FINAL } = await reglas();
      const efectivo = sumar(TOPE_CONSUMIDOR_FINAL, delta);
      const ctx = await preparar();
      const v = await venta(ctx, [{ medio: 'efectivo', monto: efectivo }]);

      const res = await pedirFactura(ctx, v.id);

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ parte: 'efectivo', estado, importe: efectivo });
      expect((await facturasDe(v.id))[0]).toMatchObject({ estado, codigoError });
      expect(await avisosDeFactura()).toHaveLength(avisos);
      expect(ctx.falso.llamadas).toEqual([]);
    },
  );
});

describe('quién puede pedirla y hasta cuándo', () => {
  it('venta del 09/11 a las 23:59 pedida el 10/11 a las 00:01: el empleado → 403, el admin → 201', async () => {
    const ctx = await preparar({ ahora: HOY_0001 });
    const v = await venta(ctx, [{ medio: 'efectivo', monto: '3300' }], new Date('2026-11-10T02:59:00Z'));

    const delEmpleado = await pedirFactura(ctx, v.id);
    expect(delEmpleado.statusCode).toBe(403);
    expect(delEmpleado.json().error.codigo).toBe('FUERA_DE_PLAZO');
    expect(await facturasDe(v.id)).toEqual([]);

    const delAdmin = await pedirFactura(ctx, v.id, ctx.admin);
    expect(delAdmin.statusCode).toBe(201);
    expect(delAdmin.json()).toMatchObject({ estado: 'pendiente', importe: '3300.00' });
  });

  it.each([
    ['23:59:59 del 09/11', 403, '2026-11-10T02:59:59Z'],
    ['00:00:00 del 10/11', 201, '2026-11-10T03:00:00Z'],
  ] as const)(
    'a las 00:00:01 del 10/11, el empleado pide una venta de las %s → %s',
    async (_caso, status, creadaEn) => {
      const ctx = await preparar({ ahora: new Date('2026-11-10T03:00:01Z') });
      const v = await venta(ctx, [{ medio: 'efectivo', monto: '3300' }], new Date(creadaEn));

      const res = await pedirFactura(ctx, v.id);

      expect(res.statusCode).toBe(status);
    },
  );

  it('el empleado tampoco puede pedir una venta de días anteriores dentro del plazo', async () => {
    const ctx = await preparar({ ahora: HOY_0001 });
    const v = await venta(
      ctx,
      [{ medio: 'efectivo', monto: '3300' }],
      new Date('2026-11-07T15:00:00Z'),
    );

    const res = await pedirFactura(ctx, v.id);

    expect(res.statusCode).toBe(403);
  });

  describe('plazo del admin para días anteriores (DIAS_ATRAS_MAXIMO de reglas.ts; hoy 5)', () => {
    /** 00:00 de Argentina del último día permitido, contado desde el 10/11. */
    async function inicioDelUltimoDia() {
      const { DIAS_ATRAS_MAXIMO } = await reglas();
      return inicioDelDiaEnArgentina(fechaMenosDias('2026-11-10', DIAS_ATRAS_MAXIMO));
    }

    it.each([
      ['00:00:00 del último día permitido (05/11 hoy)', 201, 0],
      ['12:00 del último día permitido', 201, 12 * 3600_000],
      ['23:59:59 del día anterior (04/11 hoy)', 422, -1_000],
      ['23:59 del día anterior', 422, -60_000],
    ])('el 10/11 a las 00:01, venta de las %s → %s', async (_caso, status, desfaseMs) => {
      const inicio = await inicioDelUltimoDia();
      const ctx = await preparar({ ahora: HOY_0001 });
      const v = await venta(
        ctx,
        [{ medio: 'efectivo', monto: '3300' }],
        new Date(inicio.getTime() + desfaseMs),
      );

      const res = await pedirFactura(ctx, v.id, ctx.admin);

      expect(res.statusCode).toBe(status);
      if (status === 422) {
        expect(res.json().error.codigo).toBe('FACTURA_FUERA_DE_PLAZO');
        expect(await facturasDe(v.id)).toEqual([]);
      } else {
        expect(res.json()).toMatchObject({ estado: 'pendiente' });
      }
    });
  });
});

describe('pedidos que no corresponden', () => {
  it('venta anulada → 409 y no crea factura', async () => {
    const ctx = await preparar();
    const v = await venta(ctx, [{ medio: 'efectivo', monto: '3300' }], HOY_1000, 'anulada');

    const res = await pedirFactura(ctx, v.id, ctx.admin);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('VENTA_YA_ANULADA');
    expect(await facturasDe(v.id)).toEqual([]);
  });

  it('sin facturación configurada → 409 con el motivo y no crea factura', async () => {
    const ctx = await preparar({ conFacturacion: false });
    const v = await venta(ctx, [{ medio: 'efectivo', monto: '3300' }]);

    const res = await pedirFactura(ctx, v.id);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ codigo: 'FACTURACION_NO_CONFIGURADA' });
    expect(res.json().error.mensaje).toEqual(expect.any(String));
    expect(await prismaTest.factura.count()).toBe(0);
  });

  it('sin sesión → 401', async () => {
    const ctx = await preparar();
    const v = await venta(ctx, [{ medio: 'efectivo', monto: '3300' }]);

    const res = await ctx.app.inject({ method: 'POST', url: `/api/ventas/${v.id}/factura` });

    expect(res.statusCode).toBe(401);
    expect(await facturasDe(v.id)).toEqual([]);
  });

  it('venta inexistente → 404', async () => {
    const ctx = await preparar();

    const res = await pedirFactura(ctx, '0198a5b0-0000-7000-8000-000000000000', ctx.admin);

    expect(res.statusCode).toBe(404);
    // El mismo error que el detalle de una venta inexistente (no el 404 de una ruta que no existe).
    expect(res.json().error.mensaje).toBe('La venta no existe.');
  });
});
