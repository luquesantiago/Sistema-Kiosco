# Design

## Context

- **Ya existe:**
  - `IngresoMercaderia` + `ItemIngreso` y `registrarIngreso` (`modules/stock/servicio.ts`). Este último:
    - agrupa productos repetidos;
    - crea un movimiento `compra` por producto;
    - si viene costo distinto del actual, lo actualiza y lo deja en `cambios_precio`.

    Hoy rechaza costos de un empleado (`costoNoPermitido`). La pantalla `stock/IngresoMercaderia.tsx` usa `EscanerDeProductos`, que busca en `/productos?q=`; para el empleado, esa búsqueda devuelve `ProductoVenta`, sin costo.
  - `MovimientoCaja` con `cuenta`, `turnoId` nullable y `registrarMovimientoCaja`. Este último aplica las reglas de turno: `turnoParaOperar`, salvo admin + MP, que usa `turnoAbiertoBloqueado`.
  - `resumenDeCaja` suma movimientos en efectivo por tipo. El aviso de cierre arma sus líneas desde `ResumenCaja`.
  - `Proveedor.diasEntrega` y `diaDeHoyEnArgentina`.
  - `Notificacion` con `TipoNotificacion`.
- Requisitos en `specs/pedidos`, `specs/ingreso-mercaderia`, `specs/caja` y `specs/notificaciones` de este cambio.

## Goals / Non-Goals

**Goals:**
- Un solo lugar, el pedido, para saber qué falta que llegue, qué falta cargar y a quién se le debe.
- Que el empleado reciba en dos toques y cargue cuando pueda.
- Reutilizar el ingreso de mercadería y la caja, en lugar de duplicar stock y plata.

**Non-Goals:**
- Productos del pedido cargados por el admin (eligió solo el total) y sugerencias de reposición (Etapa 4).
- Pagos parciales o saldo por proveedor.
- Editar un pedido después de que llegó, o deshacer un pago o una carga. Se corrige con un ajuste de stock o un movimiento de caja, como hoy.

## Decisions

### Modelo: un `Pedido` con dos dimensiones
```
Pedido
  numero (autoincrement), proveedorId (obligatorio)
  totalPedido, llegaEl (date), nota, creadoPorId, creadoEn
  estado: por_llegar | llego | cargado | cancelado      <- mercadería
  total (final, se fija al llegar y se puede corregir al pagar)
  notaRecepcion, llegoEn, recibidoPorId
  canceladoEn, canceladoPorId, motivoCancelacion
  cerradoEn                                             <- cargado + pagado
  ingreso   IngresoMercaderia?  (IngresoMercaderia.pedidoId @unique)
  pago      MovimientoCaja?     (MovimientoCaja.pedidoId  @unique)
```
- "Pagado" no es un campo: es que exista el `MovimientoCaja` del pedido. El `@unique` en `pedidoId` impide pagar dos veces aunque dos personas aprieten a la vez: el segundo `create` falla y se traduce a `409`. Lo mismo pasa con la carga a través de `IngresoMercaderia.pedidoId`.
- Las transiciones de estado se hacen con `updateMany` condicionado al estado esperado (`where: { id, estado: 'por_llegar' }`), igual que la anulación de ventas, y `count === 0` → `409`.
- `cerradoEn` se fija en la misma transacción de la acción que completa la segunda condición. Ahí mismo se crea el aviso si el usuario es empleado.
- Alternativa descartada: un único enum con todas las combinaciones (`llego_pagado`, `cargado_debe`…). Multiplica estados y transiciones, y dos columnas independientes reflejan mejor lo que el usuario describió.

### Pago = `MovimientoCaja` tipo `pago_proveedor`
- Se agrega `pago_proveedor` a `TipoMovimientoCaja`. `movimientoCajaEntradaSchema` no lo acepta (`400`): solo lo crea `pagarPedido`.
- `pagarPedido` reutiliza la parte de turno de `registrarMovimientoCaja`. Se extrae a una función `turnoParaMovimiento(tx, usuario, cuenta)` que usan las dos, así las reglas son las mismas: empleado → su turno; admin + efectivo → turno abierto; admin + MP → turno si lo hay.
- Motivo armado: `Pedido #12 - Coca-Cola`. Sin categoría.
- `resumenDeCaja` suma `pagosProveedor` (efectivo) y lo resta del esperado. El aviso de cierre y `Turnos.tsx` muestran "Pagos a proveedores". `nombreMovimientoCaja` lo nombra "Pago a proveedor".
- Recibir y pagar en el mismo acto (`POST /llego` con `cuenta`) corre en una sola transacción: si falla el pago, por ejemplo por no tener turno, no queda marcado como llegado.
- Alternativa descartada: una tabla `PagoPedido` aparte. Habría que enseñarle al esperado, a los listados de movimientos y al dashboard a leer otra tabla.

### El ingreso pasa a ser la carga del pedido
- `registrarIngreso` recibe `pedidoId` y toma el proveedor del pedido. Se elimina la regla `costoNoPermitido`: cualquiera puede mandar costos, con la semántica de siempre (vacío = sin cambios).
- Se saca `POST /api/stock/ingresos`. La carga es `POST /api/pedidos/:id/carga`, que valida el estado y llama a `registrarIngreso` dentro de la misma transacción. `GET /api/stock/ingresos` y su detalle siguen igual y suman `pedido: { id, numero } | null`. Los ingresos viejos de desarrollo quedan con `null`.
- **Costo para el empleado en la carga:** la búsqueda de productos del escáner del ingreso pasa a `GET /api/pedidos/productos?q=` (ambos roles). Devuelve `{ id, codigoBarras, nombre, costo }`. No se toca `/productos`, que sigue sin mostrar costos al empleado en el resto del sistema (POS, listados). `EscanerDeProductos` recibe la URL de búsqueda como prop.

### Rutas `/api/pedidos`
| Método y ruta | Quién | Qué hace |
|---|---|---|
| `GET /` (`?vista=abiertos` por defecto, o `cerrados` / `cancelados` con `desde`/`hasta`/`pagina`) | ambos (cerrados y cancelados solo admin) | lista |
| `GET /:id` | ambos | detalle |
| `POST /` | admin | crear |
| `PATCH /:id` | admin | editar si está por llegar |
| `POST /:id/cancelar` | admin | `{ motivo }` |
| `POST /:id/llego` | ambos | `{ total, notaRecepcion?, cuenta? }` |
| `POST /sin-pedido` | ambos | `{ proveedorId, total, nota?, cuenta? }` |
| `POST /:id/carga` | ambos | `{ items, nota? }` |
| `POST /:id/pago` | ambos | `{ cuenta, total? }` |
| `GET /productos?q=` | ambos | búsqueda con costo para la carga |

- Orden de la vista abierta, "primero lo que hay que atender": llegó y falta cargar; por llegar con `llegaEl <= hoy` (atrasados primero); quedaron debiendo; por llegar en el futuro. Se ordena en el servicio. Son pocos pedidos abiertos: sin paginar.
- El próximo día de entrega se calcula en la web, al abrir el formulario, con los `diasEntrega` del proveedor (ya vienen en `/stock/proveedores`) y la fecha de hoy en Argentina. Es solo un valor precargado.

### Pantallas
- **`/pedidos`** (menú, ambos roles; reemplaza "Ingreso de mercadería"):
  - Lista de abiertos en tarjetas, con insignias: *Hoy llega*, *Atrasado*, *Falta cargar*, *Debe*.
  - Botones: **Nuevo pedido** (admin) y **Recibir sin pedido**.
  - En el admin, solapas "Cerrados" y "Cancelados" con fechas.
- **`/pedidos/:id`**: detalle con acciones según el estado.
  - **Llegó**: total precargado, nota de recepción y [Efectivo] [Mercado Pago] [Queda debiendo] con `OpcionesBoton`.
  - **Cargar mercadería**: la pantalla actual de ingreso, reutilizada como componente `CargaDeMercaderia` con costo siempre visible.
  - **Pagar**.
  - **Editar** y **Cancelar** (admin).
- **POS:** franja chica sobre el carrito con los recordatorios. Cada uno es un enlace a `/pedidos/:id` y no toma el foco del lector. Se refresca al volver a la pantalla (React Query); no hace falta tiempo real.

## Risks / Trade-offs

- [El empleado ve costos al cargar mercadería] → Lo decidió el usuario: los costos vienen en el remito. La ganancia y los márgenes siguen siendo solo del admin.
- [Un pedido "llegó" que nunca se carga deja el stock mal] → El recordatorio queda fijo en el POS y en la lista hasta que se carga, y el pedido no se cierra (no sale el aviso).
- [Se pierde el ingreso suelto, que servía para mercadería que no se paga (bonificaciones, muestras)] → "Recibir sin pedido" exige un total mayor que cero, así que esos casos se cargan con un **ajuste de stock** del admin, que ya existe. Queda anotado en los docs.
- [Pagos de pedido concurrentes] → `@unique` en `MovimientoCaja.pedidoId`, más la transición condicionada.

## Migration Plan

1. Migración `pedidos_proveedor`:
   - enum `EstadoPedido`;
   - tabla `pedidos` con `numero` serial;
   - `ALTER TYPE "TipoMovimientoCaja" ADD VALUE 'pago_proveedor'` y `ALTER TYPE "TipoNotificacion" ADD VALUE 'pedido_cerrado'`;
   - `movimientos_caja.pedido_id` e `ingresos_mercaderia.pedido_id`, los dos `UNIQUE` y nullable, con FK.
2. Los datos de desarrollo no se tocan: los ingresos viejos quedan sin pedido.
3. Para volver atrás: revertir el commit. Los valores de enum agregados no se pueden sacar en PostgreSQL sin recrear el tipo; en desarrollo no importa.

## Open Questions

- Ninguna que cambie el alcance. Si en el uso real aparece la necesidad de recibir mercadería sin costo (bonificaciones), se evalúa permitir total $0 en "recibir sin pedido".
