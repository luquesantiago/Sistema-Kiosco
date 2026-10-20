/** Mensaje de error de un pedido a la API, o nada si no hay error. */
export function MensajeError({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-red-700">
      {error.message}
    </p>
  );
}
