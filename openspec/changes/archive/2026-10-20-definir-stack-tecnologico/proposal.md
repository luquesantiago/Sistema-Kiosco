# Proposal

## Why

El proyecto está en planificación y [`docs/stack-tecnologico.md`](../../../docs/stack-tecnologico.md) deja casi todo "a definir". Sin un stack decidido no se puede arrancar la Etapa 1 (Base) ni definir la estructura de carpetas. Este cambio cierra esas decisiones antes de escribir código.

## What Changes

- Se adopta un stack **TypeScript full-stack**:
  - Backend: Node.js LTS + Fastify, con API REST.
  - Frontend: React + Vite (POS de escritorio y pantallas de admin responsive).
  - Base de datos: PostgreSQL con Prisma como ORM y migraciones.
  - Infraestructura: Docker Compose en un VPS (app, PostgreSQL, WAHA) detrás de un proxy con HTTPS.
- Se definen las decisiones secundarias: autenticación (sesión con cookie httpOnly), tarea programada de las 12:00 (cron en proceso con zona horaria `America/Argentina/Buenos_Aires`), librerías candidatas para ARCA y Mercado Pago, impresión de tickets, testing, logs y backups.
- Se define la **estructura de carpetas** del repositorio (monorepo con workspaces).
- Se actualizan `docs/stack-tecnologico.md`, la sección de estructura de carpetas de `docs/estructura-proyecto.md` y el `README.md`.
- **Fuera de alcance:** crear el esqueleto del proyecto, instalar dependencias o escribir código de negocio. Eso queda para el cambio de la Etapa 1.

## Capabilities

### New Capabilities
<!-- Ninguna: el cambio solo documenta decisiones técnicas y no cambia comportamiento del sistema (skip_specs: true). -->

### Modified Capabilities
<!-- Ninguna. -->

## Impact

- **Documentación:** `docs/stack-tecnologico.md`, `docs/estructura-proyecto.md`, `README.md`.
- **Código:** ninguno (todavía no existe).
- **Cambios siguientes:** la Etapa 1 parte de estas decisiones y de la estructura de carpetas definida acá.
