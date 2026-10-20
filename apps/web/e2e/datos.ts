/** Productos que siembra `sembrar.ts` y que usan los tests. */
export const PRODUCTOS_E2E = [
  { nombre: 'Alfajor triple', codigo: '7790000000017', precio: '900', stock: 10 },
  { nombre: 'Gaseosa cola', codigo: '7790000000024', precio: '1500', stock: 10 },
] as const;

export const [ALFAJOR, GASEOSA] = PRODUCTOS_E2E;
