import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase } from './base.js';
import { crearUsuarioDePrueba, sesionDe } from './ayudas.js';
import { crearAppConFacturacion, opcionesFacturacion } from './facturacion-ayudas.js';

/*
 * `facturacionHabilitada` en el estado de la caja que consulta el mostrador
 * (cambio facturacion-arca, tarea 4.3): con ARCA configurado viene en `true`;
 * sin configuración no viene, y la respuesta queda igual que antes.
 */

const HOY = new Date('2026-11-10T13:00:00Z');

beforeEach(async () => {
  await limpiarBase();
});

async function estadoDeCaja(conFacturacion: boolean) {
  const { app } = await crearAppConFacturacion(
    HOY,
    conFacturacion ? opcionesFacturacion() : undefined,
  );
  await crearUsuarioDePrueba('juan');
  const cookies = await sesionDe(app, 'juan');
  return {
    app,
    cookies,
    res: await app.inject({ method: 'GET', url: '/api/caja/estado', cookies }),
  };
}

describe('facturacionHabilitada en GET /api/caja/estado', () => {
  it('con la facturación configurada → true', async () => {
    const { res } = await estadoDeCaja(true);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ facturacionHabilitada: true });
  });

  it('sin configuración → no viene', async () => {
    const { res } = await estadoDeCaja(false);

    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('facturacionHabilitada');
  });

  it('al abrir el turno también lo informa', async () => {
    const { app, cookies } = await estadoDeCaja(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/caja/turnos',
      cookies,
      payload: { montoInicial: '0' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ facturacionHabilitada: true });
  });
});
