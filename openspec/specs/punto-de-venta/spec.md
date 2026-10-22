# punto-de-venta Specification

## Purpose

Define cómo se usa la pantalla del mostrador: vender rápido solo con el lector de código de barras y el teclado, cobrar con uno o varios medios e imprimir el ticket cuando el cliente lo pide.

## Requirements

### Requirement: Escaneo siempre listo
La pantalla de venta SHALL tener un campo de escaneo que recupere el foco después de cada acción (agregar, cobrar, cerrar un diálogo). Un código seguido de Enter que coincida exacto con un producto MUST agregarlo al carrito con cantidad 1, o sumar 1 si ya estaba.

#### Scenario: Escanear productos seguidos
- **WHEN** el empleado escanea un alfajor, una gaseosa y otra vez el alfajor
- **THEN** el carrito tiene el alfajor con cantidad 2 y la gaseosa con cantidad 1
- **AND** el campo de escaneo sigue enfocado

#### Scenario: Código desconocido
- **WHEN** se escanea un código que no existe
- **THEN** la pantalla muestra un aviso visible y sonoro de producto no encontrado sin borrar el carrito

### Requirement: Búsqueda por nombre en el mostrador
Si lo escrito en el campo de escaneo no coincide con un código, la pantalla SHALL mostrar los productos que coinciden por nombre, para elegir con las flechas y Enter o con el mouse.

#### Scenario: Producto sin código
- **WHEN** el empleado escribe "chicle" y presiona Enter
- **THEN** ve la lista de productos cuyo nombre contiene "chicle"
- **AND** elige uno con las flechas y Enter, que se agrega al carrito

### Requirement: Ítem "Varios" desde el teclado
La pantalla SHALL permitir agregar un ítem "Varios" con un atajo de teclado, pidiendo el precio (obligatorio) y una descripción (opcional).

#### Scenario: Agregar un "Varios"
- **WHEN** el empleado presiona el atajo de "Varios", escribe 500 y Enter
- **THEN** el carrito suma un ítem "Varios" de $500

### Requirement: Edición del carrito antes de cobrar
El carrito SHALL mostrar cada ítem con nombre, cantidad, precio unitario y subtotal, y el total. La pantalla SHALL permitir cambiar la cantidad, quitar un ítem y vaciar el carrito con atajos de teclado; vaciar MUST pedir confirmación. El carrito MUST conservarse si la página se recarga por accidente.

#### Scenario: Quitar un ítem
- **WHEN** el empleado selecciona un ítem y presiona Suprimir
- **THEN** el ítem sale del carrito y el total se actualiza

#### Scenario: Recarga accidental
- **WHEN** la página se recarga con productos en el carrito
- **THEN** el carrito vuelve a aparecer como estaba

### Requirement: Cobro rápido con un solo medio
Desde el carrito, un atajo por cada medio de pago SHALL abrir el cobro del total con ese medio. Para efectivo, la pantalla SHALL permitir escribir con cuánto paga el cliente y mostrar el vuelto en grande; dejarlo vacío MUST cobrar el total justo. Enter MUST confirmar el cobro.

#### Scenario: Efectivo con vuelto
- **WHEN** el total es $3.300, el empleado elige efectivo y escribe 5000
- **THEN** la pantalla muestra vuelto $1.700 y Enter registra la venta

#### Scenario: Débito en dos teclas
- **WHEN** el empleado presiona el atajo de débito y luego Enter
- **THEN** la venta se registra con un pago en débito por el total

### Requirement: Pago mixto
El cobro SHALL permitir repartir el total entre varios medios, mostrando cuánto falta asignar. La confirmación MUST estar deshabilitada mientras lo asignado no sume exactamente el total.

#### Scenario: Parte efectivo y parte tarjeta
- **WHEN** el total es $5.000 y el empleado asigna $2.000 en efectivo
- **THEN** la pantalla muestra que faltan $3.000
- **AND** al asignar $3.000 en débito puede confirmar la venta

### Requirement: Después de cobrar
Al registrarse la venta, la pantalla SHALL mostrar el número de venta, el total y el vuelto si lo hubo, vaciar el carrito y dejar el campo de escaneo listo para la próxima venta. Si el servidor rechaza la venta porque cambiaron los precios, la pantalla MUST actualizar los precios del carrito y avisar, sin registrar la venta.

#### Scenario: Próxima venta
- **WHEN** se confirma una venta
- **THEN** el carrito queda vacío y el escaneo enfocado
- **AND** la venta cobrada sigue visible con la opción de imprimir el ticket

#### Scenario: Precios cambiados
- **WHEN** el servidor responde que los precios cambiaron
- **THEN** el carrito muestra los precios nuevos y un aviso, y el empleado vuelve a cobrar

### Requirement: Ticket a pedido
El ticket MUST imprimirse solo cuando el empleado lo pide, con un botón o un atajo después de cobrar o desde el detalle de una venta del listado. El ticket MUST incluir el nombre del kiosco, número y fecha de la venta, ítems con cantidad y subtotal, total, pagos, vuelto si lo hubo y la leyenda "No válido como factura", con un formato para papel de 58 u 80 mm.

#### Scenario: El cliente pide el ticket
- **WHEN** después de cobrar el empleado presiona el atajo de imprimir
- **THEN** se abre la impresión del ticket de esa venta

#### Scenario: Nadie pide ticket
- **WHEN** el empleado sigue con la próxima venta sin pedir el ticket
- **THEN** no se imprime nada

### Requirement: Atajos visibles
La pantalla de venta SHALL mostrar en todo momento una referencia de los atajos de teclado disponibles.

#### Scenario: Empleado nuevo
- **WHEN** un empleado abre la pantalla de venta por primera vez
- **THEN** ve los atajos para cobrar con cada medio, "Varios", quitar, vaciar e imprimir

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
