import { defineConfig } from 'tsup';

export default defineConfig({
  // Los comandos de consola también se compilan: en producción no hay tsx.
  entry: ['src/server.ts', 'src/cli/crear-admin.ts', 'src/cli/mp-terminales.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  clean: true,
  // `shared` se publica como TypeScript sin compilar: se empaqueta acá.
  noExternal: ['@kiosco/shared'],
});
