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

export function EstadoSistema() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['estado'],
    queryFn: obtenerEstado,
    retry: false,
  });

  return (
    <section className="rounded-lg bg-white p-4 shadow">
      <h2 className="mb-2 text-lg font-semibold">Estado del sistema</h2>
      {isPending && <p>Consultando el estado del sistema…</p>}
      {isError && <p className="text-red-700">No se pudo conectar con la API.</p>}
      {data && (
        <ul className="space-y-1" aria-label="Estado del sistema">
          <Indicador nombre="API" ok />
          <Indicador nombre="Base de datos" ok={data.baseDeDatos === 'ok'} />
        </ul>
      )}
    </section>
  );
}
