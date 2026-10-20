import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  clean: true,
  // `shared` se publica como TypeScript sin compilar: se empaqueta acá.
  noExternal: ['@kiosco/shared'],
});
