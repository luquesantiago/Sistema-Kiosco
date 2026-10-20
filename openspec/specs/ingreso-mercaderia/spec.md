# ingreso-mercaderia Specification

## Purpose

Registra la mercadería que llega al kiosco: qué productos y cuántas unidades trajo cada proveedor, quién la recibió y, cuando el admin lo indica, a qué costo.

## Requirements

### Requirement: Registro de un ingreso de mercadería
Admin y empleado SHALL poder registrar un ingreso con proveedor (opcional, activo), una nota opcional (por ejemplo, el número de remito) y uno o más productos con su cantidad (entero mayor que cero). Al confirmar, el sistema MUST guardar el ingreso con su usuario y fecha y registrar un movimiento `compra` por cada producto, todo en una sola operación.

#### Scenario: El empleado recibe al proveedor
- **WHEN** un empleado registra un ingreso del proveedor "Distribuidora Sur" con 24 gaseosas y 12 alfajores
- **THEN** el stock de la gaseosa sube 24 y el del alfajor sube 12
- **AND** el ingreso queda registrado con el empleado como responsable

#### Scenario: Ingreso sin productos
- **WHEN** se intenta registrar un ingreso sin productos o con una cantidad cero o negativa
- **THEN** el sistema responde `400` y no registra nada

#### Scenario: Producto repetido en el ingreso
- **WHEN** el mismo producto aparece dos veces en el ingreso
- **THEN** el sistema suma las cantidades y registra un solo movimiento para ese producto

### Requirement: Carga rápida con el lector
La pantalla de ingreso SHALL permitir agregar productos escaneando el código de barras o buscando por nombre. Escanear un producto que ya está en la lista MUST sumar una unidad en vez de agregar otra fila. Si el código no existe, la pantalla MUST avisar que el producto no está cargado, sin cortar la carga.

#### Scenario: Escanear dos veces
- **WHEN** el empleado escanea dos veces la misma gaseosa
- **THEN** la lista tiene una sola fila de esa gaseosa con cantidad 2

#### Scenario: Código desconocido
- **WHEN** se escanea un código que no está en el catálogo
- **THEN** la pantalla muestra que el producto no existe y que lo tiene que cargar el admin
- **AND** los productos ya cargados en la lista se conservan

### Requirement: Costo opcional y precargado para el admin
Para el admin, cada producto del ingreso SHALL mostrar su costo actual precargado y editable, y dejarlo vacío MUST significar "sin cambios". Si el admin envía un costo distinto del actual, el sistema MUST actualizar el costo del producto y registrarlo en el historial de precios con origen manual. El empleado MUST NOT ver ni enviar costos.

#### Scenario: Llegó con otro costo
- **WHEN** el admin registra un ingreso donde el alfajor tiene costo $650 y su costo actual es $600
- **THEN** el costo del alfajor pasa a $650
- **AND** el historial de precios del alfajor registra el cambio de costo

#### Scenario: Costo sin cambios
- **WHEN** el admin deja el costo precargado tal cual
- **THEN** el costo del producto no cambia y no se agrega nada al historial de precios

#### Scenario: El empleado envía un costo
- **WHEN** un ingreso de un empleado incluye costos
- **THEN** el sistema responde `400` y no registra nada

### Requirement: Consulta de ingresos
El admin SHALL poder ver la lista de ingresos, del más reciente al más antiguo, con fecha en hora de Argentina, proveedor, usuario, cantidad de productos y nota, y el detalle de cada uno con sus productos, cantidades y costos.

#### Scenario: Revisar lo que recibió un empleado
- **WHEN** el admin abre un ingreso cargado por un empleado
- **THEN** ve cada producto con la cantidad recibida y quién lo registró
