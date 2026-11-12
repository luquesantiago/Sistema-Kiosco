import { readFileSync } from 'node:fs';
import type { EntornoArca } from '@kiosco/shared';
import forge from 'node-forge';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { type DireccionesArca, DIRECCIONES_ARCA } from './direcciones.js';
import { ArcaNoDisponible, ArcaRechazo, type MotivoNoDisponible } from './errores.js';
import { obtenerTicket } from './tickets.js';
import {
  type AuthWsfe,
  type ComprobanteArca,
  feCaeSolicitar,
  feCompConsultar,
  feCompUltimoAutorizado,
  feDummy,
  type PedidoCae,
} from './wsfe.js';

export { ArcaNoDisponible, ArcaRechazo };
export type { ComprobanteArca, MotivoNoDisponible, PedidoCae };

/**
 * Lo que la emisión necesita de ARCA, sin detalles de SOAP. Los tests inyectan
 * un cliente falso (`test/arca-falso.ts`). La autenticación queda adentro:
 * cada llamada que la necesita pide el ticket a `tickets.ts`.
 */
export interface ClienteArca {
  /** `FEDummy`. No necesita ticket. */
  estadoServidores(): Promise<'ok' | 'caido'>;
  /** Último número autorizado y su fecha ("AAAA-MM-DD"; null si todavía no hay ninguno). */
  ultimoAutorizado(ptoVta: number, tipo: number): Promise<{ numero: number; fecha: string | null }>;
  /** Un comprobante, o null si ARCA no lo tiene. */
  consultar(ptoVta: number, tipo: number, numero: number): Promise<ComprobanteArca | null>;
  solicitarCae(pedido: PedidoCae): Promise<{ cae: string; vencimiento: string }>;
}

export interface OpcionesClienteArca {
  prisma: PrismaClient;
  entorno: EntornoArca;
  cuit: string;
  /** Certificado y clave en PEM, leídos al arrancar. La clave queda solo en memoria. */
  certificado: string;
  clave: string;
  ahora: () => Date;
  /** Por defecto, las de ARCA para el entorno. */
  direcciones?: DireccionesArca;
  timeoutMs?: number;
}

/**
 * Lee el certificado y la clave al arrancar y verifica que sean PEM válidos.
 * Si no puede, el error nombra la variable y el archivo, nunca el contenido.
 */
export function leerCredenciales(rutas: { certificado: string; clave: string }): {
  certificado: string;
  clave: string;
} {
  const leer = (variable: string, ruta: string, validar: (pem: string) => unknown) => {
    let pem: string;
    try {
      pem = readFileSync(ruta, 'utf8');
    } catch {
      throw new Error(`No se puede leer el archivo de ${variable} (${ruta}).`);
    }
    try {
      validar(pem);
    } catch {
      throw new Error(`El archivo de ${variable} (${ruta}) no es un PEM válido.`);
    }
    return pem;
  };
  return {
    certificado: leer('ARCA_CERT_PATH', rutas.certificado, (pem) =>
      forge.pki.certificateFromPem(pem),
    ),
    clave: leer('ARCA_KEY_PATH', rutas.clave, (pem) => forge.pki.privateKeyFromPem(pem)),
  };
}

/** Cliente real de ARCA: WSAA + WSFEv1 con `fetch` y timeout de 15 s. */
export function clienteArca({
  prisma,
  entorno,
  cuit,
  certificado,
  clave,
  ahora,
  direcciones = DIRECCIONES_ARCA[entorno],
  timeoutMs,
}: OpcionesClienteArca): ClienteArca {
  const wsfe = { url: direcciones.wsfe, timeoutMs };

  const credenciales = async (): Promise<AuthWsfe> => ({
    ...(await obtenerTicket(prisma, entorno, ahora(), {
      url: direcciones.wsaa,
      certificado,
      clave,
      timeoutMs,
    })),
    cuit,
  });

  const consultar = async (ptoVta: number, tipo: number, numero: number) =>
    feCompConsultar(wsfe, await credenciales(), ptoVta, tipo, numero);

  return {
    estadoServidores: () => feDummy(wsfe),

    async ultimoAutorizado(ptoVta, tipo) {
      const numero = await feCompUltimoAutorizado(wsfe, await credenciales(), ptoVta, tipo);
      if (numero === 0) return { numero, fecha: null };
      // La fecha del último hace falta para que las fechas de los comprobantes no retrocedan.
      const ultimo = await consultar(ptoVta, tipo, numero);
      return { numero, fecha: ultimo?.fecha ?? null };
    },

    consultar,

    async solicitarCae(pedido) {
      return feCaeSolicitar(wsfe, await credenciales(), pedido);
    },
  };
}
