/**
 * Deja en un node_modules de pnpm (el de `pnpm deploy`) solo los paquetes
 * alcanzables desde las dependencias del package.json, sin seguir los peers
 * opcionales que la app no usa en ejecución. Lo usa el Dockerfile.
 *
 *   node podar-node-modules.mjs /out
 *
 * @prisma/client declara como peers a `prisma` (el CLI) y a `typescript`, que
 * solo hacen falta para generar el cliente. pnpm los enlaza igual, y con ellos
 * entran Prisma Studio, PGlite y varios cientos de MB.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';

const PEERS_IGNORADOS = new Set(['prisma', 'typescript']);

const raiz = process.argv[2];
if (!raiz) throw new Error('Uso: node podar-node-modules.mjs <carpeta con package.json>');
const store = join(raiz, 'node_modules', '.pnpm');
const { dependencies = {} } = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'));

/** Nombres de paquetes de una carpeta node_modules, incluidos los @scope/nombre. */
function paquetes(carpeta) {
  return readdirSync(carpeta).flatMap((nombre) => {
    if (nombre.startsWith('.')) return [];
    if (!nombre.startsWith('@')) return [nombre];
    return readdirSync(join(carpeta, nombre)).map((sub) => `${nombre}/${sub}`);
  });
}

const vivos = new Set();

function visitar(enlace) {
  if (!existsSync(enlace)) return;
  const real = realpathSync(enlace);
  if (!real.startsWith(store + sep)) return;
  // real = <store>/<id>/node_modules/<nombre>; sus dependencias son hermanas.
  const id = real.slice(store.length + 1).split(sep)[0];
  if (vivos.has(id)) return;
  vivos.add(id);
  const hermanas = join(store, id, 'node_modules');
  for (const nombre of paquetes(hermanas)) {
    if (!PEERS_IGNORADOS.has(nombre)) visitar(join(hermanas, nombre));
  }
}

for (const nombre of Object.keys(dependencies)) {
  visitar(join(raiz, 'node_modules', nombre));
}

let borrados = 0;
for (const id of readdirSync(store)) {
  if (id === 'node_modules' || id.startsWith('lock') || vivos.has(id)) continue;
  rmSync(join(store, id), { recursive: true, force: true });
  borrados++;
}
console.log(`podar-node-modules: ${vivos.size} paquetes conservados, ${borrados} borrados`);
