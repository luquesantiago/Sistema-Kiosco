# Design

## Context

- **Ya existe:**
  - Usuarios, sesiones y roles (specs `autenticacion` y `usuarios`).
  - `requiereSesion` y `requiereRol('admin')` como hooks `preValidation`.
  - Errores con `ErrorHttp` y el formato común.
  - Tests de integración contra `kiosco_test` con `limpiarBase()` y reloj inyectable `ahora()`.
  - La web con `pedir()`, TanStack Query, menú por rol y la convención tabla en escritorio y tarjetas en celular (`/admin/usuarios`).
- **Convenciones de Prisma** (en `schema.prisma`): IDs UUID v7, montos `Decimal(12,2)`, cantidades `Int`, fechas `Timestamptz`, nombres en español con `@@map`.
- **Requisitos:** ver `specs/proveedores` y `specs/productos`.

## Goals / Non-Goals

**Goals:**
- Un catálogo que el POS pueda consultar rápido por código (búsqueda exacta, indexada).
- Montos exactos de punta a punta: nunca pasar por `number` de JavaScript para calcular precios.
- Dejar listo `Producto.stockActual` para que el cambio `stock` lo mueva con movimientos.

**Non-Goals:**
- Movimientos de stock ni edición del stock actual.
- Búsqueda difusa (con errores de tipeo) ni índices de texto completo: el catálogo de un kiosco son cientos o pocos miles de productos.

## Decisions

### Modelo de datos
- **`DiaSemana`:** enum `lunes` a `domingo`.
- **`Proveedor`** (`proveedores`): `id`, `nombre`, `telefono?`, `notas?`, `diasPedido DiaSemana[]`, `diasEntrega DiaSemana[]`, `activo`, `creadoEn`, `actualizadoEn`.
  - Los días son listas escalares de enum de PostgreSQL, que Prisma soporta.
  - Alternativa descartada: una tabla intermedia por día. Hace las consultas más complejas para un dato que se lee entero.
- **`Producto`** (`productos`):
  - Identidad: `id`, `codigoBarras String? @unique`, `nombre` y `nombreBusqueda`.
  - Precios: `precio Decimal(12,2)` y `costo Decimal(12,2)?`.
  - Stock: `stockActual Int @default(0)`, `stockMinimo Int` y `stockMaximo Int`.
  - Relación y estado: `proveedorId?`, `activo`, `creadoEn` y `actualizadoEn`.
  - `@unique` en una columna que admite nulos permite varios productos sin código, porque en PostgreSQL los `NULL` no chocan entre sí.
- **`CambioPrecio`** (`cambios_precio`):
  - `id`, `productoId` y `usuarioId`.
  - `precioAnterior`, `precioNuevo`, `costoAnterior?` y `costoNuevo?`.
  - `origen` (enum `manual` o `aumento_masivo`) y `creadoEn`.
  - Índice por `(productoId, creadoEn)`.
- **Usuario en el historial:** `usuarioId` referencia a `Usuario` con `onDelete: Restrict`. Los usuarios nunca se borran, así que no hay conflicto.

### Búsqueda sin acentos: columna normalizada en vez de `unaccent`
- **`nombreBusqueda`:** se calcula en la API al guardar, con `nombre.normalize('NFD')`, sin marcas diacríticas, en minúsculas y con los espacios colapsados.
- **Búsqueda por nombre:** se busca con `contains` sobre esa columna, normalizando la consulta con la misma función de `packages/shared`.
- **Índice:** un índice B-tree común sobre `nombreBusqueda` alcanza para ordenar. Con pocos miles de filas, `ILIKE '%x%'` recorre la tabla en milisegundos.
- **Alternativa descartada:** la extensión `unaccent` de PostgreSQL. Obliga a crear la extensión en cada base, incluida la de tests y la de la CI, y no aporta nada a este volumen.

### Búsqueda por código primero
- **Ruta:** `GET /api/productos?q=...`.
  - Si `q` coincide exacto con un `codigoBarras`, devuelve solo ese producto.
  - Si no, busca por nombre.
- **Por qué:** el lector manda el código completo más Enter, así que la búsqueda exacta resuelve el caso del POS con una sola consulta indexada.
- **Parámetros:** `q`, `pagina` (de 50) e `incluirInactivos` (solo admin; se ignora para el empleado).

### Respuesta según el rol
- **Dos esquemas de salida en `shared`:**
  - `productoVentaSchema`: `id`, `codigoBarras`, `nombre`, `precio`, `stockActual`, para cualquier usuario con sesión.
  - `productoAdminSchema`: suma `costo`, `proveedor { id, nombre }`, `stockMinimo`, `stockMaximo` y `activo`.
- **Cómo se elige:** la ruta arma la respuesta según `request.usuario.rol`. El serializador de Fastify con Zod descarta cualquier campo que no esté en el esquema, así que el costo no puede filtrarse por accidente.
- **El resto de las rutas de productos y todas las de proveedores** son solo para el admin.

### Montos: `Decimal` como texto en la API
- **En la API:** Prisma devuelve `Prisma.Decimal` y la API lo serializa como texto con dos decimales (por ejemplo, `"905.00"`). La entrada acepta texto o número, que se valida con Zod y se convierte a `Decimal`.
- **En la web:** se muestra con `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })`.
- **Por qué texto:** un `number` de JavaScript no representa exacto `0,1`. Con texto, la API nunca hace cuentas con `float`.

### Aumento masivo
- **Cálculo** (con `Decimal` en la API): `nuevo = techo(precio × (1 + porcentaje/100) / redondeo) × redondeo`, con un mínimo de un `redondeo`.
  - Si además se aumenta el costo: `costo × (1 + porcentaje/100)`, redondeado a 2 decimales (mitad hacia arriba).
- **Rutas:**
  - `POST /api/productos/aumento/vista-previa`, con body `{ proveedorId | null, porcentaje, redondeo, incluirCosto }`. Devuelve `[{ id, nombre, precioActual, precioNuevo, costoActual, costoNuevo }]` y no escribe nada.
  - `POST /api/productos/aumento`, con el mismo body. Recalcula dentro de una transacción en vez de confiar en la vista previa: actualiza los productos y crea un `CambioPrecio` por cada uno con origen `aumento_masivo`.
  - Los productos cuyo precio no cambia, porque ya están redondeados, se omiten en los dos.
- **Concurrencia:** la transacción usa nivel `Serializable` para que un cambio manual simultáneo no se pise con el masivo.
- **Validación:** `porcentaje` entre -50 y 200 y distinto de 0; `redondeo` en `{1, 10, 50, 100}`.

### Historial al editar
- **Cuándo se registra:** `PATCH /api/productos/:id` compara precio y costo con los valores guardados (con `Decimal.equals`) y, si alguno cambió, crea un `CambioPrecio` manual en la misma transacción.
- **Ruta del historial:** `GET /api/productos/:id/historial-precios`, solo admin, ordenado del más reciente al más antiguo, con el nombre del usuario.

### "Toma pedido hoy" en hora de Argentina
- **Cálculo:** el día de hoy se obtiene con `Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long' })` sobre `ahora()` (el reloj inyectable), y se traduce al enum.
- **Lista de proveedores:** `GET /api/proveedores` devuelve `tomaPedidoHoy: boolean` y `productosActivos: number`, calculados en la API, y ordena primero a los que toman pedido hoy.
- **Ayuda reutilizable:** la función queda en un helper (`src/lib/fechas.ts`) para la Etapa 4.

### API
| Método y ruta | Acceso | Qué hace |
|---|---|---|
| `GET /api/proveedores` | admin | Lista con `tomaPedidoHoy` y `productosActivos`; `?incluirInactivos=true` |
| `POST /api/proveedores` | admin | Alta → `201` |
| `PATCH /api/proveedores/:id` | admin | Edición, incluido `activo` |
| `GET /api/productos` | sesión | Búsqueda; respuesta según el rol |
| `GET /api/productos/:id` | admin | Ficha completa |
| `POST /api/productos` | admin | Alta → `201`; `409 CODIGO_EXISTENTE` |
| `PATCH /api/productos/:id` | admin | Edición, incluido `activo`; registra el historial |
| `GET /api/productos/:id/historial-precios` | admin | Historial |
| `POST /api/productos/aumento/vista-previa` | admin | Vista previa del aumento masivo |
| `POST /api/productos/aumento` | admin | Aplica el aumento masivo |

**Errores nuevos:** `CODIGO_EXISTENTE` (409) y `PROVEEDOR_INACTIVO` (400).

### Web
- **Menú del admin:** "Productos" y "Proveedores".
- **`/admin/productos`:**
  - Campo de búsqueda con foco al entrar, que sirve con el lector (código más Enter).
  - Lista de resultados: tabla en escritorio y tarjetas en celular, con nombre, código, precio, stock y estado.
  - Si un código escaneado no existe, botón "Crear producto con este código".
- **Producto:**
  - `/admin/productos/nuevo` y `/admin/productos/:id`: formulario con alta, edición y activar o desactivar.
  - La ficha muestra el historial de precios.
  - El precio se edita con teclado numérico en el celular (`inputMode="decimal"`).
- **`/admin/productos/aumento`:** formulario (proveedor o todos, porcentaje, redondeo y costo), botón "Ver vista previa", tabla de precio actual y nuevo, y "Confirmar aumento".
- **`/admin/proveedores`:**
  - Lista con el teléfono como enlace `tel:` y la marca "Toma pedido hoy".
  - Alta y edición con casillas para los días.
- **Formato:** precios con `Intl.NumberFormat` en pesos argentinos. Los montos que escribe el usuario aceptan coma decimal.

## Risks / Trade-offs

- [El empleado podría ver el costo por un error en la ruta] → el esquema de salida del empleado no tiene esos campos, y un test verifica que la respuesta no incluye `costo` ni `proveedor`.
- [Redondear siempre hacia arriba puede dar aumentos mayores al porcentaje en productos baratos] → es el comportamiento esperado en un kiosco. La vista previa muestra cada precio antes de confirmar.
- [La vista previa y la aplicación pueden diferir si alguien cambia un precio en el medio] → la aplicación recalcula dentro de la transacción. La diferencia solo afecta a ese producto y queda en el historial.
- [Búsqueda con `contains` sin índice de trigramas] → alcanza para el volumen del kiosco. Si crece, se agrega `pg_trgm` sin cambiar la API.

## Migration Plan

- Nueva migración `productos_y_proveedores`. No hay datos que migrar, porque la Etapa 1 no está en producción.
