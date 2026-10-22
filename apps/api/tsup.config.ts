import { defineConfig } from 'tsup';

export default defineConfig({
  // El comando de crear admin también se compila: en producción no hay tsx.
  entry: ['src/server.ts', 'src/cli/crear-admin.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  clean: true,
  // `shared` se publica como TypeScript sin compilar: se empaqueta acá.
  noExternal: ['@kiosco/shared'],
});
