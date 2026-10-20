import { usuarioSesionSchema } from '@kiosco/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { limpiarBase, prismaTest } from './base.js';
import {
  CONTRASENA,
  crearAppDePrueba,
  crearUsuarioDePrueba,
  ingresar,
  sesionDe,
} from './ayudas.js';

const HORA = 60 * 60 * 1000;
const MINUTO = 60 * 1000;

beforeEach(async () => {
  await limpiarBase();
});

describe('ingreso con usuario y contraseña', () => {
  it('un usuario activo ingresa y recibe una cookie httpOnly', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');

    const res = await ingresar(app, 'juan');

    expect(res.statusCode).toBe(200);
    expect(usuarioSesionSchema.parse(res.json())).toMatchObject({
      nombre: 'Nombre juan',
      usuario: 'juan',
      rol: 'empleado',
    });
    const cookie = res.cookies.find((c) => c.name === 'kiosco_sesion');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
  });

  it('no distingue mayúsculas en el usuario', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    expect((await ingresar(app, 'Juan')).statusCode).toBe(200);
  });

  it('registra el último ingreso', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    await ingresar(app, 'juan');
    const usuario = await prismaTest.usuario.findUniqueOrThrow({ where: { usuario: 'juan' } });
    expect(usuario.ultimoIngreso?.toISOString()).toBe('2026-10-20T12:00:00.000Z');
  });

  it('rechaza a un usuario desactivado con el mismo error que credenciales incorrectas', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    await prismaTest.usuario.update({ where: { usuario: 'juan' }, data: { activo: false } });

    const desactivado = await ingresar(app, 'juan');
    const incorrecta = await ingresar(app, 'juan', 'otra-clave');

    expect(desactivado.statusCode).toBe(401);
    expect(desactivado.json()).toEqual(incorrecta.json());
  });
});

describe('error de ingreso sin pistas', () => {
  it('usuario inexistente y contraseña incorrecta dan la misma respuesta', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');

    const inexistente = await ingresar(app, 'nadie');
    const incorrecta = await ingresar(app, 'juan', 'otra-clave');

    expect(inexistente.statusCode).toBe(401);
    expect(incorrecta.statusCode).toBe(401);
    expect(inexistente.json()).toEqual(incorrecta.json());
    expect(inexistente.json().error.codigo).toBe('CREDENCIALES_INVALIDAS');
  });
});

describe('bloqueo por intentos fallidos', () => {
  async function fallar(app: Awaited<ReturnType<typeof crearAppDePrueba>>['app'], veces: number) {
    for (let i = 0; i < veces; i++) {
      expect((await ingresar(app, 'juan', 'mala-clave')).statusCode).toBe(401);
    }
  }

  it('tras 5 fallos bloquea 15 minutos aunque la contraseña sea correcta', async () => {
    const { app, adelantar } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    await fallar(app, 5);

    const bloqueado = await ingresar(app, 'juan');
    expect(bloqueado.statusCode).toBe(429);
    expect(bloqueado.json().error.codigo).toBe('INGRESO_BLOQUEADO');

    adelantar(14 * MINUTO);
    expect((await ingresar(app, 'juan')).statusCode).toBe(429);

    adelantar(1 * MINUTO);
    expect((await ingresar(app, 'juan')).statusCode).toBe(200);
  });

  it('un ingreso correcto reinicia el contador', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    await fallar(app, 4);
    expect((await ingresar(app, 'juan')).statusCode).toBe(200);
    await fallar(app, 4);
    expect((await ingresar(app, 'juan')).statusCode).toBe(200);
  });
});

describe('sesión actual, vencimiento y cierre', () => {
  it('devuelve el usuario de la sesión', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('ana', 'admin');
    const cookies = await sesionDe(app, 'ana');

    const res = await app.inject({ method: 'GET', url: '/api/auth/sesion', cookies });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ usuario: 'ana', rol: 'admin' });
  });

  it('sin cookie responde 401', async () => {
    const { app } = await crearAppDePrueba();
    const res = await app.inject({ method: 'GET', url: '/api/auth/sesion' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.codigo).toBe('NO_AUTENTICADO');
  });

  it('la sesión del empleado vence a las 7 horas', async () => {
    const { app, adelantar } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    const cookies = await sesionDe(app, 'juan');

    adelantar(7 * HORA - MINUTO);
    expect((await app.inject({ method: 'GET', url: '/api/auth/sesion', cookies })).statusCode).toBe(
      200,
    );
    adelantar(MINUTO);
    expect((await app.inject({ method: 'GET', url: '/api/auth/sesion', cookies })).statusCode).toBe(
      401,
    );
  });

  it('la sesión del admin sigue vigente a los 10 días y vence a los 30', async () => {
    const { app, adelantar } = await crearAppDePrueba();
    await crearUsuarioDePrueba('ana', 'admin');
    const cookies = await sesionDe(app, 'ana');

    adelantar(10 * 24 * HORA);
    expect((await app.inject({ method: 'GET', url: '/api/auth/sesion', cookies })).statusCode).toBe(
      200,
    );
    adelantar(20 * 24 * HORA);
    expect((await app.inject({ method: 'GET', url: '/api/auth/sesion', cookies })).statusCode).toBe(
      401,
    );
  });

  it('después de salir, la misma cookie ya no sirve', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    const cookies = await sesionDe(app, 'juan');

    const salir = await app.inject({ method: 'POST', url: '/api/auth/salir', cookies });
    expect(salir.statusCode).toBe(204);

    const res = await app.inject({ method: 'GET', url: '/api/auth/sesion', cookies });
    expect(res.statusCode).toBe(401);
  });
});

describe('cambio de la propia contraseña', () => {
  function cambiar(
    app: Awaited<ReturnType<typeof crearAppDePrueba>>['app'],
    cookies: Record<string, string>,
    payload: { actual: string; nueva: string },
  ) {
    return app.inject({ method: 'POST', url: '/api/auth/contrasena', cookies, payload });
  }

  it('cambia la contraseña, cierra las otras sesiones y mantiene la actual', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    const otraPc = await sesionDe(app, 'juan');
    const actual = await sesionDe(app, 'juan');

    const res = await cambiar(app, actual, { actual: CONTRASENA, nueva: 'nueva-clave-2' });

    expect(res.statusCode).toBe(204);
    expect((await ingresar(app, 'juan', 'nueva-clave-2')).statusCode).toBe(200);
    expect((await ingresar(app, 'juan')).statusCode).toBe(401);
    const sesion = (cookies: Record<string, string>) =>
      app.inject({ method: 'GET', url: '/api/auth/sesion', cookies });
    expect((await sesion(actual)).statusCode).toBe(200);
    expect((await sesion(otraPc)).statusCode).toBe(401);
  });

  it('rechaza el cambio si la contraseña actual es incorrecta', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    const cookies = await sesionDe(app, 'juan');

    const res = await cambiar(app, cookies, { actual: 'otra', nueva: 'nueva-clave-2' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.codigo).toBe('CONTRASENA_ACTUAL_INCORRECTA');
    expect((await ingresar(app, 'juan')).statusCode).toBe(200);
  });

  it('rechaza una contraseña nueva de menos de 8 caracteres', async () => {
    const { app } = await crearAppDePrueba();
    await crearUsuarioDePrueba('juan');
    const cookies = await sesionDe(app, 'juan');

    const res = await cambiar(app, cookies, { actual: CONTRASENA, nueva: 'corta' });

    expect(res.statusCode).toBe(400);
    expect((await ingresar(app, 'juan')).statusCode).toBe(200);
  });
});
