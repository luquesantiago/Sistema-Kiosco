# Tasks

> Este cambio requiere que `productos-y-proveedores` y `stock` estén implementados y archivados antes de empezar.

## 1. Modelo de datos y utilidades compartidas

- [ ] 1.1 Agregar a `schema.prisma` los enums `MedioPago`, `EstadoVenta`, `TipoNotificacion` y `EstadoNotificacion`, los modelos `Venta`, `ItemVenta`, `PagoVenta` y `Notificacion`, y `ventaId` opcional en `MovimientoStock`, y generar la migración `ventas`; verificar con `pnpm db:migrate` que se crean las tablas, el número correlativo y el único por `(venta_id, medio)`
- [ ] 1.2 Agregar `decimal.js-light` y las funciones de montos de `packages/shared` (`sumar`, `multiplicar`, `restar`, `formatear`) y los esquemas Zod de venta (ítems de catálogo y "Varios", pagos con `montoRecibido`, `totalEsperado`), anulación (motivo de 3 a 200) y listado; verificar con tests unitarios (pago mixto que cierra al centavo, vuelto, "Varios" con precio cero rechazado)
- [ ] 1.3 Agregar `rangoDelDiaEnArgentina` a `src/lib/fechas.ts`; verificar con tests que el día 20/10 en Argentina va de 03:00 UTC del 20 a 03:00 UTC del 21

## 2. Ventas en la API

- [ ] 2.1 Implementar `POST /api/ventas` (agrupar repetidos, precios del servidor, `409 PRODUCTO_NO_DISPONIBLE`, `409 PRECIOS_CAMBIARON`, validación de pagos y vuelto, movimientos `venta` con `registrarMovimiento`, todo en una transacción); verificar con tests de integración los escenarios de "Registro de una venta", "Precios definidos por el servidor", "Ítem Varios con precio libre", "Pagos de una venta", "Vuelto en efectivo" y "Descuento de stock al vender"
- [ ] 2.2 Implementar `GET /api/ventas` y `GET /api/ventas/:id` con la regla de fechas según el rol; verificar con tests los escenarios de "Listado de ventas según el rol"
- [ ] 2.3 Implementar `textoAvisoAnulacion` y `POST /api/ventas/:id/anular` (plazo del empleado en hora de Argentina, `UPDATE ... WHERE estado='pagada'`, movimientos `anulacion`, `Notificacion` pendiente, todo en una transacción); verificar con tests unitarios del texto y de integración los escenarios de "Anulación de ventas" y "Aviso al admin por cada anulación", incluidas dos anulaciones simultáneas que reponen el stock una sola vez
- [ ] 2.4 Implementar `GET /api/notificaciones` (solo admin); verificar con tests los escenarios de la spec `notificaciones`
- [ ] 2.5 Agregar las rutas nuevas al test de rutas protegidas; verificar `401` sin sesión y `403` del empleado en `/api/notificaciones`

## 3. POS en la web

- [ ] 3.1 Implementar el reducer del carrito con persistencia en `sessionStorage`; verificar con tests unitarios agregar, sumar, cambiar cantidad, quitar, vaciar, actualizar precios y restaurar después de una recarga
- [ ] 3.2 Crear la pantalla `/venta` con el campo de escaneo siempre enfocado, la lista de coincidencias por nombre (flechas y Enter), el aviso de código inexistente con sonido, el diálogo "Varios" (F7), la tabla del carrito con selección y el pie de atajos; verificar con tests de Testing Library los escenarios de "Escaneo siempre listo", "Búsqueda por nombre en el mostrador", "Ítem Varios desde el teclado", "Edición del carrito antes de cobrar" y "Atajos visibles"
- [ ] 3.3 Crear el diálogo de cobro (F1 a F4 con un medio, "Paga con" y vuelto para efectivo, F6 pago mixto con "Falta asignar" y confirmación deshabilitada) y el panel "Venta #N cobrada"; manejar `409 PRECIOS_CAMBIARON`; verificar con tests los escenarios de "Cobro rápido con un solo medio", "Pago mixto" y "Después de cobrar"
- [ ] 3.4 Crear el componente `Ticket` con estilos de impresión (`@page`, 58/80 mm según `VITE_ANCHO_TICKET`, `VITE_NOMBRE_KIOSCO`) e imprimir con F9 o con el botón; verificar con un test que el ticket contiene número, ítems, total, pagos, vuelto y "No válido como factura", y que no se llama a `window.print()` si no se pide
- [ ] 3.5 Crear `/ventas` (listado del día, selector de fechas para el admin, detalle, reimprimir, anular con motivo, ventas anuladas tachadas) y `/admin/avisos`, y agregarlos al menú; verificar con tests que el empleado no ve el selector de fechas, que la anulación pide motivo y que el admin ve los avisos

## 4. Pruebas de punta a punta

- [ ] 4.1 Configurar Playwright en `apps/web/e2e/` (Chromium, `webServer` con la API compilada en el puerto 3100 contra `kiosco_test`, `globalSetup` que migra, limpia y siembra un admin, un empleado y productos con contraseñas al azar) y el script `pnpm --filter web e2e`; verificar que corre en local
- [ ] 4.2 Escribir el test del flujo crítico (ingresar como empleado, escanear con repetido, F1 con vuelto, verificar la venta y el stock, anular con motivo, verificar el stock repuesto y el aviso como admin, y que F1 a F4 no disparan acciones del navegador); verificar que pasa en local
- [ ] 4.3 Agregar a la CI un job de e2e que instala Chromium y corre `pnpm --filter web e2e` con PostgreSQL como service; verificar que el job pasa en GitHub

## 5. Verificación manual y documentación

- [ ] 5.1 Verificar en el navegador con la base de desarrollo, usando solo el teclado: una venta en efectivo con vuelto, una con pago mixto, un "Varios", un código inexistente, recargar la página con el carrito armado, imprimir un ticket (vista previa de impresión a 80 mm) y anular una venta como empleado
- [ ] 5.2 Actualizar `docs/requisitos-y-limites.md` (pago mixto, vuelto opcional, ticket a pedido, precios definidos por el servidor, atajos del POS) y `docs/estructura-proyecto.md` (modelo de `Venta`, `ItemVenta`, `PagoVenta` y `Notificacion`, y el flujo de venta con pago mixto); verificar que coinciden con las specs del cambio

## Workflow follow-up

- Archivar el cambio con `/opsx:archive` cuando la CI, incluido el job de e2e, esté en verde.
- Con esto termina la Etapa 1. La Etapa 2 (Caja y puesta en marcha) agrega el turno a `Venta`, el ingreso de caja por ventas sin sistema, el envío de avisos por WAHA, el deploy y los backups.
