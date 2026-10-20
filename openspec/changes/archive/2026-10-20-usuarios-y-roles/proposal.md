# Proposal

## Why

Todo el sistema requiere saber quién está usándolo: las ventas, los ajustes de stock y las anulaciones quedan registrados por usuario, y el empleado no puede hacer lo mismo que el admin. Sin usuarios, sesiones y roles no se puede construir ninguno de los cambios siguientes de la Etapa 1 (`productos-y-proveedores`, `stock`, `venta-pos`).

## What Changes

- **Ingreso con usuario y contraseña** para admin y empleado, con contraseñas guardadas con argon2.
- **Sesiones con cookie `httpOnly`** guardadas en la base, con duración según el rol: **7 horas** para el empleado (un turno con margen) y **30 días** para el admin (que entra desde el celular). Cerrar sesión, desactivar al usuario o cambiarle la contraseña cierra sus sesiones.
- **Bloqueo temporal** del usuario tras varios intentos fallidos de ingreso, con un mensaje de error que no revela si el usuario existe.
- **Control de acceso por rol** en la API: sin sesión se responde `401`; con un rol sin permiso, `403`.
- **Gestión de usuarios por el admin** (responsive, usable desde el celular):
  - Crear usuarios con nombre, usuario, rol y contraseña inicial.
  - Editar nombre y rol, y desactivar o reactivar usuarios. Los usuarios nunca se borran, porque el historial de ventas y movimientos los referencia.
  - Restablecer la contraseña de otro usuario.
  - Siempre tiene que quedar al menos un admin activo.
- **Cambio de la propia contraseña** para cualquier usuario, pidiendo la actual.
- **Primer admin** creado con un comando de consola, ya que sin usuarios nadie puede entrar a la web.
- **Web:**
  - Pantalla de ingreso.
  - Estructura de la aplicación con menú según el rol.
  - Pantallas de usuarios y de cambio de contraseña.
  - Redirección al ingreso cuando la sesión vence. El empleado entra a la sección de venta, todavía vacía hasta `venta-pos`.
- Primer modelo de Prisma y primera migración: `Usuario` y `Sesion`.
- **Fuera de alcance:** recuperación de contraseña por email o WhatsApp (la restablece el admin); registro de auditoría general (nace en `stock`); permisos más finos que admin/empleado; ingreso por PIN.

## Capabilities

### New Capabilities
- `autenticacion`: ingreso, sesiones con vencimiento por rol, cierre de sesión, bloqueo por intentos fallidos, cambio de la propia contraseña y control de acceso (401/403) a la API.
- `usuarios`: alta, edición, roles, desactivación y restablecimiento de contraseña de usuarios por parte del admin, la regla de al menos un admin activo y la creación del primer admin.

### Modified Capabilities
<!-- Ninguna: estado-del-servicio no cambia (el chequeo de estado sigue sin pedir sesión). -->

## Impact

- **API:**
  - Nuevos módulos `auth` y `usuarios` en `apps/api/src/modules/`.
  - Un plugin de sesión y autorización que usan todas las rutas siguientes.
  - Nuevas dependencias: `argon2` y `@fastify/cookie`.
- **Base de datos:** primera migración de Prisma (`Usuario`, `Sesion`). Los tests de integración y la CI aplican las migraciones sobre `kiosco_test`.
- **Shared:** esquemas Zod de ingreso, usuario y contraseña.
- **Web:** React Router con rutas protegidas, pantallas de ingreso, usuarios y contraseña, y menú por rol.
- **Docs:** README (cómo crear el primer admin) y `docs/requisitos-y-limites.md` (duración de sesiones).
