# Spec Delta

## ADDED Requirements

### Requirement: Ventas en espera fuera de la caja
El efectivo esperado, la cantidad de ventas y las ventas por medio de pago de un turno MUST contar solo las ventas `pagada` y las `anulada` (que se cobraron antes de anularse). Las ventas `pendiente` y `cancelada` MUST NOT contar, ni siquiera su parte en efectivo. Una venta en espera que se aprueba MUST contar desde ese momento en el turno en que se registró.

#### Scenario: Venta en espera con parte en efectivo
- **WHEN** un turno con esperado $52.000 tiene una venta en espera de $5.000 con $2.000 en efectivo y $3.000 en débito
- **THEN** el esperado sigue siendo $52.000 y la venta no figura en la cantidad de ventas ni en las ventas por medio

#### Scenario: La venta en espera se aprueba
- **WHEN** se aprueba el pago de esa venta
- **THEN** el esperado pasa a $54.000, la cantidad de ventas sube en 1 y las ventas por medio suman $2.000 en efectivo y $3.000 en débito

#### Scenario: Venta cancelada
- **WHEN** en un turno con esperado $52.000 se cancela una venta en espera de $2.000 en efectivo y $3.000 en débito
- **THEN** el esperado sigue siendo $52.000 y la venta no figura en la cantidad de ventas ni en las ventas por medio

#### Scenario: Venta pagada y después anulada en el mismo turno
- **WHEN** en un turno se cobra con débito por el Point una venta de $3.000, se aprueba y después se anula
- **THEN** la venta cuenta en las ventas por medio y el esperado baja $3.000 por la devolución en efectivo

### Requirement: Cierre con un cobro en espera
El turno MUST NOT poder cerrarse mientras tenga una venta en espera: el cierre MUST rechazarse con `409` indicando la venta, y el turno MUST seguir abierto. La pantalla de cierre MUST avisarlo antes de pedir el conteo.

#### Scenario: Cierre con un cobro esperando en el Point
- **WHEN** el empleado intenta cerrar el turno con la venta #120 esperando el pago en el Point
- **THEN** el sistema responde `409` con "Hay un cobro con Mercado Pago en espera (venta #120): esperalo o cancelalo" y el turno sigue abierto

#### Scenario: Cierre después de cancelar
- **WHEN** el empleado cancela la venta en espera y vuelve a cerrar el turno
- **THEN** el turno se cierra normalmente

#### Scenario: Cierre con una venta cancelada en el turno
- **WHEN** el turno tiene ventas canceladas y ninguna en espera
- **THEN** el turno se cierra normalmente

### Requirement: Devolución en efectivo de un cobro de una venta cancelada
Un cobro "a devolver" MUST devolverse en efectivo desde el turno abierto. Quien opera ese turno (su empleado o el admin) SHALL confirmar la devolución, que MUST registrar en esa operación una salida de efectivo del turno por exactamente el monto cobrado, sin poder cambiarlo, y crear un aviso al admin. Cada cobro MUST devolverse una sola vez. Sin turno abierto, confirmar MUST rechazarse con `409`.

#### Scenario: El empleado devuelve la plata
- **WHEN** con su turno abierto y esperado $52.000 el empleado confirma la devolución de un cobro "a devolver" de $3.000
- **THEN** queda en su turno un movimiento "Devolución de cobro de Mercado Pago · venta #120" de $3.000 en efectivo, el esperado baja a $49.000, el cobro queda devuelto y se crea un aviso para el admin

#### Scenario: El monto es siempre el cobrado
- **WHEN** se confirma la devolución de un cobro de $3.000 de una venta cancelada de $5.000 con pago mixto
- **THEN** la salida de efectivo es de $3.000, aunque el pedido diga otro monto

#### Scenario: Confirmación repetida
- **WHEN** se confirma dos veces la devolución del mismo cobro, por ejemplo con un doble clic o desde dos pantallas
- **THEN** hay una sola salida de $3.000 y el segundo pedido recibe `409` indicando que ya se devolvió

#### Scenario: El pago llega sin turno abierto
- **WHEN** Mercado Pago aprueba el cobro de una venta cancelada sin ningún turno abierto
- **THEN** el ingreso queda en la cuenta Mercado Pago sin turno y la devolución queda pendiente hasta que se abra un turno

#### Scenario: Confirmar sin turno abierto
- **WHEN** alguien intenta confirmar una devolución sin ningún turno abierto
- **THEN** el sistema responde `409` y la devolución sigue pendiente

#### Scenario: El ingreso no toca el efectivo
- **WHEN** entra el pago de $3.000 de una venta cancelada con el turno abierto y esperado $52.000
- **THEN** el esperado sigue en $52.000 hasta que se confirma la devolución

### Requirement: Cliente que se fue sin la devolución
Si el cliente ya no está, quien opera el turno SHALL indicarlo en lugar de confirmar la devolución. El cobro MUST quedar "sin devolver", sin salida de efectivo, y MUST crearse un aviso al admin para que lo resuelva desde Administración → Mercado Pago.

#### Scenario: El cliente se fue
- **WHEN** el empleado indica que el cliente de un cobro "a devolver" de $3.000 ya se fue
- **THEN** el cobro queda "sin devolver", el esperado no cambia y se crea un aviso para el admin

### Requirement: Cierre con una devolución pendiente
El turno MUST NOT poder cerrarse mientras haya un cobro "a devolver": el cierre MUST rechazarse con `409` indicando el monto, y el turno MUST seguir abierto. Un cobro "devuelto" o "sin devolver" MUST NOT bloquear el cierre.

#### Scenario: Cierre con una devolución pendiente
- **WHEN** entre el pago y la devolución el empleado intenta cerrar el turno con un cobro "a devolver" de $3.000
- **THEN** el sistema responde `409` con "Antes de cerrar, devolvé $3.000 en efectivo de un cobro cancelado" y el turno sigue abierto

#### Scenario: Cierre después de devolver
- **WHEN** el empleado confirma la devolución y vuelve a cerrar el turno
- **THEN** el turno se cierra con la devolución incluida en el esperado

#### Scenario: Cierre con el cliente que se fue
- **WHEN** el cobro quedó "sin devolver" y el empleado cierra el turno
- **THEN** el turno se cierra normalmente
