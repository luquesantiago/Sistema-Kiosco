# Spec Delta

## Purpose

Registra a quién le compra el kiosco: datos de contacto de cada proveedor y los días en que toma pedidos y entrega, para hacer y planificar los pedidos.

## ADDED Requirements

### Requirement: Alta y edición de proveedores
El admin SHALL poder crear y editar proveedores con nombre (obligatorio), teléfono, notas, días de toma de pedido y días de entrega. Cada lista de días MUST admitir de cero a siete días distintos de la semana. Solo un admin MUST poder crear o editar proveedores.

#### Scenario: Proveedor que viene dos veces por semana
- **WHEN** el admin crea un proveedor que toma pedido lunes y jueves y entrega martes y viernes
- **THEN** el proveedor queda guardado con esos días

#### Scenario: Proveedor sin días fijos
- **WHEN** el admin crea un proveedor sin días de pedido ni de entrega
- **THEN** el proveedor queda guardado y se le pide por teléfono cuando haga falta

#### Scenario: Empleado intenta crear un proveedor
- **WHEN** un empleado intenta crear o editar un proveedor
- **THEN** el sistema responde `403`

#### Scenario: Datos inválidos
- **WHEN** se envía un proveedor sin nombre o con un día de la semana inexistente
- **THEN** el sistema responde `400` y no guarda nada

### Requirement: Lista de proveedores
El admin SHALL poder ver la lista de proveedores con nombre, teléfono, días de pedido y de entrega, y cantidad de productos activos. La lista MUST indicar qué proveedores toman pedido el día de hoy según la hora de Argentina.

#### Scenario: Proveedor que toma pedido hoy
- **WHEN** es jueves en Argentina y un proveedor toma pedido los jueves
- **THEN** la lista marca a ese proveedor como "toma pedido hoy"

#### Scenario: Cerca de la medianoche
- **WHEN** son las 22:00 del miércoles en Argentina (01:00 del jueves en UTC)
- **THEN** la lista marca a los proveedores que toman pedido los miércoles, no los jueves

### Requirement: Desactivación de proveedores
El admin SHALL poder desactivar y reactivar proveedores. Los proveedores MUST NOT borrarse. Un proveedor desactivado MUST NOT poder asignarse a productos nuevos, y sus productos MUST conservar la asociación.

#### Scenario: Desactivar un proveedor con productos
- **WHEN** el admin desactiva un proveedor que tiene productos
- **THEN** los productos siguen asociados a ese proveedor
- **AND** el proveedor no aparece entre las opciones para asignar a un producto
