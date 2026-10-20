import { createHash, randomBytes } from 'node:crypto';
import type { Rol, UsuarioSesion } from '@kiosco/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';

export const COOKIE_SESION = 'kiosco_sesion';

const HORA_MS = 60 * 60 * 1000;

/** Duración de la sesión desde el ingreso; no se renueva con el uso. */
export const DURACION_SESION_MS: Record<Rol, number> = {
  empleado: 7 * HORA_MS,
  admin: 30 * 24 * HORA_MS,
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Crea una sesión y devuelve el token para la cookie (en la base solo queda su hash). */
export async function crearSesion(
  prisma: PrismaClient,
  usuario: { id: string; rol: Rol },
  ahora: Date,
): Promise<{ token: string; expiraEn: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiraEn = new Date(ahora.getTime() + DURACION_SESION_MS[usuario.rol]);
  await prisma.sesion.create({
    data: { tokenHash: hashToken(token), usuarioId: usuario.id, expiraEn },
  });
  return { token, expiraEn };
}

/** Busca una sesión vigente de un usuario activo. */
export async function buscarSesion(
  prisma: PrismaClient,
  token: string,
  ahora: Date,
): Promise<{ sesionId: string; usuario: UsuarioSesion } | null> {
  const sesion = await prisma.sesion.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { usuario: true },
  });
  if (!sesion || sesion.expiraEn <= ahora || !sesion.usuario.activo) {
    return null;
  }
  const { id, nombre, usuario, rol } = sesion.usuario;
  return { sesionId: sesion.id, usuario: { id, nombre, usuario, rol } };
}

/** Cierra todas las sesiones del usuario, salvo la indicada. */
export async function cerrarSesiones(
  prisma: Pick<PrismaClient, 'sesion'>,
  usuarioId: string,
  salvo?: string,
): Promise<void> {
  await prisma.sesion.deleteMany({
    where: { usuarioId, ...(salvo ? { id: { not: salvo } } : {}) },
  });
}
