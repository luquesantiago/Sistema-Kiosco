import { describe, expect, it } from 'vitest';
import { textoAvisoReposicion } from '../src/modules/reposicion/aviso.js';
import type { Reposicion } from '../src/modules/reposicion/servicio.js';

/*
 * Se compara el texto completo, como en los otros avisos. El formato es el que
 * propone el design. Supuestos que fijan estos tests:
 * - El día sin faltantes deja una línea en blanco entre "Stock a las HH:MM" y
 *   "Hoy no hay nada para reponer", igual que antes de los grupos.
 * - Cada proveedor que pide hoy es un bloque propio separado por una línea en blanco.
 * - El título "*Otros proveedores*" solo aparece si hay alguno.
 * - Los días van en castellano con tilde ("miércoles", "sábado").
 */

type Grupo = Reposicion['grupos'][number];

/** Martes 10/11/2026 a las 12:00 de Argentina. */
const MARTES_1200 = new Date('2026-11-10T15:00:00Z');

function reposicion(grupos: Grupo[], calculadaEn = MARTES_1200, fecha = '2026-11-10'): Reposicion {
  return { fecha, calculadaEn, grupos };
}

let siguienteId = 0;

function grupo(
  nombre: string | null,
  productos: [string, number][],
  datos: { tomaPedidoHoy?: boolean; pedidoPorLlegarEl?: string | null } = {},
): Grupo {
  return {
    proveedor: nombre === null ? null : { id: `prov-${nombre}`, nombre },
    tomaPedidoHoy: datos.tomaPedidoHoy ?? false,
    pedidoPorLlegarEl: datos.pedidoPorLlegarEl ?? null,
    productos: productos.map(([n, sugerido]) => ({
      id: `prod-${++siguienteId}`,
      nombre: n,
      stockActual: 0,
      sugerido,
    })),
  };
}

/** n productos cualquiera, para los proveedores que no piden hoy (solo se cuentan). */
const varios = (n: number): [string, number][] =>
  Array.from({ length: n }, (_, i) => [`Producto ${i + 1}`, 3]);

describe('texto del aviso de reposición', () => {
  it('día con faltantes: detalle de los que piden hoy, cantidad del resto y "Sin proveedor" al final', () => {
    const texto = textoAvisoReposicion(
      reposicion([
        grupo(
          'Coca-Cola',
          [
            ['Coca 500 ml', 24],
            ['Sprite 500 ml', 12],
          ],
          { tomaPedidoHoy: true },
        ),
        grupo('Arcor', varios(5)),
        grupo(null, [['Hielo', 10]]),
      ]),
    );

    expect(texto).toBe(
      [
        '*Reposición - martes 10/11*',
        'Stock a las 12:00',
        '',
        '*Coca-Cola* (pide hoy)',
        '- Coca 500 ml: 24',
        '- Sprite 500 ml: 12',
        '',
        '*Otros proveedores*',
        '- Arcor: 5 productos',
        '',
        '*Sin proveedor*',
        '- Hielo: 10',
      ].join('\n'),
    );
  });

  it('el ejemplo completo del design, con la marca de pedido por llegar en los dos formatos', () => {
    const texto = textoAvisoReposicion(
      reposicion([
        grupo(
          'Coca-Cola',
          [
            ['Coca 500 ml', 24],
            ['Sprite 500 ml', 12],
          ],
          { tomaPedidoHoy: true, pedidoPorLlegarEl: '2026-11-12' },
        ),
        grupo('Arcor', varios(5), { pedidoPorLlegarEl: '2026-11-12' }),
        grupo('Pepsi', varios(1)),
        grupo(null, [['Hielo', 10]]),
      ]),
    );

    expect(texto).toBe(
      [
        '*Reposición - martes 10/11*',
        'Stock a las 12:00',
        '',
        '*Coca-Cola* (pide hoy)',
        '_Ya hay un pedido por llegar el jueves 12/11_',
        '- Coca 500 ml: 24',
        '- Sprite 500 ml: 12',
        '',
        '*Otros proveedores*',
        '- Arcor: 5 productos (pedido por llegar el jueves 12/11)',
        '- Pepsi: 1 producto',
        '',
        '*Sin proveedor*',
        '- Hielo: 10',
      ].join('\n'),
    );
  });

  it.each([
    [1, '1 producto'],
    [2, '2 productos'],
  ])('a Pepsi, que no pide hoy, le faltan %i: dice "%s"', (cantidad, leyenda) => {
    const texto = textoAvisoReposicion(reposicion([grupo('Pepsi', varios(cantidad))]));

    expect(texto).toBe(
      [
        '*Reposición - martes 10/11*',
        'Stock a las 12:00',
        '',
        '*Otros proveedores*',
        `- Pepsi: ${leyenda}`,
      ].join('\n'),
    );
  });

  it('varios proveedores que piden hoy van cada uno con su detalle; sin otros, no hay título de otros', () => {
    const texto = textoAvisoReposicion(
      reposicion([
        grupo('Coca-Cola', [['Coca 500 ml', 24]], { tomaPedidoHoy: true }),
        grupo('Quilmes', [['Quilmes 1 l', 6]], { tomaPedidoHoy: true }),
        grupo(null, [
          ['Hielo', 10],
          ['Carbón', 4],
        ]),
      ]),
    );

    expect(texto).toBe(
      [
        '*Reposición - martes 10/11*',
        'Stock a las 12:00',
        '',
        '*Coca-Cola* (pide hoy)',
        '- Coca 500 ml: 24',
        '',
        '*Quilmes* (pide hoy)',
        '- Quilmes 1 l: 6',
        '',
        '*Sin proveedor*',
        '- Hielo: 10',
        '- Carbón: 4',
      ].join('\n'),
    );
  });

  it('día sin faltantes: la fecha, la hora del stock y "Hoy no hay nada para reponer"', () => {
    expect(textoAvisoReposicion(reposicion([]))).toBe(
      ['*Reposición - martes 10/11*', 'Stock a las 12:00', '', 'Hoy no hay nada para reponer'].join(
        '\n',
      ),
    );
  });

  it.each([
    ['2026-11-10T15:00:00Z', '12:00'],
    ['2026-11-10T15:00:59Z', '12:00'],
    ['2026-11-10T18:20:00Z', '15:20'],
    ['2026-11-10T21:59:59Z', '18:59'],
  ])('calculado a las %s dice "Stock a las %s" (hora de Argentina)', (instante, hora) => {
    const texto = textoAvisoReposicion(reposicion([], new Date(instante)));

    expect(texto.split('\n')[1]).toBe(`Stock a las ${hora}`);
  });

  it.each([
    ['2026-11-09', 'lunes 09/11'],
    ['2026-11-10', 'martes 10/11'],
    ['2026-11-11', 'miércoles 11/11'],
    ['2026-11-12', 'jueves 12/11'],
    ['2026-11-13', 'viernes 13/11'],
    ['2026-11-14', 'sábado 14/11'],
    ['2026-11-15', 'domingo 15/11'],
    ['2026-01-01', 'jueves 01/01'],
    ['2026-12-31', 'jueves 31/12'],
  ])(
    'la fecha %s se escribe "%s" en el título y en la marca, sin correrse de día',
    (fecha, dia) => {
      const texto = textoAvisoReposicion(
        reposicion(
          [grupo('Arcor', varios(2), { pedidoPorLlegarEl: fecha })],
          new Date(`${fecha}T15:00:00Z`),
          fecha,
        ),
      );

      expect(texto.split('\n')[0]).toBe(`*Reposición - ${dia}*`);
      expect(texto).toContain(`- Arcor: 2 productos (pedido por llegar el ${dia})`);
    },
  );
});
