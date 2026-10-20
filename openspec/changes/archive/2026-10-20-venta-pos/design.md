# Design

## Context

- **Este cambio se implementa después de `productos-y-proveedores` y `stock`**, que agregan:
  - `Producto`, con precio `Decimal`, `nombre`, `codigoBarras` y `activo`.
  - La búsqueda `GET /api/productos?q=` (código exacto primero y después nombre sin acentos), que no devuelve costos al empleado.
  - Los montos como texto decimal y el formateo en pesos de la web.
  - `registrarMovimiento(tx, ...)`, con incremento atómico y los tipos `venta` y `anulacion` ya definidos en el enum.
- **Ya existe:**
  - Sesiones y roles (`requiereSesion` y `requiereRol` como `preValidation`).
  - `ErrorHttp`, el reloj `ahora()` y el helper `diaDeHoyEnArgentina` de `src/lib/fechas.ts`.
  - El test de rutas protegidas.
  - La página provisoria `/venta`.
- **Requisitos:** ver `specs/ventas`, `specs/punto-de-venta` y `specs/notificaciones`.

## Goals / Non-Goals

**Goals:**
- Cobrar una venta típica de 3 productos en efectivo sin tocar el mouse: escanear 3 veces, F1, escribir con cuánto paga y Enter.
- Que la venta, sus pagos, el stock y el aviso de anulación se guarden siempre juntos o nada.
- Dejar el modelo listo para que la Etapa 2 agregue el turno y la Etapa 5 el cobro de Mercado Pago, sin migrar datos.

**Non-Goals:**
- Modo sin conexión (decidido en la exploración: no hay).
- Integración con la API de Mercado Pago ni facturación.
- Impresión silenciosa sin diálogo (QZ Tray o `--kiosk-printing`): queda para cuando moleste el diálogo, como dice el stack.

## Decisions

### Modelo de datos
- **Enums:**
  - `MedioPago`: `efectivo`, `debito`, `credito` y `mercado_pago`.
  - `EstadoVenta`: `pagada` y `anulada`. La Etapa 5 agrega `pendiente` para los cobros de Mercado Pago en espera.
  - `TipoNotificacion`: `anulacion_venta`.
  - `EstadoNotificacion`: `pendiente`, `enviada` y `error`.
- **`Venta`** (`ventas`):
  - Identificación: `id` (UUID v7) y `numero Int @default(autoincrement()) @unique`. El número es legible para tickets y conversaciones ("la venta 120").
  - Datos: `usuarioId`, `total Decimal(12,2)`, `estado` y `creadaEn`.
  - Anulación: `anuladaEn?`, `anuladaPorId?` y `motivoAnulacion?`.
  - Índice por `creadaEn`.
  - **Sin `turnoId`:** lo agrega la Etapa 2 con su migración.
- **`ItemVenta`** (`items_venta`):
  - `id`, `ventaId`, `productoId?` (vacío para "Varios") y `descripcion`, con el nombre del producto al momento de vender.
  - `cantidad Int`, `precioUnitario Decimal(12,2)` y `subtotal Decimal(12,2)`.
- **`PagoVenta`** (`pagos_venta`):
  - `id`, `ventaId`, `medio` y `monto Decimal(12,2)`.
  - `montoRecibido Decimal(12,2)?` y `vuelto Decimal(12,2)?`, solo para efectivo.
  - `@@unique([ventaId, medio])`: un pago como máximo por medio.
- **`Notificacion`** (`notificaciones`): `id`, `tipo`, `destino` (texto, por ahora `admin`), `texto`, `estado`, `creadaEn`, `enviadaEn?` y `error?`.
- **`MovimientoStock`** gana `ventaId?`, para unir cada movimiento `venta` o `anulacion` con su venta.

### Registrar una venta: `POST /api/ventas`
- **Body:** `{ items: [{ productoId, cantidad } | { varios: { descripcion?, precio }, cantidad }], pagos: [{ medio, monto, montoRecibido? }], totalEsperado }`. Hasta 200 ítems. Los montos viajan como texto decimal.
- **Pasos, dentro de una transacción:**
  1. Agrupa los ítems de catálogo repetidos sumando cantidades.
  2. Lee los productos (`findMany` por ids). Si alguno falta o está desactivado, responde `409 PRODUCTO_NO_DISPONIBLE` con cuál.
  3. Calcula los subtotales y el total con `Decimal`. Si el total difiere de `totalEsperado`, responde `409 PRECIOS_CAMBIARON` con `[{ productoId, precio }]` de los precios actuales.
  4. Valida los pagos: la suma es igual al total, no hay medios repetidos y `montoRecibido >= monto` en efectivo. Calcula el vuelto.
  5. Crea la venta, los ítems y los pagos.
  6. Por cada producto, llama a `registrarMovimiento(tx, { tipo: 'venta', cantidad: -n, ventaId })`.
- **Respuesta:** `201` con la venta completa (número, ítems, pagos y vuelto), lista para mostrar y para el ticket.
- **Por qué el servidor recalcula:** el mostrador no puede fijar precios, así que un cliente manipulado no puede vender más barato. `totalEsperado` solo sirve para detectar que el empleado vio otro precio.

### Anular: `POST /api/ventas/:id/anular`
- **Body:** `{ motivo }`, de 3 a 200 caracteres.
- **Permisos:**
  - El empleado necesita que la venta sea del día de hoy en Argentina. Se compara la fecha de la venta y la de `ahora()`, las dos llevadas a la zona `America/Argentina/Buenos_Aires`. Si no es de hoy, `403 FUERA_DE_PLAZO`.
  - El admin puede anular cualquier venta.
- **Pasos, dentro de una transacción:**
  1. `UPDATE ventas SET estado='anulada', ... WHERE id=$id AND estado='pagada'`. Si no actualiza ninguna fila, responde `409 VENTA_YA_ANULADA` (o `404` si no existe). Así, dos anulaciones simultáneas no reponen el stock dos veces.
  2. Repone el stock de cada ítem de catálogo con `registrarMovimiento(tx, { tipo: 'anulacion', cantidad: +n, ventaId })`.
  3. Crea la `Notificacion` con el texto que arma `textoAvisoAnulacion(venta, usuario, ahora)`, una función pura y testeable.
- **Etapa 2:** cambia la regla de plazo a "del turno abierto" sin tocar este flujo.

### Listado: `GET /api/ventas` y `GET /api/ventas/:id`
- **Parámetros:** `desde` y `hasta` (fechas en Argentina, inclusive) y `pagina` (de a 50).
  - Empleado: si no manda fechas, se usa hoy; si pide otro día, `403`.
  - Admin: sin fechas, también hoy.
- **Rango de fechas:** se convierte a instantes UTC calculando el inicio y el fin del día en Argentina (UTC−3, sin horario de verano desde 2009). Se escribe como helper `rangoDelDiaEnArgentina` en `src/lib/fechas.ts`, con tests.
- **Detalle:** ítems y pagos. Nunca hay costos, porque `ItemVenta` no los guarda.

### Avisos: `GET /api/notificaciones` (solo admin)
- Lista paginada, de la más reciente a la más antigua. En la Etapa 1 no hay envío.
- **Etapa 2:** agrega un proceso que toma las `pendiente`, las manda por WAHA y las pasa a `enviada` o `error`.

### POS en la web
- **Estado del carrito:** un `useReducer` con las acciones `agregar`, `sumar`, `cambiarCantidad`, `quitar`, `vaciar` y `actualizarPrecios`. Se guarda en `sessionStorage` en cada cambio y se restaura al cargar.
  - **Por qué `sessionStorage` y no `localStorage`:** no lo comparten otras pestañas, y se descarta al cerrar el navegador.
  - **Los ítems guardan** `productoId`, `nombre`, `precio` (texto decimal), `cantidad` y `codigo`, o `varios: { descripcion }`.
- **Campo de escaneo:**
  - Enter llama a `GET /api/productos?q=`. Si el primer resultado coincide exacto por código, lo agrega; si no, abre la lista de coincidencias.
  - Tras cada acción, un efecto devuelve el foco al campo, salvo con un diálogo abierto.
  - Un código no encontrado emite un sonido corto (Web Audio, sin archivos) y un aviso.
- **Atajos** (en un hook `useAtajosPos` con `keydown` en `window`, con `preventDefault`):

  | Tecla | Acción |
  |---|---|
  | `F1` / `F2` / `F3` / `F4` | Cobrar todo en efectivo / débito / crédito / Mercado Pago |
  | `F6` | Pago mixto |
  | `F7` | Ítem "Varios" |
  | `↑` / `↓` | Seleccionar ítem del carrito |
  | `+` / `-` | Sumar o restar 1 al ítem seleccionado |
  | `Supr` | Quitar el ítem seleccionado |
  | `Ctrl+Supr` | Vaciar el carrito (con confirmación) |
  | `F9` | Imprimir el ticket de la última venta |
  | `Esc` | Cerrar el diálogo abierto |

  - **Por qué F1 a F4:** quedan bajo la mano izquierda y son estándar en los POS. `F5`, `F11` y `F12` se evitan porque el navegador los usa (recargar, pantalla completa, herramientas).
  - **F1:** Chrome abre la ayuda con esa tecla, pero lo evita `preventDefault` en `keydown`. Se verifica en el test de Playwright.
  - Una barra fija al pie muestra la referencia de atajos.
- **Diálogo de cobro:**
  - **Un medio:** muestra el total en grande. En efectivo, un campo "Paga con" (opcional) y el vuelto calculado con `Decimal` en `shared`. Enter confirma.
  - **Pago mixto:** filas por medio con su monto, el texto "Falta asignar $X" y la confirmación deshabilitada hasta que falte $0.
- **Después de cobrar:** el panel "Venta #N cobrada" muestra total, vuelto y el botón "Imprimir ticket (F9)" hasta la próxima venta. El carrito se vacía.
- **Precios cambiados:** ante `409 PRECIOS_CAMBIARON`, se despacha `actualizarPrecios` con los precios nuevos, se resaltan las filas cambiadas y se muestra un aviso.

### Ticket
- **Componente:** `Ticket` se renderiza en un contenedor oculto en pantalla y visible al imprimir. Lo maneja `@media print` en una hoja de estilos con `@page { size: 80mm auto; margin: 0 }`, el ancho en `mm` y una tipografía monoespaciada.
- **Ancho:** el de 58 mm se elige con la variable `VITE_ANCHO_TICKET` (`58` o `80`).
- **Nombre del kiosco:** sale de `VITE_NOMBRE_KIOSCO`.
- **Contenido:** fecha en hora de Argentina, ítems, total, pagos, vuelto y "No válido como factura".
- **Impresión:** `window.print()` con la térmica como impresora por defecto, como decidió el stack.

### Listado de ventas en la web
- **`/ventas`** (admin y empleado):
  - Tabla de ventas del día (el admin con selector de fechas), con estado y medios de pago.
  - En el detalle, botones "Reimprimir ticket" y "Anular", que pide el motivo.
  - Una venta anulada se ve tachada, con el motivo.
- **`/admin/avisos`:** lista de avisos con estado y texto.
- **Menú:** "Venta", "Ventas" y, para el admin, "Avisos".

### Montos con decimales exactos en la web
- **Librería:** las sumas del carrito, el pago mixto y el vuelto se calculan con `decimal.js-light`, una dependencia chica, desde funciones de `packages/shared` (`sumar`, `multiplicar`, `restar`, `formatear`) que también usa la API.
- **Por qué:** con `number`, por ejemplo, `0.1 + 0.2` no da `0.3`, y el pago mixto podría no cerrar por centavos.

### Playwright
- **Ubicación:** `apps/web/e2e/` con `@playwright/test` y Chromium.
- **`webServer`:** `pnpm build` y la API compilada en modo producción en el puerto 3100, contra `kiosco_test`, sirviendo la web.
- **`globalSetup`:**
  - Aplica las migraciones, limpia la base y siembra un admin, un empleado y dos productos con código.
  - Las contraseñas de test se generan al azar en cada corrida y se pasan por variables de entorno a los tests.
- **Flujo cubierto:**
  1. Ingresar como empleado.
  2. Escanear (escribir el código y Enter) dos productos y uno repetido.
  3. F1, pagar con un monto mayor y verificar el vuelto.
  4. Verificar en `/ventas` la venta y, por la API, el stock descontado.
  5. Anular con motivo y verificar el stock repuesto y el aviso en `/admin/avisos` como admin.
- **CI:** un job aparte que instala Chromium (`playwright install --with-deps chromium`) y corre `pnpm --filter web e2e`.

## Risks / Trade-offs

- [Una venta grande bloquea las filas de varios productos durante la transacción] → las transacciones son cortas (un `UPDATE` por producto). Con un solo mostrador no hay competencia real.
- [El navegador del kiosco podría interceptar alguna tecla F] → el test de Playwright verifica F1 a F4. El kiosco se configura con Chrome. Si algo choca, los atajos están en una sola tabla del hook.
- [El diálogo de impresión del navegador frena el mostrador] → se acepta en la Etapa 1. El stack ya prevé `--kiosk-printing` o QZ Tray para imprimir sin diálogo.
- [La regla "ventas del día" para el empleado es más amplia que "del turno"] → es temporal hasta la Etapa 2, decidido en la exploración.
- [Pago mixto con Mercado Pago integrado en la Etapa 5] → queda como pregunta para esa etapa: qué hacer si solo una parte se cobra por la API. El modelo de `PagoVenta` por medio ya lo admite.

## Migration Plan

- Nueva migración `ventas`: tablas nuevas y la columna `venta_id` opcional en `movimientos_stock`. No hay datos reales.
