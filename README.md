# Sistema-Kiosco

Sistema de gestión para un kiosco familiar: ventas con lector de código de barras, stock por proveedor, control de caja por turno, avisos diarios de reposición por WhatsApp, facturación electrónica ARCA y dashboard de ventas.

> **Estado:** en desarrollo. Las Etapas 1, 2 y 3 están terminadas en código: hay ventas, stock, caja por turno, avisos al admin por WhatsApp, pedidos a proveedor y dashboard. La instalación en el servidor se hace cuando el sistema esté completo. Las funcionalidades se agregan cambio por cambio. La documentación del proyecto está en [`docs/`](docs/).

## Funcionalidades previstas

- **Ventas (POS):** cobro rápido con lector de código de barras; efectivo, débito, crédito y Mercado Pago (integrado con su API).
- **Stock y proveedores:** cada proveedor con sus productos, día de toma de pedido y día de entrega.
- **Caja y turnos:** 2 turnos de 6 horas, apertura, cierre, arqueo y retiros por empleado.
- **Avisos al admin por WhatsApp:** anulaciones, gastos y retiros de los empleados y el resumen de cada cierre de turno, desde un chip dedicado que se vincula por QR desde el sistema.
- **Usuarios y roles:** admin y empleado.
- **Dashboard:** ventas, productos más vendidos, ingresos y egresos (usable desde el celular).
- **Reposición:** recomendaciones agrupadas por proveedor, enviadas por WhatsApp ([WAHA](https://waha.devlike.pro/)) todos los días a las 12:00.
- **Facturación:** Factura C electrónica mediante los web services de ARCA/AFIP.

## Etapas

1. ✅ **Base**, en 5 cambios: `esqueleto-monorepo`, `usuarios-y-roles`, `productos-y-proveedores`, `stock` y `venta-pos`. Terminada y unida a `main`.
2. 🚧 **Caja y puesta en marcha** (rama `etapa-2`), en 3 cambios. Todo el código está terminado; solo falta la instalación en el servidor:
   - ✅ `caja-y-turnos`: turnos, apertura, cierre ciego, arqueo, gastos y retiros.
   - 🚧 `puesta-en-marcha`: imagen y Compose de producción con Caddy, deploy con script y backups diarios a Google Drive. Está implementado; falta instalarlo en el Cloud Server de DonWeb y configurar los backups con la cuenta del dueño. Se deja para cuando el sistema esté completo, así no se paga el servidor antes.
   - ✅ `envio-whatsapp`: WAHA y envío de avisos al admin (anulaciones, gastos, retiros y resumen de cada cierre), con vinculación del chip por QR desde **Administración → WhatsApp**. Probado con el chip.
3. ✅ **Dashboard** (rama `etapa-3`), en 4 cambios, todos implementados:
   - ✅ `costo-y-gastos`: costo guardado en cada venta y categoría de los gastos.
   - ✅ `cuenta-mercado-pago`: efectivo y cuenta de MP separados; devoluciones siempre en efectivo.
   - ✅ `pedidos-proveedor`: pedidos, recepción en dos tiempos, pagos ahora o después y recordatorios en el POS.
   - ✅ `dashboard`: ventas, ganancia, gastos, resultado, más vendidos, efectivo en caja y pendiente de pagar.
4. Reposición: aviso diario de las 12:00 por WhatsApp
5. Facturación electrónica ARCA e integración con Mercado Pago

## Desarrollo

### Requisitos

- [Node.js 24](https://nodejs.org/) (ver `.nvmrc`).
- pnpm, activado con Corepack, que viene con Node.
- [Docker](https://www.docker.com/) para la base de datos (y WhatsApp, si se quieren probar los avisos).

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
pnpm db:migrate
```

Aplica las migraciones a la base de desarrollo. Hay que repetirlo cada vez que se agregan migraciones nuevas.

```bash
pnpm --filter api usuarios:crear-admin --usuario admin --nombre "Tu nombre"
```

Crea el primer admin; la contraseña se pide por consola sin mostrarla. Sin ese admin nadie puede entrar a la web. Los demás usuarios los crea el admin desde **Usuarios**.

```bash
pnpm dev
```

`pnpm dev` levanta la API en `http://localhost:3000` y la web en `http://localhost:5173`. Ingresá con el admin: el panel de administración muestra si la API y la base de datos responden.

Si el puerto 3000 está ocupado, cambiá `PORT` en `apps/api/.env` y levantá la web con `API_PORT` igual a ese puerto. Si el 5173 está ocupado, Vite elige el siguiente libre y lo muestra en la consola.

Los avisos por WhatsApp son opcionales en desarrollo: sin WAHA quedan pendientes y se ven en **Avisos**. Para probarlos con el chip, ver [WhatsApp de desarrollo](infra/README.md#whatsapp-de-desarrollo).

### Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | API y web en modo desarrollo, con recarga automática |
| `pnpm test` | Tests de la API (contra la base `kiosco_test`) y de la web |
| `pnpm lint` / `pnpm typecheck` | ESLint y chequeo de tipos |
| `pnpm format` | Formatea el código con Prettier |
| `pnpm build` / `pnpm start` | Build de producción; la API sirve la web desde el mismo puerto |
| `pnpm db:up` / `pnpm db:down` | Levanta o detiene PostgreSQL de desarrollo (ver [`infra/`](infra/README.md)) |
| `pnpm whatsapp:up` / `pnpm whatsapp:down` | Levanta o detiene WhatsApp (WAHA) de desarrollo, para probar los avisos con el chip (ver [`infra/`](infra/README.md#whatsapp-de-desarrollo)) |
| `pnpm db:migrate` | Crea y aplica migraciones en desarrollo (`prisma migrate dev`) |
| `pnpm db:deploy` | Aplica las migraciones pendientes sin crear nuevas (`prisma migrate deploy`) |
| `pnpm --filter api usuarios:crear-admin` | Crea un usuario admin desde la consola |

## Documentación

- [Visión general](docs/README.md)
- [Estructura del proyecto](docs/estructura-proyecto.md)
- [Requisitos y límites](docs/requisitos-y-limites.md)
- [Stack tecnológico](docs/stack-tecnologico.md): TypeScript, Fastify, React + Vite, PostgreSQL + Prisma y Docker Compose

## Metodología

El desarrollo se organiza con [OpenSpec](https://github.com/Fission-AI/OpenSpec): cada cambio tiene propuesta, diseño, specs y tareas, dentro de [`openspec/`](openspec/). Las etapas grandes se dividen en varios cambios.
