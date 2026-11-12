# productos Specification

## Purpose

Mantiene el catálogo de lo que vende el kiosco: productos con su código, precio, costo y límites de stock, cómo se buscan en el mostrador y cómo cambian sus precios a lo largo del tiempo.

## Requirements

### Requirement: Alta de producto
El admin SHALL poder crear productos con nombre (obligatorio), código de barras (opcional), precio de venta (mayor que cero), costo (opcional, cero o más), stock mínimo y stock máximo (enteros, cero o más) y proveedor (opcional, uno activo). Un producto nuevo MUST empezar activo y con stock actual 0.

#### Scenario: Alta completa
- **WHEN** el admin crea "Alfajor triple" con código `7790001000012`, precio $900, costo $600, mínimo 10, máximo 40 y un proveedor activo
- **THEN** el producto queda activo con esos datos y stock actual 0

#### Scenario: Producto sin código de barras
- **WHEN** el admin crea un producto sin código de barras
- **THEN** el producto queda creado y solo se puede encontrar por nombre

#### Scenario: Precio inválido
- **WHEN** el precio es cero o negativo, o el stock máximo es menor que el mínimo
- **THEN** el sistema responde `400` y no crea el producto

#### Scenario: Proveedor desactivado
- **WHEN** se intenta asignar un proveedor desactivado
- **THEN** el sistema responde `400` y no guarda el cambio

### Requirement: Código de barras único
El código de barras, cuando existe, MUST ser único entre todos los productos, activos o desactivados. El sistema MUST quitar los espacios de los extremos antes de guardarlo o compararlo.

#### Scenario: Código repetido
- **WHEN** el admin crea o edita un producto con un código que ya tiene otro producto
- **THEN** el sistema responde `409` indicando qué producto usa ese código

### Requirement: Edición y desactivación de productos
El admin SHALL poder editar todos los datos de un producto salvo el stock actual, y desactivarlo o reactivarlo. Los productos MUST NOT borrarse. Un producto desactivado MUST NOT aparecer en la búsqueda del empleado.

#### Scenario: Desactivar un producto discontinuado
- **WHEN** el admin desactiva un producto
- **THEN** el producto sigue existiendo para el admin
- **AND** el empleado ya no lo encuentra ni por código ni por nombre

#### Scenario: El stock actual no se edita acá
- **WHEN** se envía un stock actual en la edición de un producto
- **THEN** el sistema lo ignora o lo rechaza y el stock actual no cambia

### Requirement: Búsqueda de productos
El sistema SHALL permitir a admin y empleado buscar productos por código de barras exacto o por parte del nombre, sin distinguir mayúsculas ni acentos. El empleado MUST ver solo productos activos y MUST NOT recibir el costo ni el proveedor. La búsqueda por nombre MUST devolver como máximo 50 resultados por página.

#### Scenario: Búsqueda con el lector
- **WHEN** el empleado busca el código `7790001000012`
- **THEN** recibe ese producto con nombre, código, precio y stock actual, sin costo ni proveedor

#### Scenario: Búsqueda por nombre sin acentos
- **WHEN** se busca "cafe" y existe el producto "Café molido 250 g"
- **THEN** el producto aparece en los resultados

#### Scenario: Código inexistente
- **WHEN** se busca un código que no existe
- **THEN** el resultado es una lista vacía, no un error

#### Scenario: El admin ve todo
- **WHEN** el admin busca productos
- **THEN** recibe también costo, proveedor y si el producto está activo, e incluye los desactivados si lo pide

### Requirement: Alta rápida desde un código escaneado
Cuando el admin busca un código de barras que no existe, la pantalla de productos SHALL ofrecer crear un producto con ese código ya cargado.

#### Scenario: Escanear un producto nuevo
- **WHEN** el admin escanea en la búsqueda un código que no está en el catálogo
- **THEN** la pantalla ofrece "Crear producto con este código"
- **AND** al elegirlo, el formulario de alta se abre con el código completo

### Requirement: Historial de cambios de precio
Cada vez que cambia el precio de venta o el costo de un producto, el sistema MUST registrar el usuario, la fecha, los valores anterior y nuevo de precio y costo, y el origen (`manual` o `aumento_masivo`). El admin SHALL poder ver el historial de un producto, del más reciente al más antiguo.

#### Scenario: Cambio manual de precio
- **WHEN** el admin cambia el precio de un producto de $900 a $1.000
- **THEN** el historial del producto muestra el cambio de $900 a $1.000 con su usuario, la fecha y el origen manual

#### Scenario: Edición sin cambio de precio
- **WHEN** el admin edita solo el nombre de un producto
- **THEN** no se agrega ninguna entrada al historial de precios

### Requirement: Aumento masivo de precios por porcentaje
El admin SHALL poder aplicar un porcentaje, entre -50% y +200%, al precio de venta de los productos activos de un proveedor o de todos los productos activos. El nuevo precio MUST redondearse hacia arriba al múltiplo elegido ($1, $10, $50 o $100) y nunca quedar en cero. El admin MAY indicar que el mismo porcentaje se aplique al costo, sin redondeo y con dos decimales.

#### Scenario: Aumento del 10% a un proveedor redondeando a $10
- **WHEN** el admin aplica +10% con redondeo a $10 a un proveedor cuyo producto vale $905
- **THEN** el nuevo precio de ese producto es $1.000 (995,50 redondeado hacia arriba a $10)

#### Scenario: Solo productos activos
- **WHEN** el proveedor tiene productos desactivados
- **THEN** sus precios no cambian

### Requirement: Vista previa y aplicación atómica del aumento masivo
Antes de aplicar un aumento masivo, el sistema SHALL mostrar la lista de productos afectados con su precio actual y el nuevo, sin modificar nada. Al confirmar, el sistema MUST aplicar todos los cambios juntos o ninguno, y registrar cada uno en el historial con origen `aumento_masivo`.

#### Scenario: Vista previa
- **WHEN** el admin pide la vista previa de un aumento
- **THEN** recibe cada producto afectado con su precio actual y el nuevo
- **AND** ningún precio cambia todavía

#### Scenario: Aplicar el aumento
- **WHEN** el admin confirma el aumento
- **THEN** todos los productos afectados quedan con el precio nuevo
- **AND** cada uno tiene una entrada en su historial con origen `aumento_masivo`

#### Scenario: Error a mitad del aumento
- **WHEN** falla la actualización de uno de los productos
- **THEN** ningún precio queda modificado

### Requirement: Filtro de productos sin costo
El admin SHALL poder filtrar la lista de productos para ver solo los activos que no tienen costo cargado, combinable con la búsqueda por nombre. El dashboard MUST enlazar a esa lista filtrada desde lo vendido sin costo. Para el empleado, el filtro MUST ignorarse.

#### Scenario: Completar costos desde el dashboard
- **WHEN** el admin toca "vendido sin costo" en el dashboard
- **THEN** ve la lista de productos activos sin costo y puede abrir cada uno para cargarlo

#### Scenario: El filtro con un empleado
- **WHEN** un empleado busca productos indicando el filtro sin costo
- **THEN** el filtro se ignora y recibe la búsqueda normal, sin costos
