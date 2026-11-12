# Spec Delta

## MODIFIED Requirements

### Requirement: Registro de una venta
Admin y empleado SHALL poder registrar una venta con uno o más ítems y uno o más pagos. Cada venta MUST guardar un número correlativo único, el usuario, la fecha, el turno de caja abierto en que se registró, el total, los ítems y los pagos. Una venta cobrada solo en efectivo, o sin el Point configurado, MUST quedar `pagada`; una venta con una parte cobrada por el Point MUST quedar `pendiente` hasta que se apruebe el pago. Un ítem de catálogo MUST referenciar un producto activo, con cantidad entera entre 1 y 999. Sin un turno abierto en el que el usuario pueda operar, la venta MUST rechazarse con `409` sin registrar nada.

#### Scenario: Venta simple
- **WHEN** un empleado con su turno abierto vende 2 alfajores de $900 y 1 gaseosa de $1.500 cobrando en efectivo
- **THEN** se registra la venta con el número siguiente, total $3.300, estado `pagada`, el empleado como vendedor, su turno y un pago en efectivo de $3.300

#### Scenario: Venta con débito por el Point
- **WHEN** con el Point configurado un empleado vende $3.300 cobrando con débito
- **THEN** se registra la venta con el número siguiente, total $3.300, estado `pendiente`, su turno y un pago en débito de $3.300, y se envía el cobro al Point

#### Scenario: Venta vacía o con producto desactivado
- **WHEN** la venta no tiene ítems o incluye un producto desactivado o inexistente
- **THEN** el sistema la rechaza y no registra nada

#### Scenario: Venta sin turno abierto
- **WHEN** alguien intenta registrar una venta sin ningún turno abierto
- **THEN** el sistema responde `409`, no registra la venta y no mueve stock

### Requirement: Pagos de una venta
Cada pago MUST tener un medio (`efectivo`, `debito`, `credito` o `mercado_pago`) y un monto mayor que cero, y la suma de los pagos MUST ser igual al total de la venta. Una venta SHALL poder tener pagos con distintos medios (pago mixto), con un pago como máximo por medio. Con el Point configurado, una venta MUST tener como máximo un pago que no sea en efectivo; si tiene más, MUST rechazarse con `400`.

#### Scenario: Pago mixto
- **WHEN** una venta de $5.000 se paga con $2.000 en efectivo y $3.000 en débito
- **THEN** la venta queda registrada con esos dos pagos

#### Scenario: Pagos que no suman el total
- **WHEN** los pagos suman distinto del total
- **THEN** el sistema responde `400` y no registra la venta

#### Scenario: Parte del Point igual al total
- **WHEN** con el Point configurado una venta de $5.000 se paga con $5.000 en débito
- **THEN** la venta queda en espera con un solo pago en débito de $5.000 y no hay parte en efectivo

#### Scenario: Parte del Point un centavo menor que el total
- **WHEN** con el Point configurado una venta de $5.000 se paga con $4.999,99 en débito y $0,01 en efectivo
- **THEN** la venta queda en espera con los dos pagos y al Point se envían $4.999,99

#### Scenario: Parte en efectivo de cero
- **WHEN** una venta de $5.000 se paga con $5.000 en débito y $0 en efectivo
- **THEN** el sistema responde `400` y no registra la venta

#### Scenario: Dos medios electrónicos con el Point configurado
- **WHEN** con el Point configurado una venta de $5.000 se paga con $2.000 en débito y $3.000 en crédito
- **THEN** el sistema responde `400` indicando que solo se puede cobrar una parte con el Point, y no registra la venta

### Requirement: Descuento de stock al vender
Una venta `pagada` en el momento MUST descontar el stock de cada producto vendido con un movimiento `venta` por la cantidad vendida, en la misma operación que la venta. Una venta en espera MUST NOT mover stock hasta que se apruebe su pago; al aprobarse, el descuento MUST hacerse en la misma operación que el paso a `pagada`, aunque el producto se haya desactivado mientras tanto. Una venta MUST NOT rechazarse por falta de stock.

#### Scenario: Stock descontado
- **WHEN** se venden en efectivo 2 unidades de un producto con stock 10
- **THEN** el stock queda en 8 y hay un movimiento `venta` de -2 asociado a la venta

#### Scenario: Vender sin stock
- **WHEN** se vende un producto con stock 0
- **THEN** la venta se registra y el stock queda negativo

#### Scenario: Venta en espera sin stock descontado
- **WHEN** se cobran con débito por el Point 2 unidades de un producto con stock 10 y el pago todavía no se aprobó
- **THEN** el stock sigue en 10 y no hay movimientos de esa venta

#### Scenario: Stock descontado al aprobarse
- **WHEN** se aprueba el pago de esa venta en espera
- **THEN** el stock queda en 8 y hay un movimiento `venta` de -2 asociado a la venta

#### Scenario: Pago rechazado sin nada que deshacer
- **WHEN** el pago de esa venta en espera se rechaza y la venta se cancela
- **THEN** el stock sigue en 10 y no hay movimientos de esa venta

## ADDED Requirements

### Requirement: Venta en espera de un cobro
Una venta `pendiente` MUST NOT descontar stock ni contar en la caja ni en el dashboard. Sus ítems, precios y pagos MUST quedar fijos desde que se registra. Una venta en espera MUST NOT poder anularse: anularla MUST responderse con `409`. Solo puede pasar a `pagada` al aprobarse su pago o a `cancelada`.

#### Scenario: Precios que cambian durante la espera
- **WHEN** una venta en espera tiene una gaseosa de $1.500 y el admin sube su precio a $1.600 antes de que se apruebe el pago
- **THEN** al aprobarse, la venta queda `pagada` con la gaseosa a $1.500

#### Scenario: Intento de anular una venta en espera
- **WHEN** alguien intenta anular una venta `pendiente`
- **THEN** el sistema responde `409` y la venta no cambia

### Requirement: Confirmación de la venta al aprobarse el pago
Al aprobarse el pago de una venta `pendiente`, el sistema MUST, en una sola operación: pasarla a `pagada` con la fecha de aprobación, descontar el stock y encolar su factura automática según `facturacion` (solo la parte electrónica). Si la venta ya no está `pendiente`, MUST NOT hacer nada de eso.

#### Scenario: Aprobación
- **WHEN** Mercado Pago aprueba el pago de la venta #120 en espera a las 10:15:05
- **THEN** la venta #120 queda `pagada` con fecha de aprobación 10:15:05, se descuenta su stock y se encola su factura automática, todo junto

#### Scenario: Aprobación de una venta mixta
- **WHEN** con la facturación configurada se aprueba el cobro de $3.000 en débito de una venta de $5.000 con $2.000 en efectivo
- **THEN** la venta queda `pagada` con una sola factura automática de $3.000, y los $2.000 en efectivo se pueden facturar aparte si el cliente lo pide

#### Scenario: La facturación falla
- **WHEN** al aprobarse el pago falla la llamada a la facturación dentro de la operación
- **THEN** la venta sigue `pendiente`, el stock no cambia y la aprobación se vuelve a procesar en la siguiente consulta

### Requirement: Cancelación de una venta en espera
El empleado que registró la venta en espera, en su turno, o el admin, SHALL poder cancelarla. Si su cobro está activo, el sistema MUST pedirle a Mercado Pago que lo cancele y la venta MUST pasar a `cancelada` solo cuando Mercado Pago confirme la cancelación; si en cambio se aprueba el pago, la venta MUST quedar `pagada`. Si el cobro ya terminó sin aprobarse, la venta MUST pasar a `cancelada` en el momento.

#### Scenario: Cancelar con el cobro sin tomar por la terminal
- **WHEN** el empleado cancela una venta cuyo cobro todavía no llegó a la terminal
- **THEN** Mercado Pago confirma la cancelación en el momento y la venta queda `cancelada`

#### Scenario: Cancelar con el cobro en la pantalla del Point
- **WHEN** el empleado cancela una venta cuyo cobro ya está en la pantalla del Point
- **THEN** la venta sigue en espera con la cancelación pedida hasta que Mercado Pago la confirme, y entonces queda `cancelada`

#### Scenario: Cancelar después de un rechazo
- **WHEN** el pago de una venta en espera se rechazó y el empleado cancela
- **THEN** la venta queda `cancelada` en el momento, sin stock ni caja que deshacer

#### Scenario: Empleado intenta cancelar una venta de otro turno
- **WHEN** un empleado intenta cancelar una venta en espera de otro turno
- **THEN** el sistema responde `403` y la venta no cambia

#### Scenario: Cancelar una venta que no está en espera
- **WHEN** se intenta cancelar una venta `pagada`
- **THEN** el sistema responde `409` y la venta no cambia

### Requirement: Vencimiento de una venta en espera
Una venta `pendiente` MUST vencer 10 minutos después de enviar su último intento de cobro. Al vencer, el sistema MUST consultar antes el estado del cobro: si se aprobó, la venta MUST quedar `pagada`; si sigue activo, MUST pedir su cancelación; si terminó sin aprobarse, la venta MUST quedar `cancelada` con el motivo "Venció la espera".

#### Scenario: 1 segundo antes del vencimiento
- **WHEN** el último intento de cobro de una venta se envió a las 10:00:00 sin aprobarse y el sistema revisa a las 10:09:59
- **THEN** la venta sigue `pendiente`

#### Scenario: Justo en el vencimiento
- **WHEN** el último intento de cobro de una venta se envió a las 10:00:00 y venció sin pagarse, y el sistema revisa a las 10:10:00
- **THEN** la venta queda `cancelada` con el motivo "Venció la espera"

#### Scenario: Después del vencimiento
- **WHEN** el último intento de cobro de una venta se envió a las 10:00:00 sin pagarse y el sistema revisa a las 10:10:01
- **THEN** la venta queda `cancelada` con el motivo "Venció la espera"

#### Scenario: Reintentar renueva el plazo
- **WHEN** una venta empezó a las 10:00:00, el empleado reintentó el cobro a las 10:06:00 y el sistema revisa a las 10:12:00
- **THEN** la venta sigue `pendiente` hasta las 10:16:00

#### Scenario: Aprobado justo antes de vencer
- **WHEN** al vencer la venta la consulta a Mercado Pago informa el pago aprobado
- **THEN** la venta queda `pagada` y no se cancela

### Requirement: Ventas en espera o canceladas sin factura
Una venta `pendiente` o `cancelada` MUST NOT tener facturas: no se encola la automática y pedir factura para ella MUST rechazarse con `409`. Una venta en espera que se aprueba se factura recién al quedar `pagada`.

#### Scenario: Pedir factura de una venta en espera
- **WHEN** el empleado pide factura de una venta en espera con $2.000 en efectivo
- **THEN** el sistema responde `409` y la venta no tiene facturas

#### Scenario: Venta cancelada con el cobro devuelto en efectivo
- **WHEN** el cobro de una venta cancelada se aprobó y se devolvió en efectivo
- **THEN** la venta sigue `cancelada` y no tiene ninguna factura

### Requirement: Ventas en espera y canceladas en el listado
El listado y el detalle de ventas MUST mostrar los estados `pendiente` ("En espera") y `cancelada` ("Cobro no realizado"), con los mismos permisos por rol que las demás ventas. El detalle de una venta cancelada MUST mostrar el motivo y la fecha de cancelación. El ticket MUST poder imprimirse solo de ventas `pagada` o `anulada`.

#### Scenario: El admin revisa una venta cancelada
- **WHEN** el admin abre el detalle de una venta cancelada por vencimiento
- **THEN** ve el estado "Cobro no realizado", el motivo "Venció la espera" y la fecha

#### Scenario: Ticket de una venta en espera
- **WHEN** se intenta imprimir el ticket de una venta en espera
- **THEN** la opción de imprimir no está disponible
