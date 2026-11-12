/** Por qué ARCA no está disponible: lo muestra la pantalla de Facturación. */
export type MotivoNoDisponible = 'caido' | 'autenticacion_bloqueada';

/**
 * ARCA no respondió o no puede atender: red, timeout, HTTP 5xx, SOAP Fault del
 * servidor, `FEDummy` con algún servidor caído o `coe.alreadyAuthenticated`
 * (`autenticacion_bloqueada`). No es culpa de la factura: no gasta intento.
 */
export class ArcaNoDisponible extends Error {
  constructor(
    readonly motivo: MotivoNoDisponible,
    mensaje = motivo === 'caido'
      ? 'ARCA no responde.'
      : 'ARCA ya dio un ticket de acceso que no está guardado: hay que esperar a que venza.',
  ) {
    super(mensaje);
  }
}

/**
 * ARCA respondió que no (`Resultado = R` o `Errors`) con el servicio
 * funcionando. Lleva el código y el mensaje de ARCA, recortados y sin el token.
 * Gasta intento.
 */
export class ArcaRechazo extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}
