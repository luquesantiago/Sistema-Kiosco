import { DIAS_SEMANA, normalizarParaBusqueda } from '@kiosco/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { armarReposicion, calcularReposicion } from '../src/modules/reposicion/servicio.js';
import { limpiarBase, prismaTest } from './base.js';
import { crearUsuarioDePrueba } from './ayudas.js';
import { crearProductoDePrueba } from './stock-ayudas.js';

/*
 * Contrato que fijan estos tests (el design deja abierta la forma de entrada de
 * la función pura; se eligió la más simple, que coincide con lo que devuelve
 * Prisma):
 *
 *   armarReposicion(productos, pedidos, hoy): Grupo[]
 *     productos: { id, nombre, nombreBusqueda, stockActual, stockMinimo, stockMaximo, activo,
 *                  proveedor: { id, nombre, activo, diasPedido } | null }[]
 *     pedidos:   { proveedorId, llegaEl: Date }[]   -- solo los `por_llegar`, uno o varios por proveedor
 *     hoy:       DiaSemana
 *
 * La función pura aplica la regla completa (activo, stock <= mínimo, mínimo y
 * máximo 0, sugerido <= 0) aunque la consulta ya traiga filtrado lo grueso: así
 * los bordes se prueban sin base. El grupo "Sin proveedor" tiene
 * `proveedor: null`, `tomaPedidoHoy: false` y `pedidoPorLlegarEl: null`.
 */

type ProductoEntrada = Parameters<typeof armarReposicion>[0][number];
type ProveedorEntrada = NonNullable<ProductoEntrada['proveedor']>;

let siguienteId = 0;

function proveedor(nombre: string, datos: Partial<ProveedorEntrada> = {}): ProveedorEntrada {
  return { id: `prov-${nombre}`, nombre, activo: true, diasPedido: [], ...datos };
}

function producto(
  nombre: string,
  stock: { actual: number; minimo: number; maximo: number },
  datos: { proveedor?: ProveedorEntrada | null; activo?: boolean } = {},
): ProductoEntrada {
  siguienteId++;
  return {
    id: `prod-${String(siguienteId).padStart(4, '0')}`,
    nombre,
    nombreBusqueda: normalizarParaBusqueda(nombre),
    stockActual: stock.actual,
    stockMinimo: stock.minimo,
    stockMaximo: stock.maximo,
    activo: datos.activo ?? true,
    proveedor: datos.proveedor ?? null,
  };
}

/** Un producto que siempre falta: stock 0, mínimo 5, máximo 20 (sugerido 20). */
function faltante(nombre: string, prov: ProveedorEntrada | null = null) {
  return producto(nombre, { actual: 0, minimo: 5, maximo: 20 }, { proveedor: prov });
}

const nombresDeGrupos = (grupos: ReturnType<typeof armarReposicion>) =>
  grupos.map((g) => g.proveedor?.nombre ?? null);

/**
 * Tabla de bordes del umbral: [mínimo, máximo, stock, sugerido esperado o null si no entra].
 * Se usa con la función pura y, toda junta, contra la base.
 */
const UMBRAL: [number, number, number, number | null][] = [
  // Umbral con mínimo 5 y máximo 20: justo arriba, en el borde, justo debajo y negativo.
  [5, 20, 6, null],
  [5, 20, 5, 15],
  [5, 20, 4, 16],
  [5, 20, -3, 23],
  // Mínimo y máximo 0: "no reponer nunca".
  [0, 0, 1, null],
  [0, 0, 0, null],
  [0, 0, -2, null],
  // Mínimo 0 con máximo mayor que 0: entra al llegar a 0 o menos.
  [0, 10, 1, null],
  [0, 10, 0, 10],
  [0, 10, -1, 11],
  // Mínimo igual al máximo: sugerido 0 no aparece.
  [5, 5, 6, null],
  [5, 5, 5, null],
  [5, 5, 4, 1],
  // Topes válidos de mínimo y máximo (1.000.000).
  [1_000_000, 1_000_000, 1_000_001, null],
  [1_000_000, 1_000_000, 1_000_000, null],
  [1_000_000, 1_000_000, 999_999, 1],
  [0, 1_000_000, 1, null],
  [0, 1_000_000, 0, 1_000_000],
  [0, 1_000_000, -1, 1_000_001],
];

describe('armarReposicion: qué productos entran y cuánto se sugiere', () => {
  it.each(UMBRAL)(
    'mínimo %i, máximo %i y stock %i → sugerido %s',
    (minimo, maximo, actual, esperado) => {
      const grupos = armarReposicion(
        [producto('Gaseosa', { actual, minimo, maximo })],
        [],
        'martes',
      );

      if (esperado === null) {
        expect(grupos).toEqual([]);
      } else {
        expect(grupos).toHaveLength(1);
        expect(grupos[0]!.productos).toEqual([
          expect.objectContaining({ nombre: 'Gaseosa', stockActual: actual, sugerido: esperado }),
        ]);
      }
    },
  );

  it('un producto desactivado con mínimo 5, máximo 20 y stock 0 no entra', () => {
    const grupos = armarReposicion(
      [producto('Gaseosa', { actual: 0, minimo: 5, maximo: 20 }, { activo: false })],
      [],
      'martes',
    );

    expect(grupos).toEqual([]);
  });

  it('cada renglón trae id, nombre, stock actual y sugerido', () => {
    const p = producto('Coca 500 ml', { actual: 4, minimo: 5, maximo: 20 });

    const [grupo] = armarReposicion([p], [], 'martes');

    expect(grupo!.productos).toEqual([
      { id: p.id, nombre: 'Coca 500 ml', stockActual: 4, sugerido: 16 },
    ]);
  });
});

describe('armarReposicion: agrupación por proveedor', () => {
  it('productos de dos proveedores: Coca-Cola con 2 y Arcor con 1', () => {
    const coca = proveedor('Coca-Cola');
    const arcor = proveedor('Arcor');

    const grupos = armarReposicion(
      [
        faltante('Coca 500 ml', coca),
        faltante('Bon o Bon', arcor),
        faltante('Sprite 500 ml', coca),
      ],
      [],
      'martes',
    );

    expect(grupos.map((g) => [g.proveedor?.nombre, g.productos.length])).toEqual([
      ['Arcor', 1],
      ['Coca-Cola', 2],
    ]);
    expect(grupos[1]!.proveedor).toEqual({ id: coca.id, nombre: 'Coca-Cola' });
  });

  it('un producto sin proveedor va al grupo "Sin proveedor"', () => {
    const grupos = armarReposicion([faltante('Hielo')], [], 'martes');

    expect(grupos).toEqual([
      {
        proveedor: null,
        tomaPedidoHoy: false,
        pedidoPorLlegarEl: null,
        productos: [expect.objectContaining({ nombre: 'Hielo', sugerido: 20 })],
      },
    ]);
  });

  it('un producto de un proveedor desactivado va a "Sin proveedor", aunque ese proveedor tome pedido hoy', () => {
    const pepsi = proveedor('Pepsi', { activo: false, diasPedido: ['martes'] });

    const grupos = armarReposicion(
      [faltante('Pepsi 500 ml', pepsi)],
      [{ proveedorId: pepsi.id, llegaEl: new Date('2026-11-12T00:00:00Z') }],
      'martes',
    );

    expect(nombresDeGrupos(grupos)).toEqual([null]);
    expect(grupos[0]).toMatchObject({ tomaPedidoHoy: false, pedidoPorLlegarEl: null });
    expect(grupos[0]!.productos.map((p) => p.nombre)).toEqual(['Pepsi 500 ml']);
  });

  it('un proveedor que toma pedido hoy sin faltantes no aparece', () => {
    const pepsi = proveedor('Pepsi', { diasPedido: ['martes'] });
    const arcor = proveedor('Arcor', { diasPedido: ['jueves'] });

    const grupos = armarReposicion(
      [
        producto('Pepsi 500 ml', { actual: 6, minimo: 5, maximo: 20 }, { proveedor: pepsi }),
        producto('Pepsi lata', { actual: 5, minimo: 5, maximo: 5 }, { proveedor: pepsi }),
        faltante('Bon o Bon', arcor),
      ],
      [],
      'martes',
    );

    expect(nombresDeGrupos(grupos)).toEqual(['Arcor']);
  });

  it('sin ningún faltante no hay grupos', () => {
    expect(armarReposicion([], [], 'martes')).toEqual([]);
  });
});

describe('armarReposicion: orden', () => {
  it('el martes, Coca-Cola (pide los martes) va antes que Arcor (pide los jueves)', () => {
    const arcor = proveedor('Arcor', { diasPedido: ['jueves'] });
    const coca = proveedor('Coca-Cola', { diasPedido: ['martes'] });

    const grupos = armarReposicion(
      [faltante('Bon o Bon', arcor), faltante('Coca 500 ml', coca)],
      [],
      'martes',
    );

    expect(grupos.map((g) => [g.proveedor?.nombre, g.tomaPedidoHoy])).toEqual([
      ['Coca-Cola', true],
      ['Arcor', false],
    ]);
  });

  it('varios que toman pedido hoy van primero y por nombre; después el resto por nombre', () => {
    const quilmes = proveedor('Quilmes', { diasPedido: ['martes', 'viernes'] });
    const coca = proveedor('Coca-Cola', { diasPedido: ['martes'] });
    const pepsi = proveedor('Pepsi', { diasPedido: ['jueves'] });
    const arcor = proveedor('Arcor', { diasPedido: ['jueves'] });

    const grupos = armarReposicion(
      [
        faltante('Pepsi 500 ml', pepsi),
        faltante('Quilmes 1 l', quilmes),
        faltante('Bon o Bon', arcor),
        faltante('Coca 500 ml', coca),
      ],
      [],
      'martes',
    );

    expect(nombresDeGrupos(grupos)).toEqual(['Coca-Cola', 'Quilmes', 'Arcor', 'Pepsi']);
  });

  it('"Sin proveedor" va último, aunque por nombre fuera antes', () => {
    const coca = proveedor('Coca-Cola', { diasPedido: ['martes'] });
    const arcor = proveedor('Arcor');
    const zeta = proveedor('Zeta');

    const grupos = armarReposicion(
      [
        faltante('Hielo'),
        faltante('Z1', zeta),
        faltante('Bon o Bon', arcor),
        faltante('Coca', coca),
      ],
      [],
      'martes',
    );

    expect(nombresDeGrupos(grupos)).toEqual(['Coca-Cola', 'Arcor', 'Zeta', null]);
  });

  it('los proveedores se ordenan sin distinguir mayúsculas ni acentos', () => {
    const grupos = armarReposicion(
      [
        faltante('A', proveedor('zeta')),
        faltante('B', proveedor('Óptimo')),
        faltante('C', proveedor('Bagley')),
      ],
      [],
      'martes',
    );

    expect(nombresDeGrupos(grupos)).toEqual(['Bagley', 'Óptimo', 'zeta']);
  });

  it('los productos se ordenan por nombre sin distinguir mayúsculas ni acentos', () => {
    const arcor = proveedor('Arcor');

    const grupos = armarReposicion(
      ['Óreo', 'Zapallo', 'Ñandú galletitas', 'alfajor', 'oblea'].map((n) => faltante(n, arcor)),
      [],
      'martes',
    );

    expect(grupos[0]!.productos.map((p) => p.nombre)).toEqual([
      'alfajor',
      'Ñandú galletitas',
      'oblea',
      'Óreo',
      'Zapallo',
    ]);
  });

  it('el ejemplo del spec: "alfajor", "Ñandú galletitas", "Óreo"', () => {
    const arcor = proveedor('Arcor');

    const grupos = armarReposicion(
      ['Ñandú galletitas', 'alfajor', 'Óreo'].map((n) => faltante(n, arcor)),
      [],
      'martes',
    );

    expect(grupos[0]!.productos.map((p) => p.nombre)).toEqual([
      'alfajor',
      'Ñandú galletitas',
      'Óreo',
    ]);
  });

  it.each(DIAS_SEMANA)(
    'un proveedor sin días de pedido nunca toma pedido hoy (%s) y va con el resto por nombre',
    (hoy) => {
      const bimbo = proveedor('Bimbo', { diasPedido: DIAS_SEMANA.filter((d) => d !== hoy) });
      const arcor = proveedor('Arcor', { diasPedido: [] });

      const grupos = armarReposicion(
        [faltante('Pan lactal', bimbo), faltante('Bon o Bon', arcor)],
        [],
        hoy,
      );

      expect(grupos.map((g) => [g.proveedor?.nombre, g.tomaPedidoHoy])).toEqual([
        ['Arcor', false],
        ['Bimbo', false],
      ]);
    },
  );
});

describe('armarReposicion: pedido por llegar', () => {
  const coca = proveedor('Coca-Cola', { diasPedido: ['martes'] });
  const llega = (fecha: string) => ({
    proveedorId: coca.id,
    llegaEl: new Date(`${fecha}T00:00:00Z`),
  });

  it('con un pedido por llegar el jueves 12/11, los productos aparecen igual y con la marca', () => {
    const grupos = armarReposicion(
      [faltante('Coca 500 ml', coca), faltante('Sprite 500 ml', coca)],
      [llega('2026-11-12')],
      'martes',
    );

    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.pedidoPorLlegarEl).toBe('2026-11-12');
    expect(grupos[0]!.productos).toHaveLength(2);
  });

  it('con dos pedidos por llegar (viernes 13/11 y jueves 12/11) marca el más cercano', () => {
    const grupos = armarReposicion(
      [faltante('Coca 500 ml', coca)],
      [llega('2026-11-13'), llega('2026-11-12')],
      'martes',
    );

    expect(grupos[0]!.pedidoPorLlegarEl).toBe('2026-11-12');
  });

  it('un pedido atrasado (lunes 09/11, hoy martes 10/11) marca el 09/11', () => {
    const grupos = armarReposicion(
      [faltante('Coca 500 ml', coca)],
      [llega('2026-11-09')],
      'martes',
    );

    expect(grupos[0]!.pedidoPorLlegarEl).toBe('2026-11-09');
  });

  it('sin pedidos, o con un pedido de otro proveedor, no hay marca', () => {
    const arcor = proveedor('Arcor');

    const grupos = armarReposicion(
      [faltante('Coca 500 ml', coca)],
      [{ proveedorId: arcor.id, llegaEl: new Date('2026-11-12T00:00:00Z') }],
      'martes',
    );

    expect(grupos[0]!.pedidoPorLlegarEl).toBeNull();
  });
});

describe('calcularReposicion contra la base', () => {
  /** Martes 10/11/2026 a las 12:00 de Argentina. */
  const MARTES_1200 = new Date('2026-11-10T15:00:00Z');

  beforeEach(async () => {
    await limpiarBase();
  });

  const resumen = (r: Awaited<ReturnType<typeof calcularReposicion>>) =>
    r.grupos.map((g) => ({
      proveedor: g.proveedor?.nombre ?? null,
      tomaPedidoHoy: g.tomaPedidoHoy,
      pedidoPorLlegarEl: g.pedidoPorLlegarEl,
      productos: g.productos.map((p) => [p.nombre, p.sugerido]),
    }));

  it('devuelve la fecha de Argentina y el instante del cálculo', async () => {
    const r = await calcularReposicion(prismaTest, MARTES_1200);

    expect(r).toEqual({ fecha: '2026-11-10', calculadaEn: MARTES_1200, grupos: [] });
  });

  it('aplica todos los bordes del umbral con el stock de la base', async () => {
    for (const [minimo, maximo, actual] of UMBRAL) {
      await crearProductoDePrueba(`min ${minimo} max ${maximo} stock ${actual}`, {
        stockMinimo: minimo,
        stockMaximo: maximo,
        stockActual: actual,
      });
    }
    await crearProductoDePrueba('desactivado', {
      stockMinimo: 5,
      stockMaximo: 20,
      stockActual: 0,
      activo: false,
    });

    const r = await calcularReposicion(prismaTest, MARTES_1200);

    const obtenido = Object.fromEntries(
      r.grupos.flatMap((g) => g.productos).map((p) => [p.nombre, p.sugerido]),
    );
    const esperado = Object.fromEntries(
      UMBRAL.filter(([, , , s]) => s !== null).map(([minimo, maximo, actual, s]) => [
        `min ${minimo} max ${maximo} stock ${actual}`,
        s,
      ]),
    );
    expect(obtenido).toEqual(esperado);
  });

  it('agrupa, ordena y manda a "Sin proveedor" los sin proveedor y los de proveedor desactivado', async () => {
    const coca = await prismaTest.proveedor.create({
      data: { nombre: 'Coca-Cola', diasPedido: ['martes'] },
    });
    const arcor = await prismaTest.proveedor.create({
      data: { nombre: 'Arcor', diasPedido: ['jueves'] },
    });
    const viejo = await prismaTest.proveedor.create({
      data: { nombre: 'Aaa desactivado', diasPedido: ['martes'], activo: false },
    });
    await prismaTest.proveedor.create({ data: { nombre: 'Pepsi', diasPedido: ['martes'] } });
    const crear = (nombre: string, proveedorId: string | null, actual = 0) =>
      crearProductoDePrueba(nombre, {
        nombreBusqueda: normalizarParaBusqueda(nombre),
        stockMinimo: 5,
        stockMaximo: 20,
        stockActual: actual,
        proveedorId,
      });
    await crear('Óreo', arcor.id);
    await crear('Ñandú galletitas', arcor.id);
    await crear('alfajor', arcor.id);
    await crear('Sprite 500 ml', coca.id, 8);
    await crear('Coca 500 ml', coca.id, 4);
    await crear('Hielo', null);
    await crear('Producto viejo', viejo.id);

    const r = await calcularReposicion(prismaTest, MARTES_1200);

    expect(resumen(r)).toEqual([
      {
        proveedor: 'Coca-Cola',
        tomaPedidoHoy: true,
        pedidoPorLlegarEl: null,
        productos: [['Coca 500 ml', 16]],
      },
      {
        proveedor: 'Arcor',
        tomaPedidoHoy: false,
        pedidoPorLlegarEl: null,
        productos: [
          ['alfajor', 20],
          ['Ñandú galletitas', 20],
          ['Óreo', 20],
        ],
      },
      {
        proveedor: null,
        tomaPedidoHoy: false,
        pedidoPorLlegarEl: null,
        productos: [
          ['Hielo', 20],
          ['Producto viejo', 20],
        ],
      },
    ]);
  });

  it.each([
    ['2026-11-11T02:59:59Z', '2026-11-10', true],
    ['2026-11-11T03:00:00Z', '2026-11-11', false],
  ])(
    'a las %s es el día %s de Argentina: Coca-Cola (pide los martes) toma pedido hoy = %s',
    async (instante, fecha, tomaPedidoHoy) => {
      const coca = await prismaTest.proveedor.create({
        data: { nombre: 'Coca-Cola', diasPedido: ['martes'] },
      });
      await crearProductoDePrueba('Coca 500 ml', {
        stockMinimo: 5,
        stockMaximo: 20,
        proveedorId: coca.id,
      });

      const r = await calcularReposicion(prismaTest, new Date(instante));

      expect(r.fecha).toBe(fecha);
      expect(r.grupos.map((g) => g.tomaPedidoHoy)).toEqual([tomaPedidoHoy]);
    },
  );

  it('marca solo los pedidos por llegar, con la fecha más cercana aunque esté atrasada', async () => {
    const admin = await crearUsuarioDePrueba('ana', 'admin');
    const proveedores: Record<string, string> = {};
    for (const nombre of ['Arcor', 'Bimbo', 'Coca-Cola', 'Pepsi', 'Quilmes']) {
      const p = await prismaTest.proveedor.create({ data: { nombre } });
      proveedores[nombre] = p.id;
      await crearProductoDePrueba(`Producto de ${nombre}`, {
        stockMinimo: 5,
        stockMaximo: 20,
        proveedorId: p.id,
      });
    }
    const pedido = (
      nombre: string,
      llegaEl: string,
      estado: 'por_llegar' | 'llego' | 'cargado' | 'cancelado',
    ) =>
      prismaTest.pedido.create({
        data: {
          proveedorId: proveedores[nombre]!,
          totalPedido: '1000',
          llegaEl: new Date(`${llegaEl}T00:00:00Z`),
          creadoPorId: admin.id,
          estado,
        },
      });
    // Coca-Cola: dos por llegar → el más cercano.
    await pedido('Coca-Cola', '2026-11-13', 'por_llegar');
    await pedido('Coca-Cola', '2026-11-12', 'por_llegar');
    // Bimbo: atrasado (debía llegar el lunes 09/11).
    await pedido('Bimbo', '2026-11-09', 'por_llegar');
    // Arcor, Pepsi y Quilmes: el único pedido ya llegó, está cargado o se canceló.
    await pedido('Arcor', '2026-11-11', 'llego');
    await pedido('Pepsi', '2026-11-11', 'cargado');
    await pedido('Quilmes', '2026-11-11', 'cancelado');
    // Un pedido cancelado más cercano no le gana al por llegar de Coca-Cola.
    await pedido('Coca-Cola', '2026-11-11', 'cancelado');

    const r = await calcularReposicion(prismaTest, MARTES_1200);

    expect(
      Object.fromEntries(r.grupos.map((g) => [g.proveedor?.nombre, g.pedidoPorLlegarEl])),
    ).toEqual({
      Arcor: null,
      Bimbo: '2026-11-09',
      'Coca-Cola': '2026-11-12',
      Pepsi: null,
      Quilmes: null,
    });
  });
});
