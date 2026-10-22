import type { Rol } from '@kiosco/shared';
import { crearApp, type OpcionesApp } from '../src/app.js';
import { crearUsuario } from '../src/modules/usuarios/servicio.js';
import { prismaTest } from './base.js';

export const CONTRASENA = 'clave-segura-1';

/** App de test con un reloj que se puede adelantar. */
export async function crearAppDePrueba(
  inicio = new Date('2026-10-20T12:00:00Z'),
  opciones: Pick<OpcionesApp, 'whatsapp'> = {},
) {
  let ahora = inicio;
  const app = await crearApp({ prisma: prismaTest, ahora: () => ahora, ...opciones });
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

type Cookies = Awaited<ReturnType<typeof sesionDe>>;

/** Abre un turno de caja con la sesión dada (por defecto con $0) y devuelve su id. */
export async function abrirTurnoDePrueba(app: App, cookies: Cookies, montoInicial = '0') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/caja/turnos',
    cookies,
    payload: { montoInicial },
  });
  if (res.statusCode !== 201) throw new Error(`No se pudo abrir el turno: ${res.body}`);
  return res.json().turnoAbierto.id as string;
}

export function cerrarTurnoDePrueba(
  app: App,
  cookies: Cookies,
  turnoId: string,
  payload: Record<string, unknown> = { montoContado: '0' },
) {
  return app.inject({
    method: 'POST',
    url: `/api/caja/turnos/${turnoId}/cerrar`,
    cookies,
    payload,
  });
}
