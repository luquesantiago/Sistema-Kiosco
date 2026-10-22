# Spec Delta

## MODIFIED Requirements

### Requirement: Movimientos de caja
Un movimiento de caja SHALL ser un `gasto`, un `retiro`, un `ingreso` o un `pago_proveedor`, con monto mayor que cero y motivo obligatorio, y MUST guardar la cuenta, el turno (si lo hay), el usuario y la fecha. El empleado SHALL registrar gastos y retiros; los ingresos MUST ser solo del admin. Un `pago_proveedor` MUST registrarse solo al pagar un pedido, atado a él y con el motivo armado por el sistema (número de pedido y proveedor); registrarlo como movimiento suelto MUST rechazarse con `400`. Los movimientos MUST NOT editarse ni borrarse.

#### Scenario: El empleado paga al repartidor
- **WHEN** un empleado registra un gasto de $8.000 de la categoría Otro con motivo "pago a proveedor - Coca"
- **THEN** el gasto queda en su turno con el monto, la categoría, el motivo, el empleado y la fecha

#### Scenario: Empleado intenta registrar un ingreso
- **WHEN** un empleado intenta registrar un ingreso de caja
- **THEN** el sistema responde `403`

#### Scenario: Movimiento sin motivo
- **WHEN** se intenta registrar un movimiento sin motivo o con monto cero
- **THEN** el sistema responde `400`

#### Scenario: Pago de un pedido
- **WHEN** el empleado paga en efectivo los $310.000 del pedido #12 de Coca-Cola
- **THEN** queda un movimiento `pago_proveedor` en efectivo de $310.000 en su turno, atado al pedido #12, con motivo "Pedido #12 - Coca-Cola"

#### Scenario: Pago a proveedor suelto
- **WHEN** alguien intenta registrar un `pago_proveedor` sin pagar un pedido
- **THEN** el sistema responde `400`

### Requirement: Efectivo esperado
El efectivo esperado de un turno MUST calcularse como: monto inicial contado, más los pagos en efectivo de las ventas del turno, más los ingresos en efectivo, menos los gastos en efectivo, menos los retiros en efectivo, menos los pagos a proveedores en efectivo, menos el total de las ventas anuladas durante ese turno. El vuelto MUST NOT sumarse, porque el pago en efectivo ya es el monto neto. Los pagos con débito, crédito y Mercado Pago, y los movimientos de la cuenta Mercado Pago, MUST NOT afectar el esperado.

#### Scenario: Turno con ventas y movimientos
- **WHEN** un turno abrió con $20.000, vendió $50.000 en efectivo y $30.000 en débito, tuvo un gasto de $8.000 y un retiro de $10.000
- **THEN** el esperado es $52.000

#### Scenario: Anulación de una venta del mismo turno
- **WHEN** en un turno se vende $3.000 en efectivo y luego se anula esa venta
- **THEN** la venta anulada no cambia el esperado del turno

#### Scenario: Un gasto de Mercado Pago no toca el efectivo
- **WHEN** en un turno con esperado $52.000 se registra un gasto de $45.000 de la cuenta Mercado Pago
- **THEN** el esperado sigue siendo $52.000

#### Scenario: Anulación de una venta con débito del mismo turno
- **WHEN** en un turno se vende $3.000 con débito y luego se anula esa venta
- **THEN** el esperado del turno baja $3.000, porque se devuelven en efectivo

#### Scenario: Pago a un proveedor en efectivo
- **WHEN** en un turno con esperado $352.000 se paga en efectivo un pedido de $310.000
- **THEN** el esperado baja a $42.000

#### Scenario: Pago a un proveedor con Mercado Pago
- **WHEN** en un turno con esperado $52.000 se paga con Mercado Pago un pedido de $210.000
- **THEN** el esperado sigue siendo $52.000
