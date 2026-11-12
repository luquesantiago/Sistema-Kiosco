# Spec Delta

## ADDED Requirements

### Requirement: Costo de cada ítem vendido
Al registrar una venta, cada ítem de catálogo MUST guardar como costo unitario el costo que tiene el producto en ese momento. El costo guardado MUST NOT cambiar aunque después cambie el costo del producto. Si el producto no tiene costo, o si el ítem es "Varios", el costo del ítem MUST quedar vacío y MUST NOT completarse después.

#### Scenario: Producto con costo
- **WHEN** se vende 1 gaseosa de $1.500 cuyo costo es $1.000
- **THEN** el ítem queda con precio unitario $1.500 y costo unitario $1.000

#### Scenario: El costo del producto cambia después de vender
- **WHEN** se vende una gaseosa con costo $1.000 y más tarde un ingreso de mercadería cambia su costo a $1.100
- **THEN** el ítem de esa venta sigue con costo unitario $1.000
- **AND** una venta nueva de la misma gaseosa guarda costo unitario $1.100

#### Scenario: Producto sin costo
- **WHEN** se vende un producto que no tiene costo cargado
- **THEN** el ítem queda sin costo unitario
- **AND** si después se carga el costo del producto, ese ítem sigue sin costo

#### Scenario: Ítem "Varios"
- **WHEN** se vende un ítem "Varios" de $500
- **THEN** el ítem queda sin costo unitario

## MODIFIED Requirements

### Requirement: Listado de ventas según el rol
El empleado SHALL poder ver las ventas del día en hora de Argentina, de cualquier usuario. El admin SHALL poder ver las ventas de cualquier rango de fechas. El listado MUST mostrar número, hora, vendedor, total, medios de pago y estado, y el detalle MUST mostrar ítems y pagos. El detalle para el admin MUST incluir el costo unitario de cada ítem (vacío si no tiene). El detalle para el empleado MUST NOT incluir costos.

#### Scenario: El empleado busca una venta de hoy
- **WHEN** un empleado abre el listado de ventas
- **THEN** ve solo las ventas de hoy en hora de Argentina

#### Scenario: El empleado pide un día anterior
- **WHEN** un empleado pide las ventas de ayer
- **THEN** el sistema responde `403`

#### Scenario: El admin ve el costo de cada ítem
- **WHEN** el admin abre el detalle de una venta con una gaseosa de costo $1.000 y un ítem "Varios"
- **THEN** ve el costo unitario $1.000 en la gaseosa y el ítem "Varios" sin costo

#### Scenario: El empleado no ve costos en el detalle
- **WHEN** un empleado abre el detalle de una venta de hoy
- **THEN** la respuesta no incluye el costo de ningún ítem
