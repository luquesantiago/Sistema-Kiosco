# Spec Delta

## ADDED Requirements

### Requirement: Ventas en espera y canceladas fuera del dashboard
Las ventas, la ganancia, las ventas por día, los totales por medio de pago, los más vendidos y la comparación con el período anterior MUST contar solo las ventas `pagada`. Las ventas `pendiente` y `cancelada` MUST NOT contar en ningún número del dashboard, ni como ventas ni como anuladas. Una venta aprobada MUST contar en el día y la hora en que se registró.

#### Scenario: Venta en espera
- **WHEN** hoy hay ventas pagadas por $100.000 y una venta en espera de $5.000
- **THEN** las ventas de hoy son $100.000 y la venta en espera no suma en ningún medio de pago ni en los más vendidos

#### Scenario: Venta cancelada
- **WHEN** hoy hay ventas pagadas por $100.000 y una venta cancelada de $5.000
- **THEN** las ventas de hoy son $100.000 y las anuladas no cambian

#### Scenario: Venta aprobada después de la medianoche
- **WHEN** una venta se registró en espera a las 23:59:58 del 10/11 y su pago se aprobó a las 00:00:03 del 11/11
- **THEN** cuenta en las ventas del 10/11
