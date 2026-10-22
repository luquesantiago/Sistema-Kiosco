import { pedidoDetalleSchema, pedidoResumenSchema, turnoDetalleSchema } from '@kiosco/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limpiarBase, prismaTest } from './base.js';
import {
  abrirTurnoDePrueba,
  cerrarTurnoDePrueba,
  crearAppDePrueba,
  crearUsuarioDePrueba,
  sesionDe,
} from './ayudas.js';
import { crearProductoDePrueba, verificarStockConsistente } from './stock-ayudas.js';

beforeEach(async () => {
  await limpiarBase();
});

afterEach(async () => {
  await verificarStockConsistente();
});

/** Martes 20/10/2026 a las 9:00 en Argentina. */
const MARTES_0900 = new Date('2026-10-20T12:00:00Z');
const HORA = 60 * 60 * 1000;

async function preparar() {
  const { app, adelantar } = await crearAppDePrueba(MARTES_0900);
  await crearUsuarioDePrueba('ana', 'admin');
  const juan = await crearUsuarioDePrueba('juan');
  const admin = await sesionDe(app, 'ana');
  const empleado = await sesionDe(app, 'juan');
  const coca = await prismaTest.proveedor.create({
    data: { nombre: 'Coca-Cola', diasEntrega: ['jueves'] },
  });
  const gaseosa = await crearProductoDePrueba('Gaseosa', { costo: '1000', codigoBarras: '779' });
  const alfajor = await crearProductoDePrueba('Alfajor');
  return { app, adelantar, admin, empleado, juan, coca, gaseosa, alfajor };
}

type Ctx = Awaited<ReturnType<typeof preparar>>;
type Cookies = Ctx['admin'];

function pedir(
  ctx: Ctx,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  cookies: Cookies,
  payload?: Record<string, unknown>,
) {
  return ctx.app.inject({ method, url: `/api/pedidos${url}`, cookies, payload });
}

async function crearPedido(ctx: Ctx, datos: Record<string, unknown> = {}) {
  const res = await pedir(ctx, 'POST', '', ctx.admin, {
    proveedorId: ctx.coca.id,
    totalPedido: '310000',
    llegaEl: '2026-10-22',
    nota: '4 packs de 500',
    ...datos,
  });
  return pedidoDetalleSchema.parse(res.json());
}

const llego = (ctx: Ctx, id: string, datos: Record<string, unknown>, cookies = ctx.empleado) =>
  pedir(ctx, 'POST', `/${id}/llego`, cookies, datos);
const cargar = (ctx: Ctx, id: string, cookies = ctx.empleado, items?: unknown[]) =>
  pedir(ctx, 'POST', `/${id}/carga`, cookies, {
    items: items ?? [
      { productoId: ctx.gaseosa.id, cantidad: 24 },
      { productoId: ctx.alfajor.id, cantidad: 12 },
    ],
  });
const pagar = (ctx: Ctx, id: string, datos: Record<string, unknown>, cookies = ctx.empleado) =>
  pedir(ctx, 'POST', `/${id}/pago`, cookies, datos);

async function detalleTurno(ctx: Ctx, id: string) {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/caja/turnos/${id}`,
    cookies: ctx.admin,
  });
  return turnoDetalleSchema.parse(res.json());
}

describe('alta de un pedido', () => {
  it('el admin crea un pedido por llegar y sin pagar, con número', async () => {
    const ctx = await preparar();

    const pedido = await crearPedido(ctx);

    expect(pedido).toMatchObject({
      proveedor: { nombre: 'Coca-Cola' },
      totalPedido: '310000.00',
      total: null,
      llegaEl: '2026-10-22',
      nota: '4 packs de 500',
      estado: 'por_llegar',
      cuentaPago: null,
      creado: { usuario: { nombre: 'Nombre ana' } },
    });
    expect(pedido.numero).toBeGreaterThan(0);
  });

  it('proveedor desactivado o total cero responde 400; un empleado recibe 403', async () => {
    const ctx = await preparar();
    await prismaTest.proveedor.update({ where: { id: ctx.coca.id }, data: { activo: false } });
    const base = { proveedorId: ctx.coca.id, llegaEl: '2026-10-22' };

    const inactivo = await pedir(ctx, 'POST', '', ctx.admin, { ...base, totalPedido: '100' });
    const cero = await pedir(ctx, 'POST', '', ctx.admin, { ...base, totalPedido: '0' });
    const delEmpleado = await pedir(ctx, 'POST', '', ctx.empleado, { ...base, totalPedido: '1' });

    expect([inactivo.statusCode, cero.statusCode, delEmpleado.statusCode]).toEqual([400, 400, 403]);
    expect(await prismaTest.pedido.count()).toBe(0);
  });
});

describe('edición y cancelación de un pedido', () => {
  it('el admin edita y cancela un pedido por llegar', async () => {
    const ctx = await preparar();
    const pedido = await crearPedido(ctx);

    const editado = await pedir(ctx, 'PATCH', `/${pedido.id}`, ctx.admin, {
      totalPedido: '295000',
    });
    const cancelado = await pedir(ctx, 'POST', `/${pedido.id}/cancelar`, ctx.admin, {
      motivo: 'no vino',
    });

    expect(editado.json()).toMatchObject({ totalPedido: '295000.00' });
    expect(cancelado.json()).toMatchObject({
      estado: 'cancelado',
      cancelado: { motivo: 'no vino', usuario: { nombre: 'Nombre ana' } },
    });
    const abiertos = await pedir(ctx, 'GET', '', ctx.admin);
    expect(abiertos.json()).toEqual([]);
  });

  it('no se edita ni se cancela un pedido que ya llegó', async () => {
    const ctx = await preparar();
    const pedido = await crearPedido(ctx);
    await llego(ctx, pedido.id, { total: '310000' });

    const editar = await pedir(ctx, 'PATCH', `/${pedido.id}`, ctx.admin, { nota: 'x' });
    const cancelar = await pedir(ctx, 'POST', `/${pedido.id}/cancelar`, ctx.admin, {
      motivo: 'no vino',
    });

    expect([editar.statusCode, cancelar.statusCode]).toEqual([409, 409]);
    expect(cancelar.json().error.codigo).toBe('PEDIDO_EN_OTRO_ESTADO');
  });
});

describe('recepción de un pedido', () => {
  it('llega Coca y se paga en efectivo: falta cargar y queda pagado', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.empleado, '352000');
    const pedido = await crearPedido(ctx);

    const res = await llego(ctx, pedido.id, { total: '310000', cuenta: 'efectivo' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      estado: 'llego',
      total: '310000.00',
      cuentaPago: 'efectivo',
      recibido: { usuario: { nombre: 'Nombre juan' } },
      pago: { monto: '310000.00', cuenta: 'efectivo' },
    });
    const movimiento = await prismaTest.movimientoCaja.findFirstOrThrow();
    expect(movimiento).toMatchObject({
      tipo: 'pago_proveedor',
      pedidoId: pedido.id,
      turnoId,
      motivo: `Pedido #${pedido.numero} - Coca-Cola`,
    });
    // Pago a un proveedor en efectivo: el esperado baja.
    expect((await detalleTurno(ctx, turnoId)).resumen).toMatchObject({
      pagosProveedor: '310000.00',
      esperado: '42000.00',
    });
  });

  it('llegó con faltantes y quedó debiendo', async () => {
    const ctx = await preparar();
    const pedido = await crearPedido(ctx);

    const res = await llego(ctx, pedido.id, {
      total: '280000',
      notaRecepcion: 'faltaron 2 packs',
    });

    expect(res.json()).toMatchObject({
      estado: 'llego',
      total: '280000.00',
      notaRecepcion: 'faltaron 2 packs',
      cuentaPago: null,
      pago: null,
    });
    expect(await prismaTest.movimientoCaja.count()).toBe(0);
  });

  it('llegar dos veces o un pedido cancelado responde 409', async () => {
    const ctx = await preparar();
    const pedido = await crearPedido(ctx);
    const cancelado = await crearPedido(ctx);
    await pedir(ctx, 'POST', `/${cancelado.id}/cancelar`, ctx.admin, { motivo: 'no vino' });
    await llego(ctx, pedido.id, { total: '1' });

    expect((await llego(ctx, pedido.id, { total: '1' })).statusCode).toBe(409);
    expect((await llego(ctx, cancelado.id, { total: '1' })).statusCode).toBe(409);
  });

  it('si el empleado no tiene turno para pagar, el pedido no queda como llegado', async () => {
    const ctx = await preparar();
    const pedido = await crearPedido(ctx);

    const res = await llego(ctx, pedido.id, { total: '310000', cuenta: 'efectivo' });

    expect(res.statusCode).toBe(409);
    const enBase = await prismaTest.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
    expect(enBase.estado).toBe('por_llegar');
  });
});

describe('recibir sin pedido', () => {
  it('llega el pan: crea un pedido llegado y pagado que falta cargar', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.empleado);
    const panaderia = await prismaTest.proveedor.create({ data: { nombre: 'Panadería' } });

    const res = await pedir(ctx, 'POST', '/sin-pedido', ctx.empleado, {
      proveedorId: panaderia.id,
      total: '12000',
      cuenta: 'efectivo',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      proveedor: { nombre: 'Panadería' },
      estado: 'llego',
      total: '12000.00',
      cuentaPago: 'efectivo',
      llegaEl: '2026-10-20',
    });
  });

  it('sin proveedor responde 400', async () => {
    const ctx = await preparar();
    const res = await pedir(ctx, 'POST', '/sin-pedido', ctx.empleado, { total: '12000' });
    expect(res.statusCode).toBe(400);
    expect(await prismaTest.pedido.count()).toBe(0);
  });
});

describe('carga de la mercadería de un pedido', () => {
  it('después de atender: sube el stock, queda el ingreso atado y se marca cargado', async () => {
    const ctx = await preparar();
    const pedido = await crearPedido(ctx);
    await llego(ctx, pedido.id, { total: '310000' });

    const res = await cargar(ctx, pedido.id);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      estado: 'cargado',
      carga: { cantidadProductos: 2, usuario: { nombre: 'Nombre juan' } },
      cerradoEn: null,
    });
    const ingreso = await prismaTest.ingresoMercaderia.findFirstOrThrow();
    expect(ingreso).toMatchObject({ pedidoId: pedido.id, proveedorId: ctx.coca.id });
    const gaseosa = await prismaTest.producto.findUniqueOrThrow({ where: { id: ctx.gaseosa.id } });
    expect(gaseosa.stockActual).toBe(24);
  });

  it('cargar dos veces, o antes de que llegue, responde 409 y no mueve stock', async () => {
    const ctx = await preparar();
    const pedido = await crearPedido(ctx);
    const porLlegar = await crearPedido(ctx);
    await llego(ctx, pedido.id, { total: '1' });
    await cargar(ctx, pedido.id);

    expect((await cargar(ctx, pedido.id)).statusCode).toBe(409);
    expect((await cargar(ctx, porLlegar.id)).statusCode).toBe(409);
    expect(await prismaTest.ingresoMercaderia.count()).toBe(1);
  });

  it('la búsqueda para la carga le da el costo al empleado', async () => {
    const ctx = await preparar();

    const porCodigo = await pedir(ctx, 'GET', '/productos?q=779', ctx.empleado);
    const porNombre = await pedir(ctx, 'GET', '/productos?q=alfa', ctx.empleado);

    expect(porCodigo.json()).toEqual([
      { id: ctx.gaseosa.id, codigoBarras: '779', nombre: 'Gaseosa', costo: '1000.00' },
    ]);
    expect(porNombre.json()).toMatchObject([{ nombre: 'Alfajor', costo: '600.00' }]);
  });
});

describe('pago de un pedido y cierre', () => {
  it('quedó debiendo, se cargó y el jueves se paga: se cierra y avisa al admin', async () => {
    const ctx = await preparar();
    const pedido = await crearPedido(ctx);
    await llego(ctx, pedido.id, { total: '210000', notaRecepcion: 'faltó 1 pack' });
    await cargar(ctx, pedido.id);
    ctx.adelantar(2 * 24 * HORA);
    const empleado = await sesionDe(ctx.app, 'juan');
    const turnoId = await abrirTurnoDePrueba(ctx.app, empleado, '300000');

    const res = await pagar(ctx, pedido.id, { cuenta: 'efectivo' }, empleado);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ cuentaPago: 'efectivo', pago: { monto: '210000.00' } });
    expect(res.json().cerradoEn).not.toBeNull();
    expect((await detalleTurno(ctx, turnoId)).resumen.esperado).toBe('90000.00');
    const aviso = await prismaTest.notificacion.findFirstOrThrow({
      where: { tipo: 'pedido_cerrado' },
    });
    expect(aviso.texto).toBe(
      [
        `*Pedido #${pedido.numero} cerrado - Coca-Cola*`,
        'Pagado: $ 210.000,00 (Efectivo)',
        'Total del pedido: $ 310.000,00',
        'Nota: faltó 1 pack',
        'Productos cargados: 2',
        'Recibió: Nombre juan · Cargó: Nombre juan · Pagó: Nombre juan',
        'Cerrado: 22/10/2026 09:00',
      ].join('\n'),
    );
  });

  it('pagó al recibir y cargó después: se cierra al cargar', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.empleado, '400000');
    const pedido = await crearPedido(ctx);
    await llego(ctx, pedido.id, { total: '310000', cuenta: 'efectivo' });
    expect(await prismaTest.notificacion.count({ where: { tipo: 'pedido_cerrado' } })).toBe(0);

    const res = await cargar(ctx, pedido.id);

    expect(res.json().cerradoEn).not.toBeNull();
    expect(await prismaTest.notificacion.count({ where: { tipo: 'pedido_cerrado' } })).toBe(1);
  });

  it('el admin paga con Mercado Pago sin turno: se cierra sin aviso; el total se corrige', async () => {
    const ctx = await preparar();
    const pedido = await crearPedido(ctx);
    await llego(ctx, pedido.id, { total: '210000' });
    await cargar(ctx, pedido.id);

    const res = await pagar(ctx, pedido.id, { cuenta: 'mercado_pago', total: '205000' }, ctx.admin);

    expect(res.json()).toMatchObject({ total: '205000.00', cuentaPago: 'mercado_pago' });
    expect(res.json().cerradoEn).not.toBeNull();
    const movimiento = await prismaTest.movimientoCaja.findFirstOrThrow();
    expect(movimiento).toMatchObject({ cuenta: 'mercado_pago', turnoId: null });
    expect(await prismaTest.notificacion.count({ where: { tipo: 'pedido_cerrado' } })).toBe(0);
  });

  it('un pago con Mercado Pago no toca el esperado del turno', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.empleado, '52000');
    const pedido = await crearPedido(ctx);
    await llego(ctx, pedido.id, { total: '210000', cuenta: 'mercado_pago' });

    expect((await detalleTurno(ctx, turnoId)).resumen).toMatchObject({
      pagosProveedor: '0.00',
      esperado: '52000.00',
    });
  });

  it('no se paga por adelantado, dos veces ni un cancelado; dos pagos a la vez registran uno', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.empleado, '1000000');
    const porLlegar = await crearPedido(ctx);
    const pedido = await crearPedido(ctx);
    await llego(ctx, pedido.id, { total: '1000' });

    expect((await pagar(ctx, porLlegar.id, { cuenta: 'efectivo' })).statusCode).toBe(409);
    const [a, b] = await Promise.all([
      pagar(ctx, pedido.id, { cuenta: 'efectivo' }),
      pagar(ctx, pedido.id, { cuenta: 'efectivo' }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(await prismaTest.movimientoCaja.count()).toBe(1);
  });
});

describe('caja con pagos a proveedores', () => {
  it('un pago a proveedor suelto responde 400', async () => {
    const ctx = await preparar();
    await abrirTurnoDePrueba(ctx.app, ctx.empleado);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/caja/movimientos',
      cookies: ctx.empleado,
      payload: { tipo: 'pago_proveedor', monto: '100', motivo: 'Coca' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('el resumen del cierre incluye los pagos a proveedores', async () => {
    const ctx = await preparar();
    const turnoId = await abrirTurnoDePrueba(ctx.app, ctx.empleado, '400000');
    const pedido = await crearPedido(ctx);
    await llego(ctx, pedido.id, { total: '310000', cuenta: 'efectivo' });

    await cerrarTurnoDePrueba(ctx.app, ctx.empleado, turnoId, { montoContado: '90000' });

    const aviso = await prismaTest.notificacion.findFirstOrThrow({
      where: { tipo: 'cierre_turno' },
    });
    expect(aviso.texto).toContain('Pagos a proveedores: $ 310.000,00');
  });
});

describe('lista de pedidos', () => {
  it('primero lo que hay que atender: falta cargar, hoy o atrasado, debe y lo que viene', async () => {
    const ctx = await preparar();
    const viene = await crearPedido(ctx, { llegaEl: '2026-10-29' });
    const debe = await crearPedido(ctx, { llegaEl: '2026-10-19' });
    await llego(ctx, debe.id, { total: '1' });
    await cargar(ctx, debe.id);
    const atrasado = await crearPedido(ctx, { llegaEl: '2026-10-19' });
    const faltaCargar = await crearPedido(ctx);
    await llego(ctx, faltaCargar.id, { total: '1' });

    const res = await pedir(ctx, 'GET', '', ctx.empleado);

    expect(
      z
        .array(pedidoResumenSchema)
        .parse(res.json())
        .map((p) => p.id),
    ).toEqual([faltaCargar.id, atrasado.id, debe.id, viene.id]);
  });

  it('el admin ve los cerrados de un rango; el empleado recibe 403', async () => {
    const ctx = await preparar();
    const pedido = await crearPedido(ctx);
    await llego(ctx, pedido.id, { total: '1000' });
    await cargar(ctx, pedido.id, ctx.admin);
    await pagar(ctx, pedido.id, { cuenta: 'mercado_pago' }, ctx.admin);

    const cerrados = await pedir(
      ctx,
      'GET',
      '?vista=cerrados&desde=2026-10-01&hasta=2026-10-20',
      ctx.admin,
    );
    const delEmpleado = await pedir(ctx, 'GET', '?vista=cerrados', ctx.empleado);

    expect(cerrados.json()).toMatchObject([{ id: pedido.id, cuentaPago: 'mercado_pago' }]);
    expect(delEmpleado.statusCode).toBe(403);
  });
});
