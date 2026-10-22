# Spec Delta

## MODIFIED Requirements

### Requirement: Aviso por gasto o retiro del empleado
Cuando un empleado registra un gasto o un retiro de caja, el sistema MUST crear en la misma operación un aviso pendiente para el admin. El texto MUST incluir el tipo de movimiento, el monto, la categoría si es un gasto, la cuenta si es Mercado Pago, el motivo, el nombre del empleado y la fecha y hora en Argentina. Los movimientos que registra el admin y el retiro al cierre MUST NOT generar este aviso.

#### Scenario: Gasto del empleado
- **WHEN** Juan registra a las 10:15 un gasto de $8.000 de la categoría Insumos con motivo "bolsas de camiseta"
- **THEN** queda un aviso pendiente que menciona el gasto, los $8.000, la categoría Insumos, el motivo, a Juan y las 10:15

#### Scenario: Retiro del empleado
- **WHEN** Juan registra un retiro de caja de $20.000
- **THEN** queda un aviso pendiente que menciona el retiro, sin categoría

#### Scenario: Retiro del admin
- **WHEN** el admin registra un retiro de caja
- **THEN** no se genera ningún aviso

#### Scenario: Gasto del empleado con Mercado Pago
- **WHEN** Juan registra un gasto de $6.000 de Insumos con la cuenta Mercado Pago
- **THEN** el aviso pendiente indica que el gasto salió de Mercado Pago
