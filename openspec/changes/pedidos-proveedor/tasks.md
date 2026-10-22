# Tasks

## 1. Modelo de datos y schemas compartidos

- [x] 1.1 En `schema.prisma`:
  - Agregar el enum `EstadoPedido` y el modelo `Pedido`.
  - Sumar `pago_proveedor` a `TipoMovimientoCaja` y `pedido_cerrado` a `TipoNotificacion`.
  - Sumar `MovimientoCaja.pedidoId` e `IngresoMercaderia.pedidoId`, los dos únicos y nullable.

  Generar la migración `pedidos_proveedor` y correr `prisma generate`. Verificar con `pnpm db:migrate` que se aplica sobre la base de desarrollo y que los tests existentes de la API siguen pasando.
- [x] 1.2 Crear `packages/shared/src/pedidos.ts` (exportado desde `index.ts`) con:
  - los esquemas de entrada: alta, edición, cancelación, llegó, sin pedido, carga, pago y query de la lista;
  - los de salida: resumen, detalle y producto para la carga;
  - los nombres de los estados;
  - `proximoDiaDeEntrega(diasEntrega, hoy)`.

  En `caja.ts`, sumar `pago_proveedor` a los tipos (el schema de entrada lo sigue rechazando), `pagosProveedor` a `ResumenCaja` y "Pago a proveedor" a `nombreMovimientoCaja`. Verificar con tests unitarios:
  - `proximoDiaDeEntrega`: martes con entregas los jueves da el jueves; jueves con entregas los jueves da el jueves siguiente; sin días de entrega da mañana.
  - El schema de movimientos rechaza `pago_proveedor` y los totales tienen que ser mayores que cero.

## 2. Caja

- [x] 2.1 Extraer `turnoParaMovimiento(tx, usuario, cuenta)` de `registrarMovimientoCaja` sin cambiar su comportamiento. Sumar `pagosProveedor` (en efectivo) a `resumenDeCaja` y restarlo del esperado. Agregar "Pagos a proveedores" al texto del cierre y a `Turnos.tsx`. Verificar con los tests de caja existentes (sin cambios de resultado) más tests nuevos: "Pago a un proveedor en efectivo/con Mercado Pago" de "Efectivo esperado", "Pago a proveedor suelto" (`400`) y la línea del aviso de cierre.

## 3. Pedidos (API)

- [x] 3.1 Crear `modules/pedidos` con `GET /`, `GET /:id`, `POST /`, `PATCH /:id` y `POST /:id/cancelar`, registrado en la app. Verificar con tests de integración los escenarios de "Alta de un pedido" y "Edición y cancelación de un pedido", el orden de la vista abierta y que los cerrados y cancelados sean solo para el admin. Sumar las rutas al test de rutas protegidas.
- [x] 3.2 Implementar `POST /:id/llego` y `POST /sin-pedido`, con pago opcional en la misma transacción usando `turnoParaMovimiento`. Verificar con tests los escenarios de "Recepción de un pedido" y "Recibir sin pedido": paga en efectivo, faltantes, queda debiendo, `409` si ya llegó o está cancelado, `400` sin proveedor, y un empleado sin turno que intenta pagar al recibir recibe `409` sin quedar marcado como llegado.
- [x] 3.3 Mover la carga: `registrarIngreso` recibe el pedido, toma su proveedor y acepta costos de cualquier rol. Sacar `POST /api/stock/ingresos`. Implementar `POST /:id/carga` y `GET /productos?q=`. Sumar el pedido a la lista y al detalle de ingresos. Actualizar `ingresos.test.ts` para que cargue a través de pedidos. Verificar con tests los escenarios de "Carga de la mercadería de un pedido" y los modificados de `ingreso-mercaderia`: el empleado carga costo y queda en el historial a su nombre, `409` al cargar dos veces y la búsqueda devuelve el costo al empleado.
- [x] 3.4 Implementar `POST /:id/pago` (total corregible, `@unique` → `409`) y el cierre del pedido con su aviso `pedido_cerrado` cuando lo cierra un empleado. Verificar con tests los escenarios de "Pago de un pedido", "Pedido cerrado" (los dos órdenes) y "Aviso al cerrarse un pedido": texto completo, sin aviso si quedó debiendo, sin aviso si lo cierra el admin, y dos pagos a la vez registran uno solo.

## 4. Web

- [x] 4.1 Extraer la pantalla de ingreso a un componente `CargaDeMercaderia`:
  - Costo siempre visible y precargado.
  - Búsqueda por `/pedidos/productos`, con `EscanerDeProductos` recibiendo la URL.
  - Confirmación contra `/pedidos/:id/carga`.

  Sacar la ruta `/stock/ingreso`. Verificar adaptando los tests de componente del ingreso: escanear dos veces suma, código desconocido avisa y el empleado ve y envía el costo.
- [x] 4.2 Crear `/pedidos` y `/pedidos/:id`:
  - Lista con insignias.
  - Nuevo pedido con la fecha precargada (admin).
  - Recibir sin pedido.
  - Detalle con Llegó (total, nota y [Efectivo] [Mercado Pago] [Queda debiendo]), Cargar, Pagar, Editar y Cancelar según rol y estado.
  - Solapas de cerrados y cancelados para el admin.
  - Entrada "Pedidos" en el menú en lugar de "Ingreso de mercadería".

  Verificar con tests de componente los flujos de recibir y pagar, la fecha precargada y que el empleado no ve "Nuevo pedido" ni "Cancelar".
- [x] 4.3 Agregar los recordatorios al POS (`pos/Venta.tsx`): "Hoy llega" o "Atrasado" y "Falta cargar", como enlaces que no toman el foco. Verificar con un test de componente y con el e2e del mostrador, que tiene que seguir pasando.
- [x] 4.4 Verificar en el navegador con `verif-admin` y `verif-empleado`:
  - el admin crea un pedido desde el celular (375 px);
  - el empleado ve el recordatorio en el POS, marca "Llegó" pagando en efectivo, carga la mercadería con costos y el pedido queda cerrado;
  - el turno muestra el pago a proveedor y el aviso queda en Avisos.

## 5. Documentación y cierre

- [x] 5.1 Actualizar `docs/requisitos-y-limites.md` (pedidos, recepción en dos tiempos, pagos, el empleado ve costos al cargar, sin ingreso suelto y bonificaciones por ajuste de stock) y `docs/estructura-proyecto.md` (modelo `Pedido`, campos nuevos y módulo `pedidos`). Verificar releyendo que coinciden con las specs.
- [x] 5.2 Correr `pnpm lint`, `pnpm typecheck`, `pnpm test` (web con `--no-file-parallelism` si hay timeouts por carga) y el e2e, y verificar que todo pasa.

## Workflow follow-up

- Archivar el cambio cuando la CI esté en verde en `etapa-3`.
- Último cambio de la Etapa 3: `dashboard`, que lee "pendiente de pagar" de los pedidos abiertos.
