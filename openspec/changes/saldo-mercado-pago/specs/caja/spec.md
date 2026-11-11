# Spec Delta

## ADDED Requirements

### Requirement: Saldo de Mercado Pago desde la caja del mostrador
Quien opera la caja del mostrador (empleado o admin) SHALL ver el saldo de Mercado Pago del kiosco al abrir la caja (F8), con la hora en que se leyó. La caja solo se abre con un turno abierto: sin turno abierto, el empleado no ve el saldo y no hay otra pantalla que lo muestre en el mostrador. Mientras la caja está abierta, el saldo MUST refrescarse solo cada 60 segundos. El saldo MUST NOT afectar el efectivo esperado y no da acceso al esperado ni a las diferencias.

#### Scenario: El empleado abre la caja
- **WHEN** un empleado abre la caja del mostrador y Mercado Pago informa $250.000 disponibles leídos a las 10:00
- **THEN** ve "Mercado Pago: $250.000 (10:00)" junto a los movimientos de su turno, sin ver el esperado

#### Scenario: Saldo desactualizado en el mostrador
- **WHEN** Mercado Pago no responde y el último saldo leído es de las 09:58
- **THEN** la caja muestra ese saldo con "actualizado a las 09:58", la marca de desactualizado y el motivo "Mercado Pago no responde"

#### Scenario: La consulta del saldo falla o no termina
- **WHEN** el empleado abre la caja y la consulta del saldo responde con error o no termina nunca
- **THEN** los movimientos del turno se muestran y se puede registrar un movimiento sin esperar al saldo

#### Scenario: Mercado Pago no configurado
- **WHEN** el sistema no tiene credenciales de Mercado Pago y el empleado abre la caja
- **THEN** la caja funciona igual y no muestra la línea del saldo
