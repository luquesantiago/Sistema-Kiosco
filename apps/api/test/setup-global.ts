import { execFileSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './url-base.js';

/** Aplica las migraciones pendientes a la base de tests antes de correr. */
export default function setup() {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
