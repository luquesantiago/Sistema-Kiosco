# Spec Delta

## ADDED Requirements

### Requirement: Abrir el turno antes de vender
Si no hay un turno abierto, la pantalla de venta SHALL pedir abrirlo antes de escanear, con el monto sugerido precargado y editable, de modo que Enter confirme. Si el turno abierto es de otro empleado, la pantalla SHALL indicar de quién es y ofrecer cerrarlo contando la caja antes de abrir el propio. El admin SHALL vender en el turno abierto sin que se le pida nada.

#### Scenario: Primer ingreso de la mañana
- **WHEN** Ana entra a la pantalla de venta sin ningún turno abierto
- **THEN** ve la apertura con el monto que dejó el turno anterior, presiona Enter y queda lista para escanear

#### Scenario: El turno de Ana quedó abierto
- **WHEN** Juan entra a la pantalla de venta y el turno de Ana sigue abierto
- **THEN** la pantalla le avisa que el turno de Ana está abierto y le ofrece cerrarlo contando la caja
- **AND** después del cierre le ofrece abrir su turno

### Requirement: Cerrar el turno desde el mostrador
La pantalla de venta SHALL ofrecer cerrar el turno, pidiendo el efectivo contado y un retiro opcional con motivo, sin mostrar el esperado. Al cerrar, la pantalla MUST mostrar lo que queda en caja e invitar a cerrar la sesión. Cerrar el turno MUST estar deshabilitado mientras haya productos en el carrito.

#### Scenario: Fin del turno de la mañana
- **WHEN** Ana cierra su turno contando $51.500 y retirando $30.000
- **THEN** la pantalla muestra que quedan $21.500 en caja y le ofrece cerrar la sesión

#### Scenario: Carrito con productos
- **WHEN** el carrito tiene productos
- **THEN** la opción de cerrar el turno no está disponible

### Requirement: Movimientos de caja desde el mostrador
Desde la pantalla de venta SHALL poder registrarse un gasto o un retiro con monto y motivo, y ver los movimientos del turno. Para el admin, la pantalla SHALL ofrecer además el ingreso de caja. El carrito MUST conservarse al registrar un movimiento.

#### Scenario: Pagar al repartidor en medio de una venta
- **WHEN** con productos en el carrito, el empleado registra un gasto de $8.000 por un pago a proveedor
- **THEN** el gasto queda registrado y el carrito sigue como estaba
