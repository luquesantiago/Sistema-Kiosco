# Spec Delta

## MODIFIED Requirements

### Requirement: Efectivo en caja y pendiente de pagar
El dashboard SHALL mostrar, sin importar el período elegido, el efectivo en caja, el saldo de Mercado Pago y lo pendiente de pagar. El efectivo en caja MUST ser el esperado en vivo del turno abierto o, si no hay ninguno, lo que quedó en caja al cerrar el último turno. El saldo de Mercado Pago MUST ser el que informa Mercado Pago, con su hora, y MUST NOT calcularse. Lo pendiente de pagar MUST ser la suma del total de los pedidos por llegar más el total de los pedidos que llegaron sin pagar, cada parte con su cantidad.

#### Scenario: Turno abierto
- **WHEN** hay un turno abierto cuyo esperado es $90.000
- **THEN** el efectivo en caja es $90.000

#### Scenario: Sin turno abierto
- **WHEN** no hay turno abierto y en el último cierre quedaron $21.500
- **THEN** el efectivo en caja es $21.500

#### Scenario: Pendiente de pagar
- **WHEN** hay 2 pedidos por llegar por $310.000 en total y 3 entregas que deben $210.000, y un pedido cancelado
- **THEN** lo pendiente de pagar es $520.000: por llegar 2 por $310.000 y deben 3 por $210.000

#### Scenario: Saldo de Mercado Pago junto al efectivo
- **WHEN** el admin abre el dashboard y Mercado Pago informa $250.000 disponibles leídos a las 10:00
- **THEN** ve el saldo de Mercado Pago $250.000 con "actualizado a las 10:00", junto al efectivo en caja

#### Scenario: Saldo no disponible
- **WHEN** el admin abre el dashboard y Mercado Pago no responde ni hay un saldo leído antes
- **THEN** el resto del dashboard se muestra igual y el saldo dice "Saldo no disponible"

#### Scenario: Mercado Pago sin configurar
- **WHEN** el sistema no tiene credenciales de Mercado Pago
- **THEN** el saldo dice "Mercado Pago no configurado" y el resto del dashboard se muestra igual

#### Scenario: El período no cambia el saldo
- **WHEN** el admin cambia el período de "Hoy" a "Mes anterior"
- **THEN** el saldo de Mercado Pago sigue siendo el actual
