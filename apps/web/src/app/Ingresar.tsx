import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useIngresar, useSesion } from './sesion.js';

export function Ingresar() {
  const { data: sesion } = useSesion();
  const ingresar = useIngresar();
  const navigate = useNavigate();
  const desde = (useLocation().state as { desde?: string } | null)?.desde ?? '/';
  const [usuario, setUsuario] = useState('');
  const [contrasena, setContrasena] = useState('');

  if (sesion) return <Navigate to={desde} replace />;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    ingresar.mutate(
      { usuario, contrasena },
      { onSuccess: () => navigate(desde, { replace: true }) },
    );
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form onSubmit={enviar} className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow">
        <h1 className="text-2xl font-semibold">Kiosco</h1>
        <label className="block">
          <span className="text-sm font-medium">Usuario</span>
          <input
            className="campo"
            name="usuario"
            autoComplete="username"
            autoFocus
            required
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Contraseña</span>
          <input
            className="campo"
            name="contrasena"
            type="password"
            autoComplete="current-password"
            required
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
          />
        </label>
        {ingresar.error && (
          <p role="alert" className="text-sm text-red-700">
            {ingresar.error.message}
          </p>
        )}
        <button type="submit" className="boton w-full" disabled={ingresar.isPending}>
          {ingresar.isPending ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </main>
  );
}
