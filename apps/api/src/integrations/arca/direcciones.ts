import type { EntornoArca } from '@kiosco/shared';

/*
 * Direcciones de los web services de ARCA por entorno (normativo, verificar:
 * ARCA puede migrarlas a arca.gob.ar). Es el único lugar donde están.
 */

export interface DireccionesArca {
  /** WSAA: `LoginCms`, el pedido del ticket de acceso. */
  wsaa: string;
  /** WSFEv1: factura electrónica. */
  wsfe: string;
}

export const DIRECCIONES_ARCA: Record<EntornoArca, DireccionesArca> = {
  homologacion: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  produccion: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
};
