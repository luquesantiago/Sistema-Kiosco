# Proposal

## Why

El stock, las ventas y la reposición giran alrededor del catálogo de productos y de los proveedores que los traen. Hoy existen usuarios y roles, pero el sistema todavía no sabe qué vende el kiosco, a qué precio ni a quién se le compra. Además, con aumentos de precios frecuentes, el admin necesita actualizar precios rápido, incluso desde el celular, y saber cuándo y cuánto cambió cada uno.

## What Changes

- **Proveedores** (solo admin):
  - Alta, edición y desactivación con nombre, teléfono, notas, **días de toma de pedido** y **días de entrega**. Pueden ser varios días por semana.
  - El listado muestra el teléfono como enlace para llamar desde el celular y marca qué proveedores toman pedido hoy.
- **Productos** (solo admin):
  - Alta, edición y desactivación con código de barras (opcional y único), nombre, precio de venta, costo (opcional), stock mínimo, stock máximo y proveedor (opcional, uno por producto).
  - Los productos nunca se borran, porque las ventas y los movimientos los referencian.
  - El stock actual se muestra pero no se edita acá: arranca en 0 y lo mueve el cambio `stock`.
- **Búsqueda de productos** (admin y empleado):
  - Por código de barras exacto, que es lo que escribe el lector.
  - Por nombre, sin distinguir mayúsculas ni acentos.
  - El empleado ve nombre, código, precio y stock, pero **no** el costo ni el proveedor.
- **Alta rápida escaneando:** si el admin busca un código que no existe, puede crear el producto con ese código ya cargado.
- **Historial de precios:**
  - Cada cambio de precio o de costo queda registrado con usuario, fecha, valores anterior y nuevo, y origen (manual o aumento masivo).
  - El admin lo ve en la ficha del producto.
- **Aumento masivo por porcentaje:**
  - El admin elige un proveedor, o todos los productos, y un porcentaje.
  - Elige un redondeo ($1, $10, $50 o $100) y si también se actualiza el costo.
  - Ve una vista previa con precio actual y nuevo antes de confirmar. Se aplica todo junto o nada.
- **Web:**
  - Pantallas de productos (lista con búsqueda, alta y edición, ficha con historial) y de proveedores.
  - Pantalla de aumento masivo.
  - Todas responsive, usables desde el celular.
- **Fuera de alcance:**
  - Movimientos de stock, ingreso de mercadería y ajustes: cambio `stock`.
  - El ítem "Varios" con precio libre: cambio `venta-pos`.
  - Categorías o rubros.
  - Importar productos desde planillas.
  - Varios proveedores por producto.
  - Recomendaciones de reposición: Etapa 4.

## Capabilities

### New Capabilities
- `proveedores`: datos de cada proveedor, sus días de toma de pedido y de entrega, su teléfono y su desactivación.
- `productos`: catálogo de productos (alta, edición, desactivación), búsqueda por código y por nombre según el rol, historial de precios y aumento masivo por porcentaje.

### Modified Capabilities
<!-- Ninguna: autenticacion y usuarios no cambian; las rutas nuevas usan el control de acceso existente. -->

## Impact

- **API:** nuevos módulos `proveedores` y `productos` en `apps/api/src/modules/`, protegidos con `requiereSesion` y `requiereRol('admin')`.
- **Base de datos:** migración con `Proveedor`, `Producto` y `CambioPrecio`, y el enum `DiaSemana`.
- **Shared:** esquemas Zod de proveedor, producto, búsqueda y aumento masivo.
- **Web:**
  - Pantallas en `/admin/productos` y `/admin/proveedores`.
  - Enlaces en el panel y en el menú del admin.
- **Docs:** `docs/requisitos-y-limites.md` (varios días por proveedor, aumento masivo e historial de precios) y `docs/estructura-proyecto.md` (modelo de datos).
- **Cambios siguientes:** `stock` usa `Producto.stockActual` y `venta-pos` usa la búsqueda por código y por nombre.
