# Tasks

## 1. Modelo de datos y migraciones

- [x] 1.1 Agregar a `prisma/schema.prisma` el enum `Rol` y los modelos `Usuario` y `Sesion` según `design.md`, generar la migración `usuarios` con `prisma migrate dev` y agregar los scripts `db:migrate`/`db:deploy` (API y alias en la raíz); verificar que `pnpm db:migrate` crea las tablas `usuarios` y `sesiones` en la base de desarrollo
- [x] 1.2 Configurar en Vitest de la API un `globalSetup` que corre `prisma migrate deploy` sobre `kiosco_test`, la ayuda `limpiarBase()` y `fileParallelism: false`; verificar que los tests existentes de `estado-del-servicio` siguen pasando y que la CI aplica las migraciones

## 2. Esquemas compartidos

- [x] 2.1 Agregar en `packages/shared` los esquemas Zod de ingreso, usuario de sesión, alta y edición de usuario, contraseña (mínimo 8) y nombre de usuario (3 a 30, `[a-z0-9._-]`, normalizado a minúsculas), y los códigos de error nuevos; verificar con tests unitarios de los esquemas (usuario con espacios, mayúsculas normalizadas, contraseña corta)

## 3. Autenticación en la API

- [x] 3.1 Agregar `@fastify/cookie` y `argon2` (en `onlyBuiltDependencies`), el plugin `sesion` con `request.usuario`, los `preHandler` `requiereSesion`/`requiereRol` y un reloj inyectable `ahora()` en `crearApp`; verificar que `pnpm install` compila `argon2` en Windows y que typecheck pasa
- [x] 3.2 Implementar `POST /api/auth/ingresar` (minúsculas, usuarios desactivados, error genérico, hash fijo para usuarios inexistentes, contador de intentos y bloqueo de 15 min, `ultimoIngreso`, sesión de 7 h o 30 días según el rol y cookie); verificar con tests de integración todos los escenarios de "Ingreso con usuario y contraseña", "Error de ingreso sin pistas" y "Bloqueo por intentos fallidos"
- [x] 3.3 Implementar `GET /api/auth/sesion` y `POST /api/auth/salir`; verificar con tests los escenarios de "Sesión actual", "Cierre de sesión" y "Vencimiento de la sesión según el rol" (usando el reloj inyectable)
- [x] 3.4 Implementar `POST /api/auth/contrasena`; verificar con tests los escenarios de "Cambio de la propia contraseña", incluido que otra sesión del mismo usuario deja de servir y la actual sigue
- [x] 3.5 Agregar el test que recorre todas las rutas registradas bajo `/api` y comprueba que, salvo `ingresar` y `health`, responden `401` sin sesión; y un test de que ninguna respuesta de auth ni de usuarios contiene `contrasena` ni `contrasenaHash`

## 4. Gestión de usuarios en la API

- [x] 4.1 Implementar el servicio y las rutas `GET`/`POST /api/usuarios` (solo admin, `409 USUARIO_EXISTENTE`); verificar con tests los escenarios de "Roles admin y empleado", "Alta de usuario" y "Lista de usuarios"
- [x] 4.2 Implementar `PATCH /api/usuarios/:id` (nombre, rol, activo) con la regla del último admin activo y de no desactivarse a sí mismo en una transacción, cerrando las sesiones al cambiar rol o desactivar; verificar con tests los escenarios de "Edición de usuario", "Desactivación sin borrado" y "Siempre queda un admin activo"
- [x] 4.3 Implementar `POST /api/usuarios/:id/contrasena`; verificar con tests el escenario "Empleado que olvidó la contraseña" (la anterior deja de servir y se cierran sus sesiones)
- [x] 4.4 Implementar el comando `pnpm --filter api usuarios:crear-admin` (`src/cli/crear-admin.ts`, contraseña pedida dos veces sin eco, reutiliza el servicio de alta); verificar con un test del núcleo del comando (base vacía crea admin; usuario existente falla sin modificarlo) y ejecutándolo a mano en la base de desarrollo

## 5. Web

- [x] 5.1 Crear el cliente de API (`src/api/cliente.ts`) que parsea el formato de error común y, ante un `401`, invalida la sesión en caché; verificar con tests unitarios (`fetch` simulado) que traduce errores y dispara la invalidación
- [x] 5.2 Crear la pantalla `/ingresar` (foco en usuario, Enter para enviar, mensaje genérico y de bloqueo) y la carga de la sesión con redirección a `/ingresar` guardando la ruta de destino; verificar con tests de Testing Library el ingreso correcto, el error y la redirección sin sesión
- [x] 5.3 Crear el layout con nombre del usuario, menú por rol (colapsable en móvil) y "Salir", la redirección de `/` según el rol y la página `/venta` provisoria; verificar con tests que el empleado no ve el menú de usuarios y que "Salir" vuelve al ingreso
- [x] 5.4 Crear `/admin/usuarios` (lista en tarjetas en móvil y tabla en escritorio, alta, edición de nombre/rol, activar/desactivar y restablecer contraseña, mostrando los errores `409`) y `/cuenta/contrasena`; verificar con tests de Testing Library el alta, el error de usuario repetido y el error de último admin
- [x] 5.5 Verificar en el navegador con la API y la base de desarrollo: crear el admin por consola, ingresar, crear un empleado, ingresar como empleado en otra ventana, desactivarlo desde el admin y comprobar que el empleado vuelve al ingreso; revisar `/admin/usuarios` en ancho de celular (375 px)

## 6. Documentación

- [x] 6.1 Actualizar `README.md` (pasos `pnpm db:migrate` y `pnpm --filter api usuarios:crear-admin` al levantar el proyecto) y `docs/requisitos-y-limites.md` (sesiones de 7 h para empleado y 30 días para admin, bloqueo tras 5 intentos, contraseña mínima de 8 y restablecimiento por el admin); verificar siguiendo los pasos del README sobre una base reseteada

## Workflow follow-up

- Archivar el cambio con `/opsx:archive` cuando la CI esté en verde.
- Proponer el siguiente cambio de la Etapa 1: `productos-y-proveedores`.
