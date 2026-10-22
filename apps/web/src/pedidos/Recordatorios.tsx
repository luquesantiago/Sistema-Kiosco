import type { PedidoResumen } from '@kiosco/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { pedir } from '../api/cliente.js';
import { hoyEnArgentina } from '../lib/fechas.js';
import { formatearPesos } from '../lib/montos.js';
import { CLAVE_PEDIDOS } from './Pedidos.js';

/**
 * Pedidos que hay que atender, para el POS: los que llegan hoy o están
 * atrasados y los que llegaron y falta cargar. Los enlaces quedan fuera del
 * orden de Tab para no sacarle el foco al lector.
 */
export function RecordatoriosPedidos() {
  const { data: pedidos } = useQuery({
    queryKey: [...CLAVE_PEDIDOS, 'abiertos'],
    queryFn: () => pedir<PedidoResumen[]>('GET', '/pedidos?vista=abiertos'),
  });
  const hoy = hoyEnArgentina();
  const recordatorios = (pedidos ?? []).flatMap((p) => {
    if (p.estado === 'llego') return [{ p, texto: `${p.proveedor.nombre}: falta cargar` }];
    if (p.estado === 'por_llegar' && p.llegaEl <= hoy) {
      const cuando = p.llegaEl === hoy ? 'Hoy llega' : 'Atrasado';
      return [{ p, texto: `${cuando}: ${p.proveedor.nombre} (${formatearPesos(p.totalPedido)})` }];
    }
    return [];
  });
  if (recordatorios.length === 0) return null;

  return (
    <ul
      aria-label="Pedidos para atender"
      className="flex flex-wrap gap-2 rounded-lg bg-amber-50 p-2 text-sm"
    >
      {recordatorios.map(({ p, texto }) => (
        <li key={p.id}>
          <Link
            to={`/pedidos/${p.id}`}
            tabIndex={-1}
            className="block rounded bg-amber-100 px-2 py-1 text-amber-900 hover:bg-amber-200"
          >
            {texto}
          </Link>
        </li>
      ))}
    </ul>
  );
}
