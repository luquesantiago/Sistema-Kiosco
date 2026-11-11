import { normalizarParaBusqueda, type DiaSemana } from '@kiosco/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { diaDeHoyEnArgentina, fechaEnArgentina } from '../../lib/fechas.js';

// Qué hay que reponer (Fase A): stock actual en o debajo del mínimo, hasta el máximo.
// No tiene rutas: lo usa solo el aviso diario de reposición.

export interface ProductoAReponer {
  id: string;
  nombre: string;
  stockActual: number;
  sugerido: number;
}

export interface GrupoReposicion {
  /** `null` es el grupo "Sin proveedor" (sin proveedor o con el proveedor desactivado). */
  proveedor: { id: string; nombre: string } | null;
  tomaPedidoHoy: boolean;
  /** "AAAA-MM-DD" del pedido por llegar más cercano, aunque esté atrasado. */
  pedidoPorLlegarEl: string | null;
  productos: ProductoAReponer[];
}

export interface Reposicion {
  /** Día de Argentina del cálculo, "AAAA-MM-DD". */
  fecha: string;
  calculadaEn: Date;
  grupos: GrupoReposicion[];
}

/** Producto tal como lo trae la consulta, con su proveedor. */
export interface ProductoConProveedor {
  id: string;
  nombre: string;
  nombreBusqueda: string;
  stockActual: number;
  stockMinimo: number;
  stockMaximo: number;
  activo: boolean;
  proveedor: { id: string; nombre: string; activo: boolean; diasPedido: DiaSemana[] } | null;
}

/** Un pedido `por_llegar` (puede haber varios por proveedor). */
export interface PedidoPorLlegar {
  proveedorId: string;
  llegaEl: Date;
}

/** Orden de texto sin distinguir mayúsculas ni acentos; a igual texto, por id para que sea estable. */
function compararPor<T>(clave: (x: T) => [number, string, string]) {
  return (a: T, b: T) => {
    const ka = clave(a);
    const kb = clave(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i]! < kb[i]!) return -1;
      if (ka[i]! > kb[i]!) return 1;
    }
    return 0;
  };
}

/**
 * Arma la reposición en memoria: filtra con la regla completa, agrupa por
 * proveedor, ordena y marca los pedidos por llegar. Pura, para testear los bordes sin base.
 */
export function armarReposicion(
  productos: readonly ProductoConProveedor[],
  pedidos: readonly PedidoPorLlegar[],
  hoy: DiaSemana,
): GrupoReposicion[] {
  const llegadaMasCercana = new Map<string, Date>();
  for (const p of pedidos) {
    const actual = llegadaMasCercana.get(p.proveedorId);
    if (!actual || p.llegaEl < actual) llegadaMasCercana.set(p.proveedorId, p.llegaEl);
  }

  type Renglon = ProductoAReponer & { orden: string };
  const porProveedor = new Map<string, { grupo: GrupoReposicion; renglones: Renglon[] }>();
  const sinProveedor: Renglon[] = [];

  for (const p of productos) {
    if (!p.activo || p.stockActual > p.stockMinimo) continue;
    // Mínimo y máximo 0: "no reponer nunca".
    if (p.stockMinimo === 0 && p.stockMaximo === 0) continue;
    const sugerido = p.stockMaximo - p.stockActual;
    if (sugerido <= 0) continue;

    const renglon: Renglon = {
      id: p.id,
      nombre: p.nombre,
      stockActual: p.stockActual,
      sugerido,
      orden: p.nombreBusqueda,
    };
    const prov = p.proveedor;
    if (!prov || !prov.activo) {
      sinProveedor.push(renglon);
      continue;
    }
    let entrada = porProveedor.get(prov.id);
    if (!entrada) {
      const llega = llegadaMasCercana.get(prov.id);
      entrada = {
        grupo: {
          proveedor: { id: prov.id, nombre: prov.nombre },
          tomaPedidoHoy: prov.diasPedido.includes(hoy),
          // `llegaEl` es una fecha sin hora (medianoche UTC): se toma tal cual.
          pedidoPorLlegarEl: llega ? llega.toISOString().slice(0, 10) : null,
          productos: [],
        },
        renglones: [],
      };
      porProveedor.set(prov.id, entrada);
    }
    entrada.renglones.push(renglon);
  }

  const ordenarProductos = (lista: Renglon[]): ProductoAReponer[] =>
    lista
      .sort(compararPor((x) => [0, x.orden, x.id]))
      .map(({ id, nombre, stockActual, sugerido }) => ({ id, nombre, stockActual, sugerido }));

  const grupos = [...porProveedor.values()]
    .sort(
      compararPor(({ grupo }) => [
        grupo.tomaPedidoHoy ? 0 : 1,
        normalizarParaBusqueda(grupo.proveedor!.nombre),
        grupo.proveedor!.id,
      ]),
    )
    .map(({ grupo, renglones }) => ({ ...grupo, productos: ordenarProductos(renglones) }));

  if (sinProveedor.length > 0) {
    grupos.push({
      proveedor: null,
      tomaPedidoHoy: false,
      pedidoPorLlegarEl: null,
      productos: ordenarProductos(sinProveedor),
    });
  }
  return grupos;
}

/** Reposición con el stock del momento `ahora`. */
export async function calcularReposicion(prisma: PrismaClient, ahora: Date): Promise<Reposicion> {
  const [productos, pedidos] = await Promise.all([
    prisma.producto.findMany({
      where: { activo: true, stockActual: { lte: prisma.producto.fields.stockMinimo } },
      select: {
        id: true,
        nombre: true,
        nombreBusqueda: true,
        stockActual: true,
        stockMinimo: true,
        stockMaximo: true,
        activo: true,
        proveedor: { select: { id: true, nombre: true, activo: true, diasPedido: true } },
      },
    }),
    prisma.pedido.groupBy({
      by: ['proveedorId'],
      where: { estado: 'por_llegar' },
      _min: { llegaEl: true },
    }),
  ]);

  return {
    fecha: fechaEnArgentina(ahora),
    calculadaEn: ahora,
    grupos: armarReposicion(
      productos,
      pedidos.map((p) => ({ proveedorId: p.proveedorId, llegaEl: p._min.llegaEl! })),
      diaDeHoyEnArgentina(ahora),
    ),
  };
}
