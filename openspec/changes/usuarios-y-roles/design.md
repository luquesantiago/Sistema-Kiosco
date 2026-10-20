# Design

## Context

- El esqueleto ya está (cambio archivado `esqueleto-monorepo`):
  - `apps/api` con Fastify 5, `fastify-type-provider-zod` y el formato de error común.
  - `crearApp({ verificarBase, webDist })` en `src/app.ts` y rutas bajo el prefijo `/api`.
  - Prisma 7 sin modelos, con las convenciones escritas en `prisma/schema.prisma`.
  - Tests de integración con `app.inject()` contra `kiosco_test`.
  - `apps/web` con React Router (modo librería), TanStack Query y Tailwind 4.
- Todavía no hay migraciones: este cambio crea la primera.
- `docs/stack-tecnologico.md` fijó sesiones en PostgreSQL con cookie `httpOnly`, contraseñas con argon2 y roles controlados con un hook de Fastify por ruta.
- Requisitos y comportamiento: ver `specs/autenticacion` y `specs/usuarios`.

## Goals / Non-Goals

**Goals:**
- Un mecanismo de sesión y autorización que los cambios siguientes usen con una línea por ruta.
- Dejar armada la carga de migraciones y la limpieza de la base en los tests, que van a usar todos los cambios siguientes.
- Estructura de la web (rutas protegidas, menú por rol, sesión vencida) lista para sumar las pantallas de productos, stock y POS.

**Non-Goals:**
- Auditoría general de acciones (nace en `stock`).
- Playwright (llega con `venta-pos`).
- Recuperación de contraseña sin el admin.

## Decisions

### Sesiones propias en una tabla `Sesion`, en vez de `@fastify/session`
- **Modelo:** `Sesion` con `id` (UUID v7), `tokenHash` (SHA-256 del token, único), `usuarioId`, `creadaEn` y `expiraEn`.
- **Token:** 32 bytes aleatorios en base64url, generados con `crypto.randomBytes`. La cookie lleva el token y en la base solo se guarda su hash, así un volcado de la base no permite robar sesiones.
- **Vencimiento:** `expiraEn` se fija al crear la sesión según el rol: 7 h para empleado y 30 días para admin. Es un vencimiento absoluto desde el ingreso, no se renueva con el uso, porque así el empleado vuelve a ingresar en cada turno.
- **Cerrar sesiones:** desactivar, cambiar el rol o restablecer la contraseña borra todas las sesiones del usuario. El cambio de la propia contraseña borra todas menos la actual.
- **Limpieza:** las sesiones vencidas se borran al ingresar el mismo usuario. No hace falta una tarea programada.
- **Por qué:** `@fastify/session` guarda un objeto de sesión genérico con un vencimiento fijo para todos. La duración por rol, y cerrar todas las sesiones de un usuario, requieren consultar y borrar por `usuarioId`, que con una tabla propia es una línea de Prisma. Se descarta también JWT, por lo mismo que en el stack: revocar sesiones es difícil.

### Cookie y CSRF
- **Cookie** `kiosco_sesion` con `@fastify/cookie`: `httpOnly`, `sameSite: 'lax'`, `path: '/'`, `secure` en producción y `maxAge` igual a la duración de la sesión.
- **CSRF:** con `sameSite=lax`, otros sitios no mandan la cookie en `POST`, `PATCH` ni `DELETE`. Además, la API solo acepta JSON en esas rutas, lo que obliga a una petición *preflight* desde otro origen.
- **Por qué no un token anti-CSRF aparte:** la web y la API comparten origen, así que alcanza con lo anterior.

### Autorización con un plugin y `preHandler`
- **Plugin `sesion`** (`src/plugins/sesion.ts`): decora el request con `usuario: UsuarioSesion | null`. En un hook `onRequest` lee la cookie, busca la sesión vigente con su usuario activo y la carga.
- **Ayudas para las rutas:** `requiereSesion` y `requiereRol('admin')`, que se usan como `preHandler`:
  - Sin usuario → `401 NO_AUTENTICADO`.
  - Con un rol distinto → `403 SIN_PERMISO`.
- **Rutas abiertas:** solo `POST /api/auth/ingresar` y `GET /api/health` no llevan `preHandler`. Se agrega un test que recorre las rutas registradas y verifica que todas las demás bajo `/api` exigen sesión, para que ningún cambio futuro deje una ruta abierta por olvido.
- **Desactivación:** como cada pedido consulta el usuario junto con la sesión, desactivar a alguien corta su acceso en el siguiente pedido aunque la sesión no se haya borrado.

### Contraseñas y bloqueo
- **Hash:** `argon2` (argon2id) con los parámetros por defecto de la librería. `argon2` compila un binario nativo, así que va en `onlyBuiltDependencies` de `pnpm-workspace.yaml`.
- **Bloqueo:** `Usuario` lleva `intentosFallidos` y `bloqueadoHasta`.
  - Cada fallo con un usuario existente suma un intento. Al llegar a 5, se fija `bloqueadoHasta = ahora + 15 min` y el contador vuelve a 0.
  - Un ingreso correcto pone el contador en 0.
  - Mientras dura el bloqueo se responde `429 INGRESO_BLOQUEADO` sin verificar la contraseña. Que este error sea distinto revela que el usuario existe, pero solo después de 5 intentos, y avisarle al empleado le sirve más que ocultarlo.
- **Usuario inexistente:** se verifica igual la contraseña contra un hash fijo, para que el tiempo de respuesta no delate qué usuarios existen.
- **Logs:** el body de `/api/auth/*` y `/api/usuarios/*` no se loguea. Fastify no loguea bodies por defecto; se deja escrito en un comentario para no activarlo después.

### Modelo de datos
- **`Usuario`** (`@@map("usuarios")`):
  - `id`, `nombre`, `usuario` (único, guardado en minúsculas), `contrasenaHash`.
  - `rol` (enum `Rol`: `admin`, `empleado`) y `activo`.
  - `intentosFallidos` y `bloqueadoHasta`.
  - `ultimoIngreso`, `creadoEn` y `actualizadoEn`.
- **`Sesion`** (`@@map("sesiones")`): los campos de arriba, con `onDelete: Cascade` hacia `Usuario`.
- **Usuario sin distinguir mayúsculas:** se normaliza a minúsculas al guardar y al buscar, en vez de usar `citext`, que exige activar una extensión de PostgreSQL.

### API
| Método y ruta | Acceso | Qué hace |
|---|---|---|
| `POST /api/auth/ingresar` | abierta | `{ usuario, contrasena }` → `200` con el usuario y la cookie |
| `POST /api/auth/salir` | sesión | Borra la sesión actual y limpia la cookie → `204` |
| `GET /api/auth/sesion` | sesión | `{ id, nombre, usuario, rol }` |
| `POST /api/auth/contrasena` | sesión | `{ actual, nueva }` → `204` |
| `GET /api/usuarios` | admin | Lista sin hashes |
| `POST /api/usuarios` | admin | Alta → `201` |
| `PATCH /api/usuarios/:id` | admin | `{ nombre?, rol?, activo? }` |
| `POST /api/usuarios/:id/contrasena` | admin | `{ nueva }` → `204` |

- **Validación:** los esquemas Zod de cada body viven en `packages/shared`, y la web los usa para validar los formularios.
- **Errores nuevos:** `CREDENCIALES_INVALIDAS` (401), `NO_AUTENTICADO` (401), `SIN_PERMISO` (403), `INGRESO_BLOQUEADO` (429), `USUARIO_EXISTENTE` (409) y `ULTIMO_ADMIN` (409).
- **Reglas de negocio:** la regla del último admin y la de no desactivarse a sí mismo se verifican en el servicio dentro de una transacción, contando los admins activos.

### Primer admin
- **Comando:** `pnpm --filter api usuarios:crear-admin`, que ejecuta `src/cli/crear-admin.ts` con tsx.
- **Datos:** pide usuario y nombre por argumento o pregunta, y la contraseña dos veces sin eco (`readline` con la salida silenciada).
- **Reglas:** reutiliza el servicio de alta de usuarios, así que aplica las mismas validaciones y falla si el usuario ya existe.
- **Por qué no un seed automático con contraseña por defecto:** quedaría una contraseña conocida en un sistema expuesto a internet.

### Migraciones y tests
- **Migración:** `prisma migrate dev --name usuarios` genera `prisma/migrations/`, que se versiona.
- **Scripts:** `db:migrate` (`prisma migrate dev`) y `db:deploy` (`prisma migrate deploy`) en la API, más alias en la raíz.
- **Tests de integración:**
  - Un `globalSetup` de Vitest corre `prisma migrate deploy` contra `kiosco_test` antes de los tests.
  - Una ayuda `limpiarBase()` hace `TRUNCATE ... CASCADE` de las tablas entre tests.
  - Los tests de la API pasan a correr en serie (`fileParallelism: false`), porque comparten una sola base.
- **Tiempo:** el vencimiento y el bloqueo se testean con un reloj inyectable (`ahora()` en las opciones de `crearApp`) en vez de esperar horas.

### Web
- **Rutas:**
  - `/ingresar` (pública).
  - `/` redirige según el rol: el admin a `/admin` y el empleado a `/venta`.
  - `/venta` muestra un aviso de "próximamente" hasta `venta-pos`.
  - `/admin/usuarios` (lista, alta y edición) y `/cuenta/contrasena`.
- **Sesión en la web:**
  - Un *loader* raíz consulta `GET /api/auth/sesion` con TanStack Query.
  - Si responde `401`, redirige a `/ingresar` y guarda la ruta de destino para volver después.
  - Cualquier `401` posterior de la API invalida la sesión en caché y vuelve al ingreso. Así se maneja que la sesión del empleado venza a mitad del turno.
- **Layout:**
  - Barra con el nombre del usuario, el menú según el rol y "Salir".
  - En el celular el menú se colapsa.
  - La pantalla de usuarios usa tarjetas en móvil y tabla en escritorio.
- **Pantalla de ingreso:**
  - Pensada para teclado: foco inicial en el usuario y Enter para enviar.
  - Muestra el mensaje genérico de error o el de bloqueo.
- **Llamadas a la API:** un cliente mínimo (`src/api/cliente.ts`) sobre `fetch` que parsea el formato de error común.

## Risks / Trade-offs

- [`argon2` necesita un binario nativo y podría fallar al instalar en Windows o en la CI] → `argon2` publica binarios precompilados para Windows y Linux x64. Si fallara, el plan B es `@node-rs/argon2`, que no compila nada.
- [Tests en serie, más lentos a medida que crece la API] → por ahora son pocos. Si crecen, se puede usar un esquema de PostgreSQL por archivo de test.
- [Bloqueo por usuario: alguien puede bloquear a otro a propósito con 5 intentos] → el bloqueo dura solo 15 minutos y el sistema es interno. Se acepta frente al riesgo de adivinar contraseñas por fuerza bruta.
- [Una sesión de admin de 30 días en un celular perdido] → el admin puede cambiar su contraseña desde otro dispositivo, y eso cierra las demás sesiones.
- [Que un cambio futuro olvide proteger una ruta] → el test que recorre todas las rutas de `/api` lo detecta.

## Migration Plan

- Es la primera migración y no hay datos reales (la Etapa 1 no va a producción), así que no hay migración de datos.
- En desarrollo: `pnpm db:migrate` y después `pnpm --filter api usuarios:crear-admin`.
- La CI aplica las migraciones a `kiosco_test` a través del `globalSetup` de los tests.
