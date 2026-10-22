/**
 * Radios con aspecto de botón: un toque con el mouse o el dedo, o Tab y flechas
 * con el teclado. `valor` null deja todas sin elegir.
 */
export function OpcionesBoton<T extends string>({
  leyenda,
  nombre,
  opciones,
  nombres,
  valor,
  alCambiar,
}: {
  leyenda: string;
  nombre: string;
  opciones: readonly T[];
  nombres: Record<T, string>;
  valor: T | null;
  alCambiar: (valor: T) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{leyenda}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {opciones.map((o) => (
          <label
            key={o}
            className="cursor-pointer rounded border border-slate-300 bg-white px-4 py-2 has-checked:border-slate-800 has-checked:bg-slate-800 has-checked:text-white has-focus-visible:ring-2 has-focus-visible:ring-slate-500"
          >
            <input
              type="radio"
              name={nombre}
              value={o}
              className="sr-only"
              checked={valor === o}
              onChange={() => alCambiar(o)}
            />
            {nombres[o]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
