import { usuarioListadoSchema } from '@kiosco/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limpiarBase, prismaTest } from './base.js';
import { crearAppDePrueba, crearUsuarioDePrueba, ingresar, sesionDe } from './ayudas.js';

beforeEach(async () => {
  await limpiarBase();
});

/** App con un admin `ana` logueado. */
async function conAdmin() {
  const { app } = await crearAppDePrueba();
  const ana = await crearUsuarioDePrueba('ana', 'admin');
  const cookies = await sesionDe(app, 'ana');
  return { app, ana, cookies };
}

describe('alta de usuario', () => {
  it('el admin crea un empleado que queda activo y puede ingresar', async () => {
    const { app, cookies } = await conAdmin();

    const res = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      cookies,
      payload: { nombre: 'María', usuario: 'Maria', rol: 'empleado', contrasena: '12345678' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ usuario: 'maria', rol: 'empleado', activo: true });
    expect((await ingresar(app, 'maria', '12345678')).statusCode).toBe(200);
  });

  it('un usuario repetido, sin importar mayúsculas, responde 409', async () => {
    const { app, cookies } = await conAdmin();
    await crearUsuarioDePrueba('juan');

    const res = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      cookies,
      payload: { nombre: 'Otro Juan', usuario: 'JUAN', rol: 'empleado', contrasena: '12345678' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('USUARIO_EXISTENTE');
  });

  it.each([
    { usuario: 'juan perez', contrasena: '12345678' },
    { usuario: 'ju', contrasena: '12345678' },
    { usuario: 'juan', contrasena: '1234567' },
  ])('rechaza datos inválidos ($usuario / $contrasena)', async (datos) => {
    const { app, cookies } = await conAdmin();
    const res = await app.inject({
      method: 'POST',
      url: '/api/usuarios',
      cookies,
      payload: { nombre: 'Juan', rol: 'empleado', ...datos },
    });
    expect(res.statusCode).toBe(400);
    expect(await prismaTest.usuario.count()).toBe(1);
  });
});

describe('lista de usuarios', () => {
  it('muestra activos y desactivados con su último ingreso', async () => {
    const { app, cookies } = await conAdmin();
    await crearUsuarioDePrueba('juan');
    await prismaTest.usuario.update({ where: { usuario: 'juan' }, data: { activo: false } });

    const res = await app.inject({ method: 'GET', url: '/api/usuarios', cookies });

    expect(res.statusCode).toBe(200);
    const lista = z.array(usuarioListadoSchema).parse(res.json());
    expect(lista.map((u) => [u.usuario, u.activo])).toEqual([
      ['ana', true],
      ['juan', false],
    ]);
    expect(lista[0]?.ultimoIngreso).toBe('2026-10-20T12:00:00.000Z');
    expect(lista[1]?.ultimoIngreso).toBeNull();
  });
});

describe('edición, desactivación y último admin', () => {
  function editar(
    app: Awaited<ReturnType<typeof conAdmin>>['app'],
    cookies: Record<string, string>,
    id: string,
    payload: object,
  ) {
    return app.inject({ method: 'PATCH', url: `/api/usuarios/${id}`, cookies, payload });
  }

  it('pasar un empleado a admin cierra su sesión y vuelve a entrar como admin', async () => {
    const { app, cookies } = await conAdmin();
    const juan = await crearUsuarioDePrueba('juan');
    const sesionJuan = await sesionDe(app, 'juan');

    const res = await editar(app, cookies, juan.id, { rol: 'admin', nombre: 'Juan Pérez' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ rol: 'admin', nombre: 'Juan Pérez', usuario: 'juan' });
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/sesion', cookies: sesionJuan }))
        .statusCode,
    ).toBe(401);
    expect((await ingresar(app, 'juan')).json().rol).toBe('admin');
  });

  it('desactivar a un empleado corta su sesión y no puede volver a ingresar', async () => {
    const { app, cookies } = await conAdmin();
    const juan = await crearUsuarioDePrueba('juan');
    const sesionJuan = await sesionDe(app, 'juan');

    expect((await editar(app, cookies, juan.id, { activo: false })).statusCode).toBe(200);

    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/sesion', cookies: sesionJuan }))
        .statusCode,
    ).toBe(401);
    expect((await ingresar(app, 'juan')).statusCode).toBe(401);
    expect(await prismaTest.usuario.count({ where: { usuario: 'juan' } })).toBe(1);
  });

  it('reactivar permite volver a ingresar', async () => {
    const { app, cookies } = await conAdmin();
    const juan = await crearUsuarioDePrueba('juan');
    await editar(app, cookies, juan.id, { activo: false });

    await editar(app, cookies, juan.id, { activo: true });

    expect((await ingresar(app, 'juan')).statusCode).toBe(200);
  });

  it('el único admin activo no puede pasarse a empleado', async () => {
    const { app, ana, cookies } = await conAdmin();

    const res = await editar(app, cookies, ana.id, { rol: 'empleado' });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('ULTIMO_ADMIN');
    const usuario = await prismaTest.usuario.findUniqueOrThrow({ where: { id: ana.id } });
    expect(usuario).toMatchObject({ rol: 'admin', activo: true });
  });

  it('con otro admin activo, se puede pasar un admin a empleado', async () => {
    const { app, cookies } = await conAdmin();
    const otro = await crearUsuarioDePrueba('otro', 'admin');
    expect((await editar(app, cookies, otro.id, { rol: 'empleado' })).statusCode).toBe(200);
  });

  it('con dos admins, uno puede desactivar al otro, pero no quedarse sin admins', async () => {
    const { app, ana } = await conAdmin();
    const otro = await crearUsuarioDePrueba('otro', 'admin');
    const cookiesOtro = await sesionDe(app, 'otro');

    // "otro" desactiva a Ana: queda "otro" como admin activo, así que se permite.
    expect((await editar(app, cookiesOtro, ana.id, { activo: false })).statusCode).toBe(200);
    // Ahora "otro" es el único admin activo y no puede pasarse a empleado.
    const res = await editar(app, cookiesOtro, otro.id, { rol: 'empleado' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('ULTIMO_ADMIN');
  });

  it('un admin no puede desactivarse a sí mismo', async () => {
    const { app, ana, cookies } = await conAdmin();
    await crearUsuarioDePrueba('otro', 'admin');

    const res = await editar(app, cookies, ana.id, { activo: false });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.codigo).toBe('NO_PUEDE_DESACTIVARSE');
    expect((await prismaTest.usuario.findUniqueOrThrow({ where: { id: ana.id } })).activo).toBe(
      true,
    );
  });

  it('editar un usuario inexistente responde 404', async () => {
    const { app, cookies } = await conAdmin();
    const res = await editar(app, cookies, '0198a5b0-0000-7000-8000-000000000000', {
      nombre: 'X',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('restablecer la contraseña de otro usuario', () => {
  it('la nueva contraseña sirve, la anterior no, y se cierran sus sesiones', async () => {
    const { app, cookies } = await conAdmin();
    const juan = await crearUsuarioDePrueba('juan');
    const sesionJuan = await sesionDe(app, 'juan');

    const res = await app.inject({
      method: 'POST',
      url: `/api/usuarios/${juan.id}/contrasena`,
      cookies,
      payload: { nueva: 'otra-clave-9' },
    });

    expect(res.statusCode).toBe(204);
    expect((await ingresar(app, 'juan')).statusCode).toBe(401);
    expect((await ingresar(app, 'juan', 'otra-clave-9')).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/sesion', cookies: sesionJuan }))
        .statusCode,
    ).toBe(401);
  });
});
