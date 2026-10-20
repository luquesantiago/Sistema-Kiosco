# Design

## Context

- El repositorio solo tiene documentación y OpenSpec; no hay `package.json` ni código.
- El stack está fijado en `docs/stack-tecnologico.md` y la estructura de carpetas en `docs/estructura-proyecto.md`; este diseño solo baja esas decisiones a configuración concreta.
- El desarrollador trabaja en **Windows** con Node.js 24 y Docker instalados (pnpm todavía no). El remoto es GitHub (`luquesantiago/Sistema-Kiosco`).
- La Etapa 1 no va a producción: se usa en el kiosco recién con la Etapa 2. Por eso este cambio no incluye deploy.

## Goals / Non-Goals

**Goals:**
- Que `pnpm install`, `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` funcionen desde la raíz, en Windows y en la CI.
- Que los cambios siguientes solo tengan que agregar módulos (rutas, modelos de Prisma, pantallas), sin tocar la configuración base.
- Dejar fijadas las convenciones de datos (IDs, montos, fechas) y de la API (prefijo, errores) antes del primer modelo.

**Non-Goals:**
- Modelos de negocio, autenticación o pantallas reales.
- Dockerfile de producción, Caddy, deploy y backups.
- Playwright (llega con `venta-pos`, que es el primer flujo de punta a punta que vale la pena).

## Decisions

### Versiones y gestor de paquetes
- **Node.js 24 LTS**, fijado en `.nvmrc` y en `engines` del `package.json` raíz.
- **pnpm 10** activado con Corepack y fijado en el campo `packageManager`, para que la CI y cualquier máquina usen la misma versión sin instalarlo aparte.
- **ESM** en todos los paquetes (`"type": "module"`), TypeScript en modo `strict` con un `tsconfig.base.json` en la raíz que extienden los demás.
- Alternativa descartada: npm/yarn workspaces. pnpm ya estaba elegido en el stack y es más estricto con dependencias no declaradas.

### `packages/shared` sin paso de build
- `@kiosco/shared` exporta su código TypeScript directamente (`exports` apunta a `src/index.ts`).
- La web lo compila con Vite y la API lo empaqueta con **tsup** al hacer `build`. En desarrollo la API corre con **tsx** (`tsx watch`), que también lee TypeScript directo.
- Por qué: evita tener que compilar `shared` antes de cada cambio y los problemas de "olvidé rebuildear el paquete". Alternativa descartada: referencias de proyecto de TypeScript con `tsc -b`, que agrega orden de build y archivos `.d.ts` sin beneficio para dos consumidores.

### API (`apps/api`)
- Fastify 5 con **`fastify-type-provider-zod`**: los esquemas Zod de `shared` validan entradas y tipan las rutas.
- Estructura: `src/app.ts` arma la instancia (plugins y rutas) y `src/server.ts` la escucha. Separarlas permite testear con `app.inject()` sin abrir un puerto.
- Todas las rutas van bajo el prefijo **`/api`**. Rutas por dominio en `src/modules/<dominio>/`; este cambio solo crea `src/modules/estado/`.
- **Configuración** en `src/config.ts`: un esquema Zod lee `process.env` (`DATABASE_URL`, `PORT` con valor por defecto 3000, `NODE_ENV`, `LOG_LEVEL`). Si falla, se loguea qué variable está mal y el proceso sale con código 1. En desarrollo se carga `.env` con `--env-file` de Node (sin dependencia `dotenv`). Hay un `.env.example` versionado.
- **Formato de error** para todos los cambios: `{ "error": { "codigo": "<CODIGO>", "mensaje": "<texto para mostrar>" } }`. Un `setErrorHandler` traduce los errores de validación a `400 VALIDACION` y lo inesperado a `500 ERROR_INTERNO` (el detalle va al log). Un `setNotFoundHandler` devuelve `404 NO_ENCONTRADO` para `/api/*`.
- **Chequeo de estado:** `SELECT 1` vía Prisma con un timeout de 2 s (`Promise.race`), según la spec `estado-del-servicio`.
- **Logs** con el logger pino integrado en Fastify; en desarrollo con `pino-pretty`.
- **Producción:** si existe el build de la web (`apps/web/dist`), `@fastify/static` lo sirve y toda ruta que no empieza con `/api` devuelve `index.html` (fallback de la SPA). En desarrollo no se usa: Vite sirve la web.

### Base de datos y Prisma
- **Prisma 7** con `prisma.config.ts` y el adaptador **`@prisma/adapter-pg`**, que es como la versión 7 se conecta a PostgreSQL. El esquema vive en `apps/api/prisma/schema.prisma`.
- Este cambio no crea modelos ni migraciones; el primero llega con `usuarios-y-roles`. El cliente se genera igual (`prisma generate` en `postinstall` de la API) para que el chequeo de estado use la misma conexión que va a usar todo lo demás.
- **Convenciones**, que se documentan como comentario en `schema.prisma` y aplican desde el primer modelo:
  - IDs `String @id @default(uuid(7)) @db.Uuid`: UUID v7, ordenables por fecha y generables también desde el cliente si algún día hace falta un modo sin conexión.
  - Montos `Decimal @db.Decimal(12, 2)`, nunca `Float`. Cantidades y stock `Int` (no hay productos por peso).
  - Fechas `DateTime @db.Timestamptz` guardadas en UTC; la conversión a hora de Argentina se hace al mostrar y al agrupar reportes.
  - Nombres de modelos y campos en español, en `PascalCase`/`camelCase`, con `@@map` a tablas en `snake_case`.
- Alternativa descartada: IDs autoincrementales. Exponen el volumen de ventas en las URLs y complican generar IDs fuera del servidor.

### PostgreSQL de desarrollo y de test
- `infra/docker-compose.dev.yml` con un solo servicio `db` (`postgres:18-alpine`), puerto `5432` publicado solo en `127.0.0.1` y un volumen con nombre.
- Un script de inicio (`infra/db/init/01-test-db.sql`) crea una segunda base `kiosco_test` para los tests de integración, separada de los datos de desarrollo.
- Scripts raíz: `pnpm db:up` / `pnpm db:down`. El Compose de producción (con `caddy`, `app` y `waha`) llega con la puesta en marcha y reusa estos nombres.

### Web (`apps/web`)
- React 19 + Vite, **React Router** (modo librería), **TanStack Query** y **Tailwind CSS 4** (plugin `@tailwindcss/vite`, sin `tailwind.config.js`).
- El proxy de Vite manda `/api` a `http://localhost:3000`, así en desarrollo también es mismo origen y las cookies de sesión del próximo cambio funcionan sin CORS.
- Estructura inicial: `src/main.tsx`, `src/app/` (router y QueryClient), `src/pos/` y `src/admin/` vacías con un `README` corto, y una página de inicio que muestra el resultado de `GET /api/health`.

### Calidad
- **ESLint 9** con configuración plana única en la raíz (`typescript-eslint` + `eslint-plugin-react-hooks`) y **Prettier** con `eslint-config-prettier` para que no se pisen.
- **Vitest** con un `vitest.config.ts` por paquete y `pnpm test` en la raíz que corre todos:
  - API: tests de integración con `app.inject()` contra `kiosco_test`.
  - Web: entorno `jsdom` + Testing Library, con un test de la página de inicio usando un `fetch` simulado.
- `pnpm typecheck` corre `tsc --noEmit` en cada paquete.
- Scripts multiplataforma: nada de `rm -rf`, `export` ni `&&` dependiente de bash; se usan `pnpm -r`, `pnpm --parallel` y comandos de Node.

### CI
- GitHub Actions (`.github/workflows/ci.yml`) en `push` y `pull_request`: checkout, Node 24, Corepack, `pnpm install --frozen-lockfile`, lint, typecheck, test y build.
- PostgreSQL 18 como `service` del job, con `kiosco_test` creada por la variable `POSTGRES_DB`.

## Risks / Trade-offs

- [Prisma 7 cambió la configuración (`prisma.config.ts`, adaptadores) y mucha documentación online es de la 6] → seguir la guía oficial de la 7; si el adaptador da problemas, el plan B es fijar Prisma 6 con su configuración clásica y dejarlo anotado en este diseño.
- [`prisma generate` sin modelos puede advertir o fallar según la versión] → si falla, agregar un modelo técnico mínimo no expuesto (por ejemplo `Configuracion` con clave/valor) en vez de adelantar modelos de negocio.
- [Exportar TypeScript sin build en `shared` ata a sus consumidores a herramientas que entienden TS] → los únicos consumidores (Vite, tsx, tsup, Vitest) lo hacen; si aparece otro, se agrega un build con tsup.
- [Windows: fin de línea, rutas y scripts de shell] → `.gitattributes` con `* text=auto eol=lf`, Prettier con `endOfLine: "lf"` y scripts solo con comandos de Node/pnpm. La CI corre en Linux, así que también detecta lo que solo funciona en Windows.
- [Puerto 5432 ocupado por un PostgreSQL local] → el puerto del host se puede cambiar con una variable en el Compose de desarrollo y en `DATABASE_URL`.

## Open Questions

- Ninguna que cambie el alcance. La versión exacta de cada dependencia se fija al instalar (la última estable dentro de las versiones mayores de arriba) y queda en `pnpm-lock.yaml`.
