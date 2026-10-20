# ventas Specification

## Purpose

Registra cada venta del kiosco con lo que se vendió, a qué precio, cómo se cobró y quién la hizo, descuenta el stock y permite anularla dejando rastro.

## Requirements

### Requirement: Registro de una venta
Admin y empleado SHALL poder registrar una venta con uno o más ítems y uno o más pagos. Cada venta MUST guardar un número correlativo único, el usuario, la fecha, el total, los ítems y los pagos, y quedar en estado `pagada`. Un ítem de catálogo MUST referenciar un producto activo, con cantidad entera entre 1 y 999.

#### Scenario: Venta simple
- **WHEN** un empleado vende 2 alfajores de $900 y 1 gaseosa de $1.500 cobrando en débito
- **THEN** se registra la venta con el número siguiente, total $3.300, estado `pagada`, el empleado como vendedor y un pago en débito de $3.300

#### Scenario: Venta vacía o con producto desactivado
- **WHEN** la venta no tiene ítems o incluye un producto desactivado o inexistente
- **THEN** el sistema la rechaza y no registra nada

### Requirement: Precios definidos por el servidor
El precio unitario de cada ítem de catálogo MUST tomarse del producto en el momento de registrar la venta, y guardarse en el ítem junto con el nombre del producto. Si el total que esperaba el mostrador no coincide con el calculado, el sistema MUST rechazar la venta con `409` e informar los precios actuales.

#### Scenario: El admin cambió un precio mientras se armaba el carrito
- **WHEN** el mostrador manda la venta con un total calculado con el precio viejo
- **THEN** el sistema responde `409` con los precios actuales y no registra la venta

#### Scenario: Cambios de precio posteriores
- **WHEN** después de una venta cambia el precio de un producto vendido
- **THEN** la venta registrada conserva el precio y el nombre del momento de la venta

### Requirement: Ítem "Varios" con precio libre
Una venta SHALL poder incluir ítems "Varios" sin producto, con precio unitario libre mayor que cero, cantidad entera entre 1 y 999 y una descripción opcional (por defecto "Varios"). Los ítems "Varios" MUST NOT mover stock.

#### Scenario: Vender algo que no está cargado
- **WHEN** el empleado agrega un ítem "Varios" de $500 con descripción "Caramelos sueltos"
- **THEN** la venta incluye ese ítem con su precio y descripción
- **AND** no se registra ningún movimiento de stock por ese ítem

### Requirement: Pagos de una venta
Cada pago MUST tener un medio (`efectivo`, `debito`, `credito` o `mercado_pago`) y un monto mayor que cero, y la suma de los pagos MUST ser igual al total de la venta. Una venta SHALL poder tener pagos con distintos medios (pago mixto), con un pago como máximo por medio.

#### Scenario: Pago mixto
- **WHEN** una venta de $5.000 se paga con $2.000 en efectivo y $3.000 en débito
- **THEN** la venta queda registrada con esos dos pagos

#### Scenario: Pagos que no suman el total
- **WHEN** los pagos suman distinto del total
- **THEN** el sistema responde `400` y no registra la venta

### Requirement: Vuelto en efectivo
El pago en efectivo SHALL aceptar opcionalmente el monto recibido del cliente, que MUST ser mayor o igual al monto en efectivo. Cuando se informa, el sistema MUST guardar el monto recibido y el vuelto (recibido menos monto en efectivo).

#### Scenario: Paga con un billete más grande
- **WHEN** una venta de $3.300 se paga en efectivo y el cliente entrega $5.000
- **THEN** la venta registra recibido $5.000 y vuelto $1.700

#### Scenario: Monto recibido insuficiente
- **WHEN** el monto recibido es menor que el monto en efectivo
- **THEN** el sistema responde `400`

### Requirement: Descuento de stock al vender
Al registrar una venta, el sistema MUST descontar el stock de cada producto vendido con un movimiento `venta` por la cantidad vendida, en la misma operación que la venta: o se guardan los dos o ninguno. Una venta MUST NOT rechazarse por falta de stock.

#### Scenario: Stock descontado
- **WHEN** se venden 2 unidades de un producto con stock 10
- **THEN** el stock queda en 8 y hay un movimiento `venta` de -2 asociado a la venta

#### Scenario: Vender sin stock
- **WHEN** se vende un producto con stock 0
- **THEN** la venta se registra y el stock queda negativo

### Requirement: Listado de ventas según el rol
El empleado SHALL poder ver las ventas del día en hora de Argentina, de cualquier usuario. El admin SHALL poder ver las ventas de cualquier rango de fechas. El listado MUST mostrar número, hora, vendedor, total, medios de pago y estado, y el detalle MUST mostrar ítems y pagos. El detalle para el empleado MUST NOT incluir costos.

#### Scenario: El empleado busca una venta de hoy
- **WHEN** un empleado abre el listado de ventas
- **THEN** ve solo las ventas de hoy en hora de Argentina

#### Scenario: El empleado pide un día anterior
- **WHEN** un empleado pide las ventas de ayer
- **THEN** el sistema responde `403`

### Requirement: Anulación de ventas
El sistema SHALL permitir anular una venta `pagada` indicando un motivo obligatorio. El empleado MUST poder anular solo ventas del día en hora de Argentina; el admin, cualquier venta. Al anular, la venta MUST quedar en estado `anulada` con usuario, fecha y motivo, MUST NOT borrarse, y el sistema MUST reponer el stock de cada producto con un movimiento `anulacion`, todo en una sola operación.

#### Scenario: El empleado anula una venta del día
- **WHEN** un empleado anula la venta #120 de hoy con motivo "cobré dos veces"
- **THEN** la venta queda `anulada` con el empleado, la fecha y el motivo
- **AND** el stock de cada producto vuelve a sumar lo vendido con un movimiento `anulacion`

#### Scenario: El empleado intenta anular una venta de ayer
- **WHEN** un empleado intenta anular una venta del día anterior
- **THEN** el sistema responde `403` y la venta no cambia

#### Scenario: Anular dos veces
- **WHEN** se intenta anular una venta ya anulada
- **THEN** el sistema responde `409` y no repone stock otra vez

#### Scenario: Anulación sin motivo
- **WHEN** se intenta anular sin motivo
- **THEN** el sistema responde `400`

### Requirement: Aviso al admin por cada anulación
Al anular una venta, el sistema MUST crear en la misma operación un aviso pendiente para el admin con el número de venta, la hora en Argentina, quién anuló, el motivo, los ítems y el total.

#### Scenario: Aviso de anulación
- **WHEN** un empleado anula una venta
- **THEN** queda un aviso pendiente con el texto de la anulación para el admin
