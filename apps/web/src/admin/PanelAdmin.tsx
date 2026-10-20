import { Link } from 'react-router';
import { EstadoSistema } from './EstadoSistema.js';

const SECCIONES = [
  { a: '/admin/productos', titulo: 'Productos', detalle: 'Catálogo, precios e historial' },
  { a: '/admin/productos/aumento', titulo: 'Aumento de precios', detalle: 'Por porcentaje' },
  { a: '/admin/stock', titulo: 'Stock', detalle: 'Ajustes, conteos, ingresos y movimientos' },
  { a: '/admin/proveedores', titulo: 'Proveedores', detalle: 'Contacto y días de pedido' },
  { a: '/ventas', titulo: 'Ventas', detalle: 'Listado, detalle y anulaciones' },
  { a: '/admin/avisos', titulo: 'Avisos', detalle: 'Anulaciones pendientes de aviso' },
  { a: '/admin/usuarios', titulo: 'Usuarios', detalle: 'Altas, roles y contraseñas' },
];

export function PanelAdmin() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Administración</h1>
      <nav className="grid gap-3 sm:grid-cols-2">
        {SECCIONES.map((s) => (
          <Link key={s.a} to={s.a} className="rounded-lg bg-white p-4 shadow hover:bg-slate-50">
            <span className="font-medium">{s.titulo}</span>
            <span className="block text-sm text-slate-600">{s.detalle}</span>
          </Link>
        ))}
      </nav>
      <EstadoSistema />
    </section>
  );
}
