import type { Rol } from '@kiosco/shared';
import { useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useSalir, useSesion } from './sesion.js';

const ENLACES: { a: string; texto: string; roles: Rol[] }[] = [
  { a: '/venta', texto: 'Venta', roles: ['admin', 'empleado'] },
  { a: '/ventas', texto: 'Ventas', roles: ['admin', 'empleado'] },
  { a: '/stock/ingreso', texto: 'Ingreso de mercadería', roles: ['admin', 'empleado'] },
  { a: '/admin/productos', texto: 'Productos', roles: ['admin'] },
  { a: '/admin/stock', texto: 'Stock', roles: ['admin'] },
  { a: '/admin/proveedores', texto: 'Proveedores', roles: ['admin'] },
  { a: '/admin/usuarios', texto: 'Usuarios', roles: ['admin'] },
  { a: '/admin/avisos', texto: 'Avisos', roles: ['admin'] },
  { a: '/cuenta/contrasena', texto: 'Mi contraseña', roles: ['admin', 'empleado'] },
];

/** Exige sesión y muestra la barra con el menú según el rol. */
export function Layout() {
  const { data: sesion, isPending } = useSesion();
  const salir = useSalir();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuAbierto, setMenuAbierto] = useState(false);

  if (isPending) return <p className="p-6">Cargando…</p>;
  if (!sesion) return <Navigate to="/ingresar" state={{ desde: pathname }} replace />;

  const enlaces = ENLACES.filter((e) => e.roles.includes(sesion.rol));

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-slate-800 text-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <span className="font-semibold">Kiosco</span>
          <button
            type="button"
            className="ml-auto rounded px-2 py-1 md:hidden"
            aria-expanded={menuAbierto}
            aria-controls="menu-principal"
            onClick={() => setMenuAbierto((abierto) => !abierto)}
          >
            Menú
          </button>
          <nav
            id="menu-principal"
            aria-label="Principal"
            className={`${menuAbierto ? 'flex' : 'hidden'} absolute top-12 right-0 left-0 flex-col gap-1 bg-slate-800 p-3 md:static md:flex md:flex-1 md:flex-row md:p-0`}
          >
            {enlaces.map((e) => (
              <NavLink
                key={e.a}
                to={e.a}
                onClick={() => setMenuAbierto(false)}
                className={({ isActive }) =>
                  `rounded px-3 py-1 ${isActive ? 'bg-slate-600' : 'hover:bg-slate-700'}`
                }
              >
                {e.texto}
              </NavLink>
            ))}
            <span className="px-3 py-1 text-slate-300 md:ml-auto">{sesion.nombre}</span>
            <button
              type="button"
              className="rounded px-3 py-1 text-left hover:bg-slate-700"
              onClick={() =>
                salir.mutate(undefined, {
                  onSettled: () => navigate('/ingresar', { replace: true }),
                })
              }
            >
              Salir
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </div>
  );
}

/** Admin al panel de administración; empleado a la venta. */
export function RedireccionInicio() {
  const { data: sesion } = useSesion();
  return <Navigate to={sesion?.rol === 'admin' ? '/admin' : '/venta'} replace />;
}

/** Solo deja pasar al rol indicado; al resto lo manda al inicio. */
export function RequiereRol({ rol }: { rol: Rol }) {
  const { data: sesion } = useSesion();
  if (sesion?.rol !== rol) return <Navigate to="/" replace />;
  return <Outlet />;
}
