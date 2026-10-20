# Proposal

## Why

Con el catálogo cargado (`productos-y-proveedores`), el stock actual de cada producto está en 0 y nada lo mueve. Para poder controlar faltantes y, más adelante, recomendar reposición y descontar las ventas, cada entrada y salida de mercadería tiene que quedar registrada, con quién la hizo y por qué. También hace falta una forma rápida de cargar lo que llega del proveedor y de corregir el stock después de un conteo o de un corte de luz.

## What Changes

- **Movimientos de stock:**
  - Cada cambio de stock queda como un movimiento con tipo (`compra`, `ajuste`, y más adelante `venta` y `anulacion`), cantidad con signo, stock resultante, motivo, nota, usuario y fecha.
  - El stock actual del producto se actualiza en la misma operación.
  - El stock puede quedar negativo.
  - Los movimientos no se editan ni se borran: un error se corrige con otro movimiento.
- **Ingreso de mercadería** (admin y empleado):
  - Se elige el proveedor (opcional), se escanean o buscan los productos y se cargan las cantidades. Escanear dos veces el mismo producto suma 1.
  - Al confirmar, se registra el ingreso con un movimiento `compra` por producto.
  - **Costo opcional y precargado:** el admin ve el costo actual de cada producto ya cargado y puede cambiarlo; si lo cambia, se actualiza el costo del producto y queda en el historial de precios. El empleado no ve ni carga costos, solo cantidades.
- **Ajustes de stock** (solo admin): sumar o restar unidades de un producto con un motivo obligatorio (`rotura`, `vencimiento`, `robo`, `conteo`, `venta_sin_sistema`, `correccion` u `otro`) y una nota opcional.
- **Conteo rápido** (solo admin): se carga la cantidad contada de un producto y el sistema registra un ajuste por la diferencia.
- **Ventas hechas sin sistema** (solo admin): carga de varios productos con la cantidad vendida durante un corte, que descuenta el stock con motivo `venta_sin_sistema` en una sola operación. El total cobrado se registra como ingreso de caja en la Etapa 2.
- **Historial de movimientos** (solo admin): por producto, del más reciente al más antiguo, y la lista de ingresos de mercadería con su detalle.
- **Web:**
  - `/stock/ingreso` para admin y empleado, pensada para el lector y el teclado en la PC del kiosco.
  - Pantallas de admin para ajustes, conteo, ventas sin sistema e historial, responsive.
- **Fuera de alcance:**
  - Movimientos de venta y de anulación: los genera `venta-pos`.
  - Ingreso de caja por ventas sin sistema: Etapa 2.
  - Recomendaciones y avisos de reposición: Etapa 4.
  - Pedidos a proveedores.
  - Crear productos desde el ingreso: si el empleado escanea un código que no existe, se le avisa que lo cargue el admin.

## Capabilities

### New Capabilities
- `stock`: movimientos de stock, stock actual, ajustes con motivo, conteo, ventas sin sistema e historial de movimientos.
- `ingreso-mercaderia`: registro de la mercadería que llega de un proveedor, con cantidades y, para el admin, costos.

### Modified Capabilities
<!-- Ninguna. productos (del cambio productos-y-proveedores) ya define que el stock actual no se edita en la ficha y que el empleado no ve costos; este cambio respeta esas reglas. -->

## Impact

- **Depende de** `productos-y-proveedores`, que tiene que estar implementado antes: usa `Producto`, `Proveedor`, `CambioPrecio` y la búsqueda de productos.
- **API:** nuevo módulo `stock` en `apps/api/src/modules/`, con un servicio `registrarMovimiento` que `venta-pos` va a reutilizar.
- **Base de datos:** migración con `MovimientoStock`, `IngresoMercaderia` e `ItemIngreso`, y los enums `TipoMovimiento` y `MotivoAjuste`.
- **Shared:** esquemas Zod de movimientos, ajustes, conteo, ventas sin sistema e ingresos.
- **Web:**
  - Enlace "Ingreso de mercadería" en el menú de admin y empleado.
  - Pantallas de stock en el admin.
- **Docs:** `docs/requisitos-y-limites.md` (quién carga ingresos, costo opcional, motivos de ajuste) y `docs/estructura-proyecto.md` (modelo de stock e ingresos).
