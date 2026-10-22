import {
  type ClienteWhatsapp,
  type EstadoSesion,
  WhatsappNoDisponible,
  WhatsappRechazo,
} from '../src/modules/whatsapp/cliente.js';

export const CHIP = '5491100000000';

/**
 * Cliente de WhatsApp en memoria. Por defecto está conectado, todos los números
 * existen y los envíos salen bien; cada test cambia lo que necesita.
 */
export function crearWhatsappFalso() {
  const falso = {
    estadoActual: 'conectado' as EstadoSesion,
    /** Números internacionales que no tienen WhatsApp. */
    sinWhatsapp: new Set<string>(),
    /** Fallas programadas para los próximos envíos, en orden (`null`: ese sale bien). */
    fallas: [] as ('rechazo' | 'no_disponible' | null)[],
    enviados: [] as { chatId: string; texto: string }[],
    llamadas: [] as string[],
    /** La sesión todavía no existe en WAHA: reiniciarla da 404. */
    sinSesion: false,
  };

  const cliente: ClienteWhatsapp = {
    async estado() {
      return {
        estado: falso.estadoActual,
        cuenta: falso.estadoActual === 'conectado' ? CHIP : null,
      };
    },
    async iniciar() {
      falso.llamadas.push('iniciar');
      falso.sinSesion = false;
      if (falso.estadoActual === 'desvinculado') falso.estadoActual = 'esperando_qr';
    },
    async reiniciar() {
      falso.llamadas.push('reiniciar');
      if (falso.sinSesion) throw new WhatsappRechazo(404, 'No existe la sesión.');
      falso.estadoActual = 'esperando_qr';
    },
    async desvincular() {
      falso.llamadas.push('desvincular');
      falso.estadoActual = 'desvinculado';
    },
    async qr() {
      if (falso.estadoActual !== 'esperando_qr') throw new WhatsappRechazo(422, 'Sin QR.');
      return 'data:image/png;base64,UVI=';
    },
    async verificarNumero(numero) {
      if (falso.estadoActual === 'no_disponible') throw new WhatsappNoDisponible('Caído.');
      return falso.sinWhatsapp.has(numero) ? null : `${numero}@c.us`;
    },
    async enviarTexto(chatId, texto) {
      const falla = falso.fallas.shift();
      if (falla === 'rechazo') throw new WhatsappRechazo(500, 'WhatsApp rechazó el pedido.');
      if (falla === 'no_disponible' || falso.estadoActual === 'no_disponible') {
        throw new WhatsappNoDisponible('WhatsApp no responde.');
      }
      falso.enviados.push({ chatId, texto });
    },
  };

  return { falso, cliente };
}
