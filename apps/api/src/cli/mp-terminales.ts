/**
 * Terminales Point de la cuenta de Mercado Pago del kiosco (cambio cobro-mercado-pago).
 *
 *   pnpm --filter api mp:terminales                 lista las terminales y su modo
 *   pnpm --filter api mp:terminales --pdv <id>      pasa esa terminal a modo integrado (PDV)
 *
 * En producción, dentro del contenedor:
 *
 *   docker compose exec app node dist/cli/mp-terminales.js
 *
 * Usa `MP_ACCESS_TOKEN` del entorno (nunca lo muestra). El `id` que aparece es el que va
 * en `MP_TERMINAL_ID`. La terminal tiene que estar encendida y con sesión iniciada.
 */
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  MercadoPagoNoDisponible,
  MercadoPagoRechazo,
} from '../integrations/mercadopago/errores.js';
import { activarModoPdv, listarTerminales } from '../integrations/mercadopago/terminales.js';

/** Hace lo que piden los argumentos y escribe el resultado. Devuelve el código de salida. */
export async function ejecutarMpTerminales(
  args: string[],
  {
    token,
    baseUrl,
    escribir = (linea: string) => console.log(linea),
  }: { token: string | undefined; baseUrl?: string; escribir?: (linea: string) => void },
): Promise<number> {
  const { values } = parseArgs({
    // pnpm reenvía un "--" literal si se escribe `pnpm ... -- --pdv x`.
    args: args.filter((arg) => arg !== '--'),
    options: { pdv: { type: 'string' } },
  });
  if (!token) {
    escribir('Falta MP_ACCESS_TOKEN: cargalo en el .env antes de usar este comando.');
    return 1;
  }
  try {
    if (values.pdv) {
      await activarModoPdv(token, values.pdv, { baseUrl });
      escribir(`Terminal ${values.pdv} en modo integrado (PDV).`);
      escribir(`Cargá MP_TERMINAL_ID=${values.pdv} y reiniciá el sistema.`);
      return 0;
    }
    const terminales = await listarTerminales(token, { baseUrl });
    if (terminales.length === 0) {
      escribir('La cuenta no tiene terminales Point vinculadas.');
      return 0;
    }
    escribir('Terminales Point de la cuenta:');
    for (const t of terminales) escribir(`- ${t.id} (modo ${t.modo ?? 'desconocido'})`);
    escribir('Para cobrar desde el sistema: --pdv <id> y después MP_TERMINAL_ID=<id>.');
    return 0;
  } catch (error) {
    if (error instanceof MercadoPagoNoDisponible) {
      escribir('Mercado Pago no responde. Probá de nuevo en un rato.');
    } else if (error instanceof MercadoPagoRechazo) {
      escribir(
        error.status === 401 || error.status === 403
          ? 'Mercado Pago rechazó las credenciales: revisá MP_ACCESS_TOKEN.'
          : `Mercado Pago rechazó el pedido (HTTP ${error.status}).`,
      );
    } else {
      throw error;
    }
    return 1;
  }
}

// Solo corre como comando (no al importarlo desde un test).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await ejecutarMpTerminales(process.argv.slice(2), {
    token: process.env.MP_ACCESS_TOKEN,
  });
}
