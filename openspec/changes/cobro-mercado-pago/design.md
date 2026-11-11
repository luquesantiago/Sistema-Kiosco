# Design

## Context

- **Ya existe:**
  - `Venta` con `estado` (`pagada`, `anulada`), `turnoId`, `creadaEn` y número autoincremental; `PagoVenta` con `@@unique([ventaId, medio])`; `ItemVenta` con precio y costo fijos.
  - `registrarVenta` (`modules/ventas/servicio.ts`) hace todo en una transacción: turno con `turnoParaOperar` (bloqueo `FOR SHARE`), precios del catálogo, `409 PRECIOS_CAMBIARON`, pagos y un movimiento `venta` por producto. `anularVenta` solo pasa de `pagada` a `anulada` (`updateMany ... where estado = 'pagada'`).
  - **Error latente:** `resumenDeCaja` (`modules/caja/servicio.ts`) agrupa `pagoVenta` y cuenta `venta` del turno **sin mirar el estado**. Hoy da igual porque toda venta nace `pagada`; con ventas `pendiente` las contaría. El dashboard ya filtra `estado = 'pagada'` en todas sus consultas.
  - `pos/Venta.tsx`: F1 efectivo, F2 débito, F3 crédito, F4 Mercado Pago, F6 pago mixto, F9 imprimir. El carrito vive en el cliente hasta que la venta se registra.
  - `ventaEntradaSchema` (shared) valida montos con `montoSchema`: acepta hasta 2 decimales y **rechaza** 3 o más (no redondea).
  - **De `saldo-mercado-pago`:** `src/integrations/mercadopago/cliente.ts` (`ClienteMercadoPago`, timeout de 10 s, `MercadoPagoNoDisponible` / `MercadoPagoRechazo`), `test/mercadopago-falso.ts`, `MP_ACCESS_TOKEN` y `modules/mercadopago/`.
  - **De `aviso-reposicion-diario`:** `src/jobs/ciclo.ts` con `iniciarCiclo({ nombre, pasada, intervaloMs, log })` (`setTimeout` encadenado, sin pasadas superpuestas, `detener()` que espera la pasada en curso).
  - `test/rutas-protegidas.test.ts`: `RUTAS_ABIERTAS = ['POST /api/auth/ingresar', 'GET /api/health']`.
  - Producción (`puesta-en-marcha`): Caddy con HTTPS delante de la app. **Hoy no hay servidor contratado**, así que no hay URL pública para webhooks.
- Requisitos en `specs/mercado-pago`, `specs/ventas`, `specs/punto-de-venta`, `specs/caja`, `specs/dashboard` y `specs/notificaciones` de este cambio.

## Goals / Non-Goals

**Goals:**
- Que ninguna venta electrónica quede `pagada` sin que Mercado Pago confirme el pago.
- Que el sistema funcione sin webhooks (solo consulta) y con webhooks (más rápido), sin cambiar nada más que la configuración.
- Que cada cosa que pase dos veces (aviso repetido, aviso y consulta a la vez, reintento después de un timeout) tenga efecto una sola vez, garantizado por la base.
- La menor fricción en el mostrador: una tecla para cobrar, una pantalla de espera clara y el carrito que no se pierde.

**Non-Goals:**
- Reembolsos por la API (las anulaciones y los cobros de ventas canceladas se devuelven en efectivo).
- QR dinámico generado por el sistema, sucursal y caja de MP: la terminal es un Point Smart que muestra el QR.
- Registro manual de cobros electrónicos cuando MP no responde.
- Varias terminales: hay una sola caja y un solo Point.
- Cuotas preconfiguradas o costos de financiación.
- Diseñar la facturación: solo el punto de llamada.

## Decisions

### API de Mercado Pago: Orders API, tipo `point`, terminal en modo PDV (investigado el 2026-11-10)
- **Orders API (`POST /v1/orders`, `type: "point"`) y no Payment Intents.** La documentación de Point de Argentina usa la Orders API y tiene una guía para migrar desde Payment Intents; MP indica que las funciones nuevas se desarrollan sobre Orders.
- **Datos de la orden** que se usan:
  - `external_reference` único (hasta 64 caracteres, letras, números, `-` y `_`, sin datos personales): `venta-{numero}-{intento}`.
  - `transactions.payments[0].amount` como texto con 2 decimales (`"1500.00"`). Con `type: point` va **una sola transacción por orden**.
  - `config.point.terminal_id` tal como lo devuelve `GET /terminals/v1/list` (formato `{tipo}__{serie}`).
  - `config.point.print_on_terminal: "no_ticket"`: el ticket lo imprime el sistema a pedido.
  - `config.payment_method.default_type`: débito → `debit_card`, crédito → `credit_card`, Mercado Pago → `qr`. Si no se envía, la terminal acepta cualquier medio y el cliente elige; se envía para que el medio registrado sea el que eligió el empleado. **`qr` funciona solo en modo PDV.**
  - `expiration_time: "PT3M"` (MP acepta de `PT30S` a `PT3H`; sin él son 15 minutos en PDV).
  - Header `X-Idempotency-Key` obligatorio: un UUID por intento, guardado **antes** de llamar.
- **Terminal en modo PDV** (`PATCH /terminals/v1/setup`, `operating_mode: "PDV"`). Funciona en **Point Smart 1 y Point Smart 2** con el software actualizado.
- **Cancelación** (`POST /v1/orders/{id}/cancel`):
  - Orden `created` (la terminal todavía no la tomó): síncrona, `200` con `status: canceled`.
  - Orden `at_terminal`: asíncrona, `202`, con el header `x-allow-cancelable-status: at_terminal` (sin él, `409 cannot_cancel_order`). La confirmación final llega por webhook o consulta.
- **Consulta:** `GET /v1/orders/{id}`.
- **Errores que se traducen:** `409 already_queued_order_for_terminal` (el Point tiene otra orden) y `400` de monto (por ejemplo `minimum_amount_not_met`).
- **QR en la misma terminal:** en modo PDV el Point Smart acepta QR (`default_type: "qr"`). **El dueño confirmó (2026-11-11) que su terminal es un Point Smart y que se cobra en modo integrado, con tarjeta o QR en la misma terminal.** El QR dinámico generado por el sistema queda **fuera de alcance**, y con él la sucursal y la caja de MP.

Fuentes:
- Procesamiento de pagos con Point (Orders API, atributos, `default_type`, expiración, cancelación): https://www.mercadopago.com.ar/developers/es/docs/mp-point/payment-processing
- Estados de una order y de una transacción: https://www.mercadopago.com.ar/developers/es/docs/mp-point/order-status
- Notificaciones de Point (tópico Order, eventos `order.processed`, `order.canceled`, `order.failed`, `order.expired`, `order.action_required`): https://www.mercadopago.com.ar/developers/es/docs/mp-point/notifications
- Migración de Payment Intents a Orders (`/terminals/v1/list`, `/terminals/v1/setup`, `X-Idempotency-Key`): https://www.mercadopago.com.ar/developers/en/docs/mp-point/migrate-payment-intent-to-orders
- Referencia de creación de órdenes (errores `already_queued_order_for_terminal`, `idempotency_key_already_used`, `minimum_amount_not_met`): https://www.mercadopago.com.ar/developers/es/reference/in-person-payments/point/orders/create-order/post
- Webhooks, firma `x-signature`, respuesta en 22 s y reintentos cada 15 min: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks

### Estados de MP traducidos a estados del cobro

| Orden / transacción en MP | `EstadoCobroMp` | Efecto en la venta |
|---|---|---|
| (todavía sin respuesta a la creación) | `creando` | Sigue `pendiente` |
| `created`, `at_terminal`, `action_required/waiting_payment` | `en_espera` | Sigue `pendiente` |
| `at_terminal/cancellation_requested` | `cancelando` | Sigue `pendiente` |
| `processed/accredited` | `aprobado` | Pasa a `pagada` (o el cobro queda `a_devolver` si la venta ya estaba `cancelada`) |
| `failed/*` (con su `status_detail`) | `rechazado` | Sigue `pendiente`; el mostrador ofrece reintentar |
| `expired` | `vencido` | Sigue `pendiente`; el mostrador ofrece reintentar |
| `canceled/*` | `cancelado` | Si la cancelación la pidió el sistema: `cancelada` |
| `action_required/check_on_terminal`, `refunded` sin haberlo pedido | `a_revisar` | Sigue `pendiente`; aviso al admin |

- Los `status_detail` de `failed` se traducen a textos cortos en shared (`rejected_by_issuer` → "Tarjeta rechazada por el banco", `insufficient_amount` → "Fondos insuficientes", `card_disabled` → "Tarjeta bloqueada", `bad_filled_card_data` → "Datos de la tarjeta incorrectos", `high_risk` → "Mercado Pago lo rechazó por seguridad", el resto → "Pago rechazado").
- **El estado solo se toma de `GET /v1/orders/{id}`**, nunca del cuerpo del webhook.

### Modelo de datos
- `enum EstadoVenta`: se agregan **al final** `pendiente` y `cancelada`.
- `Venta` suma: `pagadaEn DateTime?`, `venceEn DateTime?` (solo en `pendiente`), `canceladaEn DateTime?`, `motivoCancelacion String?`. `creadaEn` sigue siendo cuando se registró; el dashboard y la caja agrupan por `creadaEn`.
- `enum EstadoCobroMp { creando en_espera cancelando aprobado rechazado vencido cancelado a_revisar a_devolver devuelto sin_devolver }`. Los tres últimos son el circuito del pago aprobado después de cancelar.
- `enum TipoMovimientoCaja` suma `devolucion_cobro` al final. `MovimientoCaja` suma `cobroMpId String? @db.Uuid` (FK a `cobros_mp`) con `@@unique([cobroMpId, tipo])`: un cobro tiene como mucho un ingreso de MP y una devolución en efectivo, garantizado por la base.
- **`CobroMp` (`cobros_mp`):**
  ```
  id, ventaId (FK), intento Int, medio MedioPago, monto Decimal(12,2),
  claveIdempotencia uuid @unique, referenciaExterna @unique, ordenId String? @unique,
  estado EstadoCobroMp, detalle String?, tipoInformado String?,
  cancelacionPedida Boolean @default(false),
  creadoEn, consultadoEn DateTime?, resueltoEn DateTime?,
  revisadoPorId?, revisadoEn?, notaRevision?
  @@unique([ventaId, intento]); @@index([estado])
  ```
  - **Índice único parcial `cobros_mp_uno_activo`** (`ON cobros_mp ((true)) WHERE estado IN ('creando','en_espera','cancelando')`), agregado a mano en la migración como `turnos_un_solo_abierto`. Garantiza "un cobro a la vez" aunque lleguen dos pedidos juntos (`P2002` → `409 TERMINAL_OCUPADA`).
- **`AvisoMp` (`avisos_mp`):** `id` (el `id` del cuerpo de la notificación, o `x-request-id` si no viene), `ordenId`, `recibidoEn`. El `INSERT` con clave primaria es lo que evita procesar dos veces la misma notificación.
- `TipoNotificacion` suma `cobro_mp_a_revisar` al final, también en `TIPOS_NOTIFICACION` de shared.
- Alternativa descartada: no crear la `Venta` hasta la aprobación (guardar el carrito en el cobro). Evita números salteados, pero contradice la decisión del dueño ("la venta nace `pendiente`"), complica retomar la espera al recargar y obliga a duplicar la validación de precios. Los números de las ventas canceladas quedan visibles en el listado como "Cobro no realizado", que además sirve de rastro.

### Registro de una venta con el Point (`registrarVenta`)
- **¿Va por el Point?** Si `config.point` existe (token y terminal) y algún pago no es en efectivo. Si no, todo sigue como hoy (`pagada` y stock en el momento).
- **Validación nueva:** como máximo un pago distinto de efectivo → `400 UN_SOLO_MEDIO_ELECTRONICO`. Va en el servicio, no en el esquema de shared, porque depende de la configuración.
- **Pasos:**
  1. Transacción (la misma de hoy, con turno y precios): crea la `Venta` `pendiente` con ítems y **todos** los pagos (incluido el efectivo, con `montoRecibido` y `vuelto`), **sin** movimientos de stock. `venceEn = ahora + 10 min`. Crea el `CobroMp` intento 1 en `creando` con su clave de idempotencia. Si el índice parcial salta → `409 TERMINAL_OCUPADA` y no queda nada.
  2. **Fuera de la transacción**, `cliente.crearOrden(...)` con timeout de 10 s:
     - Sale bien: guarda `ordenId`, `estado` traducido y `consultadoEn`.
     - `MercadoPagoNoDisponible`: el cobro queda en `creando`. La respuesta lo informa como "Mercado Pago no responde".
     - `MercadoPagoRechazo`: el cobro pasa a `rechazado` con el motivo traducido.
  3. Responde `201` con la venta (`estado: pendiente`) y su `cobro`.
- No se llama a MP dentro de la transacción para no tener el turno bloqueado hasta 10 s.

### Confirmación (`confirmarCobroAprobado`, en `modules/ventas/cobro.ts`)
- Una transacción:
  1. `UPDATE cobros_mp SET estado = 'aprobado' ... WHERE id = $1 AND estado IN ('creando','en_espera','cancelando','a_revisar')`. Si no actualiza nada, ya se procesó y termina.
  2. `UPDATE ventas SET estado = 'pagada', pagada_en = ahora, vence_en = null WHERE id = $2 AND estado = 'pendiente'`.
     - Si actualiza la venta: movimientos `venta` de stock (con `permitirDesactivado: true`, usuario = el vendedor) y **`encolarFacturaSiCorresponde`**.
     - Si la venta ya estaba `cancelada`: el cobro pasa a `a_devolver`, se crea el ingreso en la cuenta MP y el aviso `cobro_mp_a_revisar` (ver "Pago aprobado después de cancelar"). **No** se llama a la facturación.
- Los dos `UPDATE` condicionados hacen que el webhook, el reenvío y la consulta puedan llegar a la vez: solo uno aplica.

### Punto de llamada a la facturación (dependencia con `facturacion-arca`)
- `facturacion-arca` (design y specs revisados el 2026-11-11) expone `encolarFacturaSiCorresponde(tx, venta, { facturacion, ahora })` en `modules/facturacion/encolado.ts`. `venta` trae `id`, `estado`, `total` y `pagos`. La función no hace nada si la venta no está `pagada` o si la parte electrónica es $0, y es idempotente (único `(ventaId, parte)`).
- **Este cambio la llama en un solo lugar:** dentro de la transacción de `confirmarCobroAprobado`, después del stock, con la venta ya `pagada`. `registrarVenta` ya la llama al final de su transacción (cambio de `facturacion-arca`). Con una venta `pendiente` esa llamada no hace nada, así que no hace falta tocarla.
- **Pago mixto:** la venta en espera guarda todos sus pagos desde el principio, así que al aprobarse `importePorParte` ve la parte electrónica y el efectivo. Se factura **solo la parte electrónica** (factura automática) y el efectivo se puede facturar aparte si el cliente lo pide (F10): hasta **dos facturas por venta**, como define `facturacion`. Este cambio no altera esa regla.
- **Ventas `pendiente` o `cancelada`:** nunca se encola la factura (la función mira `pagada`). `pedirFactura` (`POST /api/ventas/:id/factura`) hoy solo rechaza las anuladas; este cambio le suma `409` para `pendiente` y `cancelada` (requisito "Ventas en espera o canceladas sin factura"). **Un cobro devuelto en efectivo de una venta cancelada nunca dispara factura.**
- Si `facturacion-arca` todavía no está mergeado cuando se implementa este cambio, se deja la llamada detrás de `modules/ventas/al-quedar-pagada.ts` con `alQuedarPagada(tx, venta)` vacío, y quien mergee segundo conecta la función real. Si falla, la transacción entera se deshace y la aprobación se reintenta en la siguiente consulta.

### Cancelación, reintento y vencimiento
- **`POST /api/ventas/:id/cancelar`** (vendedor en su turno, o admin; si no, `403`; venta no `pendiente` → `409 VENTA_NO_EN_ESPERA`):
  - Cobro terminado sin aprobar (`rechazado`, `vencido`, `cancelado`) o `creando` sin `ordenId` → venta `cancelada` en el momento.
  - Cobro `en_espera` → `cliente.cancelarOrden(ordenId)` con el header de `at_terminal`:
    - `200 canceled`: cobro `cancelado` y venta `cancelada`.
    - `202`: cobro `cancelando`, `cancelacionPedida = true`; la venta se cancela cuando una consulta o un aviso informa `canceled`.
    - `409` (ya procesada): se consulta la orden y se aplica lo que diga, lo que puede dejar la venta `pagada` (spec "Aprobado mientras se cancelaba").
  - Motivo guardado: "Cancelada en el mostrador" o "Venció la espera".
- **`POST /api/ventas/:id/cobro/reintentar`:**
  - Último cobro en `creando`: reenvía con **la misma clave de idempotencia** (MP devuelve la misma orden si la primera llegó).
  - Último cobro `rechazado` o `vencido`: crea el intento siguiente (clave y referencia nuevas) y renueva `venceEn = ahora + 10 min`.
  - Cobro activo: `409 TERMINAL_OCUPADA`.
- **Vencimiento a los 10 minutos del último intento:**
  - Lo revisa la tarea periódica: `venceEn <= ahora`, así que justo a los 10 minutos ya vence.
  - Antes de cancelar consulta la orden: si se aprobó, confirma; si sigue activa, pide cancelarla y espera la confirmación.
  - **Por qué 10 minutos:** el cobro vence en MP a los 3 minutos, así que una venta abandonada (empleado que se fue de la pantalla) queda resuelta en 10 sin bloquear el cierre del turno mucho tiempo, y deja margen para dos o tres reintentos.
- **Cobrar de otra forma** es, en el servidor, una cancelación; el mostrador guarda el carrito hasta que la venta queda `cancelada` y lo devuelve intacto.

### Pago aprobado después de cancelar: se devuelve en efectivo
> **Confirmado por el dueño el 2026-11-11.** El dueño respondió *"si lo cancela se devuelve en efectivo"* y confirmó esta lectura: la venta **no revive**, lo cobrado queda como **ingreso en la cuenta de Mercado Pago** y al cliente se le devuelve **en efectivo desde la caja abierta**, igual que las anulaciones (que se devuelven en efectivo por el total). Este diseño aplica esa interpretación; confirmarla al revisar.

- **Al detectar el pago** (`processed` de un cobro cuya venta ya está `cancelada`), en la transacción de `confirmarCobroAprobado`:
  1. La venta sigue `cancelada`: no hay stock ni factura.
  2. `MovimientoCaja` `ingreso`, cuenta `mercado_pago`, por `cobro.monto`, con `cobroMpId`, el turno abierto si lo hay (si no, sin turno, como los movimientos de MP del admin), usuario = el vendedor de la venta, y motivo "Cobro de la venta #N cancelada". No toca el esperado (es de la cuenta MP) y aparece en Administración → Mercado Pago.
  3. Cobro `a_devolver` y aviso `cobro_mp_a_revisar` ("Cobro de Mercado Pago a devolver").
  - La transición `aprobado → a_devolver` va por el mismo `UPDATE ... WHERE estado IN (...)` condicionado, y `@@unique([cobroMpId, tipo])` respalda que la misma aprobación por varias vías deja **un** ingreso.
- **En el mostrador:** `GET /api/caja/estado` suma `devolucionesPendientes: { cobroId, monto, ventaNumero }[]`. La pantalla de venta ya consulta el estado de la caja; si hay alguna, muestra un **diálogo modal que no se cierra con Esc ni haciendo clic afuera y bloquea el escaneo**, con el texto del spec y dos botones:
  - **Ya devolví $X** → `POST /api/mercado-pago/cobros/:id/devolucion` (sin cuerpo). En una transacción:
    - `turnoParaOperar` (sin turno → `409 SIN_TURNO_ABIERTO`, código existente);
    - `UPDATE cobros_mp SET estado = 'devuelto' WHERE id AND estado = 'a_devolver'` (si no actualiza nada → `409 DEVOLUCION_YA_CONFIRMADA`);
    - `MovimientoCaja` `devolucion_cobro`, cuenta `efectivo`, turno abierto, por **`cobro.monto`** (el pedido no lleva monto, así que no se puede cambiar), con motivo "Devolución de cobro de Mercado Pago · venta #N";
    - aviso al admin ("Devolución en efectivo de un cobro de Mercado Pago").
  - **El cliente ya se fue** → `POST /api/mercado-pago/cobros/:id/sin-devolver`: cobro `sin_devolver` (mismo `UPDATE` condicionado), sin movimiento, aviso al admin. El admin lo ve en "Cobros a revisar", lo resuelve por fuera (por ejemplo, devolviendo por la app de MP) y lo marca revisado con nota.
  - Los pueden usar el empleado del turno abierto y el admin.
- **Esperado:** `resumenDeCaja` suma los `devolucion_cobro` en efectivo del turno a `devoluciones` (la línea pasa a llamarse "Devoluciones" en `Turnos.tsx` y en el aviso de cierre), junto con el total de las ventas anuladas. El movimiento aparece en el detalle del turno.
- **Bordes:**
  - *Sin turno abierto cuando llega el pago:* el ingreso queda sin turno y la devolución queda pendiente. El modal aparece apenas alguien abre el turno, y la devolución sale de ese turno.
  - *Turno que se intenta cerrar entre el pago y la devolución:* `cerrarTurno` rechaza con `409 DEVOLUCION_PENDIENTE` mientras exista **cualquier** cobro `a_devolver` (no hay un turno "dueño" del cobro: sale del que esté abierto). Es la misma idea que el cobro en espera. `sin_devolver` no bloquea, para que un cliente que se fue no deje el turno trabado.
  - *El aviso o la aprobación llegan dos veces:* un solo ingreso y una sola devolución pendiente (transición condicionada y único `(cobroMpId, tipo)`).
  - *Devolución ya confirmada (doble clic, dos pantallas):* `409 DEVOLUCION_YA_CONFIRMADA` y una sola salida de efectivo.
  - *Monto:* siempre `cobro.monto`. En una venta mixta cancelada es solo la parte del Point, porque el efectivo nunca se llegó a cobrar.
- **Dashboard:** el ingreso de MP suma en "ingresos" (ya incluye las dos cuentas). La devolución en efectivo no tiene renglón propio y se ve en el detalle del turno y en el esperado. Se acepta por ser un caso raro (ver Open Questions).
- **Mientras la cancelación está pedida y sin confirmar** (`cancelacionPedida` y cobro `cancelando`), un `processed` sí confirma la venta: el cliente pagó antes de que la cancelación se concretara y la mercadería sigue en el mostrador.
- `action_required/check_on_terminal` (MP lo documenta como estado que no cambia más) va a `a_revisar`: el mostrador pide mirar el Point y solo ofrece Cancelar, y el admin lo ve en "Cobros a revisar". Si después MP informa `processed`, entra por el circuito de devolución.

### Webhook firmado: `POST /api/mercado-pago/webhook`
- **Única ruta nueva sin sesión.** Se suma a `RUTAS_ABIERTAS` en `rutas-protegidas.test.ts`. Tiene `bodyLimit` de 64 KB.
- **Pasos:**
  1. Sin `MP_WEBHOOK_SECRET` → `401`.
  2. Parsear `x-signature` (`ts=...,v1=...`). Si falta algo → `401`.
  3. **Tolerancia:** `|ahora − ts| <= 300 s`. Si `ts` tiene 13 dígitos se toma como milisegundos (la documentación muestra segundos, `ts=1704908010`, y no aclara la unidad). Afuera de la tolerancia → `401`.
  4. **Manifest:** `id:{data.id};request-id:{x-request-id};ts:{ts};`, con `data.id` del query en minúsculas, y omitiendo `id:` o `request-id:` si no vienen. Se firma con HMAC-SHA256 y la clave secreta, en hexadecimal, y se compara con `v1` usando `timingSafeEqual`.
     - La página oficial de webhooks solo muestra el formato del header y remite a los SDK. El template y el paso a minúsculas salen de los SDK y de reportes de la comunidad ([TabNews](https://www.tabnews.com.br/mss/5e345d47-e76a-449b-84ad-dc65fe55341b)). **Hay que confirmarlo con "Simular notificación" del panel de MP y con usuarios de prueba** (tarea 8.2).
  5. Si `type !== 'order'` → `200` sin hacer nada.
  6. `INSERT` en `avisos_mp`. Si ya existe → `200` sin más (notificación repetida).
  7. Buscar el cobro por `ordenId` (o por `external_reference` si viene en `data`). Si no hay → `200`.
  8. `actualizarCobro(cobro)`: `GET /v1/orders/{id}` (10 s) y aplicar el estado. Si MP no responde, igual se contesta `200`: la consulta de respaldo lo resuelve.
  9. `200`. MP espera la respuesta como máximo 22 s; el peor caso son unos 10 s.
- **Por qué 300 s:** es la ventana habitual contra reenvíos maliciosos y tolera relojes algo corridos (el servidor usa NTP). Una notificación legítima que llega tarde y se rechaza no hace daño: la consulta de respaldo cubre el estado. MP reintenta cada 15 minutos; si los reintentos conservan el `ts` original, se rechazan por la misma razón y tampoco importa.
- La firma se verifica sobre el `data.id` del **query**, que es lo que firma MP; el cuerpo solo se usa para el `id` de la notificación.

### Consulta de respaldo: `src/jobs/cobros-mp.ts`
- `revisarCobros({ prisma, mercadoPago, ahora })`, una pasada:
  1. Cobros `en_espera` o `cancelando` con `ordenId` y `consultadoEn` nulo o `<= ahora − 3 s`: los consulta de a uno y aplica el estado.
  2. Ventas `pendiente` con `venceEn <= ahora`: vencimiento (ver arriba).
- `iniciarCobrosMp(...)` usa `iniciarCiclo` cada **1 s**. El límite de 3 s por cobro lo pone `consultadoEn`, así el vencimiento se aplica con precisión de 1 s y los escenarios de borde de 2,999 s y 3,000 s se testean llamando a `revisarCobros` con el reloj controlado.
- Se arranca en `server.ts` solo si hay Point configurado, y se detiene en `onClose`.
- Sin cobros activos, cada pasada es una consulta por índice (`estado`), sin llamadas a MP.

### Rutas
- `POST /api/ventas` (la de hoy) puede responder una venta `pendiente` con `cobro`.
- `GET /api/ventas/:id/cobro`: estado del último cobro, solo de la base. El mostrador lo pide cada 1 s mientras espera.
- `POST /api/ventas/:id/cobro/reintentar`, `POST /api/ventas/:id/cancelar` y `GET /api/ventas/en-espera` (la venta pendiente del turno, para retomar al recargar). Empleado y admin.
- `POST /api/caja/turnos/:id/cerrar`: si el turno tiene ventas `pendiente` → `409 COBRO_EN_ESPERA` con el número de venta; si hay algún cobro `a_devolver` → `409 DEVOLUCION_PENDIENTE` con el monto.
- `GET /api/caja/estado` suma `devolucionesPendientes`.
- `POST /api/mercado-pago/cobros/:id/devolucion` y `POST /api/mercado-pago/cobros/:id/sin-devolver`: empleado del turno abierto y admin. Entran en `RUTAS_DEL_EMPLEADO`.
- `GET /api/mercado-pago/cobros-a-revisar` y `POST /api/mercado-pago/cobros/:id/revisado` (`{ nota }`, de 3 a 200 caracteres; solo para `a_revisar` y `sin_devolver`). Solo admin.
- `POST /api/ventas/:id/factura` (de `facturacion-arca`): `409` si la venta está `pendiente` o `cancelada`.
- Códigos nuevos en `shared/errores.ts`: `TERMINAL_OCUPADA`, `UN_SOLO_MEDIO_ELECTRONICO`, `VENTA_NO_EN_ESPERA`, `COBRO_EN_ESPERA`, `DEVOLUCION_PENDIENTE`, `DEVOLUCION_YA_CONFIRMADA` y `MP_NO_DISPONIBLE`.

### Caja y dashboard
- `resumenDeCaja`: `porMedio` y `cantidadVentas` filtran `venta: { turnoId, estado: { in: ['pagada', 'anulada'] } }`. Las anuladas siguen contando como venta del turno, porque la devolución se resta aparte. `devoluciones` suma, además del total de las anuladas en el turno, los `devolucion_cobro` en efectivo del turno.
- `cerrarTurno`: dentro de la transacción, después del `FOR UPDATE` del turno, cuenta las ventas `pendiente` del turno y los cobros `a_devolver`. El bloqueo `FOR SHARE` de `registrarVenta` y de la confirmación de la devolución (que usa `turnoParaOperar`) hace que no se cuele nada durante el cierre.
- **Dashboard:** no cambia el código (ya filtra `pagada`); se suman tests con ventas `pendiente` y `cancelada` para que el spec quede cubierto.

### Mostrador
- **F2, F3 y F4** abren el mismo diálogo de hoy; Enter manda la venta. Si vuelve `pendiente`, se abre `DialogoEsperaCobro` (en `pos/Dialogos.tsx`):
  - Monto y medio en grande, y "Pasá la tarjeta por el Point" o "Mostrale el QR del Point al cliente".
  - Estado actualizado cada 1 s con `GET /api/ventas/:id/cobro`. Con la consulta de MP cada 3 s, la aprobación se ve en 4 s o menos.
  - Motivo del rechazo, **Reintentar** (Enter), **Cobrar de otra forma** y **Cancelar** (Esc, con confirmación).
  - **Mercado Pago no responde** (decisión del dueño: sin registro manual): el texto es "Mercado Pago no responde. Por ahora cobrá solo en efectivo (F1) o reintentá en un rato.", y se repite como aviso en el carrito al elegir **Cobrar de otra forma**. No hay forma de registrar un débito, crédito o MP a mano mientras el Point esté configurado.
- **Devolución pendiente:** `DialogoDevolucionCobro` modal, que no se cierra con Esc ni con clic afuera y bloquea el escaneo, con **Ya devolví $X** y **El cliente ya se fue** (ver "Pago aprobado después de cancelar"). Se muestra con lo que trae `GET /api/caja/estado`, que la pantalla de venta pide cada 5 s mientras hay un turno abierto.
- **Pago mixto (F6):** con Point, al asignar un segundo medio electrónico el campo se deshabilita con la explicación. Al aprobarse, la pantalla de "venta cobrada" muestra "Cobrá $X en efectivo · vuelto $Y".
- **Al cargar la pantalla** se pide `GET /api/ventas/en-espera` y, si hay, se retoma la espera. Mientras tanto, el carrito de esa venta se guarda en `sessionStorage` para devolverlo con **Cobrar de otra forma** aunque se haya recargado.
- **F9** solo con la última venta `pagada`. `Ticket.tsx` no cambia.
- `Caja.tsx`: el diálogo de cierre muestra el aviso de cobro en espera o de devolución pendiente y deshabilita **Cerrar** mientras haya uno.
- `ventas/Ventas.tsx`: etiquetas "En espera" y "Cobro no realizado", y el motivo en el detalle.
- `admin/MercadoPago.tsx`: sección **Cobros a revisar** (a revisar, devolución pendiente y sin devolver) con el formulario de nota. `admin/Turnos.tsx`: la línea "Devoluciones de anulaciones" pasa a "Devoluciones".

### Configuración
- `MP_TERMINAL_ID` (texto) y `MP_WEBHOOK_SECRET` (texto), opcionales:
  - `MP_TERMINAL_ID` exige `MP_ACCESS_TOKEN`: si falta el token, la app no arranca y nombra la variable.
  - `MP_WEBHOOK_SECRET` exige `MP_TERMINAL_ID`.
  - Con token y terminal hay Point. Sin secreto, solo se consulta.
- Un script `pnpm --filter api mp:terminales` (en `src/cli/`) lista las terminales de la cuenta y pasa una a modo PDV, para que el dueño no tenga que usar `curl`.

### Archivos compartidos con los otros cambios en curso

| Archivo | Qué toca este cambio | `saldo-mercado-pago` | `aviso-reposicion-diario` | `facturacion-arca` |
|---|---|---|---|---|
| `apps/api/prisma/schema.prisma` | `pendiente`/`cancelada` al final de `EstadoVenta`; `cobro_mp_a_revisar` y `devolucion_cobro_mp` al final de `TipoNotificacion`; `devolucion_cobro` al final de `TipoMovimientoCaja`; `cobroMpId` en `MovimientoCaja`; columnas en `Venta`; `CobroMp`, `AvisoMp`, `EstadoCobroMp` | Nada | `reposicion` en `TipoNotificacion`, `EjecucionTarea` | `Factura`, `TicketAccesoArca` y sus enums; relación en `Venta`; no toca `EstadoVenta` |
| Migraciones | `cobro_mercado_pago`, con el índice parcial a mano | Ninguna | `aviso_reposicion` | La suya |
| `apps/api/src/config.ts` | `MP_TERMINAL_ID`, `MP_WEBHOOK_SECRET` y sus reglas | `MP_ACCESS_TOKEN` | Nada | Variables de ARCA |
| `.env.example` (api e infra) | Sus dos variables, debajo de `MP_ACCESS_TOKEN` | `MP_ACCESS_TOKEN` | Nada | Bloque de ARCA |
| `apps/api/src/server.ts` | Bloque de `iniciarCobrosMp` | Crea el cliente de MP | Bloque del aviso | Su tarea |
| `apps/api/src/app.ts` | `config.point?` en `OpcionesApp`; rutas del webhook | `mercadoPago?` y `rutasMercadoPago` | Nada | Sus rutas |
| `apps/web/src/admin/PanelAdmin.tsx` | Nada | Nada | Nada | Su tarjeta |
| `apps/web/src/app/rutas.tsx` | Nada | Nada | Nada | Sus pantallas |
| `packages/shared/src/index.ts` | Nada nuevo (usa `mercadopago.ts`) | Crea la exportación | Nada | Lo suyo |
| `packages/shared/src/ventas.ts` | `ESTADOS_VENTA`, `cobro` en `ventaDetalleSchema`, `cobro_mp_a_revisar` | Nada | `reposicion` en `TIPOS_NOTIFICACION` | Datos de factura en el detalle |
| `apps/web/src/pos/Venta.tsx` | Pantalla de espera, F2/F3/F4 y retomar | Nada | Nada | Quizá CAE en "venta cobrada" |
| `apps/web/src/pos/Ticket.tsx` | Nada | Nada | Nada | Datos de la factura |
| `modules/ventas/servicio.ts` | Rama del Point en `registrarVenta`; listado con estados nuevos | Nada | Nada | `encolarFacturaSiCorresponde` al final de `registrarVenta`, cancelación de facturas en `anularVenta` y `facturas` en el detalle |
| `modules/facturacion/` (de `facturacion-arca`) | `409` de `pedirFactura` para `pendiente` y `cancelada` | Nada | Nada | Dueño del módulo |
| `modules/caja/servicio.ts` | Filtro por estado y devoluciones de cobros en `resumenDeCaja`; `409` en `cerrarTurno`; `devolucionesPendientes` en el estado | Nada | Nada | Nada |
| `modules/dashboard/servicio.ts` | Nada (solo tests) | Nada | Nada | Nada |

- **Requisitos:** este cambio no modifica ningún requisito que modifique `facturacion-arca`. Ese cambio modifica "Ticket a pedido" (`punto-de-venta`) y "Texto del aviso de anulación" (`notificaciones`) y agrega requisitos nuevos. Este cambio modifica "Cobro rápido con un solo medio" y "Pago mixto" (`punto-de-venta`) y "Registro de una venta", "Pagos de una venta" y "Descuento de stock al vender" (`ventas`).
- **Orden recomendado de merge:** `aviso-reposicion-diario` → `saldo-mercado-pago` → `facturacion-arca` → este cambio. Así la migración de este cambio queda última, los valores de enum se agregan al final sin chocar, y la llamada a la facturación se conecta directo. Si `facturacion-arca` llega después, se usa `al-quedar-pagada.ts` (ver arriba). Si las migraciones se generan en paralelo, se regenera la del cambio que llega segundo para que quede con fecha posterior.
  - El design de `facturacion-arca` propone `aviso-reposicion-diario` → `facturacion-arca` → `cobro-mercado-pago` → `saldo-mercado-pago`. **Ese orden no sirve:** este cambio usa `src/integrations/mercadopago/` y `MP_ACCESS_TOKEN`, que crea `saldo-mercado-pago`, así que el saldo tiene que entrar antes. Entre el saldo y la facturación el orden da igual: solo comparten `config.ts`.

## Risks / Trade-offs

- **[Sin HTTPS público no hay webhooks]** → La consulta cada 3 s es obligatoria y alcanza sola; los webhooks solo aceleran y cubren el caso "aprobado después de un timeout sin `ordenId`".
- **[Timeout al crear el cobro y el empleado cancela]** Sin `ordenId` no se puede cancelar en MP: la orden, si existía, vence a los 3 minutos. Si el cliente igual pagara, solo se vería por webhook (`external_reference`), que lo manda al circuito de devolución en efectivo, o en la app de MP. → Es un caso raro (MP no responde y el cliente paga igual). Se mitiga reintentando con la misma clave en lugar de cancelar, que es la opción por defecto de la pantalla.
- **[La firma del webhook se implementa con información no oficial]** → La firma inválida solo hace que el aviso se ignore; la consulta sigue resolviendo. Se prueba con el simulador del panel antes de producción.
- **[Ventas canceladas con número]** El listado muestra números que no son ventas. → Se muestran como "Cobro no realizado", con motivo; sirven de rastro de intentos.
- **[`check_on_terminal` deja ventas sin confirmar que tal vez se cobraron]** → Aviso al admin y lista de cobros a revisar; MP lo documenta como estado excepcional.
- **[Consultar MP cada 3 s]** → Solo mientras hay un cobro activo (como mucho uno), unas 20 consultas por minuto, durante a lo sumo 3 minutos por cobro.
- **[Dos procesos durante un deploy]** → Los `UPDATE` condicionados y el índice parcial evitan efectos dobles.
- **[El turno no se puede cerrar con un cobro en espera]** → Como mucho 10 minutos, y el empleado puede cancelarlo en el momento.
- **[El turno no se puede cerrar con una devolución pendiente]** → Se resuelve en el momento con **Ya devolví** o **El cliente ya se fue**; el modal no deja olvidarla.
- **[El empleado marca "Ya devolví" sin entregar la plata]** → El esperado baja y la diferencia del cierre no lo delata. Mitigación: el aviso al admin con quién confirmó y el monto, como con los gastos del empleado.
- **[Mientras MP no responde solo se cobra en efectivo]** → Decisión del dueño. Se pierde alguna venta con tarjeta, pero nunca se registra un cobro que no pasó.

## Migration Plan

1. Migración `cobro_mercado_pago`: `ALTER TYPE "EstadoVenta" ADD VALUE 'pendiente'` y `'cancelada'`, `ALTER TYPE "TipoNotificacion" ADD VALUE 'cobro_mp_a_revisar'` y `'devolucion_cobro_mp'`, `ALTER TYPE "TipoMovimientoCaja" ADD VALUE 'devolucion_cobro'`, `movimientos_caja.cobro_mp_id` (nula) con su único, columnas nuevas en `ventas` (nulas), `EstadoCobroMp`, las tablas `cobros_mp` y `avisos_mp`, y el índice parcial `cobros_mp_uno_activo` a mano. No toca datos existentes.
2. Deploy sin `MP_TERMINAL_ID`: todo sigue como hoy, solo se corrige el filtro de la caja.
3. Activar el Point: cargar `MP_TERMINAL_ID` (con `pnpm --filter api mp:terminales`) y reiniciar. Con HTTPS, configurar el webhook en el panel de MP (evento **Order**, URL `https://<dominio>/api/mercado-pago/webhook`), cargar `MP_WEBHOOK_SECRET` y reiniciar.
4. **Vuelta atrás:** sacar `MP_TERMINAL_ID` y reiniciar vuelve al cobro manual sin deploy. Volver a la versión anterior con `deploy.sh` también funciona, pero las ventas `pendiente` o `cancelada` que hubiera las vería mal el código viejo: antes, cancelar las pendientes. Los valores de enum no se pueden sacar sin recrear el tipo.

## Open Questions

Resueltas por el dueño el 2026-11-11 (ya aplicadas arriba): la terminal es un **Point Smart** en modo integrado (el QR dinámico queda fuera de alcance); **mientras MP no responde solo se cobra en efectivo**, sin registro manual; se registra el **medio que eligió el empleado** (lo que informa MP queda en `tipoInformado`).

También confirmadas por el dueño el 2026-11-11: la devolución en efectivo del cobro aprobado después de cancelar (venta cancelada, ingreso en la cuenta MP y devolución desde la caja abierta, con modal en el mostrador y aviso al admin), y que esa devolución **no lleva renglón propio en el dashboard** (el ingreso de MP suma en "ingresos").

1. **Monto mínimo de MP.** La documentación no lo publica para Point. Supuesto: el sistema acepta desde $0,01 y, si MP lo rechaza, se muestra el motivo. Hay que verificarlo con usuarios de prueba.
2. **Unidad de `ts` y template de la firma.** Supuesto: segundos (o milisegundos si tiene 13 dígitos) y el template de los SDK. Se confirma con el simulador del panel (tarea 8.2).
