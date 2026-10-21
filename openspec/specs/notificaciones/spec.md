# notificaciones Specification

## Purpose

Guarda los avisos que el sistema tiene que mandarle al admin (por ejemplo, una venta anulada) hasta que se envíen, para que ningún aviso se pierda aunque el envío por WhatsApp falle o todavía no exista.

## Requirements

### Requirement: Avisos pendientes
El sistema SHALL guardar cada aviso con tipo, destinatario (`admin`), texto ya armado, estado (`pendiente`, `enviada` o `error`) y fecha de creación. Un aviso nuevo MUST quedar `pendiente`. Los avisos MUST NOT borrarse.

#### Scenario: Aviso creado
- **WHEN** el sistema genera un aviso de anulación
- **THEN** el aviso queda `pendiente` con su texto completo

### Requirement: Texto del aviso de anulación
El texto del aviso de anulación MUST incluir el número de venta, la fecha y hora en Argentina, el nombre de quien anuló, el motivo, cada ítem con cantidad y subtotal, y el total, en un formato legible por WhatsApp.

#### Scenario: Texto de ejemplo
- **WHEN** Juan anula a las 15:42 la venta #120 de 2 alfajores ($1.800) y 1 gaseosa ($1.500) con motivo "cobré dos veces"
- **THEN** el texto del aviso menciona la venta #120, las 15:42, a Juan, el motivo, los dos ítems y el total $3.300

### Requirement: Lista de avisos para el admin
El admin SHALL poder ver los avisos del más reciente al más antiguo, con su estado y texto. Un empleado MUST NOT poder verlos.

#### Scenario: El admin revisa los avisos
- **WHEN** el admin abre la lista de avisos
- **THEN** ve el aviso de cada anulación con su estado `pendiente`

#### Scenario: Empleado intenta ver los avisos
- **WHEN** un empleado pide la lista de avisos
- **THEN** el sistema responde `403`

### Requirement: Aviso por gasto o retiro del empleado
Cuando un empleado registra un gasto o un retiro de caja, el sistema MUST crear en la misma operación un aviso pendiente para el admin. El texto MUST incluir el tipo de movimiento, el monto, el motivo, el nombre del empleado y la fecha y hora en Argentina. Los movimientos que registra el admin y el retiro al cierre MUST NOT generar este aviso.

#### Scenario: Gasto del empleado
- **WHEN** Juan registra a las 10:15 un gasto de $8.000 con motivo "pago a proveedor - Coca"
- **THEN** queda un aviso pendiente que menciona el gasto, los $8.000, el motivo, a Juan y las 10:15

#### Scenario: Retiro del admin
- **WHEN** el admin registra un retiro de caja
- **THEN** no se genera ningún aviso

### Requirement: Resumen del cierre de turno
Al cerrar un turno, el sistema MUST crear en la misma operación un aviso pendiente para el admin. El texto MUST incluir el responsable, quién cerró si es otra persona, las horas de apertura y cierre en Argentina, la cantidad de ventas, el total por medio de pago, los gastos, los retiros, los ingresos, las anulaciones descontadas, la diferencia de apertura si no es cero, el esperado, lo contado, la diferencia y lo que quedó en caja, en un formato legible por WhatsApp.

#### Scenario: Cierre normal
- **WHEN** Juan cierra su turno de 7:02 a 13:05 con 84 ventas, esperado $52.000 y contado $51.500
- **THEN** queda un aviso pendiente con el resumen del turno, la diferencia -$500 y lo que quedó en caja

#### Scenario: Cierre del turno de otro
- **WHEN** Juan cierra el turno que Ana dejó abierto
- **THEN** el resumen indica que Ana es la responsable y que cerró Juan
