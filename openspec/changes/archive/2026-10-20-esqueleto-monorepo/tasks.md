# Tasks

## 1. Monorepo y herramientas base

- [x] 1.1 Crear `package.json` raíz (privado, `"type": "module"`, `packageManager` con pnpm 10, `engines.node` >= 24), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `.nvmrc`, `.gitattributes` (`* text=auto eol=lf`) y `tsconfig.base.json` estricto; verificar que `corepack enable` + `pnpm install` terminan sin errores en Windows
- [x] 1.2 Configurar ESLint 10 (config plana con `typescript-eslint`, `eslint-plugin-react-hooks` y `eslint-config-prettier`) y Prettier (`endOfLine: "lf"`) en la raíz, con scripts `lint` y `format`; verificar que `pnpm lint` pasa sobre el repo
- [x] 1.3 Agregar scripts raíz `dev`, `build`, `test`, `typecheck`, `db:up` y `db:down` usando solo comandos de pnpm/Node (sin sintaxis de bash); verificar que `pnpm run` los lista y que ninguno usa `rm`, `export` ni variables al estilo `VAR=x`

## 2. Paquete compartido

- [x] 2.1 Crear `packages/shared` (`@kiosco/shared`) con `exports` apuntando a `src/index.ts`, dependencia de Zod y el esquema/tipo de la respuesta del chequeo de estado (`estado`, `baseDeDatos`, `hora`) y del formato de error (`error.codigo`, `error.mensaje`); verificar con `pnpm --filter @kiosco/shared typecheck`

## 3. Base de datos de desarrollo

- [x] 3.1 Crear `infra/docker-compose.dev.yml` con el servicio `db` (`postgres:18-alpine`, puerto publicado solo en `127.0.0.1`, puerto del host configurable, volumen con nombre) e `infra/db/init/01-test-db.sql` que crea `kiosco_test`; verificar que `pnpm db:up` levanta el contenedor y que existen las bases de desarrollo y `kiosco_test`
- [x] 3.2 Documentar en `infra/README.md` cómo levantar, bajar y resetear la base de desarrollo; verificar que los comandos escritos funcionan tal cual

## 4. API

- [x] 4.1 Crear `apps/api` con Fastify 5, `fastify-type-provider-zod`, tsx (dev) y tsup (build), separando `src/app.ts` (arma la instancia) de `src/server.ts` (escucha); verificar que `pnpm --filter api dev` arranca y escucha en el puerto configurado
- [x] 4.2 Implementar `src/config.ts` que valida `DATABASE_URL`, `PORT`, `NODE_ENV` y `LOG_LEVEL` con Zod y termina el proceso con código 1 nombrando la variable inválida; agregar `.env.example`; verificar con un test que una configuración sin `DATABASE_URL` es rechazada y que el mensaje no incluye valores de otras variables
- [x] 4.3 Configurar Prisma 7 (`prisma.config.ts`, `@prisma/adapter-pg`, `schema.prisma` sin modelos con las convenciones de IDs UUID v7, `Decimal(12,2)`, `Int` para cantidades, `Timestamptz` y nombres en español con `@@map` escritas como comentario) y `prisma generate` en `postinstall`; verificar que `pnpm install` genera el cliente (si falla sin modelos, aplicar el plan B de `design.md` y anotarlo)
- [x] 4.4 Agregar el manejo de errores común (`400 VALIDACION`, `404 NO_ENCONTRADO` para `/api/*`, `500 ERROR_INTERNO` con el detalle solo en el log) y verificar con tests de `app.inject()` que `GET /api/no-existe` responde `404` JSON con el formato de error
- [x] 4.5 Implementar `GET /api/health` en `src/modules/estado/` con `SELECT 1` y timeout de 2 s, según la spec `estado-del-servicio`; verificar con tests de integración contra `kiosco_test` los casos `200 ok`, base caída (`503 degradado`) y base colgada (responde en menos de 3 s)
- [x] 4.6 Servir el build de la web con `@fastify/static` y fallback a `index.html` para rutas que no empiezan con `/api` cuando existe `apps/web/dist`; verificar con un test que `/` devuelve HTML y `/api/no-existe` sigue devolviendo JSON

## 5. Web

- [x] 5.1 Crear `apps/web` con React 19, Vite, React Router, TanStack Query y Tailwind CSS 4 (`@tailwindcss/vite`), con proxy de `/api` a `http://localhost:3000` y carpetas `src/app/`, `src/pos/` y `src/admin/`; verificar que `pnpm --filter web dev` abre la página sin errores en consola
- [x] 5.2 Crear la página de inicio que consulta `GET /api/health` con TanStack Query y muestra "API ok / base ok" o el error; verificar con un test de Vitest + Testing Library (jsdom, `fetch` simulado) los estados ok y degradado

## 6. Integración y CI

- [x] 6.1 Verificar de punta a punta en local: `pnpm db:up`, `pnpm dev` y la página de inicio muestra la base como ok; con la base bajada (`pnpm db:down`) muestra el estado degradado
- [x] 6.2 Verificar el modo producción en local: `pnpm build` y luego arrancar la API compilada con `NODE_ENV=production` sirve la web en `/` y la API en `/api/health` desde el mismo puerto
- [x] 6.3 Crear `.github/workflows/ci.yml` (Node 24, pnpm/action-setup, `pnpm install --frozen-lockfile`, lint, typecheck, test, build, con PostgreSQL 18 como service y `kiosco_test`); verificar que el workflow corre en verde en GitHub en la rama del cambio

## 7. Documentación

- [x] 7.1 Actualizar `README.md`: estado "en desarrollo (Etapa 1)", requisitos (Node 24, Corepack/pnpm, Docker) y los comandos para levantar el proyecto (`pnpm install`, `pnpm db:up`, `pnpm dev`, `pnpm test`); verificar siguiendo los pasos desde un clon limpio
- [x] 7.2 Actualizar las etapas en `README.md` y `docs/README.md`: la Etapa 1 se divide en los cambios `esqueleto-monorepo`, `usuarios-y-roles`, `productos-y-proveedores`, `stock` y `venta-pos`; la Etapa 2 (Caja) es la puesta en marcha e incluye deploy, backups, WAHA y el envío de notificaciones pendientes; la Etapa 4 solo agrega el aviso de reposición; verificar que ambos archivos dicen lo mismo
- [x] 7.3 Marcar como resueltas en `docs/requisitos-y-limites.md` las preguntas abiertas, con la respuesta acordada, y llevar las respuestas a los requisitos correspondientes; verificar que las preguntas restantes (modalidad de Mercado Pago, fiado, número de WhatsApp, notas de crédito) siguen abiertas. Respuestas:
  - Sin conexión: no hay modo sin conexión. Durante un corte el empleado anota en papel; después el admin descuenta el stock de lo vendido (ajuste con motivo "venta sin sistema", varios productos de una vez) y registra el total cobrado como ingreso de caja (Etapa 2).
  - Medios de pago: efectivo, débito, crédito y transferencia. La transferencia se recibe por Mercado Pago y se registra como medio `mercado_pago` (con la factura automática que exige el requisito de facturación, en la Etapa 5).
  - Productos sin código de barras: el código es opcional, se buscan por nombre y existe un ítem "Varios" con precio libre.
  - Productos por peso: no hay; cantidades y stock son enteros.
  - Descuentos: no hay.
  - Anulaciones: las puede hacer el empleado, solo sobre ventas del día (luego, del turno abierto), con motivo obligatorio; la venta queda `anulada` (nunca se borra), se repone el stock y se avisa al admin por WhatsApp con la hora y el detalle. Las ventas anteriores solo las anula el admin.
  - Stock negativo: permitido (no bloquea la venta).
- [x] 7.4 Actualizar el modelo de datos de `docs/estructura-proyecto.md`: medios de pago `efectivo`/`debito`/`credito`/`mercado_pago`; `Venta` con motivo, usuario y fecha de anulación y turno opcional durante la Etapa 1 (obligatorio desde la Etapa 2); `MovimientoStock` con tipos `venta`, `compra`, `ajuste` y `anulacion`; `Producto` con código de barras opcional; nueva entidad `Notificacion` (destino, texto, estado pendiente/enviada/error, fechas); convención de IDs UUID; y en la sección del servicio `waha`, que se suma en la Etapa 2; verificar que no contradice `design.md` ni `docs/requisitos-y-limites.md`

## Workflow follow-up

- Archivar el cambio con `/opsx:archive` cuando la CI esté en verde y la documentación revisada.
- Proponer el siguiente cambio de la Etapa 1: `usuarios-y-roles`.
