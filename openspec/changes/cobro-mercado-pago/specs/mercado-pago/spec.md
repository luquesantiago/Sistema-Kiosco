# Spec Delta

## Purpose

Conecta el sistema con la cuenta de Mercado Pago del kiosco: la configuración de las credenciales, la lectura del saldo y los cobros con la terminal Point en modo integrado, con sus notificaciones firmadas y la consulta de respaldo.

## ADDED Requirements

### Requirement: Cobro con la terminal Point
Con el Point configurado, el cobro de una venta con débito, crédito o Mercado Pago MUST enviarse a la terminal por el monto exacto de esa parte, sin que el empleado lo tipee. La terminal MUST aceptar solo el medio elegido: débito con tarjeta de débito, crédito con tarjeta de crédito y Mercado Pago con el código QR que muestra la terminal. Cada cobro MUST vencer en Mercado Pago a los 3 minutos si nadie paga.

#### Scenario: Cobro con débito
- **WHEN** el empleado cobra con débito una venta de $3.300
- **THEN** el Point muestra $3.300,00 para pagar solo con tarjeta de débito

#### Scenario: Cobro con Mercado Pago
- **WHEN** el empleado cobra con Mercado Pago una venta de $3.300
- **THEN** el Point muestra un código QR por $3.300,00 para pagar desde la app de Mercado Pago

#### Scenario: Nadie paga en la terminal
- **WHEN** pasan 3 minutos desde que se envió el cobro y nadie pagó
- **THEN** Mercado Pago informa el cobro como vencido y el sistema lo muestra como vencido

### Requirement: Monto enviado a la terminal
El monto enviado a la terminal MUST ser el de la parte cobrada por el Point, con exactamente 2 decimales y sin redondear: un monto con más de 2 decimales MUST rechazarse con `400` sin crear nada. El sistema MUST aceptar desde $0,01; si Mercado Pago rechaza el monto (por ejemplo, por debajo de su mínimo), el cobro MUST quedar rechazado con un motivo claro.

#### Scenario: Monto entero
- **WHEN** la parte del Point es $1.500
- **THEN** a la terminal se envía "1500.00"

#### Scenario: Monto con un decimal
- **WHEN** la parte del Point es $1.500,5
- **THEN** a la terminal se envía "1500.50"

#### Scenario: Monto mínimo del sistema
- **WHEN** la parte del Point es $0,01
- **THEN** a la terminal se envía "0.01"

#### Scenario: Monto cero
- **WHEN** la parte del Point es $0,00
- **THEN** el sistema responde `400` y no crea la venta ni el cobro

#### Scenario: Monto con tres decimales
- **WHEN** la parte del Point es $0,005
- **THEN** el sistema responde `400` y no crea la venta ni el cobro

#### Scenario: Mercado Pago no acepta el monto
- **WHEN** Mercado Pago rechaza la creación del cobro de $0,01 por el monto
- **THEN** el cobro queda rechazado con el motivo "Mercado Pago no acepta ese monto" y la venta sigue en espera

### Requirement: Un cobro a la vez en la terminal
El sistema MUST tener como máximo un cobro activo (creándose, esperando en la terminal o cancelándose) a la vez. Un cobro nuevo mientras otro está activo MUST rechazarse con `409` sin crear la venta. Si Mercado Pago informa que la terminal ya tiene otro cobro, el cobro MUST quedar rechazado con un motivo que pida liberar el Point.

#### Scenario: Segundo cobro con el primero esperando
- **WHEN** hay un cobro esperando en el Point y se intenta cobrar otra venta con crédito
- **THEN** el sistema responde `409` indicando que el Point está ocupado y no registra la segunda venta

#### Scenario: El Point tiene un cobro hecho por fuera
- **WHEN** Mercado Pago responde que la terminal ya tiene un cobro en espera
- **THEN** el cobro queda rechazado con el motivo "El Point tiene otro cobro abierto: cancelalo en el Point y reintentá"

### Requirement: Mercado Pago no responde al crear o consultar un cobro
Cada pedido a Mercado Pago MUST esperar como máximo 10 segundos. Si Mercado Pago no responde a tiempo al crear el cobro, el sistema MUST informarlo sin dar el cobro por rechazado, y reintentar MUST reutilizar la misma clave para que Mercado Pago no cree dos cobros. Si no responde a una consulta, el cobro MUST quedar como estaba hasta la próxima consulta.

#### Scenario: Respuesta a los 9,9 segundos
- **WHEN** Mercado Pago responde la creación del cobro a los 9,9 segundos
- **THEN** el cobro queda esperando en la terminal

#### Scenario: Sin respuesta a los 10 segundos
- **WHEN** Mercado Pago no responde la creación del cobro en 10 segundos
- **THEN** el mostrador muestra "Mercado Pago no responde. Por ahora cobrá solo en efectivo (F1) o reintentá en un rato." con las opciones de reintentar, cobrar de otra forma y cancelar, y la venta sigue en espera

#### Scenario: Reintento después de un timeout
- **WHEN** después de un timeout el empleado reintenta y la primera creación sí había llegado a Mercado Pago
- **THEN** Mercado Pago devuelve el mismo cobro y en la terminal hay un solo cobro

#### Scenario: Consulta sin respuesta
- **WHEN** una consulta del estado de un cobro esperando no tiene respuesta en 10 segundos
- **THEN** el cobro sigue esperando y se vuelve a consultar en la siguiente revisión

### Requirement: Estado del cobro según Mercado Pago
El sistema MUST tomar el estado de cada cobro solo de la consulta a Mercado Pago: aprobado (pago acreditado), rechazado con su motivo (tarjeta rechazada, fondos insuficientes, etc.), vencido, cancelado o a revisar (la terminal pide confirmación). Un pago aprobado MUST confirmar la venta en espera; los demás estados MUST dejarla en espera sin tocar stock ni caja.

#### Scenario: Pago aprobado
- **WHEN** la consulta informa el pago acreditado de una venta en espera
- **THEN** la venta queda `pagada`

#### Scenario: Pago rechazado
- **WHEN** la consulta informa el pago fallido por fondos insuficientes
- **THEN** el cobro queda rechazado con el motivo "Fondos insuficientes" y la venta sigue en espera

#### Scenario: Cobro vencido
- **WHEN** la consulta informa que el cobro venció
- **THEN** el cobro queda vencido y la venta sigue en espera

#### Scenario: La terminal pide revisar el pago
- **WHEN** la consulta informa que la terminal pide confirmar si el pago se aprobó
- **THEN** el cobro queda a revisar, la venta sigue en espera y el mostrador pide mirar el Point

### Requirement: Consulta de respaldo del estado
Mientras un cobro esté activo, el sistema MUST consultar su estado en Mercado Pago cada 3 segundos, haya o no notificaciones. Una consulta MUST NOT hacerse si la anterior de ese cobro fue hace menos de 3 segundos.

#### Scenario: Sin notificaciones
- **WHEN** el servidor no recibe notificaciones y el cliente paga con débito
- **THEN** el sistema detecta el pago aprobado en la siguiente consulta, a más tardar 3 segundos después

#### Scenario: Consulta 1 ms antes de los 3 segundos
- **WHEN** la última consulta de un cobro fue a las 10:00:00,000 y el sistema revisa a las 10:00:02,999
- **THEN** no se consulta a Mercado Pago por ese cobro

#### Scenario: Consulta justo a los 3 segundos
- **WHEN** la última consulta de un cobro fue a las 10:00:00,000 y el sistema revisa a las 10:00:03,000
- **THEN** se consulta a Mercado Pago por ese cobro

#### Scenario: Cobros terminados
- **WHEN** un cobro ya está aprobado, rechazado, vencido o cancelado
- **THEN** el sistema no lo vuelve a consultar

### Requirement: Notificaciones de Mercado Pago con firma verificada
El sistema SHALL recibir notificaciones de Mercado Pago sin sesión, solo en su ruta de notificaciones. Cada notificación MUST tener una firma válida hecha con la clave secreta del kiosco y una marca de tiempo a no más de 300 segundos de la hora del servidor; si no, MUST rechazarse con `401` sin hacer nada. Una notificación válida MUST NOT confirmar nada por sí misma: dispara una consulta a Mercado Pago.

#### Scenario: Firma válida
- **WHEN** llega una notificación de un cobro con firma válida y marca de tiempo de hace 10 segundos
- **THEN** el sistema responde `200` y consulta el estado de ese cobro en Mercado Pago

#### Scenario: Firma inválida
- **WHEN** llega una notificación con una firma que no corresponde a la clave del kiosco
- **THEN** el sistema responde `401`, no consulta a Mercado Pago y no cambia nada

#### Scenario: Sin firma
- **WHEN** llega una notificación sin el encabezado de firma
- **THEN** el sistema responde `401` y no cambia nada

#### Scenario: Marca de tiempo en el límite
- **WHEN** llega una notificación con firma válida y marca de tiempo de hace exactamente 300 segundos
- **THEN** el sistema la acepta

#### Scenario: Marca de tiempo vencida por 1 segundo
- **WHEN** llega una notificación con firma válida y marca de tiempo de hace 301 segundos
- **THEN** el sistema responde `401` y no cambia nada

#### Scenario: Marca de tiempo adelantada
- **WHEN** llega una notificación con firma válida y marca de tiempo 301 segundos en el futuro
- **THEN** el sistema responde `401` y no cambia nada

#### Scenario: El aviso dice aprobado pero Mercado Pago todavía no
- **WHEN** llega una notificación válida de pago aprobado y la consulta a Mercado Pago informa que el cobro sigue en la terminal
- **THEN** la venta sigue en espera

#### Scenario: Sistema sin clave secreta
- **WHEN** el sistema no tiene configurada la clave secreta de notificaciones y llega una notificación
- **THEN** responde `401` y los cobros se siguen resolviendo por la consulta de respaldo

#### Scenario: Notificación de un cobro desconocido
- **WHEN** llega una notificación válida de un cobro que el sistema no creó
- **THEN** el sistema responde `200` y no cambia nada

### Requirement: Notificación repetida
Una notificación de Mercado Pago que ya se recibió MUST responderse con `200` sin volver a procesarse. Aunque llegue la misma aprobación por varias vías (notificación, reenvío y consulta), la venta MUST confirmarse una sola vez.

#### Scenario: La misma notificación dos veces
- **WHEN** Mercado Pago envía dos veces la misma notificación válida
- **THEN** la segunda recibe `200` y no dispara otra consulta

#### Scenario: Notificación y consulta a la vez
- **WHEN** la notificación y la consulta de respaldo detectan la misma aprobación al mismo tiempo
- **THEN** la venta queda `pagada` una vez y el stock se descuenta una sola vez

### Requirement: Pago aprobado después de cancelar
Si Mercado Pago aprueba un cobro cuya venta ya está cancelada, la venta MUST seguir cancelada, sin descontar stock ni facturarse. En la misma operación, lo cobrado MUST registrarse como ingreso en la cuenta Mercado Pago y el cobro MUST quedar "a devolver" en efectivo por el mismo monto (ver `caja`). Mientras una cancelación está pedida y sin confirmar, un pago aprobado MUST confirmar la venta.

#### Scenario: Aprobado mientras se cancelaba
- **WHEN** el empleado pidió cancelar, Mercado Pago todavía no confirmó la cancelación y el pago se aprueba
- **THEN** la venta queda `pagada` y el mostrador avisa que el cliente llegó a pagar

#### Scenario: Aprobado después de cancelar
- **WHEN** una venta ya está `cancelada` y Mercado Pago informa aprobado su cobro de $3.000 con débito
- **THEN** la venta sigue `cancelada` y el stock no cambia
- **AND** queda un ingreso de $3.000 en la cuenta Mercado Pago con el motivo "Cobro de la venta #120 cancelada"
- **AND** el cobro queda "a devolver" por $3.000 y se crea un aviso para el admin

#### Scenario: La misma aprobación llega dos veces
- **WHEN** la aprobación de ese cobro llega por una notificación y por la consulta de respaldo
- **THEN** hay un solo ingreso de $3.000 y una sola devolución pendiente

#### Scenario: Sin factura
- **WHEN** con la facturación configurada se aprueba el cobro de una venta ya cancelada
- **THEN** no se crea ninguna factura para esa venta

#### Scenario: Pago mixto cancelado
- **WHEN** se canceló una venta de $5.000 con $3.000 en débito y $2.000 en efectivo, y después se aprueba el cobro de $3.000
- **THEN** el ingreso y la devolución pendiente son de $3.000, porque el efectivo nunca se cobró

### Requirement: Cobros a revisar para el admin
El admin SHALL ver en Administración → Mercado Pago los cobros que la terminal pidió revisar, los que esperan devolución y los que el empleado no pudo devolver porque el cliente se fue, con monto, medio, venta, fecha y motivo. SHALL marcar como revisados los dos últimos con una nota obligatoria, sin cambiar ventas, stock ni caja. Un empleado MUST recibir `403`.

#### Scenario: El admin resuelve un cobro que no se pudo devolver
- **WHEN** el cliente se fue sin la devolución, el admin le devuelve la plata por la app de Mercado Pago y marca el cobro como revisado con la nota "devuelto por la app"
- **THEN** el cobro deja de figurar como pendiente de revisión y guarda la nota, quién y cuándo

#### Scenario: Devolución pendiente en la lista
- **WHEN** hay un cobro "a devolver" que el empleado todavía no confirmó
- **THEN** el admin lo ve en la lista como "Devolución en efectivo pendiente", sin la opción de marcarlo revisado

#### Scenario: Sin nota
- **WHEN** el admin intenta marcar un cobro como revisado sin nota
- **THEN** el sistema responde `400`

#### Scenario: Empleado pide los cobros a revisar
- **WHEN** un empleado pide la lista de cobros a revisar
- **THEN** el sistema responde `403`

### Requirement: Sistema sin Point configurado
Sin la terminal Point configurada, el sistema MUST registrar las ventas con débito, crédito o Mercado Pago como `pagada` en el momento, igual que antes de este cambio, y MUST NOT llamar a Mercado Pago para cobrar. Con el Point configurado, MUST NOT poder registrarse un cobro electrónico sin pasar por la terminal, ni siquiera mientras Mercado Pago no responde: en ese caso solo se cobra en efectivo.

#### Scenario: Desarrollo sin credenciales
- **WHEN** el sistema no tiene el Point configurado y el empleado cobra con débito
- **THEN** la venta queda `pagada` en el momento y descuenta stock

#### Scenario: Point configurado
- **WHEN** el sistema tiene el Point configurado y el empleado cobra con débito
- **THEN** la venta queda en espera hasta que Mercado Pago apruebe el pago

#### Scenario: Mercado Pago caído un rato largo
- **WHEN** Mercado Pago no responde y el empleado elige Cobrar de otra forma
- **THEN** vuelve al carrito con el aviso "Mercado Pago no responde. Por ahora cobrá solo en efectivo (F1) o reintentá en un rato." y no hay forma de registrar el débito a mano
