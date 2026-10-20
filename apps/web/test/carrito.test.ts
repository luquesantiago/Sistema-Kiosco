import type { ProductoVenta } from '@kiosco/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cargarCarrito,
  CARRITO_VACIO,
  guardarCarrito,
  itemsParaVenta,
  reducirCarrito,
  totalCarrito,
  type AccionCarrito,
  type Carrito,
} from '../src/pos/carrito.js';

const ALFAJOR: ProductoVenta = {
  id: '0198a5b0-0000-7000-8000-000000000201',
  codigoBarras: '1',
  nombre: 'Alfajor',
  precio: '900.00',
  stockActual: 5,
};
const GASEOSA: ProductoVenta = {
  ...ALFAJOR,
  id: '0198a5b0-0000-7000-8000-000000000202',
  codigoBarras: '2',
  nombre: 'Gaseosa',
  precio: '1500.00',
};

function aplicar(...acciones: AccionCarrito[]): Carrito {
  return acciones.reduce(reducirCarrito, CARRITO_VACIO);
}

afterEach(() => {
  sessionStorage.clear();
});

describe('carrito', () => {
  it('agregar dos veces el mismo producto suma 1 y selecciona la fila', () => {
    const c = aplicar(
      { tipo: 'agregar', producto: ALFAJOR },
      { tipo: 'agregar', producto: GASEOSA },
      { tipo: 'agregar', producto: ALFAJOR },
    );
    expect(c.items.map((i) => [i.clave, i.cantidad])).toEqual([
      [ALFAJOR.id, 2],
      [GASEOSA.id, 1],
    ]);
    expect(c.seleccionado).toBe(0);
    expect(totalCarrito(c)).toBe('3300.00');
  });

  it('suma, resta y cambia cantidades sin bajar de 1 ni pasar de 999', () => {
    let c = aplicar({ tipo: 'agregar', producto: ALFAJOR });
    c = reducirCarrito(c, { tipo: 'sumar', clave: ALFAJOR.id, delta: -1 });
    expect(c.items[0]?.cantidad).toBe(1);
    c = reducirCarrito(c, { tipo: 'cambiarCantidad', clave: ALFAJOR.id, cantidad: 5000 });
    expect(c.items[0]?.cantidad).toBe(999);
    c = reducirCarrito(c, { tipo: 'cambiarCantidad', clave: ALFAJOR.id, cantidad: 3 });
    c = reducirCarrito(c, { tipo: 'sumar', clave: ALFAJOR.id, delta: 1 });
    expect(c.items[0]?.cantidad).toBe(4);
  });

  it('quita un ítem y ajusta la selección; vaciar deja el carrito vacío', () => {
    let c = aplicar({ tipo: 'agregar', producto: ALFAJOR }, { tipo: 'agregar', producto: GASEOSA });
    c = reducirCarrito(c, { tipo: 'quitar', clave: GASEOSA.id });
    expect(c.items).toHaveLength(1);
    expect(c.seleccionado).toBe(0);
    expect(reducirCarrito(c, { tipo: 'vaciar' })).toEqual(CARRITO_VACIO);
  });

  it('agrega ítems "Varios" y los arma para la venta', () => {
    const c = aplicar(
      { tipo: 'agregar', producto: ALFAJOR },
      { tipo: 'agregarVarios', descripcion: 'Caramelos', precio: '500.00', clave: 'v1' },
    );
    expect(totalCarrito(c)).toBe('1400.00');
    expect(itemsParaVenta(c)).toEqual([
      { productoId: ALFAJOR.id, cantidad: 1 },
      { varios: { descripcion: 'Caramelos', precio: '500.00' }, cantidad: 1 },
    ]);
  });

  it('actualiza precios y marca solo los que cambiaron', () => {
    let c = aplicar({ tipo: 'agregar', producto: ALFAJOR }, { tipo: 'agregar', producto: GASEOSA });
    c = reducirCarrito(c, {
      tipo: 'actualizarPrecios',
      precios: [
        { productoId: ALFAJOR.id, precio: '1000.00' },
        { productoId: GASEOSA.id, precio: '1500.00' },
      ],
    });
    expect(c.items.map((i) => [i.precio, i.precioCambio])).toEqual([
      ['1000.00', true],
      ['1500.00', false],
    ]);
    expect(totalCarrito(c)).toBe('2500.00');
  });

  it('se restaura después de una recarga', () => {
    const c = aplicar(
      { tipo: 'agregar', producto: ALFAJOR },
      { tipo: 'agregar', producto: ALFAJOR },
    );
    guardarCarrito(c);
    expect(cargarCarrito()).toEqual(c);
    guardarCarrito(CARRITO_VACIO);
    expect(cargarCarrito()).toEqual(CARRITO_VACIO);
  });

  it('ignora un guardado roto', () => {
    sessionStorage.setItem('kiosco.carrito', '{roto');
    expect(cargarCarrito()).toEqual(CARRITO_VACIO);
  });
});
