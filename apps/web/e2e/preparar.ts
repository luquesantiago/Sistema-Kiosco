import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DATABASE_URL_E2E } from '../playwright.config.js';

const carpetaApi = fileURLToPath(new URL('../../api/', import.meta.url));
const sembrar = fileURLToPath(new URL('./sembrar.ts', import.meta.url));

/**
 * Antes de los tests: migra la base de tests, la vacía y siembra un admin, dos
 * empleados (con la misma contraseña) y productos. Las contraseñas se generan en cada corrida y llegan a
 * los tests por variables de entorno.
 */
export default function preparar() {
  process.env.E2E_CLAVE_ADMIN = `e2e-${randomBytes(8).toString('hex')}`;
  process.env.E2E_CLAVE_EMPLEADO = `e2e-${randomBytes(8).toString('hex')}`;
  const env = { ...process.env, DATABASE_URL: DATABASE_URL_E2E };

  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: carpetaApi,
    env,
    stdio: 'pipe',
  });
  // La siembra usa el código de la API (hash de contraseñas, movimientos de stock) con tsx.
  execFileSync(process.execPath, ['--import', 'tsx', sembrar], {
    cwd: carpetaApi,
    env,
    stdio: 'inherit',
  });
}
