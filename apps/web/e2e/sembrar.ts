/**
 * Siembra de la base de tests para Playwright. Corre con tsx desde apps/api
 * (ver preparar.ts) para reutilizar el código de la API.
 */
import { crearUsuario } from '../../api/src/modules/usuarios/servicio.js';
import { registrarMovimiento } from '../../api/src/modules/stock/movimientos.js';
import { limpiarBase, prismaTest } from '../../api/test/base.js';
import { PRODUCTOS_E2E } from './datos.js';

await limpiarBase();
const admin = await crearUsuario(prismaTest, {
  nombre: 'Admin E2E',
  usuario: 'e2e-admin',
  rol: 'admin',
  contrasena: process.env.E2E_CLAVE_ADMIN!,
});
for (const [nombre, usuario] of [
  ['Empleado E2E', 'e2e-empleado'],
  ['Segunda E2E', 'e2e-segunda'],
]) {
  await crearUsuario(prismaTest, {
    nombre: nombre!,
    usuario: usuario!,
    rol: 'empleado',
    contrasena: process.env.E2E_CLAVE_EMPLEADO!,
  });
}

for (const p of PRODUCTOS_E2E) {
  const producto = await prismaTest.producto.create({
    data: {
      nombre: p.nombre,
      nombreBusqueda: p.nombre.toLowerCase(),
      codigoBarras: p.codigo,
      precio: p.precio,
      stockMinimo: 0,
      stockMaximo: 50,
    },
  });
  await prismaTest.$transaction((tx) =>
    registrarMovimiento(tx, {
      productoId: producto.id,
      tipo: 'compra',
      cantidad: p.stock,
      usuarioId: admin.id,
    }),
  );
}

await prismaTest.$disconnect();
