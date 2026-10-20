# Design

## Context

Ver `proposal.md` (Why). Restricciones que condicionan las decisiones, tomadas de `docs/`:

- Una sola persona desarrolla y mantiene el sistema.
- App web hosteada; la usan la PC del kiosco (POS con lector HID y teclado) y el celular del admin.
- Integraciones: Mercado Pago (API + webhook, requiere HTTPS público), ARCA (SOAP WSAA/WSFE con certificado), WAHA (contenedor Docker, API HTTP).
- Tarea diaria a las 12:00 en hora de Argentina (UTC−3).
- Datos relacionales y muy estructurados (ventas, ítems, stock, caja).
- Costo de hosting bajo.

## Goals / Non-Goals

**Goals:**
- Un solo lenguaje (TypeScript) en backend y frontend, con tipos compartidos.
- Un único despliegue con Docker Compose que levante todo lo necesario.
- Dejar elegidas las librerías de cada área para que la Etapa 1 arranque sin discusiones pendientes.

**Non-Goals:**
- Crear el esqueleto, `package.json` o configuración de CI (Etapa 1).
- Elegir proveedor de VPS concreto ni comprar dominio.
- Implementar integraciones (ARCA, MP, WAHA): solo se eligen las librerías candidatas.

## Decisions

### 1. Lenguaje: TypeScript en todo el proyecto
Un solo lenguaje para API, frontend y tipos compartidos reduce la carga de mantenimiento. Mercado Pago tiene SDK oficial para Node, y hay librerías para ARCA.
- *Alternativas:* Python/Django (admin incluido, `pyafipws` maduro, pero obliga a dos lenguajes si el POS es SPA); PHP/Laravel (buen ecosistema AFIP, pero menos afinidad con el frontend reactivo del POS).

### 2. Backend: Node.js LTS + Fastify
API REST JSON. Fastify trae validación por esquema, logging con `pino` y un ecosistema de plugins (`@fastify/cookie`, `@fastify/session`, `@fastify/static`). Validación de entradas con **Zod**, con esquemas compartidos con el frontend.
- *Alternativas:* NestJS (más estructura, pero más ceremonia para un solo desarrollador); Express (más simple, pero sin validación ni tipado integrados).

### 3. Frontend: React + Vite (SPA)
- Ruteo con React Router, datos del servidor con TanStack Query, estilos con Tailwind CSS.
- El POS es una vista de escritorio pensada para teclado: un campo de escaneo siempre enfocado que recibe el código + Enter del lector HID.
- Las pantallas de admin (precios, productos, dashboard) son responsive en la misma SPA.
- En producción, Fastify sirve el build estático: un solo contenedor de app y sin CORS.
- *Alternativas:* Next.js (SSR innecesario para una app interna detrás de login y agrega complejidad de despliegue).

### 4. Base de datos: PostgreSQL + Prisma
PostgreSQL por robustez, transacciones (la venta descuenta stock y registra caja en una sola transacción) y `pg_dump` para backups. Prisma para el esquema declarativo, migraciones versionadas y tipos generados.
- Montos en `Decimal` (nunca `float`).
- Fechas guardadas en UTC; se convierten a `America/Argentina/Buenos_Aires` en reportes y turnos.
- *Alternativas:* Drizzle (más liviano, menos maduro en migraciones); SQLite (más simple, pero peor para concurrencia y backups en caliente).

### 5. Autenticación: sesión con cookie httpOnly
Sesiones guardadas en PostgreSQL, cookie `httpOnly`, `secure` y `sameSite=lax`. Contraseñas con **argon2**. Los roles (`admin`, `empleado`) se controlan en un hook de Fastify por ruta.
- *Alternativa:* JWT (se descarta: revocar sesiones es más difícil y no hay clientes de terceros).

### 6. Tarea programada: cron dentro del proceso
Librería **croner** con `timezone: 'America/Argentina/Buenos_Aires'` para el aviso de las 12:00. Además, el contenedor corre con `TZ=America/Argentina/Buenos_Aires`. Cada ejecución queda registrada (fecha y resultado) para no enviar duplicados si el proceso se reinicia.
- *Alternativas:* cron del sistema operativo o una cola tipo BullMQ (requiere Redis y es excesivo para una tarea diaria).

### 7. Integraciones (solo elección de librerías)
- **Mercado Pago:** SDK oficial `mercadopago` (npm). El webhook entra por una ruta pública de Fastify con verificación de firma.
- **ARCA (WSAA/WSFE):** cliente propio y acotado sobre `soap` y `node-forge` (firma CMS del ticket de acceso). Solo se usa Factura C, así que la superficie es chica.
  - *Alternativa:* `@afipsdk/afip.js`. Hoy depende de un servicio intermedio con token propio, así que se deja como plan B.
- **WAHA:** llamadas HTTP directas (`fetch`) a su API REST dentro de la red de Docker Compose.

### 8. Impresión de tickets
Fase inicial: `window.print()` con una hoja de estilos para papel de 58/80 mm y el navegador del kiosco configurado con la térmica como impresora por defecto. Si el diálogo molesta, se evalúa la impresión silenciosa (modo kiosco de Chrome con `--kiosk-printing`) o **QZ Tray** como agente local.

### 9. Infraestructura: VPS + Docker Compose
Servicios: `app` (Fastify + build de React), `db` (PostgreSQL), `waha`, `caddy` (proxy inverso con HTTPS automático de Let's Encrypt). Solo Caddy expone puertos; WAHA y la base quedan en la red interna.
- Backups: `pg_dump` diario comprimido y copiado fuera del servidor (almacenamiento de objetos), con retención de 30 días.
- *Alternativa:* PaaS (Railway, Render). Más simple al principio, pero WAHA necesita persistencia de sesión y un contenedor siempre encendido, que en un VPS resulta más barato.

### 10. Calidad y operación
- Gestor de paquetes: **pnpm** con workspaces.
- Lint y formato: ESLint + Prettier.
- Tests: **Vitest** (unidad e integración de la API contra PostgreSQL de prueba) y **Playwright** para los flujos críticos del POS.
- Logs: `pino` en JSON. Alerta básica si WAHA se desconecta o falla ARCA (canal a definir en la Etapa 4/5).

### 11. Estructura de carpetas (monorepo)
```
/
├── apps/
│   ├── api/            # Fastify: rutas, servicios, jobs, integraciones
│   │   ├── prisma/     # schema.prisma y migraciones
│   │   └── src/
│   │       ├── modules/        # usuarios, productos, proveedores, stock, ventas, caja...
│   │       ├── integrations/   # arca, mercadopago, waha
│   │       └── jobs/           # aviso de reposición 12:00
│   └── web/            # React + Vite: POS y admin
│       └── src/
│           ├── pos/
│           └── admin/
├── packages/
│   └── shared/         # esquemas Zod y tipos compartidos
├── infra/              # docker-compose.yml, Caddyfile, scripts de backup
├── docs/
└── openspec/
```

## Risks / Trade-offs

- [Mantener un cliente SOAP propio para ARCA] → Superficie chica (solo Factura C); se prueba contra homologación antes de producción y queda `@afipsdk/afip.js` como plan B.
- [Un solo VPS es punto único de falla] → Backups diarios fuera del servidor y despliegue reproducible con Docker Compose para restaurar rápido.
- [Cron en proceso: si la app está caída a las 12:00, no sale el aviso] → Registrar cada ejecución y, al arrancar, enviar el aviso del día si ya pasaron las 12:00 y no se envió.
- [`window.print()` muestra diálogo] → Configuración de impresión silenciosa en el navegador del kiosco o QZ Tray si hace falta.
- [SPA sin conexión no funciona] → Se acepta por ahora; la pregunta abierta sobre modo sin conexión sigue en `docs/requisitos-y-limites.md`.

## Open Questions

- Proveedor concreto de VPS y de almacenamiento para backups (no cambia la arquitectura).
- Canal de alertas operativas (WhatsApp vía WAHA, email, etc.), a decidir en la Etapa 4.
