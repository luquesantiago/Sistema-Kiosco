# Design

## Context

- **Este cambio se implementa después de `productos-y-proveedores`**, que agrega:
  - `Producto`, con `stockActual Int @default(0)` y la regla de que no se edita en la ficha.
  - `Proveedor`, `CambioPrecio` (origen `manual` o `aumento_masivo`) y los montos como texto decimal.
  - La búsqueda `GET /api/productos?q=`, que responde según el rol.
- **Ya existe:**
  - Sesiones y roles, con `requiereSesion` y `requiereRol` como `preValidation`.
  - `ErrorHttp` y el formato de error común.
  - Tests contra `kiosco_test` con `limpiarBase()` y el reloj `ahora()`.
  - El test que verifica que todas las rutas de `/api` exigen sesión.
- **Requisitos:** ver `specs/stock` y `specs/ingreso-mercaderia`.

## Goals / Non-Goals

**Goals:**
- Un único punto de entrada para mover stock (`registrarMovimiento`) que `venta-pos` reutilice dentro de su propia transacción.
- Stock actual siempre consistente con los movimientos, aun con dos usuarios a la vez.
- Una pantalla de ingreso que el empleado use solo con el lector y el teclado.

**Non-Goals:**
- Recalcular el stock sumando movimientos en cada lectura: el stock actual guardado es la fuente rápida y los movimientos son el registro.
- Valuación de inventario o costo promedio ponderado.

## Decisions

### Modelo de datos
- **`TipoMovimiento`:** enum `compra`, `ajuste`, `venta` y `anulacion`. `venta` y `anulacion` se crean ahora para no migrar el enum en `venta-pos`.
- **`MotivoAjuste`:** enum `rotura`, `vencimiento`, `robo`, `conteo`, `venta_sin_sistema`, `correccion` y `otro`.
- **`MovimientoStock`** (`movimientos_stock`):
  - `id`, `productoId`, `tipo`, `motivo MotivoAjuste?`, `cantidad Int` (con signo) y `stockResultante Int`.
  - `nota?`, `usuarioId`, `ingresoId?` y `creadoEn`.
  - Índice por `(productoId, creadoEn)`.
- **`IngresoMercaderia`** (`ingresos_mercaderia`): `id`, `proveedorId?`, `usuarioId`, `nota?` y `creadoEn`.
- **`ItemIngreso`** (`items_ingreso`): `id`, `ingresoId`, `productoId`, `cantidad Int` y `costoUnitario Decimal(12,2)?`. El costo solo se guarda si lo cargó el admin.
- **Reglas de datos:**
  - `motivo` es obligatorio cuando `tipo = ajuste` y vacío en los demás tipos. Lo valida el servicio, porque Prisma no expresa restricciones condicionales.
  - Los movimientos no tienen rutas de edición ni de borrado. Las relaciones usan `onDelete: Restrict`, así que tampoco se borran en cascada.

### `registrarMovimiento`: incremento atómico dentro de la transacción
- **Firma:** `registrarMovimiento(tx, { productoId, tipo, cantidad, motivo?, nota?, usuarioId, ingresoId? })` recibe el cliente de la transacción en curso.
- **Cómo actualiza el stock:** hace `UPDATE productos SET stock_actual = stock_actual + $cantidad WHERE id = $id RETURNING stock_actual` (con `tx.producto.update({ data: { stockActual: { increment } } })`) y usa el valor devuelto como `stockResultante` al crear el movimiento.
- **Por qué:** el `UPDATE` bloquea la fila del producto hasta que termina la transacción, así que dos movimientos simultáneos se ordenan solos y cada `stockResultante` es correcto. No hace falta nivel `Serializable` ni leer antes de escribir.
- **Alternativa descartada:** leer el stock, sumar en la aplicación y escribir. Con dos usuarios a la vez se pierde una de las actualizaciones.
- **Producto desactivado:** si el producto no existe o está desactivado, el servicio lanza `404 PRODUCTO_NO_ENCONTRADO` y la transacción se revierte. Es un error de datos, no de stock: el stock negativo sí se permite.

### Ingreso de mercadería
- **Ruta:** `POST /api/stock/ingresos` (admin y empleado), con body `{ proveedorId?, nota?, items: [{ productoId, cantidad, costoUnitario? }] }`.
- **Validación:**
  - `items` no puede estar vacío y tiene como máximo 200 productos.
  - La cantidad es un entero entre 1 y 100.000.
  - Si quien carga es un empleado y algún ítem trae `costoUnitario`, se responde `400 COSTO_NO_PERMITIDO`.
- **Productos repetidos:** se agrupan por `productoId` sumando cantidades. Si hay costos distintos para el mismo producto, gana el último.
- **Transacción:** en una sola transacción se hace todo esto:
  - Se crea el ingreso y sus ítems.
  - Se llama a `registrarMovimiento` con tipo `compra` para cada producto.
  - Para cada ítem del admin cuyo costo difiere del actual (comparado con `Decimal.equals`), se actualiza `Producto.costo` y se crea un `CambioPrecio` con origen `manual`, precio sin cambios y costo anterior y nuevo.
- **Consultas** (solo admin): `GET /api/stock/ingresos` (paginado de a 50) y `GET /api/stock/ingresos/:id`.

### Ajustes, conteo y ventas sin sistema (solo admin)
- **`POST /api/stock/ajustes`:** `{ productoId, cantidad (≠ 0), motivo, nota? }`. Si `motivo = otro`, la nota es obligatoria (validado con Zod).
- **`POST /api/stock/conteos`:** `{ productoId, cantidadContada (≥ 0) }`.
  - Dentro de la transacción bloquea la fila (`SELECT ... FOR UPDATE` con `$queryRaw`), calcula `diferencia = contada - stockActual` y, si no es 0, llama a `registrarMovimiento` con tipo `ajuste` y motivo `conteo`.
  - Responde `{ diferencia, stockActual }`.
  - El bloqueo explícito hace falta porque acá sí se lee antes de escribir.
- **`POST /api/stock/ventas-sin-sistema`:** `{ nota?, items: [{ productoId, cantidad > 0 }] }`. En una transacción, un movimiento `ajuste` con cantidad negativa y motivo `venta_sin_sistema` por producto (agrupando repetidos).
- **`GET /api/stock/productos/:id/movimientos`:** historial paginado de a 50, con el nombre del usuario.
- **Errores nuevos:** `PRODUCTO_NO_ENCONTRADO` (404) y `COSTO_NO_PERMITIDO` (400).

### Búsqueda de productos en el ingreso
- **Se reutiliza** `GET /api/productos?q=` de `productos-y-proveedores`, que responde según el rol:
  - El empleado no recibe el costo, así que la pantalla no puede mostrarlo.
  - El admin sí lo recibe y lo usa para precargar el campo.
- **No hace falta una ruta nueva.**

### Web
- **`/stock/ingreso`** (admin y empleado, en el menú de los dos como "Ingreso de mercadería"):
  - Selector de proveedor opcional y nota.
  - Campo de escaneo siempre enfocado: código más Enter agrega o suma 1. Si no hay coincidencia exacta, abre los resultados por nombre para elegir con flechas y Enter.
  - Tabla con producto, cantidad editable y, solo para el admin, costo precargado editable. Cada fila se puede quitar.
  - Botón "Confirmar ingreso" y un resumen al terminar.
  - Atajos: `Enter` en el campo de escaneo agrega, `Ctrl+Enter` confirma.
  - Los productos inexistentes muestran un aviso no bloqueante.
  - Aviso al salir de la página con productos sin confirmar.
- **`/admin/stock`:** buscador de producto con acciones "Ajustar", "Contar" y "Ver movimientos" sobre el elegido.
- **`/admin/stock/ventas-sin-sistema`:** la misma interacción de escaneo que el ingreso, con cantidades.
- **`/admin/stock/ingresos`:** lista y detalle de ingresos.
- **Formato:** en el admin, tablas en escritorio y tarjetas en celular; fechas en hora de Argentina.

## Risks / Trade-offs

- [El stock actual podría desincronizarse de la suma de movimientos si algún cambio futuro escribe `stockActual` directo] → `registrarMovimiento` es la única función que lo modifica. Un test de integración compara el stock actual con la suma de los movimientos después de cada escenario.
- [Un ingreso grande en una sola transacción] → el máximo de 200 productos por ingreso la mantiene corta.
- [Cargar costos solo en el ingreso del admin deja sin costo lo que recibe el empleado] → el costo nunca se borra: si el empleado carga el ingreso, el costo del producto sigue siendo el anterior.
- [Ajustes con motivo `otro` usados para todo] → la nota es obligatoria para `otro`, así el admin ve qué pasó.

## Migration Plan

- Nueva migración `stock`. Los productos existentes conservan `stockActual = 0`, que es coherente con no tener movimientos. No hay datos reales.
