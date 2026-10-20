import {
  altaUsuarioSchema,
  type AltaUsuario,
  type EdicionUsuario,
  type Rol,
  type UsuarioListado,
} from '@kiosco/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { pedir } from '../api/cliente.js';
import { useSesion } from '../app/sesion.js';

const CLAVE_USUARIOS = ['usuarios'] as const;

function useUsuarios() {
  return useQuery({
    queryKey: CLAVE_USUARIOS,
    queryFn: () => pedir<UsuarioListado[]>('GET', '/usuarios'),
  });
}

function useCambioDeUsuarios<T>(accion: (datos: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: accion,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_USUARIOS }),
  });
}

const NOMBRE_ROL: Record<Rol, string> = { admin: 'Admin', empleado: 'Empleado' };

function formatearIngreso(fecha: string | null): string {
  if (!fecha) return 'Nunca';
  return new Date(fecha).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function MensajeError({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-red-700">
      {error.message}
    </p>
  );
}

function FormularioAlta({ alCerrar }: { alCerrar: () => void }) {
  const [datos, setDatos] = useState<AltaUsuario>({
    nombre: '',
    usuario: '',
    rol: 'empleado',
    contrasena: '',
  });
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const alta = useCambioDeUsuarios((d: AltaUsuario) => pedir('POST', '/usuarios', d));

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const validado = altaUsuarioSchema.safeParse(datos);
    if (!validado.success) {
      setErrorLocal(validado.error.issues[0]?.message ?? 'Revisá los datos.');
      return;
    }
    setErrorLocal(null);
    alta.mutate(validado.data, { onSuccess: alCerrar });
  };

  return (
    <form
      onSubmit={enviar}
      aria-label="Nuevo usuario"
      className="grid gap-3 rounded-lg bg-white p-4 shadow md:grid-cols-2"
    >
      <label>
        <span className="text-sm font-medium">Nombre</span>
        <input
          className="campo"
          required
          value={datos.nombre}
          onChange={(e) => setDatos({ ...datos, nombre: e.target.value })}
        />
      </label>
      <label>
        <span className="text-sm font-medium">Usuario</span>
        <input
          className="campo"
          required
          autoComplete="off"
          value={datos.usuario}
          onChange={(e) => setDatos({ ...datos, usuario: e.target.value })}
        />
      </label>
      <label>
        <span className="text-sm font-medium">Rol</span>
        <select
          className="campo"
          value={datos.rol}
          onChange={(e) => setDatos({ ...datos, rol: e.target.value as Rol })}
        >
          <option value="empleado">Empleado</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <label>
        <span className="text-sm font-medium">Contraseña inicial</span>
        <input
          className="campo"
          type="password"
          autoComplete="new-password"
          required
          value={datos.contrasena}
          onChange={(e) => setDatos({ ...datos, contrasena: e.target.value })}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 md:col-span-2">
        <button type="submit" className="boton" disabled={alta.isPending}>
          Crear usuario
        </button>
        <button type="button" className="boton-secundario" onClick={alCerrar}>
          Cancelar
        </button>
        {errorLocal ? (
          <p role="alert" className="text-sm text-red-700">
            {errorLocal}
          </p>
        ) : (
          <MensajeError error={alta.error} />
        )}
      </div>
    </form>
  );
}

function AccionesUsuario({ usuario, esYo }: { usuario: UsuarioListado; esYo: boolean }) {
  const [modo, setModo] = useState<'ver' | 'editar' | 'contrasena'>('ver');
  const [nombre, setNombre] = useState(usuario.nombre);
  const [rol, setRol] = useState<Rol>(usuario.rol);
  const [nueva, setNueva] = useState('');
  const editar = useCambioDeUsuarios((cambios: EdicionUsuario) =>
    pedir('PATCH', `/usuarios/${usuario.id}`, cambios),
  );
  const restablecer = useMutation({
    mutationFn: (contrasena: string) =>
      pedir('POST', `/usuarios/${usuario.id}/contrasena`, { nueva: contrasena }),
  });

  if (modo === 'editar') {
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          editar.mutate({ nombre, rol }, { onSuccess: () => setModo('ver') });
        }}
      >
        <label>
          <span className="text-xs">Nombre</span>
          <input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <label>
          <span className="text-xs">Rol</span>
          <select className="campo" value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
            <option value="empleado">Empleado</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit" className="boton" disabled={editar.isPending}>
          Guardar
        </button>
        <button type="button" className="boton-secundario" onClick={() => setModo('ver')}>
          Cancelar
        </button>
        <MensajeError error={editar.error} />
      </form>
    );
  }

  if (modo === 'contrasena') {
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          restablecer.mutate(nueva, {
            onSuccess: () => {
              setNueva('');
              setModo('ver');
            },
          });
        }}
      >
        <label>
          <span className="text-xs">Contraseña nueva</span>
          <input
            className="campo"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
          />
        </label>
        <button type="submit" className="boton" disabled={restablecer.isPending}>
          Restablecer
        </button>
        <button type="button" className="boton-secundario" onClick={() => setModo('ver')}>
          Cancelar
        </button>
        <MensajeError error={restablecer.error} />
      </form>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="boton-secundario" onClick={() => setModo('editar')}>
        Editar
      </button>
      <button type="button" className="boton-secundario" onClick={() => setModo('contrasena')}>
        Contraseña
      </button>
      {!esYo && (
        <button
          type="button"
          className="boton-secundario"
          disabled={editar.isPending}
          onClick={() => editar.mutate({ activo: !usuario.activo })}
        >
          {usuario.activo ? 'Desactivar' : 'Activar'}
        </button>
      )}
      {restablecer.isSuccess && <p className="text-sm text-green-700">Contraseña restablecida.</p>}
      <MensajeError error={editar.error} />
    </div>
  );
}

export function Usuarios() {
  const { data: usuarios, isPending, error } = useUsuarios();
  const { data: sesion } = useSesion();
  const [creando, setCreando] = useState(false);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        {!creando && (
          <button type="button" className="boton" onClick={() => setCreando(true)}>
            Nuevo usuario
          </button>
        )}
      </div>
      {creando && <FormularioAlta alCerrar={() => setCreando(false)} />}
      {isPending && <p>Cargando usuarios…</p>}
      <MensajeError error={error} />

      {/* Celular: tarjetas */}
      <ul className="space-y-3 md:hidden" aria-label="Usuarios">
        {usuarios?.map((u) => (
          <li
            key={u.id}
            className={`rounded-lg bg-white p-4 shadow ${u.activo ? '' : 'opacity-60'}`}
          >
            <p className="font-medium">
              {u.nombre} <span className="text-slate-500">({u.usuario})</span>
            </p>
            <p className="text-sm text-slate-600">
              {NOMBRE_ROL[u.rol]} · {u.activo ? 'Activo' : 'Desactivado'} · Último ingreso:{' '}
              {formatearIngreso(u.ultimoIngreso)}
            </p>
            <div className="mt-2">
              <AccionesUsuario usuario={u} esYo={u.id === sesion?.id} />
            </div>
          </li>
        ))}
      </ul>

      {/* Escritorio: tabla */}
      <table className="hidden w-full rounded-lg bg-white text-left shadow md:table">
        <thead className="border-b text-sm text-slate-600">
          <tr>
            <th className="p-3">Nombre</th>
            <th className="p-3">Usuario</th>
            <th className="p-3">Rol</th>
            <th className="p-3">Estado</th>
            <th className="p-3">Último ingreso</th>
            <th className="p-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {usuarios?.map((u) => (
            <tr key={u.id} className={`border-b last:border-0 ${u.activo ? '' : 'opacity-60'}`}>
              <td className="p-3">{u.nombre}</td>
              <td className="p-3">{u.usuario}</td>
              <td className="p-3">{NOMBRE_ROL[u.rol]}</td>
              <td className="p-3">{u.activo ? 'Activo' : 'Desactivado'}</td>
              <td className="p-3">{formatearIngreso(u.ultimoIngreso)}</td>
              <td className="p-3">
                <AccionesUsuario usuario={u} esYo={u.id === sesion?.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
