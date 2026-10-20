import { cambioContrasenaSchema, type CambioContrasena } from '@kiosco/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { pedir } from '../api/cliente.js';

export function CambiarContrasena() {
  const [datos, setDatos] = useState<CambioContrasena>({ actual: '', nueva: '' });
  const [repetida, setRepetida] = useState('');
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const cambiar = useMutation({
    mutationFn: (d: CambioContrasena) => pedir('POST', '/auth/contrasena', d),
    onSuccess: () => {
      setDatos({ actual: '', nueva: '' });
      setRepetida('');
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const validado = cambioContrasenaSchema.safeParse(datos);
    if (!validado.success) {
      setErrorLocal(validado.error.issues[0]?.message ?? 'Revisá los datos.');
    } else if (datos.nueva !== repetida) {
      setErrorLocal('Las contraseñas nuevas no coinciden.');
    } else {
      setErrorLocal(null);
      cambiar.mutate(validado.data);
    }
  };

  const error = errorLocal ?? cambiar.error?.message;

  return (
    <form onSubmit={enviar} className="max-w-sm space-y-4 rounded-lg bg-white p-6 shadow">
      <h1 className="text-xl font-semibold">Cambiar mi contraseña</h1>
      <label className="block">
        <span className="text-sm font-medium">Contraseña actual</span>
        <input
          className="campo"
          type="password"
          autoComplete="current-password"
          required
          value={datos.actual}
          onChange={(e) => setDatos({ ...datos, actual: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Contraseña nueva</span>
        <input
          className="campo"
          type="password"
          autoComplete="new-password"
          required
          value={datos.nueva}
          onChange={(e) => setDatos({ ...datos, nueva: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Repetí la contraseña nueva</span>
        <input
          className="campo"
          type="password"
          autoComplete="new-password"
          required
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {cambiar.isSuccess && (
        <p className="text-sm text-green-700">
          Contraseña cambiada. Se cerraron tus sesiones en otros dispositivos.
        </p>
      )}
      <button type="submit" className="boton w-full" disabled={cambiar.isPending}>
        Cambiar contraseña
      </button>
    </form>
  );
}
