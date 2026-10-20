import { estadoServicioSchema, type EstadoServicio } from '@kiosco/shared';
import { useQuery } from '@tanstack/react-query';

async function obtenerEstado(): Promise<EstadoServicio> {
  const res = await fetch('/api/health');
  // 503 también trae el cuerpo con el estado: solo falla si no es JSON válido.
  return estadoServicioSchema.parse(await res.json());
}

function Indicador({ nombre, ok }: { nombre: string; ok: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`size-3 rounded-full ${ok ? 'bg-green-600' : 'bg-red-600'}`} />
      {nombre} {ok ? 'ok' : 'con error'}
    </li>
  );
}

export function Inicio() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['estado'],
    queryFn: obtenerEstado,
    retry: false,
  });

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-2xl font-semibold">Kiosco</h1>
      {isPending && <p>Consultando el estado del sistema…</p>}
      {isError && <p className="text-red-700">No se pudo conectar con la API.</p>}
      {data && (
        <ul className="space-y-1" aria-label="Estado del sistema">
          <Indicador nombre="API" ok />
          <Indicador nombre="Base de datos" ok={data.baseDeDatos === 'ok'} />
        </ul>
      )}
    </main>
  );
}
