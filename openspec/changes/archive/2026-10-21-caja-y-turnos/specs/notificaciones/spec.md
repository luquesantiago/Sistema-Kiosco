# Spec Delta

## ADDED Requirements

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
