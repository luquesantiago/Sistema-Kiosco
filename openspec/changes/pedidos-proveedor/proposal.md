# Proposal

## Why

Hoy la mercadería entra con un ingreso suelto y lo que se le paga al proveedor se anota como un gasto "Otro". El sistema no sabe qué se pidió, qué falta que llegue, a quién se le debe ni cuánto. El dashboard de esta etapa necesita mostrar **"pendiente de pagar"**, y el kiosco necesita que el empleado pueda recibir un pedido rápido, atender y cargar la mercadería después.

## What Changes

- **Pedidos a proveedor.** El admin carga un pedido desde el celular con proveedor, total a pagar, fecha de llegada y nota. La fecha se precarga con el próximo día de entrega del proveedor. El admin puede editar el pedido mientras está "por llegar", y cancelarlo.
- **Mercadería y pago avanzan por separado:**
  - Mercadería: *por llegar* → *llegó* → *cargada*, o *cancelado*.
  - Pago: *sin pagar* → *pagado*.
  - El pedido queda **cerrado** cuando la mercadería está cargada y el pedido está pagado.
- **Recibir:** el empleado marca que el pedido llegó, corrige el total si hace falta y elige **Efectivo**, **Mercado Pago** o **Queda debiendo**. La carga de productos puede quedar para después, para poder atender en el medio. Es obligatoria para cerrar el pedido, pero no frena la recepción.
- **Cargar la mercadería:** usa el mismo ingreso de mercadería que ya existe (lector, búsqueda, cantidades), ahora atado al pedido. El empleado también ve el **costo actual precargado** de cada producto y lo corrige según el remito, lo que actualiza el costo del producto.
- **Pagar después:** cualquier entrega que quedó debiendo se paga entera más tarde, desde el mostrador (el empleado) o desde el celular (el admin, también con MP y sin turno). El total se puede corregir al pagar.
- **Recibir sin pedido** (pan, hielo): con proveedor obligatorio, crea el pedido ya recibido. **BREAKING:** reemplaza al ingreso de mercadería suelto, que deja de existir como pantalla y como ruta.
- **El pago es un movimiento de caja** de un tipo nuevo, `pago_proveedor`, con su cuenta (Efectivo o MP). En efectivo resta del esperado del turno, y el cierre del turno lo muestra en su propia línea.
- **Un aviso por pedido al cerrarse**, solo si lo cerró un empleado: proveedor, total, cómo se pagó y qué se cargó.
- **Recordatorios en el POS:** los pedidos que llegan hoy o están atrasados, y los que llegaron pero falta cargar.
- La pantalla **Pedidos** reemplaza a "Ingreso de mercadería" en el menú, para el admin y el empleado.

Fuera de alcance:
- El aviso de reposición de las 12:00 y la sugerencia de qué pedir (Etapa 4).
- El dashboard, que va a leer "pendiente de pagar" de acá (cambio `dashboard`).
- Pagos parciales y cuenta corriente con el proveedor: cada entrega se paga entera.

## Capabilities

### New Capabilities

- `pedidos`: pedidos a proveedor, su ciclo de mercadería y de pago, la recepción con o sin pedido previo, los recordatorios y la lista de pedidos.

### Modified Capabilities

- `ingreso-mercaderia`: el ingreso se registra solo como la carga de un pedido; el empleado también ve y carga costos; la consulta de ingresos muestra a qué pedido pertenece.
- `caja`: nuevo tipo de movimiento `pago_proveedor`, que resta del esperado cuando es en efectivo.
- `notificaciones`: aviso al cerrarse un pedido; el resumen del cierre de turno incluye los pagos a proveedores.

## Impact

- **Base de datos:** modelo `Pedido` (con número correlativo), enum `EstadoPedido`, valor `pago_proveedor` en `TipoMovimientoCaja`, valor `pedido_cerrado` en `TipoNotificacion`, `MovimientoCaja.pedidoId` (único, nullable) e `IngresoMercaderia.pedidoId` (único, nullable).
- **API:**
  - Nuevo módulo `modules/pedidos` (rutas `/api/pedidos`).
  - `modules/stock`: se saca `POST /api/stock/ingresos`; la carga se hace desde el pedido y el empleado puede mandar costos.
  - `modules/caja`: esperado, resumen y texto del cierre.
- **Compartido:** `packages/shared/src/pedidos.ts`, y cambios en `caja.ts` (tipo nuevo, `pagosProveedor` en el resumen) y `stock.ts`.
- **Web:**
  - Pantalla `pedidos/` (lista, nuevo pedido, recibir, cargar, pagar).
  - Recordatorios en `pos/Venta.tsx`.
  - Menú en `app/Layout.tsx`.
  - `stock/IngresoMercaderia.tsx` deja de ser una pantalla suelta y pasa a ser la carga del pedido.
- **Docs:** `docs/requisitos-y-limites.md` y `docs/estructura-proyecto.md`.
