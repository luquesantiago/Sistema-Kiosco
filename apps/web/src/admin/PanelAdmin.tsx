import { Link } from 'react-router';
import { EstadoSistema } from './EstadoSistema.js';

export function PanelAdmin() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Administración</h1>
      <nav className="grid gap-3 sm:grid-cols-2">
        <Link to="/admin/usuarios" className="rounded-lg bg-white p-4 shadow hover:bg-slate-50">
          <span className="font-medium">Usuarios</span>
          <span className="block text-sm text-slate-600">Altas, roles y contraseñas</span>
        </Link>
      </nav>
      <EstadoSistema />
    </section>
  );
}
