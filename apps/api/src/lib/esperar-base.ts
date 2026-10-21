/**
 * Espera a que la base responda antes de atender pedidos. Al reiniciar el
 * servidor, Docker levanta la app sin esperar a PostgreSQL. Devuelve false si
 * no respondió en todos los intentos (el que llama sale y Docker reintenta).
 */
export async function esperarBase(
  verificar: () => Promise<unknown>,
  { intentos = 60, pausaMs = 1000 }: { intentos?: number; pausaMs?: number } = {},
): Promise<boolean> {
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      await verificar();
      return true;
    } catch {
      if (intento < intentos) await new Promise((listo) => setTimeout(listo, pausaMs));
    }
  }
  return false;
}
