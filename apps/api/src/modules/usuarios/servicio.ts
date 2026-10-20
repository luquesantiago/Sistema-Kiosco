import {
  altaUsuarioSchema,
  CODIGOS_ERROR,
  type AltaUsuario,
  type EdicionUsuario,
  type UsuarioListado,
} from '@kiosco/shared';
import { ErrorHttp } from '../../errores.js';
import type { PrismaClient, Usuario } from '../../generated/prisma/client.js';
import { hashearContrasena } from '../auth/contrasenas.js';
import { cerrarSesiones } from '../auth/sesiones.js';

function aListado(u: Usuario): UsuarioListado {
  return {
    id: u.id,
    nombre: u.nombre,
    usuario: u.usuario,
    rol: u.rol,
    activo: u.activo,
    ultimoIngreso: u.ultimoIngreso?.toISOString() ?? null,
  };
}

function esUsuarioRepetido(error: unknown): boolean {
  return (error as { code?: string }).code === 'P2002';
}

const noEncontrado = () => new ErrorHttp(404, CODIGOS_ERROR.noEncontrado, 'El usuario no existe.');

export async function listarUsuarios(prisma: PrismaClient): Promise<UsuarioListado[]> {
  const usuarios = await prisma.usuario.findMany({
    orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
  });
  return usuarios.map(aListado);
}

/** Alta de usuario; la usan la API y el comando de consola del primer admin. */
export async function crearUsuario(
  prisma: PrismaClient,
  datos: AltaUsuario,
): Promise<UsuarioListado> {
  const { nombre, usuario, rol, contrasena } = altaUsuarioSchema.parse(datos);
  try {
    const creado = await prisma.usuario.create({
      data: { nombre, usuario, rol, contrasenaHash: await hashearContrasena(contrasena) },
    });
    return aListado(creado);
  } catch (error) {
    if (esUsuarioRepetido(error)) {
      throw new ErrorHttp(409, CODIGOS_ERROR.usuarioExistente, `El usuario ${usuario} ya existe.`);
    }
    throw error;
  }
}

/**
 * Edita nombre, rol o estado. Nunca deja el sistema sin admins activos y no
 * permite desactivarse a sí mismo. Cambiar rol o desactivar cierra las sesiones.
 */
export async function editarUsuario(
  prisma: PrismaClient,
  id: string,
  cambios: EdicionUsuario,
  actorId: string,
): Promise<UsuarioListado> {
  return prisma.$transaction(
    async (tx) => {
      const actual = await tx.usuario.findUnique({ where: { id } });
      if (!actual) throw noEncontrado();

      if (cambios.activo === false && id === actorId) {
        throw new ErrorHttp(
          409,
          CODIGOS_ERROR.autoDesactivacion,
          'No podés desactivar tu propio usuario.',
        );
      }

      const quedaAdminActivo =
        (cambios.rol ?? actual.rol) === 'admin' && (cambios.activo ?? actual.activo);
      if (actual.rol === 'admin' && actual.activo && !quedaAdminActivo) {
        const otrosAdmins = await tx.usuario.count({
          where: { rol: 'admin', activo: true, id: { not: id } },
        });
        if (otrosAdmins === 0) {
          throw new ErrorHttp(
            409,
            CODIGOS_ERROR.ultimoAdmin,
            'Tiene que quedar al menos un admin activo.',
          );
        }
      }

      const editado = await tx.usuario.update({ where: { id }, data: cambios });
      if (editado.rol !== actual.rol || !editado.activo) {
        await cerrarSesiones(tx, id);
      }
      return aListado(editado);
    },
    { isolationLevel: 'Serializable' },
  );
}

/** El admin fija una contraseña nueva; se cierran las sesiones y se levanta el bloqueo. */
export async function restablecerContrasena(
  prisma: PrismaClient,
  id: string,
  nueva: string,
): Promise<void> {
  const contrasenaHash = await hashearContrasena(nueva);
  await prisma.$transaction(async (tx) => {
    const existe = await tx.usuario.findUnique({ where: { id }, select: { id: true } });
    if (!existe) throw noEncontrado();
    await tx.usuario.update({
      where: { id },
      data: { contrasenaHash, intentosFallidos: 0, bloqueadoHasta: null },
    });
    await cerrarSesiones(tx, id);
  });
}
