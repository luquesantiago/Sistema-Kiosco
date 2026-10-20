import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase } from './base.js';
import { crearAppDePrueba, crearUsuarioDePrueba, ingresar, sesionDe } from './ayudas.js';

/** Las únicas rutas de la API que se pueden usar sin sesión. */
const RUTAS_ABIERTAS = ['POST /api/auth/ingresar', 'GET /api/health'];

beforeEach(async () => {
  await limpiarBase();
});

describe('acceso a la API según sesión', () => {
  it('toda ruta de /api, salvo las abiertas, responde 401 sin sesión', async () => {
    const { app } = await crearAppDePrueba();
    await app.ready();

    const protegidas = app.rutasRegistradas
      .flatMap(({ method, url }) =>
        (Array.isArray(method) ? method : [method]).map((m) => ({ m, url })),
      )
      .filter(({ m, url }) => url.startsWith('/api/') && m !== 'HEAD' && m !== 'OPTIONS')
      .filter(({ m, url }) => !RUTAS_ABIERTAS.includes(`${m} ${url}`));

    expect(protegidas.length).toBeGreaterThan(0);
    for (const { m, url } of protegidas) {
      const res = await app.inject({
        method: m as 'GET',
        url: url.replace(':id', '0198a5b0-0000-7000-8000-000000000000'),
        payload: m === 'GET' ? undefined : {},
      });
      expect(res.statusCode, `${m} ${url}`).toBe(401);
      expect(res.json().error.codigo, `${m} ${url}`).toBe('NO_AUTENTICADO');
    }
  });

  it('un empleado recibe 403 en una ruta de admin', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    const cookies = await sesionDe(app, 'juan');

    const res = await app.inject({ method: 'GET', url: '/api/usuarios', cookies });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.codigo).toBe('SIN_PERMISO');
  });
});

describe('contraseñas nunca expuestas', () => {
  it('ninguna respuesta de ingreso, sesión ni usuarios incluye contraseñas o hashes', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('ana', 'admin');
    const cookies = await sesionDe(app, 'ana');

    const respuestas = [
      await ingresar(app, 'ana'),
      await app.inject({ method: 'GET', url: '/api/auth/sesion', cookies }),
      await app.inject({ method: 'GET', url: '/api/usuarios', cookies }),
      await app.inject({
        method: 'POST',
        url: '/api/usuarios',
        cookies,
        payload: { nombre: 'Juan', usuario: 'juan', rol: 'empleado', contrasena: 'clave-de-juan' },
      }),
    ];

    for (const res of respuestas) {
      expect(res.statusCode).toBeLessThan(300);
      expect(res.body).not.toMatch(/contrasena|argon2|clave-/i);
    }
  });
});
