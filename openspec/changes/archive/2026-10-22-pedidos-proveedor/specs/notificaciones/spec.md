# Spec Delta

## MODIFIED Requirements

### Requirement: Resumen del cierre de turno
Al cerrar un turno, el sistema MUST crear en la misma operación un aviso pendiente para el admin. El texto MUST incluir el responsable, quién cerró si es otra persona, las horas de apertura y cierre en Argentina, la cantidad de ventas, el total por medio de pago, los gastos, los retiros, los ingresos, los pagos a proveedores en efectivo, las anulaciones descontadas, la diferencia de apertura si no es cero, el esperado, lo contado, la diferencia y lo que quedó en caja, en un formato legible por WhatsApp.

#### Scenario: Cierre normal
- **WHEN** Juan cierra su turno de 7:02 a 13:05 con 84 ventas, esperado $52.000 y contado $51.500
- **THEN** queda un aviso pendiente con el resumen del turno, la diferencia -$500 y lo que quedó en caja

#### Scenario: Cierre del turno de otro
- **WHEN** Juan cierra el turno que Ana dejó abierto
- **THEN** el resumen indica que Ana es la responsable y que cerró Juan

#### Scenario: Turno con pagos a proveedores
- **WHEN** en el turno se pagaron $310.000 en efectivo a Coca-Cola
- **THEN** el resumen incluye "Pagos a proveedores: $ 310.000,00"

## ADDED Requirements

### Requirement: Aviso al cerrarse un pedido
Cuando un empleado hace la acción que deja cerrado un pedido (cargar la mercadería o pagar, lo que pase último), el sistema MUST crear en la misma operación un aviso pendiente para el admin. El texto MUST incluir el número de pedido, el proveedor, el total pagado y la cuenta, la nota de recepción si la hay, la cantidad de productos cargados y quién recibió, cargó y pagó, con la fecha y hora en Argentina. Si lo cierra el admin, MUST NOT generarse el aviso.

#### Scenario: Coca pagada y cargada
- **WHEN** Juan paga en efectivo al recibir el pedido #12 de Coca-Cola y a las 10:40 termina de cargar 2 productos
- **THEN** queda un aviso pendiente con el pedido #12, Coca-Cola, $310.000 en efectivo, los 2 productos, a Juan y las 10:40

#### Scenario: Quedó debiendo
- **WHEN** el pedido de Pepsi se carga pero queda debiendo
- **THEN** no se genera ningún aviso hasta que se paga

#### Scenario: Lo cierra el admin
- **WHEN** el admin paga desde el celular un pedido ya cargado
- **THEN** el pedido queda cerrado y no se genera ningún aviso
