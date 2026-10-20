# Proposal

## Why

El stack ya está decidido (cambio archivado `definir-stack-tecnologico`), pero todavía no hay código: ninguna funcionalidad de la Etapa 1 se puede construir sin un monorepo que compile, se pruebe y levante la base de datos. Además, la exploración de la Etapa 1 resolvió varias preguntas abiertas y cambió el orden de algunas etapas, y la documentación todavía no lo refleja.

## What Changes

- Se crea el **monorepo pnpm** con `apps/api` (Fastify), `apps/web` (React + Vite) y `packages/shared` (esquemas Zod y tipos compartidos), configurado en TypeScript estricto.
- Se configura **Prisma** contra PostgreSQL, sin modelos de negocio (el primer modelo llega con `usuarios-y-roles`). Se fija la convención de IDs UUID, montos `Decimal` y fechas en UTC.
- Se agrega un **Docker Compose de desarrollo** en `infra/` que levanta solo PostgreSQL, con una base para desarrollo y otra para tests.
- La API valida su configuración al arrancar, expone un **chequeo de estado** (`GET /api/health`) que informa si la base de datos responde, y en producción sirve el build de la SPA desde el mismo proceso.
- La web muestra una pantalla inicial que consulta el estado de la API, como prueba de punta a punta de la cadena web -> API -> base.
- Se configuran **calidad y CI**: ESLint + Prettier, chequeo de tipos, Vitest (API contra PostgreSQL de prueba y web) y GitHub Actions que corre todo en cada push y pull request.
- Se actualiza la documentación con las decisiones de la exploración de la Etapa 1:
  - `docs/requisitos-y-limites.md`: se marcan como resueltas las preguntas sobre productos sin código de barras, productos por peso, descuentos y anulaciones, medios de pago y modo sin conexión, con la respuesta acordada.
  - `docs/estructura-proyecto.md`: el modelo de datos borrador incorpora los medios de pago, la anulación, la entidad `Notificacion` y la venta sin turno durante la Etapa 1.
  - `README.md` y `docs/README.md`: la Etapa 1 se divide en 5 cambios y WAHA se adelanta a la Etapa 2 (puesta en marcha).
- **Fuera de alcance:** usuarios, productos, proveedores, stock y ventas (cambios siguientes de la Etapa 1); Dockerfile de producción, deploy en el VPS, Caddy y backups (van con la puesta en marcha en la Etapa 2); Playwright (se configura con `venta-pos`).

## Capabilities

### New Capabilities
- `estado-del-servicio`: chequeo de estado de la API y su base de datos, que usan el desarrollo, la CI y más adelante el monitoreo del VPS.

### Modified Capabilities
<!-- Ninguna: todavía no hay specs en openspec/specs/. -->

## Impact

- **Código:** se crean `package.json`, `pnpm-workspace.yaml`, `apps/api`, `apps/web`, `packages/shared`, `infra/docker-compose.dev.yml` y `.github/workflows/`.
- **Dependencias:** Fastify, Zod, Prisma, pino, React, Vite, React Router, TanStack Query, Tailwind CSS, ESLint, Prettier y Vitest (versiones fijadas en `design.md`).
- **Entorno de desarrollo:** requiere Node.js 24 LTS, pnpm (vía Corepack) y Docker. Los scripts tienen que funcionar en Windows, que es el entorno del desarrollador.
- **Documentación:** `README.md`, `docs/README.md`, `docs/requisitos-y-limites.md`, `docs/estructura-proyecto.md`.
- **Cambios siguientes:** `usuarios-y-roles`, `productos-y-proveedores`, `stock` y `venta-pos` parten de este esqueleto.
