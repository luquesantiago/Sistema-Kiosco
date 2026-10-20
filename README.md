# Sistema-Kiosco

Sistema de gestión para un kiosco familiar: ventas con lector de código de barras, stock por proveedor, control de caja por turno, avisos diarios de reposición por WhatsApp, facturación electrónica ARCA y dashboard de ventas.

> **Estado:** en planificación. Todavía no hay código; la documentación del proyecto está en [`docs/`](docs/).

## Funcionalidades previstas

- **Ventas (POS):** cobro rápido con lector de código de barras; efectivo y Mercado Pago (integrado con su API).
- **Stock y proveedores:** cada proveedor con sus productos, día de toma de pedido y día de entrega.
- **Caja y turnos:** 2 turnos de 6 horas, apertura, cierre, arqueo y retiros por empleado.
- **Usuarios y roles:** admin y empleado.
- **Dashboard:** ventas, productos más vendidos, ingresos y egresos (usable desde el celular).
- **Reposición:** recomendaciones agrupadas por proveedor, enviadas por WhatsApp ([WAHA](https://waha.devlike.pro/)) todos los días a las 12:00.
- **Facturación:** Factura C electrónica mediante los web services de ARCA/AFIP.

## Etapas

1. Base: productos, proveedores, stock, usuarios y venta con lector
2. Caja: turnos, apertura, cierre y arqueo
3. Dashboard
4. Reposición y aviso diario por WhatsApp
5. Facturación electrónica ARCA e integración con Mercado Pago

## Documentación

- [Visión general](docs/README.md)
- [Estructura del proyecto](docs/estructura-proyecto.md)
- [Requisitos y límites](docs/requisitos-y-limites.md)
- [Stack tecnológico](docs/stack-tecnologico.md): TypeScript, Fastify, React + Vite, PostgreSQL + Prisma y Docker Compose

## Metodología

El desarrollo se organiza con [OpenSpec](https://github.com/Fission-AI/OpenSpec): cada etapa es un cambio con propuesta, diseño, specs y tareas, dentro de [`openspec/`](openspec/).
