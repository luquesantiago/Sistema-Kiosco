import {
  multiplicar,
  sumar,
  type ItemVentaEntrada,
  type PreciosActuales,
  type ProductoVenta,
} from '@kiosco/shared';

export const CANTIDAD_MAXIMA = 999;

interface ItemBase {
  /** Identifica la fila: el id del producto o uno generado para "Varios". */
  clave: string;
  cantidad: number;
  /** Precio unitario como texto decimal ("900.00"). */
  precio: string;
  /** Se marca cuando el servidor informó un precio nuevo. */
  precioCambio?: boolean;
}

export type ItemCarrito =
  | (ItemBase & { tipo: 'producto'; productoId: string; nombre: string; codigo: string | null })
  | (ItemBase & { tipo: 'varios'; descripcion: string });

export interface Carrito {
  items: ItemCarrito[];
  /** Índice del ítem seleccionado con las flechas, o -1 si no hay. */
  seleccionado: number;
}

export type AccionCarrito =
  | { tipo: 'agregar'; producto: ProductoVenta }
  | { tipo: 'agregarVarios'; descripcion: string; precio: string; clave: string }
  | { tipo: 'sumar'; clave: string; delta: number }
  | { tipo: 'cambiarCantidad'; clave: string; cantidad: number }
  | { tipo: 'quitar'; clave: string }
  | { tipo: 'seleccionar'; indice: number }
  | { tipo: 'vaciar' }
  | { tipo: 'actualizarPrecios'; precios: PreciosActuales };

export const CARRITO_VACIO: Carrito = { items: [], seleccionado: -1 };

function limitar(cantidad: number): number {
  return Math.min(Math.max(Math.trunc(cantidad), 1), CANTIDAD_MAXIMA);
}

function conItem(
  carrito: Carrito,
  clave: string,
  cambio: (i: ItemCarrito) => ItemCarrito,
): Carrito {
  return { ...carrito, items: carrito.items.map((i) => (i.clave === clave ? cambio(i) : i)) };
}

export function reducirCarrito(carrito: Carrito, accion: AccionCarrito): Carrito {
  switch (accion.tipo) {
    case 'agregar': {
      // Escanear de nuevo un producto que ya está suma una unidad.
      const indice = carrito.items.findIndex((i) => i.clave === accion.producto.id);
      if (indice >= 0) {
        const sumado = conItem(carrito, accion.producto.id, (i) => ({
          ...i,
          cantidad: limitar(i.cantidad + 1),
        }));
        return { ...sumado, seleccionado: indice };
      }
      const { id, nombre, codigoBarras, precio } = accion.producto;
      const items: ItemCarrito[] = [
        ...carrito.items,
        {
          tipo: 'producto',
          clave: id,
          productoId: id,
          nombre,
          codigo: codigoBarras,
          precio,
          cantidad: 1,
        },
      ];
      return { items, seleccionado: items.length - 1 };
    }
    case 'agregarVarios': {
      const items: ItemCarrito[] = [
        ...carrito.items,
        {
          tipo: 'varios',
          clave: accion.clave,
          descripcion: accion.descripcion,
          precio: accion.precio,
          cantidad: 1,
        },
      ];
      return { items, seleccionado: items.length - 1 };
    }
    case 'sumar':
      return conItem(carrito, accion.clave, (i) => ({
        ...i,
        cantidad: limitar(i.cantidad + accion.delta),
      }));
    case 'cambiarCantidad':
      return conItem(carrito, accion.clave, (i) => ({ ...i, cantidad: limitar(accion.cantidad) }));
    case 'quitar': {
      const items = carrito.items.filter((i) => i.clave !== accion.clave);
      return { items, seleccionado: Math.min(carrito.seleccionado, items.length - 1) };
    }
    case 'seleccionar':
      return {
        ...carrito,
        seleccionado: Math.min(Math.max(accion.indice, 0), carrito.items.length - 1),
      };
    case 'vaciar':
      return CARRITO_VACIO;
    case 'actualizarPrecios': {
      const nuevos = new Map(accion.precios.map((p) => [p.productoId, p.precio]));
      return {
        ...carrito,
        items: carrito.items.map((i) => {
          const precio = i.tipo === 'producto' ? nuevos.get(i.productoId) : undefined;
          if (precio === undefined) return { ...i, precioCambio: false };
          return { ...i, precio, precioCambio: precio !== i.precio };
        }),
      };
    }
  }
}

export function subtotal(item: ItemCarrito): string {
  return multiplicar(item.precio, item.cantidad);
}

export function totalCarrito(carrito: Carrito): string {
  return sumar(...carrito.items.map(subtotal));
}

/** Los ítems como los pide `POST /api/ventas`. */
export function itemsParaVenta(carrito: Carrito): ItemVentaEntrada[] {
  return carrito.items.map((i) =>
    i.tipo === 'producto'
      ? { productoId: i.productoId, cantidad: i.cantidad }
      : { varios: { descripcion: i.descripcion, precio: i.precio }, cantidad: i.cantidad },
  );
}

const CLAVE_GUARDADO = 'kiosco.carrito';

/**
 * sessionStorage y no localStorage: no lo comparten otras pestañas y se
 * descarta al cerrar el navegador, pero sobrevive a una recarga accidental.
 */
export function cargarCarrito(): Carrito {
  try {
    const guardado = sessionStorage.getItem(CLAVE_GUARDADO);
    if (!guardado) return CARRITO_VACIO;
    const carrito = JSON.parse(guardado) as Carrito;
    return Array.isArray(carrito.items) ? carrito : CARRITO_VACIO;
  } catch {
    return CARRITO_VACIO;
  }
}

export function guardarCarrito(carrito: Carrito): void {
  try {
    if (carrito.items.length === 0) sessionStorage.removeItem(CLAVE_GUARDADO);
    else sessionStorage.setItem(CLAVE_GUARDADO, JSON.stringify(carrito));
  } catch {
    // Sin almacenamiento (modo privado): el carrito igual funciona, solo no sobrevive a recargar.
  }
}
