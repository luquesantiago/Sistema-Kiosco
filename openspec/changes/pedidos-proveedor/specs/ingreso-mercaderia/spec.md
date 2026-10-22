# Spec Delta

## MODIFIED Requirements

### Requirement: Registro de un ingreso de mercadería
Admin y empleado SHALL registrar un ingreso solo como la carga de un pedido (ver la capacidad `pedidos`), con uno o más productos con su cantidad (entero mayor que cero) y una nota opcional (por ejemplo, el número de remito). El proveedor del ingreso MUST ser el del pedido. Al confirmar, el sistema MUST guardar el ingreso atado al pedido con su usuario y fecha y registrar un movimiento `compra` por cada producto, todo en una sola operación. No hay ingresos sueltos sin pedido.

#### Scenario: El empleado recibe al proveedor
- **WHEN** un empleado carga en el pedido del proveedor "Distribuidora Sur" 24 gaseosas y 12 alfajores
- **THEN** el stock de la gaseosa sube 24 y el del alfajor sube 12
- **AND** el ingreso queda registrado con el empleado como responsable, el proveedor del pedido y atado a ese pedido

#### Scenario: Ingreso sin productos
- **WHEN** se intenta registrar un ingreso sin productos o con una cantidad cero o negativa
- **THEN** el sistema responde `400` y no registra nada

#### Scenario: Producto repetido en el ingreso
- **WHEN** el mismo producto aparece dos veces en el ingreso
- **THEN** el sistema suma las cantidades y registra un solo movimiento para ese producto

### Requirement: Costo opcional y precargado para el admin
Para el admin y el empleado, cada producto del ingreso SHALL mostrar su costo actual precargado y editable, y dejarlo vacío MUST significar "sin cambios". Si se envía un costo distinto del actual, el sistema MUST actualizar el costo del producto y registrarlo en el historial de precios con origen manual y el usuario que lo cargó.

#### Scenario: Llegó con otro costo
- **WHEN** el admin registra un ingreso donde el alfajor tiene costo $650 y su costo actual es $600
- **THEN** el costo del alfajor pasa a $650
- **AND** el historial de precios del alfajor registra el cambio de costo

#### Scenario: Costo sin cambios
- **WHEN** el admin deja el costo precargado tal cual
- **THEN** el costo del producto no cambia y no se agrega nada al historial de precios

#### Scenario: El empleado envía un costo
- **WHEN** un empleado carga un pedido donde el remito dice que la gaseosa cuesta $1.100 y su costo actual es $1.000
- **THEN** el costo de la gaseosa pasa a $1.100 y el historial registra el cambio con el empleado como usuario

### Requirement: Consulta de ingresos
El admin SHALL poder ver la lista de ingresos, del más reciente al más antiguo, con fecha en hora de Argentina, proveedor, usuario, cantidad de productos, nota y el número del pedido al que pertenecen, y el detalle de cada uno con sus productos, cantidades y costos.

#### Scenario: Revisar lo que recibió un empleado
- **WHEN** el admin abre un ingreso cargado por un empleado
- **THEN** ve cada producto con la cantidad recibida, quién lo registró y el pedido al que pertenece
