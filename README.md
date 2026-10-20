# Sistema-Kiosco

Sistema de gestión para un kiosco familiar: ventas con lector de código de barras, stock por proveedor, control de caja por turno, avisos diarios de reposición por WhatsApp, facturación electrónica ARCA y dashboard de ventas.

> **Estado:** en desarrollo (Etapa 1). Ya está el esqueleto del monorepo; las funcionalidades se agregan cambio por cambio. La documentación del proyecto está en [`docs/`](docs/).

## Funcionalidades previstas

- **Ventas (POS):** cobro rápido con lector de código de barras; efectivo, débito, crédito y Mercado Pago (integrado con su API).
- **Stock y proveedores:** cada proveedor con sus productos, día de toma de pedido y día de entrega.
- **Caja y turnos:** 2 turnos de 6 horas, apertura, cierre, arqueo y retiros por empleado.
- **Usuarios y roles:** admin y empleado.
- **Dashboard:** ventas, productos más vendidos, ingresos y egresos (usable desde el celular).
- **Reposición:** recomendaciones agrupadas por proveedor, enviadas por WhatsApp ([WAHA](https://waha.devlike.pro/)) todos los días a las 12:00.
- **Facturación:** Factura C electrónica mediante los web services de ARCA/AFIP.

## Etapas

1. Base, en 5 cambios: `esqueleto-monorepo`, `usuarios-y-roles`, `productos-y-proveedores`, `stock` y `venta-pos`. No se usa en el kiosco todavía.
2. Caja y puesta en marcha: turnos, apertura, cierre y arqueo; deploy en el VPS, backups, WAHA y envío de avisos (por ejemplo, de anulaciones)
3. Dashboard
4. Reposición: aviso diario de las 12:00 por WhatsApp
5. Facturación electrónica ARCA e integración con Mercado Pago

## Desarrollo

### Requisitos

- [Node.js 24](https://nodejs.org/) (ver `.nvmrc`).
- pnpm, activado con Corepack, que viene con Node.
- [Docker](https://www.docker.com/) para la base de datos.

### Activar pnpm

```bash
corepack enable
```

En Windows, si Node está instalado en `Program Files`, ese comando necesita una terminal de administrador. Sin admin, se pueden instalar los accesos de pnpm en la carpeta de npm del usuario, que ya está en el PATH:

```bash
corepack enable --install-directory "$APPDATA/npm"
```

### Levantar el proyecto

```bash
pnpm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
pnpm db:up
```

```bash
pnpm dev
```

`pnpm dev` levanta la API en `http://localhost:3000` y la web en `http://localhost:5173`. La página de inicio muestra si la API y la base de datos responden.

Si el puerto 3000 está ocupado, cambiá `PORT` en `apps/api/.env` y levantá la web con `API_PORT` igual a ese puerto. Si el 5173 está ocupado, Vite elige el siguiente libre y lo muestra en la consola.

### Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | API y web en modo desarrollo, con recarga automática |
| `pnpm test` | Tests de la API (contra la base `kiosco_test`) y de la web |
| `pnpm lint` / `pnpm typecheck` | ESLint y chequeo de tipos |
| `pnpm format` | Formatea el código con Prettier |
| `pnpm build` / `pnpm start` | Build de producción; la API sirve la web desde el mismo puerto |
| `pnpm db:up` / `pnpm db:down` | Levanta o detiene PostgreSQL de desarrollo (ver [`infra/`](infra/README.md)) |

## Documentación

- [Visión general](docs/README.md)
- [Estructura del proyecto](docs/estructura-proyecto.md)
- [Requisitos y límites](docs/requisitos-y-limites.md)
- [Stack tecnológico](docs/stack-tecnologico.md): TypeScript, Fastify, React + Vite, PostgreSQL + Prisma y Docker Compose

## Metodología

El desarrollo se organiza con [OpenSpec](https://github.com/Fission-AI/OpenSpec): cada cambio tiene propuesta, diseño, specs y tareas, dentro de [`openspec/`](openspec/). Las etapas grandes se dividen en varios cambios.
