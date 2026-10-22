# Spec Delta

## MODIFIED Requirements

### Requirement: Registro de una venta
Admin y empleado SHALL poder registrar una venta con uno o más ítems y uno o más pagos. Cada venta MUST guardar un número correlativo único, el usuario, la fecha, el turno de caja abierto en que se registró, el total, los ítems y los pagos, y quedar en estado `pagada`. Un ítem de catálogo MUST referenciar un producto activo, con cantidad entera entre 1 y 999. Sin un turno abierto en el que el usuario pueda operar, la venta MUST rechazarse con `409` sin registrar nada.

#### Scenario: Venta simple
- **WHEN** un empleado con su turno abierto vende 2 alfajores de $900 y 1 gaseosa de $1.500 cobrando en débito
- **THEN** se registra la venta con el número siguiente, total $3.300, estado `pagada`, el empleado como vendedor, su turno y un pago en débito de $3.300

#### Scenario: Venta vacía o con producto desactivado
- **WHEN** la venta no tiene ítems o incluye un producto desactivado o inexistente
- **THEN** el sistema la rechaza y no registra nada

#### Scenario: Venta sin turno abierto
- **WHEN** alguien intenta registrar una venta sin ningún turno abierto
- **THEN** el sistema responde `409`, no registra la venta y no mueve stock

### Requirement: Anulación de ventas
El sistema SHALL permitir anular una venta `pagada` indicando un motivo obligatorio. El empleado MUST poder anular solo ventas del turno abierto que él abrió; el admin, cualquier venta. Al anular, la venta MUST quedar en estado `anulada` con usuario, fecha, motivo y el turno abierto en ese momento (si lo hay), MUST NOT borrarse, y el sistema MUST reponer el stock de cada producto con un movimiento `anulacion`, todo en una sola operación.

#### Scenario: El empleado anula una venta del día
- **WHEN** un empleado anula la venta #120, registrada hoy en su turno abierto, con motivo "cobré dos veces"
- **THEN** la venta queda `anulada` con el empleado, la fecha, el motivo y su turno
- **AND** el stock de cada producto vuelve a sumar lo vendido con un movimiento `anulacion`

#### Scenario: El empleado intenta anular una venta de ayer
- **WHEN** un empleado intenta anular una venta del día anterior
- **THEN** el sistema responde `403` y la venta no cambia

#### Scenario: El empleado intenta anular una venta de otro turno
- **WHEN** un empleado intenta anular una venta de hoy registrada en el turno anterior
- **THEN** el sistema responde `403` y la venta no cambia

#### Scenario: El admin anula sin turno abierto
- **WHEN** el admin anula una venta a la noche, sin ningún turno abierto
- **THEN** la venta queda `anulada` sin turno de anulación

#### Scenario: Anular dos veces
- **WHEN** se intenta anular una venta ya anulada
- **THEN** el sistema responde `409` y no repone stock otra vez

#### Scenario: Anulación sin motivo
- **WHEN** se intenta anular sin motivo
- **THEN** el sistema responde `400`
