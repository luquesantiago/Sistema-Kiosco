import { saldoMercadoPagoSchema } from '@kiosco/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ClienteMercadoPago } from '../../integrations/mercadopago/cliente.js';
import { requiereSesion } from '../../plugins/sesion.js';
import { crearServicioSaldo } from './saldo.js';

// Mercado Pago: el saldo lo ven el admin y el empleado (en Caja, F8). Sin
// `mercadoPago` (no hay MP_ACCESS_TOKEN) el saldo es `no_configurado`. El token
// nunca sale del servidor: la respuesta solo trae montos, hora y motivo.
export const rutasMercadoPago: FastifyPluginAsyncZod<{
  mercadoPago?: ClienteMercadoPago;
  ahora: () => Date;
}> = async (app, { mercadoPago, ahora }) => {
  const saldo = crearServicioSaldo({ cliente: mercadoPago, ahora });

  app.get(
    '/saldo',
    { preValidation: requiereSesion, schema: { response: { 200: saldoMercadoPagoSchema } } },
    async () => saldo.obtener(),
  );
};
