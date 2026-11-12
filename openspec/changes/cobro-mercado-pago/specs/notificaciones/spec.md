# Spec Delta

## ADDED Requirements

### Requirement: Aviso de un cobro de Mercado Pago a revisar
Cuando entra el pago de una venta cancelada, cuando la terminal pide revisar un pago y cuando el cliente se fue sin la devolución, el sistema MUST crear en la misma operación un aviso pendiente para el admin con el monto, el medio, el número de venta, la hora en Argentina, el motivo y qué hacer. Se MUST enviar por el mismo envío automático que los demás avisos.

#### Scenario: Pago aprobado de una venta cancelada
- **WHEN** Mercado Pago aprueba a las 10:15 un cobro de $3.000 con débito de la venta #120, que ya estaba cancelada
- **THEN** queda un aviso pendiente "*Cobro de Mercado Pago a devolver*" con $3.000,00, débito, venta #120, 10:15, el motivo "se aprobó después de cancelar la venta" y "Se devuelve en efectivo desde la caja"

#### Scenario: La terminal pide revisar
- **WHEN** Mercado Pago informa que la terminal pide confirmar el cobro de la venta #121
- **THEN** queda un aviso pendiente para el admin con el motivo "el Point pidió revisar el pago" y "Revisalo en Administración → Mercado Pago"

#### Scenario: El cliente se fue sin la devolución
- **WHEN** el empleado indica que el cliente del cobro de $3.000 de la venta #120 ya se fue
- **THEN** queda un aviso pendiente para el admin con el motivo "el cliente se fue sin la devolución en efectivo" y "Resolvelo en Administración → Mercado Pago"

### Requirement: Aviso de una devolución en efectivo
Al confirmarse la devolución en efectivo de un cobro de una venta cancelada, el sistema MUST crear en la misma operación un aviso pendiente para el admin con el monto, el número de venta, quién devolvió y la hora en Argentina.

#### Scenario: Devolución confirmada
- **WHEN** Ana confirma a las 10:17 la devolución de $3.000 del cobro de la venta #120
- **THEN** queda un aviso pendiente "*Devolución en efectivo de un cobro de Mercado Pago*" con $3.000,00, venta #120, Ana y 10:17
