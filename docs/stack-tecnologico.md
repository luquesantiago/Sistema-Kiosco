# Stack tecnológico

> **Estado:** definido. La justificación completa de cada decisión está en el `design.md` del cambio de OpenSpec `definir-stack-tecnologico` (en `openspec/changes/`, o en `openspec/changes/archive/` una vez archivado).

## Resumen

| Área | Decisión | Notas |
|---|---|---|
| Tipo de aplicación | Web, hosteada en un servidor | Se accede por navegador desde la PC del kiosco y el celular |
| Lenguaje | **TypeScript** en backend y frontend | Tipos y esquemas compartidos entre ambos |
| Backend | **Node.js LTS + Fastify** (API REST JSON) | Validación con **Zod**, logs con `pino` |
| Frontend | **React + Vite** (SPA) | React Router, TanStack Query, Tailwind CSS |
| Base de datos | **PostgreSQL + Prisma** | Migraciones versionadas; montos en `Decimal`; fechas en UTC |
| Autenticación | Sesión con cookie `httpOnly` | Sesiones en PostgreSQL, contraseñas con **argon2**, roles por ruta |
| Tarea programada | **croner** dentro del proceso | Zona horaria `America/Argentina/Buenos_Aires` |
| Pagos | SDK oficial **`mercadopago`** (npm) | Webhook en una ruta pública con verificación de firma |
| Facturación | **ARCA/AFIP, WSAA + WSFE** con cliente propio | Sobre `soap` y `node-forge`; solo Factura C |
| WhatsApp | **WAHA** (WhatsApp HTTP API) | Llamadas HTTP directas dentro de la red de Docker Compose |
| Lector de código de barras | USB en modo HID (teclado) | No requiere drivers ni integración |
| Impresora | Térmica de tickets (58 u 80 mm), no fiscal | `window.print()` con estilos para papel de ticket |
| Infraestructura | **VPS + Docker Compose** | Servicios `caddy`, `app`, `db`, `waha` |
| Paquetes | **pnpm** con workspaces (monorepo) | Ver [estructura de carpetas](estructura-proyecto.md#estructura-de-carpetas) |
| Calidad | ESLint + Prettier, **Vitest**, **Playwright** | |

## Detalle por área

### Backend
- Node.js LTS con **Fastify**: validación por esquema, logging integrado y plugins (`@fastify/cookie`, `@fastify/session`, `@fastify/static`).
- Validación de entradas con **Zod**; los esquemas viven en `packages/shared` y los usa también el frontend.
- Expone la API para el frontend, recibe los webhooks de Mercado Pago, corre la tarea de las 12:00 y consume los SOAP de ARCA.

### Frontend
- **React + Vite**, con React Router, TanStack Query y Tailwind CSS.
- **POS:** vista de escritorio pensada para teclado, con un campo de escaneo siempre enfocado que recibe el código + Enter del lector.
- **Admin** (precios, productos, dashboard): responsive, dentro de la misma SPA.
- En producción, Fastify sirve el build estático: un solo contenedor de app y sin CORS.

### Base de datos
- **PostgreSQL**: transacciones (la venta descuenta stock y registra la caja en una sola operación) y backups con `pg_dump`.
- **Prisma**: esquema declarativo, migraciones versionadas y tipos generados.
- Montos en `Decimal` (nunca `float`). Fechas guardadas en UTC y convertidas a hora de Argentina en turnos y reportes.

### Autenticación
- Sesiones guardadas en PostgreSQL; cookie `httpOnly`, `secure` y `sameSite=lax`.
- Contraseñas con **argon2**.
- Roles `admin` y `empleado`, controlados con un hook de Fastify por ruta.

### Tarea programada (aviso de las 12:00)
- **croner** con `timezone: 'America/Argentina/Buenos_Aires'`; el contenedor corre además con `TZ=America/Argentina/Buenos_Aires`.
- Cada ejecución queda registrada (fecha y resultado) para no enviar duplicados.
- Si la app estuvo caída a las 12:00, al arrancar envía el aviso del día si todavía no salió.

### Integraciones
- **Mercado Pago:** SDK oficial `mercadopago`. El webhook entra por una ruta pública de Fastify con verificación de firma.
- **ARCA (WSAA/WSFE):** cliente propio y acotado sobre `soap` y `node-forge` (firma CMS del ticket de acceso). Se prueba en homologación antes de producción. Plan B: `@afipsdk/afip.js`.
- **WAHA:** `fetch` a su API REST dentro de la red interna de Docker Compose.

### Impresión de tickets
- Fase inicial: `window.print()` con una hoja de estilos para papel de 58/80 mm y la térmica como impresora por defecto del navegador del kiosco.
- Si el diálogo de impresión molesta: impresión silenciosa (Chrome con `--kiosk-printing`) o **QZ Tray** como agente local.
- El comprobante con CAE y QR de ARCA se define en la etapa de facturación.

### Hosting / infraestructura
- Un **VPS** con **Docker Compose**:
  - `caddy`: proxy inverso con HTTPS automático (Let's Encrypt). Es el único servicio que expone puertos.
  - `app`: Fastify + build de React.
  - `db`: PostgreSQL.
  - `waha`: WhatsApp HTTP API, con la sesión persistida en un volumen.
- Dominio con HTTPS, necesario para los webhooks de Mercado Pago.
- **Backups:** `pg_dump` diario comprimido, copiado fuera del servidor (almacenamiento de objetos), con retención de 30 días.

### Calidad y operación
- **pnpm** con workspaces.
- **ESLint + Prettier** para lint y formato.
- **Vitest** para tests unitarios y de integración de la API contra un PostgreSQL de prueba; **Playwright** para los flujos críticos del POS.
- Logs en JSON con `pino`; alerta básica si WAHA se desconecta o falla ARCA.
- Control de versiones en git, con cambios organizados por OpenSpec.

## Alternativas descartadas

| Área | Alternativa | Motivo |
|---|---|---|
| Lenguaje | Python + Django | Admin incluido y `pyafipws` maduro, pero obliga a dos lenguajes si el POS es una SPA |
| Lenguaje | PHP + Laravel | Buen ecosistema AFIP, pero menos afinidad con el frontend reactivo del POS |
| Backend | NestJS | Más estructura, pero más ceremonia para un solo desarrollador |
| Backend | Express | Más simple, pero sin validación ni tipado integrados |
| Frontend | Next.js | SSR innecesario para una app interna detrás de login; complica el despliegue |
| ORM | Drizzle | Más liviano, pero menos maduro en migraciones |
| Base de datos | SQLite | Más simple, pero peor para concurrencia y backups en caliente |
| Autenticación | JWT | Revocar sesiones es más difícil y no hay clientes de terceros |
| Tarea programada | Cron del sistema operativo | Queda fuera del código y del despliegue con Docker Compose |
| Tarea programada | Cola tipo BullMQ | Requiere Redis; excesivo para una tarea diaria |
| Facturación | `@afipsdk/afip.js` como opción principal | Depende de un servicio intermedio con token propio; queda como plan B |
| Hosting | PaaS (Railway, Render) | WAHA necesita sesión persistente y un contenedor siempre encendido; en un VPS es más barato |

## Pendiente

Decisiones que no cambian la arquitectura y se toman más adelante:

- [ ] Proveedor concreto de VPS y de almacenamiento para los backups.
- [ ] Canal de las alertas operativas (WhatsApp vía WAHA, email, etc.), a decidir en la Etapa 4.

## Criterios usados para decidir

- Fácil de mantener por una sola persona.
- Buen soporte de librerías para ARCA y Mercado Pago.
- Costo de hosting bajo.
- Ecosistema conocido por quien lo va a desarrollar.
