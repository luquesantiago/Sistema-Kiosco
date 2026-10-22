/**
 * Crea un usuario admin desde la consola (por ejemplo, el primero, ya que sin
 * usuarios nadie puede entrar a la web).
 *
 *   pnpm --filter api usuarios:crear-admin --usuario ana --nombre "Ana Pérez"
 *
 * En producción, compilado dentro del contenedor:
 *
 *   docker compose exec app node dist/cli/crear-admin.js --usuario ana --nombre "Ana Pérez"
 *
 * La contraseña se pide dos veces sin mostrarla.
 */
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { cargarConfig } from '../config.js';
import { crearPrisma } from '../db.js';
import { ErrorHttp } from '../errores.js';
import { crearUsuario } from '../modules/usuarios/servicio.js';

/** Salida que se puede silenciar mientras se escribe la contraseña. */
class SalidaSilenciable extends Writable {
  silenciada = false;
  override _write(chunk: Buffer, _enc: BufferEncoding, listo: () => void) {
    if (!this.silenciada) process.stdout.write(chunk);
    listo();
  }
}

async function main() {
  const { values } = parseArgs({
    // pnpm reenvía un "--" literal si se escribe `pnpm ... -- --usuario x`.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { usuario: { type: 'string' }, nombre: { type: 'string' } },
  });

  const resultado = cargarConfig(process.env);
  if (!resultado.ok) {
    console.error(`Configuración inválida:\n- ${resultado.errores.join('\n- ')}`);
    process.exit(1);
  }

  const salida = new SalidaSilenciable();
  const rl = createInterface({
    input: process.stdin,
    output: salida,
    terminal: process.stdin.isTTY === true,
  });
  // Iterar las líneas (en vez de rl.question) también funciona con la entrada por pipe.
  const lineas = rl[Symbol.asyncIterator]();
  const preguntar = async (texto: string, oculto = false) => {
    process.stdout.write(texto);
    salida.silenciada = oculto;
    const { value } = await lineas.next();
    salida.silenciada = false;
    if (oculto) process.stdout.write('\n');
    return typeof value === 'string' ? value : '';
  };

  const usuario = values.usuario ?? (await preguntar('Usuario: '));
  const nombre = values.nombre ?? (await preguntar('Nombre: '));
  const contrasena = await preguntar('Contraseña (mínimo 8 caracteres): ', true);
  const repetida = await preguntar('Repetí la contraseña: ', true);
  rl.close();

  if (contrasena !== repetida) {
    console.error('Las contraseñas no coinciden.');
    process.exit(1);
  }

  const prisma = crearPrisma(resultado.config.DATABASE_URL);
  try {
    const admin = await crearUsuario(prisma, { usuario, nombre, contrasena, rol: 'admin' });
    console.log(`Admin "${admin.usuario}" creado. Ya puede ingresar desde la web.`);
  } catch (error) {
    if (error instanceof ErrorHttp) {
      console.error(error.message);
    } else if (error instanceof Error && error.name === 'ZodError') {
      console.error(
        'Datos inválidos: revisá el usuario (3 a 30 letras o números) y la contraseña (mínimo 8).',
      );
    } else {
      throw error;
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

await main();
