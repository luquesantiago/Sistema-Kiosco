# Design

## Context

- **Ya existe:**
  - `Producto.costo` (nullable). Lo actualizan el ingreso de mercadería cuando el ítem trae costo (`modules/stock/servicio.ts`) y el aumento masivo (`modules/productos/servicio.ts`).
  - `registrarVenta` (`modules/ventas/servicio.ts`) ya lee los productos del carrito dentro de la transacción para validar que estén activos y fijar el precio, y arma `itemsData` con el precio del servidor.
  - `aDetalle` serializa la venta igual para los dos roles. `ventaDetalleSchema` (`packages/shared/src/ventas.ts`) no tiene costo. `POST /api/ventas`, `GET /api/ventas/:id` y la anulación devuelven ese detalle.
  - En productos, el costo se oculta al empleado con dos serializaciones: `aVenta` (sin costo) y `aAdmin` (con costo).
  - `MovimientoCaja` tiene `tipo`, `monto` y `motivo`. `registrarMovimientoCaja` (`modules/caja/servicio.ts`) crea el movimiento y, si es de un empleado y no es un ingreso, crea el aviso con `textoAvisoMovimiento` (`modules/caja/avisos.ts`) en la misma transacción.
  - El diálogo F8 (`pos/Caja.tsx`) elige el tipo con radios y lista los movimientos del turno. `admin/Turnos.tsx` los lista en el detalle del turno.
- Requisitos en `specs/ventas`, `specs/caja` y `specs/notificaciones` de este cambio.

## Goals / Non-Goals

**Goals:**
- Que el dashboard pueda calcular la ganancia con una suma sobre `items_venta`, sin ir al historial de precios.
- Que el empleado no reciba costos en ninguna respuesta de ventas, tampoco en la del registro de la venta.
- Que registrar un gasto siga siendo rápido con teclado en el mostrador.

**Non-Goals:**
- Calcular la ganancia o mostrar reportes (cambio `dashboard`).
- Elegir de qué caja sale el gasto (cambio `cuenta-mercado-pago`).
- Completar el costo de ventas viejas.

## Decisions

### El costo se copia de `Producto.costo` en la misma lectura que el precio
- La consulta de productos de `registrarVenta` suma `costo` al `select`, y cada ítem de catálogo guarda `costoUnitario = producto.costo`. "Varios" guarda `null`.
- Se copia el costo actual del producto y no el del último ingreso: `Producto.costo` ya es el último costo conocido (lo actualizan los ingresos y los aumentos). Además, se lee dentro de la misma transacción que el precio, así que precio y costo son de la misma foto.
- Alternativa descartada: calcular el costo de lo vendido desde `cambios_precio` en el dashboard. Es más lento, se complica con productos sin historial y no da un valor fijo por venta.
- `costo_unitario` es nullable y **no** se rellena en la migración. Las ventas de desarrollo quedan sin costo, como cualquier venta de un producto sin costo.

### El costo sale en el detalle solo para el admin, como en productos
- `ventaDetalleSchema` suma `costoUnitario` **opcional** en cada ítem: `montoSalidaSchema.nullable().optional()`. Para el admin el campo está siempre presente (`null` si no tiene costo). Para el empleado no se envía.
- `aDetalle(venta, { conCostos })`: el servicio decide según el rol del usuario de la sesión, en los tres lugares que devuelven detalle (registrar, obtener y anular). Así, el POS del empleado no recibe el costo ni en la respuesta del `POST`.
- Alternativa descartada: dos schemas separados (`VentaDetalleAdmin` / `VentaDetalle`), como en productos. Cada respuesta usaría uno distinto según el rol, y la serialización de Fastify necesita un schema por ruta. El campo opcional evita duplicar el schema, y el serializador igual quita lo que no está declarado.

### Categoría como enum de Prisma, nullable en la tabla y validada por tipo
- `enum CategoriaGasto { servicios insumos otro }` y `MovimientoCaja.categoria CategoriaGasto?`.
- En la tabla es nullable porque los retiros y los ingresos no la tienen. La regla "obligatoria en gastos, prohibida en lo demás" la valida el schema Zod de entrada: `movimientoCajaEntradaSchema` pasa a ser una unión discriminada por `tipo`, donde `gasto` exige `categoria` y `retiro`/`ingreso` la rechazan (los `400` de la spec).
- Alternativa descartada: un `CHECK` en la base que exija la categoría cuando el tipo es gasto. Es más seguro, pero Prisma no lo expresa y obliga a SQL a mano. El único punto de escritura es `registrarMovimientoCaja`, que ya valida con Zod. Se puede sumar más adelante si aparecen otros puntos de escritura (por ejemplo, `cuenta-mercado-pago`).
- `packages/shared/src/caja.ts` exporta `CATEGORIAS_GASTO` y `NOMBRE_CATEGORIA_GASTO` (`Servicios`, `Insumos`, `Otro`) para que la web y el texto del aviso usen los mismos nombres.

### Botones de categoría en F8, manejables con teclado
- Cuando el tipo es gasto, aparece una fila de tres botones (Servicios, Insumos, Otro) entre el monto y el motivo. Por dentro son un grupo de radios con aspecto de botón, igual que el selector de tipo que ya existe: con el mouse es un toque, y con teclado se llega con Tab y se elige con las flechas.
- Se descartan los atajos de una tecla (1, 2, 3): el foco arranca en el monto, así que esas teclas escribirían números.
- **No hay categoría preseleccionada**: si se registra sin elegir, el diálogo pide elegirla, igual que hoy pide el motivo. Así "Otro" no se llena de gastos mal clasificados por apuro.
- El placeholder del motivo deja de sugerir "pago a proveedor" (eso va a ir por pedidos). Pasa a ser, por ejemplo, "Por ejemplo: bolsas, luz, limpieza".
- En los listados (F8 y Turnos) el gasto se muestra como `Gasto · Insumos: bolsas de camiseta`.

### Texto del aviso
- `DatosAvisoMovimiento` suma `categoria?`. El título del gasto pasa a ser `*Gasto de caja · Insumos: $8.000*`. El retiro no cambia.

## Risks / Trade-offs

- [Mientras no exista `pedidos-proveedor`, un pago a proveedor solo se puede cargar como gasto "Otro"] → El sistema todavía no se usa en el kiosco, y `pedidos-proveedor` es parte de esta misma etapa. Hasta entonces, el dashboard va a contar esos pagos como gasto.
- [Un producto sin costo vende "sin ganancia" para siempre, aunque después se le cargue el costo] → Es lo que decidió el usuario. El dashboard va a mostrar cuánto se vendió sin costo para que se completen los costos pronto.
- [El costo del producto puede estar desactualizado respecto del último remito si no se cargó con costo] → El cambio `pedidos-proveedor` hace que la recepción de cada pedido sea el momento natural de cargar costos.

## Migration Plan

1. Migración Prisma `costo_y_gastos`: crea el enum `CategoriaGasto`, agrega `items_venta.costo_unitario NUMERIC(12,2) NULL` y `movimientos_caja.categoria "CategoriaGasto" NULL`, y ejecuta `UPDATE movimientos_caja SET categoria = 'otro' WHERE tipo = 'gasto'`.
2. No rompe nada para atrás: las columnas son nullable y ninguna ruta existente cambia de forma incompatible. El detalle de ventas solo agrega un campo.
3. Para volver atrás: revertir el commit y bajar las dos columnas y el enum. No hay datos de producción.
