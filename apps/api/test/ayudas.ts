import type { Rol } from '@kiosco/shared';
import { crearApp } from '../src/app.js';
import { crearUsuario } from '../src/modules/usuarios/servicio.js';
import { prismaTest } from './base.js';

export const CONTRASENA = 'clave-segura-1';

/** App de test con un reloj que se puede adelantar. */
export async function crearAppDePrueba(inicio = new Date('2026-10-20T12:00:00Z')) {
  let ahora = inicio;
  const app = await crearApp({ prisma: prismaTest, ahora: () => ahora });
  return {
    app,
    adelantar(ms: number) {
      ahora = new Date(ahora.getTime() + ms);
    },
  };
}

export function crearUsuarioDePrueba(usuario: string, rol: Rol = 'empleado') {
  return crearUsuario(prismaTest, {
    nombre: `Nombre ${usuario}`,
    usuario,
    rol,
    contrasena: CONTRASENA,
  });
}

type App = Awaited<ReturnType<typeof crearAppDePrueba>>['app'];

export function ingresar(app: App, usuario: string, contrasena = CONTRASENA) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/ingresar',
    payload: { usuario, contrasena },
  });
}

/** Ingresa y devuelve la cookie de sesión lista para mandar en otros pedidos. */
export async function sesionDe(app: App, usuario: string, contrasena = CONTRASENA) {
  const res = await ingresar(app, usuario, contrasena);
  const cookie = res.cookies.find((c) => c.name === 'kiosco_sesion');
  if (res.statusCode !== 200 || !cookie) {
    throw new Error(`No se pudo ingresar como ${usuario}: ${res.body}`);
  }
  return { kiosco_sesion: cookie.value };
}
