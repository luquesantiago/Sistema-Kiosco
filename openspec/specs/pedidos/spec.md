# pedidos Specification

## Purpose

Registra lo que el kiosco le pide a cada proveedor: qué falta que llegue, lo que llegó y falta cargar, a quién se le debe y cuánto, y cuándo cada entrega quedó recibida y pagada.

## Requirements

### Requirement: Alta de un pedido
El admin SHALL poder crear un pedido con un proveedor activo, el total a pagar (mayor que cero), la fecha en que llega y una nota opcional. El pedido MUST quedar con un número correlativo, el admin y la fecha, la mercadería "por llegar" y sin pagar. Un empleado MUST recibir `403`. Al crear un pedido, la pantalla MUST precargar la fecha con el próximo día de entrega del proveedor a partir de mañana, o mañana si no tiene días de entrega.

#### Scenario: El admin pide a Coca-Cola
- **WHEN** el martes el admin crea un pedido a Coca-Cola, que entrega los jueves, por $310.000 con nota "4 packs de 500"
- **THEN** la fecha se precarga con el jueves
- **AND** el pedido queda con el número siguiente, por llegar y sin pagar

#### Scenario: Proveedor desactivado o total cero
- **WHEN** el admin intenta crear un pedido a un proveedor desactivado o con total $0
- **THEN** el sistema responde `400` y no crea nada

#### Scenario: Un empleado intenta crear un pedido
- **WHEN** un empleado intenta crear un pedido
- **THEN** el sistema responde `403`

### Requirement: Edición y cancelación de un pedido
Mientras la mercadería está "por llegar", el admin SHALL poder editar el total, la fecha y la nota del pedido, y cancelarlo con un motivo. Un pedido cancelado MUST NOT recibirse ni pagarse. Editar o cancelar un pedido que ya llegó MUST rechazarse con `409`. Los pedidos MUST NOT borrarse.

#### Scenario: Cambia el total antes de que llegue
- **WHEN** el admin cambia el total del pedido de Coca-Cola de $310.000 a $295.000 antes de que llegue
- **THEN** el pedido queda con el total nuevo

#### Scenario: El proveedor no viene
- **WHEN** el admin cancela un pedido por llegar con motivo "no vino"
- **THEN** el pedido queda cancelado con el motivo, el admin y la fecha, y ya no figura como pendiente de pagar

#### Scenario: Cancelar un pedido que ya llegó
- **WHEN** el admin intenta cancelar un pedido cuya mercadería ya llegó
- **THEN** el sistema responde `409`

### Requirement: Recepción de un pedido
Admin y empleado SHALL poder marcar que un pedido "por llegar" llegó, con el total final (precargado con el del pedido y corregible, mayor que cero), una nota de recepción opcional (por ejemplo, faltantes) y, si se paga en ese momento, la cuenta. Sin cuenta, el pedido MUST quedar sin pagar ("queda debiendo"). Marcar que llegó MUST NOT exigir cargar los productos. Un pedido que ya llegó o está cancelado MUST rechazarse con `409`.

#### Scenario: Llega Coca y se paga en efectivo
- **WHEN** el empleado marca que llegó el pedido de Coca-Cola con total $310.000 y paga en efectivo
- **THEN** la mercadería queda "llegó, falta cargar" y el pedido queda pagado con $310.000 en efectivo

#### Scenario: Llegó con faltantes
- **WHEN** el empleado marca que llegó con total $280.000 y nota "faltaron 2 packs"
- **THEN** el pedido queda con total $280.000 y la nota de recepción

#### Scenario: Queda debiendo
- **WHEN** el empleado marca que llegó el pedido de Pepsi sin elegir cuenta
- **THEN** la mercadería queda "llegó" y el pedido queda sin pagar

### Requirement: Recibir sin pedido
Admin y empleado SHALL poder recibir mercadería sin un pedido previo indicando un proveedor activo (obligatorio), el total, una nota opcional y, si se paga en ese momento, la cuenta. El sistema MUST crear un pedido con número correlativo cuya mercadería ya "llegó", con las mismas reglas de pago que la recepción.

#### Scenario: Llega el pan
- **WHEN** el empleado recibe sin pedido a "Panadería" por $12.000 pagando en efectivo
- **THEN** queda un pedido nuevo de Panadería, llegado y pagado, que falta cargar

#### Scenario: Sin proveedor
- **WHEN** se intenta recibir sin pedido sin indicar proveedor
- **THEN** el sistema responde `400` y no registra nada

### Requirement: Carga de la mercadería de un pedido
Admin y empleado SHALL poder cargar los productos de un pedido que llegó, una sola vez, con un ingreso de mercadería atado a ese pedido. Al cargarlos, la mercadería MUST quedar "cargada". Cargar un pedido que no llegó, que está cancelado o que ya se cargó MUST rechazarse con `409`.

#### Scenario: Carga después de atender
- **WHEN** el empleado carga 24 gaseosas y 12 alfajores en el pedido de Coca-Cola que llegó hace una hora
- **THEN** sube el stock, queda el ingreso atado al pedido y la mercadería queda "cargada"

#### Scenario: Cargar dos veces
- **WHEN** se intenta cargar de nuevo un pedido ya cargado
- **THEN** el sistema responde `409` y el stock no cambia

### Requirement: Pago de un pedido
Admin y empleado SHALL poder pagar un pedido que llegó y está sin pagar, entero, con una cuenta (Efectivo o Mercado Pago) y el total, corregible al pagar. El pago MUST registrarse como un movimiento de caja `pago_proveedor` atado al pedido, con las reglas de turno de la caja. Un pedido por llegar, cancelado o ya pagado MUST rechazarse con `409`.

#### Scenario: El preventista cobra la entrega anterior
- **WHEN** el jueves el empleado paga en efectivo los $210.000 del pedido de Pepsi que quedó debiendo
- **THEN** el pedido queda pagado y el esperado de su turno baja $210.000

#### Scenario: El admin paga desde el celular
- **WHEN** el admin, sin turno abierto, paga con Mercado Pago un pedido que quedó debiendo
- **THEN** el pedido queda pagado con un movimiento de Mercado Pago sin turno

#### Scenario: Pagar por adelantado
- **WHEN** alguien intenta pagar un pedido que todavía no llegó
- **THEN** el sistema responde `409`

### Requirement: Pedido cerrado
Un pedido MUST quedar cerrado, con la fecha de cierre, cuando su mercadería está cargada y está pagado, sin importar en qué orden pasó cada cosa.

#### Scenario: Pagó primero y cargó después
- **WHEN** el empleado paga al recibir y carga la mercadería media hora después
- **THEN** el pedido queda cerrado al cargar

#### Scenario: Cargó primero y pagó después
- **WHEN** el pedido de Pepsi está cargado y el jueves se paga
- **THEN** el pedido queda cerrado al pagar

### Requirement: Lista de pedidos
Admin y empleado SHALL ver los pedidos abiertos (ni cerrados ni cancelados) con número, proveedor, fecha en que llega, total, estado de la mercadería y si está pagado, primero los que hay que atender. El admin SHALL ver además los cerrados y cancelados de un rango de fechas. Cada pedido MUST mostrar su detalle: quién lo creó, recibió, cargó y pagó, con fechas, y el ingreso de mercadería.

#### Scenario: El empleado mira qué está pendiente
- **WHEN** el empleado abre la lista de pedidos
- **THEN** ve los que llegan hoy o están atrasados, los que llegaron y falta cargar, y los que quedaron debiendo

#### Scenario: El admin revisa los pedidos del mes
- **WHEN** el admin pide los pedidos cerrados del 1 al 22 de octubre
- **THEN** ve los cerrados de esas fechas con su total y cómo se pagaron

### Requirement: Recordatorios en el mostrador
El POS MUST mostrar, sin cortar la venta, los pedidos por llegar con fecha de hoy o anterior y los pedidos que llegaron y falta cargar, con un acceso a cada uno.

#### Scenario: Hoy llega Coca
- **WHEN** el empleado abre el POS el jueves y hay un pedido de Coca-Cola por llegar ese día
- **THEN** ve "Hoy llega: Coca-Cola ($310.000)"

#### Scenario: Falta cargar
- **WHEN** un pedido llegó y todavía no se cargó la mercadería
- **THEN** el POS muestra que falta cargar ese pedido hasta que se carga
