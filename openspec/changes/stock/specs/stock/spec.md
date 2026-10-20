# Spec Delta

## Purpose

Lleva la cuenta de cuántas unidades hay de cada producto y de por qué cambió esa cantidad: cada entrada, salida o corrección queda registrada con su motivo, usuario y fecha.

## ADDED Requirements

### Requirement: Movimientos de stock
Todo cambio del stock actual de un producto MUST registrarse como un movimiento con tipo, cantidad con signo (positiva suma, negativa resta), stock resultante, usuario y fecha. El movimiento y la actualización del stock actual MUST hacerse en la misma operación: o se guardan los dos o ninguno.

#### Scenario: Movimiento y stock coinciden
- **WHEN** se registra un movimiento de +12 sobre un producto con stock 3
- **THEN** el stock actual queda en 15
- **AND** el movimiento guarda cantidad 12 y stock resultante 15

#### Scenario: Movimientos simultáneos
- **WHEN** dos usuarios registran a la vez movimientos de +5 y -2 sobre un producto con stock 10
- **THEN** el stock actual queda en 13 y los stocks resultantes de los movimientos son consistentes con ese orden

### Requirement: Stock negativo permitido
El sistema MUST permitir que el stock actual quede negativo y MUST NOT rechazar un movimiento por falta de stock.

#### Scenario: Restar más de lo que hay
- **WHEN** se registra un ajuste de -5 sobre un producto con stock 2
- **THEN** el stock actual queda en -3

### Requirement: Movimientos inmutables
Los movimientos de stock MUST NOT poder editarse ni borrarse. Un error se corrige registrando otro movimiento.

#### Scenario: Corregir un error
- **WHEN** el admin cargó por error +10 en lugar de +1
- **THEN** lo corrige con un ajuste de -9 con motivo `correccion`
- **AND** los dos movimientos quedan en el historial

### Requirement: Ajustes de stock
El admin SHALL poder sumar o restar unidades de un producto indicando una cantidad distinta de cero, un motivo obligatorio (`rotura`, `vencimiento`, `robo`, `conteo`, `venta_sin_sistema`, `correccion` u `otro`) y una nota opcional. El motivo `otro` MUST exigir una nota. Un empleado MUST NOT poder hacer ajustes.

#### Scenario: Ajuste por rotura
- **WHEN** el admin registra -2 de un producto con motivo `rotura`
- **THEN** el stock baja 2 y el movimiento queda con tipo `ajuste` y motivo `rotura`

#### Scenario: Motivo "otro" sin nota
- **WHEN** el admin registra un ajuste con motivo `otro` y sin nota
- **THEN** el sistema responde `400` y el stock no cambia

#### Scenario: Empleado intenta ajustar
- **WHEN** un empleado intenta registrar un ajuste
- **THEN** el sistema responde `403` y el stock no cambia

### Requirement: Conteo rápido
El admin SHALL poder cargar la cantidad contada de un producto (entero, cero o más). El sistema MUST registrar un ajuste con motivo `conteo` por la diferencia entre lo contado y el stock actual, y no registrar nada si no hay diferencia.

#### Scenario: Conteo con faltante
- **WHEN** el stock actual es 20 y el admin cuenta 17
- **THEN** se registra un ajuste de -3 con motivo `conteo` y el stock queda en 17

#### Scenario: Conteo sin diferencia
- **WHEN** lo contado es igual al stock actual
- **THEN** no se registra ningún movimiento

### Requirement: Ventas hechas sin sistema
El admin SHALL poder cargar en una sola operación varios productos con la cantidad vendida durante un corte (enteros mayores que cero). El sistema MUST registrar por cada producto un ajuste negativo con motivo `venta_sin_sistema`, todos juntos o ninguno.

#### Scenario: Carga después de un corte de luz
- **WHEN** el admin carga 3 gaseosas y 5 alfajores vendidos sin sistema
- **THEN** el stock de la gaseosa baja 3 y el del alfajor baja 5
- **AND** los dos movimientos tienen motivo `venta_sin_sistema`

#### Scenario: Un producto inválido en la carga
- **WHEN** uno de los productos de la carga no existe
- **THEN** el sistema responde con error y no cambia el stock de ninguno

### Requirement: Historial de movimientos
El admin SHALL poder ver los movimientos de un producto del más reciente al más antiguo, con tipo, motivo, nota, cantidad, stock resultante, usuario y fecha en hora de Argentina, de a 50 por página.

#### Scenario: Ver el historial
- **WHEN** el admin abre el historial de un producto con un ingreso y un ajuste
- **THEN** ve los dos movimientos, primero el más reciente, con quién los hizo
