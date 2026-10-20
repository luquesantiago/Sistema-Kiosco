import argon2 from 'argon2';

export function hashearContrasena(contrasena: string): Promise<string> {
  return argon2.hash(contrasena, { type: argon2.argon2id });
}

// Hash de una contraseña al azar: se verifica contra él cuando el usuario no
// existe, para que el tiempo de respuesta no delate qué usuarios existen.
const hashFijo = hashearContrasena(crypto.randomUUID());

export async function verificarContrasena(
  hash: string | undefined,
  contrasena: string,
): Promise<boolean> {
  const ok = await argon2.verify(hash ?? (await hashFijo), contrasena);
  return hash !== undefined && ok;
}
