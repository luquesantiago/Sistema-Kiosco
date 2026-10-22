import { z } from 'zod';

/** Formato común de los errores de la API. */
export const errorApiSchema = z.object({
  error: z.object({
    codigo: z.string(),
    mensaje: z.string(),
    /** Datos extra de algunos errores (por ejemplo, los precios actuales). */
    detalle: z.unknown().optional(),
  }),
});

export type ErrorApi = z.infer<typeof errorApiSchema>;

export const CODIGOS_ERROR = {
  validacion: 'VALIDACION',
  noEncontrado: 'NO_ENCONTRADO',
  interno: 'ERROR_INTERNO',
  credencialesInvalidas: 'CREDENCIALES_INVALIDAS',
  noAutenticado: 'NO_AUTENTICADO',
  sinPermiso: 'SIN_PERMISO',
  ingresoBloqueado: 'INGRESO_BLOQUEADO',
  usuarioExistente: 'USUARIO_EXISTENTE',
  ultimoAdmin: 'ULTIMO_ADMIN',
  autoDesactivacion: 'NO_PUEDE_DESACTIVARSE',
  contrasenaActualIncorrecta: 'CONTRASENA_ACTUAL_INCORRECTA',
  codigoExistente: 'CODIGO_EXISTENTE',
  proveedorInactivo: 'PROVEEDOR_INACTIVO',
  productoNoEncontrado: 'PRODUCTO_NO_ENCONTRADO',
  costoNoPermitido: 'COSTO_NO_PERMITIDO',
  productoNoDisponible: 'PRODUCTO_NO_DISPONIBLE',
  preciosCambiaron: 'PRECIOS_CAMBIARON',
  fueraDePlazo: 'FUERA_DE_PLAZO',
  ventaYaAnulada: 'VENTA_YA_ANULADA',
  sinTurnoAbierto: 'SIN_TURNO_ABIERTO',
  turnoDeOtro: 'TURNO_DE_OTRO',
  turnoYaAbierto: 'TURNO_YA_ABIERTO',
  turnoYaCerrado: 'TURNO_YA_CERRADO',
  whatsappNoConfigurado: 'WHATSAPP_NO_CONFIGURADO',
  whatsappNoConectado: 'WHATSAPP_NO_CONECTADO',
  whatsappSinDestino: 'WHATSAPP_SIN_DESTINO',
  whatsappNoQr: 'WHATSAPP_SIN_QR',
  whatsappFallo: 'WHATSAPP_FALLO',
  numeroCon15: 'NUMERO_CON_15',
  numeroInvalido: 'NUMERO_INVALIDO',
  numeroSinWhatsapp: 'NUMERO_SIN_WHATSAPP',
  avisoNoReintentable: 'AVISO_NO_REINTENTABLE',
} as const;
