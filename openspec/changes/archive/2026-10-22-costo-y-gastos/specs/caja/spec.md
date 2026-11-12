# Spec Delta

## MODIFIED Requirements

### Requirement: Movimientos de caja
Un movimiento de caja SHALL ser un `gasto`, un `retiro` o un `ingreso`, con monto mayor que cero y motivo obligatorio, y MUST guardar el turno, el usuario y la fecha. El empleado SHALL registrar gastos y retiros; los ingresos MUST ser solo del admin. Los movimientos MUST NOT editarse ni borrarse.

#### Scenario: El empleado paga al repartidor
- **WHEN** un empleado registra un gasto de $8.000 de la categoría Otro con motivo "pago a proveedor - Coca"
- **THEN** el gasto queda en su turno con el monto, la categoría, el motivo, el empleado y la fecha

#### Scenario: Empleado intenta registrar un ingreso
- **WHEN** un empleado intenta registrar un ingreso de caja
- **THEN** el sistema responde `403`

#### Scenario: Movimiento sin motivo
- **WHEN** se intenta registrar un movimiento sin motivo o con monto cero
- **THEN** el sistema responde `400`

## ADDED Requirements

### Requirement: Categoría de los gastos
Cada gasto MUST tener una categoría de una lista fija: Servicios, Insumos u Otro. La lista MUST NOT poder editarse desde el sistema. Un gasto sin categoría o con una categoría fuera de la lista MUST rechazarse con `400`. Los retiros y los ingresos MUST NOT llevar categoría. Los listados de movimientos de caja MUST mostrar la categoría de cada gasto.

#### Scenario: Gasto de luz
- **WHEN** el admin registra un gasto de $45.000 de la categoría Servicios con motivo "luz de octubre"
- **THEN** el gasto queda con la categoría Servicios

#### Scenario: Gasto sin categoría
- **WHEN** alguien intenta registrar un gasto sin categoría o con la categoría "Proveedor"
- **THEN** el sistema responde `400` y no registra nada

#### Scenario: Retiro con categoría
- **WHEN** alguien intenta registrar un retiro indicando una categoría
- **THEN** el sistema responde `400` y no registra nada

#### Scenario: La categoría en los listados
- **WHEN** el empleado mira los movimientos del turno o el admin abre el detalle de un turno con un gasto de Insumos
- **THEN** el gasto se muestra con su categoría, su monto y su motivo
