# Proposal

## Why

Vender es lo que hace el kiosco todo el día, y es el último cambio de la Etapa 1. Con productos, proveedores y stock en su lugar, falta la pantalla del mostrador: escanear, cobrar rápido solo con el lector y el teclado, descontar el stock y dejar registrado quién vendió qué y cómo se cobró. También hace falta poder anular una venta mal hecha sin perder el control: queda registrada y se avisa al admin.

## What Changes

- **Punto de venta (POS)** en `/venta`, para admin y empleado, pensado para la PC del kiosco:
  - **Carrito:**
    - Campo de escaneo siempre enfocado: el lector agrega el producto y escanear de nuevo suma una unidad.
    - Búsqueda por nombre para productos sin código, elegida con flechas y Enter.
    - Ítem **"Varios"** con precio libre y descripción opcional, para lo que no está cargado.
    - Cambiar cantidades y quitar ítems antes de cobrar, todo con atajos de teclado.
    - El carrito sobrevive a una recarga accidental de la página.
  - **Cobro:**
    - Un atajo por medio de pago (efectivo, débito, crédito, Mercado Pago) para cobrar el total con un solo medio.
    - **Pago mixto:** repartir el total entre varios medios.
    - **Vuelto opcional:** el empleado puede escribir con cuánto paga el cliente en efectivo y ve el vuelto.
  - **Ticket solo si se pide:** después de cobrar, un botón o atajo imprime el ticket en la térmica (58/80 mm) con `window.print()`. No se imprime solo.
- **Registro de la venta:**
  - Número correlativo, usuario, fecha, ítems y pagos.
  - El precio de cada ítem lo pone el servidor desde el catálogo (salvo "Varios"), y la venta se rechaza si los precios cambiaron mientras se armaba el carrito.
  - El stock se descuenta con movimientos `venta` en la misma operación.
  - La venta no tiene turno todavía: la Etapa 2 lo agrega.
- **Anulación:**
  - El empleado anula ventas del día (en hora de Argentina) y el admin, cualquiera.
  - El motivo es obligatorio.
  - La venta queda `anulada` (nunca se borra), el stock se repone con movimientos `anulacion` y se deja un **aviso pendiente** para el admin con hora, quién anuló, motivo y detalle.
- **Avisos pendientes (`Notificacion`):** cola de mensajes para el admin que el envío por WhatsApp (WAHA, Etapa 2) va a despachar. En la Etapa 1 solo se crean, y el admin los puede ver en una lista.
- **Listado de ventas:**
  - El empleado ve las ventas del día, para encontrar la que tiene que anular o reimprimir.
  - El admin ve todas, filtradas por fecha, con el detalle.
- **Playwright:** primer test de punta a punta del flujo crítico del mostrador (ingresar, escanear, cobrar con vuelto, anular) corriendo en la CI.
- **Fuera de alcance:**
  - Cobro integrado con la API de Mercado Pago y facturación: Etapa 5. Mercado Pago se registra a mano.
  - Turnos, caja y el ingreso por ventas sin sistema: Etapa 2.
  - Envío real de WhatsApp: Etapa 2.
  - Descuentos (no hay) y devoluciones parciales: se anula la venta entera y se hace otra.

## Capabilities

### New Capabilities
- `ventas`: registro de ventas con precios del catálogo, pagos (incluido el mixto), descuento de stock, numeración, listado según el rol y anulación con reposición de stock.
- `punto-de-venta`: comportamiento de la pantalla del mostrador (escaneo, búsqueda, "Varios", carrito, atajos, cobro, vuelto y ticket).
- `notificaciones`: cola de avisos pendientes para el admin, con su texto y su estado de envío.

### Modified Capabilities
<!-- Ninguna. stock (del cambio stock) ya prevé los movimientos venta y anulacion y su registro con registrarMovimiento; este cambio los usa sin modificar sus requisitos. -->

## Impact

- **Depende de** `productos-y-proveedores` y `stock`, que tienen que estar implementados antes: usa `Producto`, la búsqueda por código y nombre, y `registrarMovimiento`.
- **API:**
  - Nuevos módulos `ventas` y `notificaciones`.
  - La venta y la anulación usan `registrarMovimiento` dentro de su transacción.
- **Base de datos:** migración con `Venta`, `ItemVenta`, `PagoVenta` y `Notificacion`, y los enums `MedioPago`, `EstadoVenta` y `EstadoNotificacion`.
- **Shared:** esquemas Zod de venta, pago, anulación y notificación; cálculo de totales y vuelto con aritmética decimal.
- **Web:**
  - Reemplaza la página provisoria `/venta` por el POS.
  - Agrega `/ventas` (listado) y `/admin/avisos`.
  - Hoja de estilos de impresión para el ticket.
- **Calidad:** Playwright en `apps/web/e2e/` y un job en la CI.
- **Docs:** `docs/requisitos-y-limites.md` (pago mixto, vuelto, ticket a pedido, precios del servidor) y `docs/estructura-proyecto.md` (modelo de ventas, pagos y avisos).
