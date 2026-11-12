import type { ConfigArca } from '../../config.js';
import type { ClienteArca } from '../../integrations/arca/cliente.js';

/** Estado de ARCA que vio la última pasada de la emisión. */
export type EstadoArca = 'disponible' | 'no_disponible' | 'autenticacion_bloqueada';

/**
 * Lo que `server.ts` le pasa a `crearApp` cuando hay configuración de ARCA.
 * Sin esto (`undefined`) el sistema vende igual que antes, sin facturar.
 */
export interface Facturacion {
  /** Las variables `ARCA_*` tal como las deja `cargarConfig`. */
  config: ConfigArca;
  arca: ClienteArca;
  /** Pide a la tarea de emisión que corra ya, sin esperar el próximo intervalo. */
  despertar: () => void;
  /** Lo que vio la última pasada: las rutas nunca le preguntan a ARCA. */
  estado: () => EstadoArca;
}
