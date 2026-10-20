# Tasks

## 1. Documento del stack

- [x] 1.1 Reescribir `docs/stack-tecnologico.md` con las decisiones de `design.md` (lenguaje, backend, frontend, base de datos, autenticación, tarea programada, integraciones, impresión, infraestructura, calidad) y verificar que no quede ninguna sección marcada como "a definir" salvo las Open Questions
- [x] 1.2 Agregar en `docs/stack-tecnologico.md` una tabla "Alternativas descartadas" con el motivo de cada una y verificar que coincide con las alternativas de `design.md`
- [x] 1.3 Mover a una sección "Pendiente" de `docs/stack-tecnologico.md` las Open Questions (proveedor de VPS/backups y canal de alertas) y verificar que el estado del documento pasa de "en definición" a "definido"

## 2. Estructura del proyecto

- [x] 2.1 Reemplazar la sección "Estructura de carpetas" de `docs/estructura-proyecto.md` por el árbol del monorepo (`apps/api`, `apps/web`, `packages/shared`, `infra/`) con una línea por carpeta y verificar que ya no dice "Pendiente"
- [x] 2.2 Actualizar el diagrama de arquitectura de `docs/estructura-proyecto.md` para mostrar los servicios de Docker Compose (`caddy`, `app`, `db`, `waha`) y verificar que los nombres coinciden con `design.md`

## 3. README

- [x] 3.1 Actualizar `README.md`: quitar "(a definir)" del enlace al stack y agregar un resumen de una línea del stack (TypeScript, Fastify, React + Vite, PostgreSQL + Prisma, Docker Compose), y verificar que todos los enlaces relativos a `docs/` abren un archivo existente

## 4. Revisión final

- [x] 4.1 Revisar que `docs/`, `README.md` y `design.md` no se contradigan (mismas librerías, mismos nombres de servicios y carpetas) y verificar con `openspec validate definir-stack-tecnologico` que el cambio es válido

## Workflow follow-up

- Archivar el cambio con `/opsx:archive` una vez revisada la documentación.
- Proponer el cambio de la Etapa 1 (esqueleto del monorepo, usuarios/roles, productos, proveedores, stock y venta con lector) partiendo de estas decisiones.
