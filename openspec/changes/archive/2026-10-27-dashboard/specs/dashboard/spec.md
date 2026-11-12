# Spec Delta

## Purpose

Muestra al admin, desde el celular, cómo va el kiosco en un período (ventas, ganancia, gastos, resultado y movimientos de plata) y el estado actual del efectivo y de lo que hay que pagar a los proveedores.

## ADDED Requirements

### Requirement: Acceso al dashboard
El dashboard SHALL ser solo del admin y MUST aparecer arriba de todo en el panel de administración, que es donde entra el admin. Un empleado que pide los datos del dashboard MUST recibir `403`.

#### Scenario: El admin entra desde el celular
- **WHEN** el admin inicia sesión
- **THEN** ve el dashboard de hoy arriba del panel de administración

#### Scenario: Un empleado pide el dashboard
- **WHEN** un empleado pide los datos del dashboard
- **THEN** el sistema responde `403`

### Requirement: Período del dashboard
El dashboard SHALL mostrar los datos de un período en hora de Argentina, elegido entre Hoy (por defecto), Ayer, Semana (de lunes a hoy), Mes (del 1 a hoy), Mes anterior o un rango de fechas. Un rango con "desde" posterior a "hasta" MUST rechazarse con `400`.

#### Scenario: La semana arranca el lunes
- **WHEN** el jueves 22/10/2026 el admin elige "Semana"
- **THEN** ve los datos del lunes 19 al jueves 22 de octubre

#### Scenario: Rango al revés
- **WHEN** se piden datos desde el 21 hasta el 20 de octubre
- **THEN** el sistema responde `400`

### Requirement: Efectivo en caja y pendiente de pagar
El dashboard SHALL mostrar, sin importar el período elegido, el efectivo en caja y lo pendiente de pagar. El efectivo en caja MUST ser el esperado en vivo del turno abierto o, si no hay ninguno, lo que quedó en caja al cerrar el último turno. Lo pendiente de pagar MUST ser la suma del total de los pedidos por llegar más el total de los pedidos que llegaron sin pagar, cada parte con su cantidad. El saldo de Mercado Pago MUST NOT mostrarse.

#### Scenario: Turno abierto
- **WHEN** hay un turno abierto cuyo esperado es $90.000
- **THEN** el efectivo en caja es $90.000

#### Scenario: Sin turno abierto
- **WHEN** no hay turno abierto y en el último cierre quedaron $21.500
- **THEN** el efectivo en caja es $21.500

#### Scenario: Pendiente de pagar
- **WHEN** hay 2 pedidos por llegar por $310.000 en total y 3 entregas que deben $210.000, y un pedido cancelado
- **THEN** lo pendiente de pagar es $520.000: por llegar 2 por $310.000 y deben 3 por $210.000

### Requirement: Ventas y ganancia del período
El dashboard SHALL mostrar las ventas del período (total y cantidad, sin las anuladas) y la ganancia, calculada como el subtotal menos cantidad por costo unitario solo de los ítems que tienen costo, con su margen sobre esas ventas. MUST mostrar aparte el total vendido en ítems sin costo, incluido "Varios".

#### Scenario: Ventas con y sin costo
- **WHEN** en el día se vendieron una gaseosa de $1.500 con costo $1.000 y un ítem "Varios" de $500, y se anuló otra venta de $3.000
- **THEN** las ventas son $2.000 en 2 ventas, la ganancia es $500 con margen 33%, y lo vendido sin costo es $500

### Requirement: Comparación con el período anterior
Las ventas y la ganancia MUST compararse con el período anterior del mismo largo, terminado el día antes de que empiece el elegido, mostrando la variación en porcentaje. El mes en curso MUST compararse con los mismos días del mes anterior (o hasta su último día si es más corto). Si el período anterior es cero, MUST NOT mostrarse un porcentaje.

#### Scenario: Hoy contra ayer
- **WHEN** hoy se vendieron $108.000 y ayer $100.000
- **THEN** las ventas muestran +8% contra ayer

#### Scenario: Mes en curso
- **WHEN** el 22 de octubre el admin elige "Mes"
- **THEN** se compara del 1 al 22 de octubre contra del 1 al 22 de septiembre

#### Scenario: Período anterior sin ventas
- **WHEN** el período anterior no tuvo ventas
- **THEN** no se muestra un porcentaje

### Requirement: Gastos y resultado
El dashboard SHALL mostrar los gastos del período de las dos cuentas (efectivo y Mercado Pago), en total y por categoría, y el resultado como la ganancia menos los gastos. Los pagos a proveedores, los retiros y los ingresos MUST NOT restarse ni sumarse al resultado.

#### Scenario: Resultado del mes
- **WHEN** en el mes la ganancia fue $150.000, hubo $15.000 de Servicios en Mercado Pago y $5.000 de Insumos en efectivo, y se pagaron $210.000 a proveedores
- **THEN** los gastos son $20.000 (Servicios $15.000, Insumos $5.000) y el resultado es $130.000

### Requirement: Ventas por día y por medio de pago
El dashboard SHALL mostrar las ventas del período agrupadas por día, o por hora cuando el período es de un solo día, y el total cobrado por cada medio de pago (efectivo, débito, crédito y Mercado Pago), sin las ventas anuladas.

#### Scenario: Ventas de hoy por hora
- **WHEN** el admin mira "Hoy" con ventas a las 8 y a las 10
- **THEN** ve las ventas agrupadas por hora

#### Scenario: Pago mixto
- **WHEN** una venta de $5.000 se cobró $2.000 en efectivo y $3.000 con débito
- **THEN** suma $2.000 a efectivo y $3.000 a débito

### Requirement: Productos más vendidos
El dashboard SHALL mostrar los 10 productos más vendidos del período, sin "Varios" ni ventas anuladas, con unidades, importe y ganancia, ordenables por unidades, por importe o por ganancia. Ordenados por ganancia MUST incluirse solo los que tienen costo.

#### Scenario: Orden por ganancia
- **WHEN** el admin ordena los más vendidos por ganancia y un producto vendido no tiene costo
- **THEN** ese producto no aparece en ese orden

### Requirement: Movimientos de plata del período
El dashboard SHALL mostrar los pagos a proveedores del período (total y por cuenta), los retiros (incluidos los del cierre) e ingresos de las dos cuentas, la suma de las diferencias de los turnos cerrados en el período con su cantidad y un enlace a Turnos, y la cantidad e importe de las ventas anuladas en el período.

#### Scenario: Diferencias del mes
- **WHEN** en el mes cerraron 20 turnos, uno con -$1.500 y otro con +$300
- **THEN** las diferencias muestran -$1.200 en 2 turnos con diferencia, con enlace a Turnos
