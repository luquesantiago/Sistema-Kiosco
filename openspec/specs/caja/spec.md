# caja Specification

## Purpose

Controla el efectivo del único cajón del kiosco por turno: con cuánto se abre, qué entra y sale, cuánto debería haber al cerrar y quién responde por cada diferencia, para delegar el mostrador sin perder el control.

## Requirements

### Requirement: Un solo turno abierto
El sistema SHALL tener como máximo un turno de caja abierto a la vez. Cada turno MUST guardar quién lo abrió (su responsable) y la fecha de apertura. Un intento de abrir un turno mientras otro está abierto MUST rechazarse con `409`, también si dos aperturas llegan al mismo tiempo.

#### Scenario: Abrir con otro turno abierto
- **WHEN** hay un turno abierto y alguien intenta abrir otro
- **THEN** el sistema responde `409` y no crea el turno

#### Scenario: Dos aperturas simultáneas
- **WHEN** dos usuarios abren un turno al mismo tiempo sin ninguno abierto
- **THEN** se abre uno solo y el otro pedido recibe `409`

### Requirement: Apertura con monto sugerido
Al abrir un turno, el sistema SHALL sugerir como monto inicial lo que quedó en la caja al cerrar el último turno, o $0 si nunca hubo uno. Quien abre MUST informar el monto que contó, igual o distinto del sugerido. El turno MUST guardar el sugerido, el contado y la diferencia de apertura (contado menos sugerido).

#### Scenario: Apertura sin diferencias
- **WHEN** el turno anterior dejó $20.000 y quien abre confirma $20.000
- **THEN** el turno abre con monto inicial $20.000 y diferencia de apertura $0

#### Scenario: Faltaba plata al abrir
- **WHEN** el turno anterior dejó $20.000 y quien abre cuenta $19.500
- **THEN** el turno abre con monto inicial $19.500 y diferencia de apertura -$500

#### Scenario: Primer turno
- **WHEN** se abre el primer turno del sistema
- **THEN** el monto sugerido es $0

### Requirement: Quién opera en el turno abierto
Las ventas y los movimientos de caja MUST registrarse en el turno abierto. Un empleado MUST operar solo en un turno que él abrió; el admin SHALL operar en el turno abierto de cualquiera. Si no hay turno abierto, o el turno es de otro empleado, el sistema MUST rechazar la operación con `409`. La única excepción son los movimientos de Mercado Pago del admin: se registran en el turno abierto si lo hay, y sin turno si no hay ninguno abierto.

#### Scenario: Empleado con el turno de otro abierto
- **WHEN** el turno de Ana sigue abierto y Juan, empleado, intenta vender
- **THEN** el sistema responde `409` indicando que primero hay que cerrar el turno de Ana

#### Scenario: El admin vende en el turno del empleado
- **WHEN** el turno de Ana está abierto y el admin registra una venta
- **THEN** la venta queda en el turno de Ana

#### Scenario: El admin paga la luz desde Mercado Pago sin turno abierto
- **WHEN** no hay ningún turno abierto y el admin registra un gasto de Mercado Pago
- **THEN** el gasto queda registrado sin turno

#### Scenario: El empleado sin turno intenta un gasto de Mercado Pago
- **WHEN** un empleado sin turno abierto intenta registrar un gasto de Mercado Pago
- **THEN** el sistema responde `409`

### Requirement: Movimientos de caja
Un movimiento de caja SHALL ser un `gasto`, un `retiro` o un `ingreso`, con monto mayor que cero y motivo obligatorio, y MUST guardar la cuenta, el turno (si lo hay), el usuario y la fecha. El empleado SHALL registrar gastos y retiros; los ingresos MUST ser solo del admin. Los movimientos MUST NOT editarse ni borrarse.

#### Scenario: El empleado paga al repartidor
- **WHEN** un empleado registra un gasto de $8.000 de la categoría Otro con motivo "pago a proveedor - Coca"
- **THEN** el gasto queda en su turno con el monto, la categoría, el motivo, el empleado y la fecha

#### Scenario: Empleado intenta registrar un ingreso
- **WHEN** un empleado intenta registrar un ingreso de caja
- **THEN** el sistema responde `403`

#### Scenario: Movimiento sin motivo
- **WHEN** se intenta registrar un movimiento sin motivo o con monto cero
- **THEN** el sistema responde `400`

### Requirement: Efectivo esperado
El efectivo esperado de un turno MUST calcularse como: monto inicial contado, más los pagos en efectivo de las ventas del turno, más los ingresos en efectivo, menos los gastos en efectivo, menos los retiros en efectivo, menos el total de las ventas anuladas durante ese turno. El vuelto MUST NOT sumarse, porque el pago en efectivo ya es el monto neto. Los pagos con débito, crédito y Mercado Pago, y los movimientos de la cuenta Mercado Pago, MUST NOT afectar el esperado.

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

### Requirement: Devolución de una anulación en la caja
Las anulaciones MUST devolverse siempre en efectivo. Cuando se anula una venta mientras hay un turno abierto, el total de la venta MUST descontarse del esperado del turno abierto, sin importar los medios con que se cobró y aunque la venta sea de un turno anterior. Si el admin anula una venta sin ningún turno abierto, la anulación MUST NOT afectar ninguna caja.

#### Scenario: El admin anula una venta de ayer con la caja abierta
- **WHEN** con el turno de hoy abierto, el admin anula una venta de ayer pagada con $2.000 en efectivo
- **THEN** el esperado del turno de hoy baja $2.000 y el del turno de ayer no cambia

#### Scenario: Anulación de una venta con pago mixto
- **WHEN** con el turno de hoy abierto, se anula una venta de $5.000 pagada con $2.000 en efectivo y $3.000 con Mercado Pago
- **THEN** el esperado del turno de hoy baja $5.000

### Requirement: Cierre ciego
Cualquier usuario SHALL poder cerrar el turno abierto informando el efectivo contado y, opcionalmente, un retiro al cierre con motivo, que no puede superar lo contado. El turno MUST guardar quién cerró, la fecha, lo contado, el retiro, el esperado, la diferencia (contado menos esperado) y lo que queda en caja (contado menos retiro). La respuesta a un empleado MUST NOT incluir el esperado ni la diferencia.

#### Scenario: Cierre con faltante
- **WHEN** el esperado es $52.000, el empleado cuenta $51.500 y retira $30.000
- **THEN** el turno se cierra con diferencia -$500 y quedan $21.500 en caja
- **AND** el empleado ve que el turno se cerró y que quedan $21.500, sin ver el esperado ni la diferencia

#### Scenario: Retiro mayor que lo contado
- **WHEN** quien cierra informa un retiro mayor que el efectivo contado
- **THEN** el sistema responde `400` y el turno sigue abierto

#### Scenario: El siguiente turno arranca con lo que quedó
- **WHEN** un turno se cierra dejando $21.500 en caja
- **THEN** el monto sugerido para abrir el siguiente turno es $21.500

### Requirement: Cierre del turno de otro
Si el turno abierto es de otro usuario, quien llega SHALL poder cerrarlo contando la caja con las mismas reglas del cierre ciego. El turno MUST conservar como responsable a quien lo abrió y registrar como cerrado por a quien lo cerró. Cerrar un turno ya cerrado MUST rechazarse con `409`.

#### Scenario: Ana se fue sin cerrar
- **WHEN** el turno de Ana sigue abierto y Juan lo cierra contando $40.000
- **THEN** el turno queda cerrado, con Ana como responsable y Juan como quien cerró
- **AND** Juan puede abrir su propio turno

#### Scenario: Dos cierres a la vez
- **WHEN** dos usuarios cierran el mismo turno al mismo tiempo
- **THEN** se registra un solo cierre y el otro pedido recibe `409`

### Requirement: Estado de la caja para quien opera
Cualquier usuario SHALL poder consultar si hay un turno abierto, de quién es y el monto sugerido para abrir. El empleado SHALL ver los movimientos del turno que abrió. El empleado MUST NOT ver el esperado, el total de efectivo vendido ni las diferencias de ningún turno.

#### Scenario: Juan llega a la tarde
- **WHEN** Juan entra al sistema y el turno de Ana sigue abierto
- **THEN** el sistema le informa que hay un turno abierto de Ana

#### Scenario: Empleado consulta su turno
- **WHEN** un empleado consulta su turno abierto
- **THEN** ve la apertura y sus movimientos, pero no el esperado

### Requirement: Turnos para el admin
El admin SHALL ver la lista de turnos del más reciente al más antiguo, con responsable, quien cerró, apertura, cierre, diferencia de apertura y diferencia de cierre. El detalle SHALL mostrar las ventas por medio de pago, los movimientos, las anulaciones descontadas, el esperado, lo contado, el retiro y lo que quedó. Un empleado que pida la lista o el detalle MUST recibir `403`.

#### Scenario: El admin revisa el día desde el celular
- **WHEN** el admin abre la lista de turnos
- **THEN** ve los turnos de hoy con sus diferencias, y en cada detalle cómo se llegó al esperado

#### Scenario: Empleado pide la lista de turnos
- **WHEN** un empleado pide la lista de turnos
- **THEN** el sistema responde `403`

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

### Requirement: Cuenta de cada movimiento
Cada movimiento de caja MUST indicar su cuenta: `efectivo` o `mercado_pago`. Si no se indica, la cuenta MUST ser `efectivo`. El empleado SHALL registrar gastos de Mercado Pago, pero sus retiros MUST ser en efectivo: un retiro de Mercado Pago de un empleado MUST rechazarse con `403`. El admin SHALL registrar gastos, retiros e ingresos en cualquiera de las dos cuentas. El retiro al cierre del turno MUST ser siempre en efectivo.

#### Scenario: El empleado paga un gasto con Mercado Pago
- **WHEN** un empleado con su turno abierto registra un gasto de Insumos de $6.000 con la cuenta Mercado Pago
- **THEN** el gasto queda en su turno con la cuenta Mercado Pago

#### Scenario: Movimiento sin cuenta
- **WHEN** se registra un gasto sin indicar la cuenta
- **THEN** el gasto queda con la cuenta Efectivo

#### Scenario: Empleado intenta un retiro de Mercado Pago
- **WHEN** un empleado intenta registrar un retiro con la cuenta Mercado Pago
- **THEN** el sistema responde `403` y no registra nada

#### Scenario: El admin pasa plata a su cuenta personal
- **WHEN** el admin registra un retiro de $100.000 de la cuenta Mercado Pago con motivo "a mi cuenta"
- **THEN** el retiro queda con la cuenta Mercado Pago y no afecta el esperado de ningún turno

### Requirement: Movimientos de Mercado Pago para el admin
El admin SHALL ver los movimientos de la cuenta Mercado Pago de un rango de fechas en hora de Argentina, del más reciente al más antiguo, con tipo, categoría, monto, motivo, usuario, fecha y turno si lo tienen, y SHALL registrarlos desde esa misma pantalla. Los listados de movimientos MUST indicar cuándo un movimiento es de Mercado Pago. El listado MUST ser solo del admin: un empleado MUST recibir `403`.

#### Scenario: El admin revisa los movimientos de Mercado Pago del mes
- **WHEN** el admin pide los movimientos de Mercado Pago del 1 al 22 de octubre
- **THEN** ve los gastos, retiros e ingresos de Mercado Pago de esas fechas, con y sin turno, y ningún movimiento en efectivo

#### Scenario: Empleado pide los movimientos de Mercado Pago
- **WHEN** un empleado pide el listado de movimientos de Mercado Pago
- **THEN** el sistema responde `403`

#### Scenario: Un gasto de Mercado Pago en el turno
- **WHEN** el empleado mira los movimientos del turno con un gasto de Mercado Pago
- **THEN** el gasto se muestra indicando que salió de Mercado Pago
