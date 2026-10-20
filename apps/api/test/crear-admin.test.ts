import { beforeEach, describe, expect, it } from 'vitest';
import { crearUsuario } from '../src/modules/usuarios/servicio.js';
import { limpiarBase, prismaTest } from './base.js';
import { crearAppDePrueba, ingresar } from './ayudas.js';

// El comando de consola (src/cli/crear-admin.ts) solo pide los datos y llama a
// crearUsuario con rol admin; acá se prueba ese núcleo.

beforeEach(async () => {
  await limpiarBase();
});

describe('creación del primer admin', () => {
  it('en una base vacía crea un admin activo que puede ingresar', async () => {
    await crearUsuario(prismaTest, {
      usuario: 'Ana',
      nombre: 'Ana Pérez',
      contrasena: 'clave-admin-1',
      rol: 'admin',
    });

    const { app } = await crearAppDePrueba();
    const res = await ingresar(app, 'ana', 'clave-admin-1');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ rol: 'admin', nombre: 'Ana Pérez' });
  });

  it('con un usuario existente falla y no lo modifica', async () => {
    await crearUsuario(prismaTest, {
      usuario: 'ana',
      nombre: 'Ana',
      contrasena: 'clave-original',
      rol: 'empleado',
    });

    await expect(
      crearUsuario(prismaTest, {
        usuario: 'ana',
        nombre: 'Otra Ana',
        contrasena: 'clave-nueva-1',
        rol: 'admin',
      }),
    ).rejects.toMatchObject({ codigo: 'USUARIO_EXISTENTE' });

    const ana = await prismaTest.usuario.findUniqueOrThrow({ where: { usuario: 'ana' } });
    expect(ana).toMatchObject({ nombre: 'Ana', rol: 'empleado' });
  });

  it('aplica las mismas validaciones que el alta', async () => {
    await expect(
      crearUsuario(prismaTest, { usuario: 'a b', nombre: 'X', contrasena: 'corta', rol: 'admin' }),
    ).rejects.toThrow();
    expect(await prismaTest.usuario.count()).toBe(0);
  });
});
