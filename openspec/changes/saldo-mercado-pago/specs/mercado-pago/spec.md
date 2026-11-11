# Spec Delta

## Purpose

Conecta el sistema con la cuenta de Mercado Pago del kiosco: la configuración de las credenciales, la lectura del saldo y, con el cobro, los pagos con la terminal Point y sus notificaciones.

## ADDED Requirements

### Requirement: Saldo de la cuenta de Mercado Pago
El sistema SHALL mostrar el saldo de la cuenta de Mercado Pago del kiosco tal como lo informa Mercado Pago: lo disponible y, si Mercado Pago lo informa, lo que está a liberar, con la hora en que se leyó. El saldo MUST NOT calcularse a partir de las ventas ni de los movimientos del sistema. El admin y el empleado SHALL poder consultarlo; sin sesión MUST responderse `401`.

#### Scenario: El admin mira el saldo
- **WHEN** Mercado Pago informa $250.000,00 disponibles y $40.000,00 a liberar, y el admin consulta el saldo a las 10:00
- **THEN** ve disponible $250.000,00, a liberar $40.000,00 y "actualizado a las 10:00"

#### Scenario: El empleado mira el saldo
- **WHEN** un empleado consulta el saldo de Mercado Pago
- **THEN** recibe el mismo saldo que el admin

#### Scenario: Mercado Pago no informa lo que está a liberar
- **WHEN** Mercado Pago informa solo el disponible
- **THEN** se muestra el disponible y no se muestra la línea "a liberar"

#### Scenario: Consulta sin sesión
- **WHEN** alguien sin sesión pide el saldo
- **THEN** el sistema responde `401`

### Requirement: Caché del saldo
El sistema MUST reutilizar el último saldo leído mientras tenga menos de 60 segundos, sin consultar a Mercado Pago. Con 60 segundos o más, la siguiente consulta MUST pedirlo de nuevo a Mercado Pago. Varias consultas simultáneas con la caché vencida MUST generar una sola consulta a Mercado Pago.

#### Scenario: Caché vigente, 1 ms antes del vencimiento
- **WHEN** el saldo se leyó de Mercado Pago a las 10:00:00,000 y se vuelve a consultar a las 10:00:59,999
- **THEN** se devuelve el mismo saldo con la hora 10:00:00 y no se consulta a Mercado Pago

#### Scenario: Caché vencida justo a los 60 segundos
- **WHEN** el saldo se leyó a las 10:00:00,000 y se vuelve a consultar a las 10:01:00,000
- **THEN** el sistema consulta a Mercado Pago y devuelve el saldo nuevo con la hora 10:01:00

#### Scenario: Caché vencida después de los 60 segundos
- **WHEN** el saldo se leyó a las 10:00:00,000 y se vuelve a consultar a las 10:01:00,001
- **THEN** el sistema consulta a Mercado Pago

#### Scenario: Tres pantallas a la vez
- **WHEN** con la caché vencida llegan 3 consultas del saldo al mismo tiempo
- **THEN** se hace una sola consulta a Mercado Pago y las 3 reciben el mismo saldo

### Requirement: Saldo cuando Mercado Pago no responde
Si Mercado Pago no responde dentro de 10 segundos o rechaza la consulta, el sistema MUST devolver el último saldo leído con su hora, marcado como desactualizado y con el motivo a la vista. Si nunca se pudo leer, MUST informar que el saldo no está disponible. Un rechazo de Mercado Pago (por ejemplo, credenciales inválidas) MUST distinguirse de la falta de respuesta, sin mostrar detalles internos ni credenciales.

#### Scenario: Respuesta justo antes del límite
- **WHEN** Mercado Pago responde el saldo a los 9,9 segundos
- **THEN** se muestra el saldo nuevo

#### Scenario: Sin respuesta a los 10 segundos con un saldo anterior
- **WHEN** Mercado Pago no responde en 10 segundos y el último saldo leído es de las 09:58
- **THEN** se muestra ese saldo con "actualizado a las 09:58", la marca de desactualizado y el motivo "Mercado Pago no responde"

#### Scenario: Credenciales rechazadas con un saldo anterior
- **WHEN** Mercado Pago rechaza la consulta por credenciales inválidas y el último saldo leído es de las 09:58
- **THEN** se muestra ese saldo con "actualizado a las 09:58", la marca de desactualizado y el motivo "Mercado Pago rechazó las credenciales", sin el token ni la respuesta de Mercado Pago

#### Scenario: Sin respuesta y sin saldo anterior
- **WHEN** Mercado Pago no responde en 10 segundos y el sistema nunca leyó el saldo
- **THEN** se muestra "Saldo no disponible: Mercado Pago no responde"

#### Scenario: Credenciales rechazadas
- **WHEN** Mercado Pago rechaza la consulta por credenciales inválidas
- **THEN** se muestra "Saldo no disponible: Mercado Pago rechazó las credenciales", sin el token ni la respuesta de Mercado Pago

#### Scenario: Un saldo desactualizado no se guarda como nuevo
- **WHEN** Mercado Pago no respondió a las 10:05 y se vuelve a consultar a las 10:05:10
- **THEN** el sistema vuelve a intentar con Mercado Pago, porque la última lectura buena sigue siendo de las 09:58

### Requirement: Sistema sin Mercado Pago configurado
La API MUST arrancar y atender pedidos aunque no tenga credenciales de Mercado Pago. En ese caso el saldo MUST informarse como "no configurado" sin intentar ninguna consulta, y el chequeo de estado de la API MUST NOT depender de Mercado Pago.

#### Scenario: Desarrollo sin credenciales
- **WHEN** la API arranca sin credenciales de Mercado Pago y alguien pide el saldo
- **THEN** recibe el estado "no configurado" y no se hace ninguna consulta a Mercado Pago

#### Scenario: Mercado Pago caído en producción
- **WHEN** Mercado Pago no responde y se llama a `GET /api/health` con la base funcionando
- **THEN** la API responde `200` con `"estado": "ok"`

### Requirement: Credenciales de Mercado Pago protegidas
El token de acceso de Mercado Pago MUST vivir solo en la configuración del servidor, fuera del repositorio. MUST NOT enviarse a la web, guardarse en la base ni aparecer en logs o mensajes de error. Si la configuración de Mercado Pago es inválida, la API MUST NOT arrancar y MUST nombrar la variable sin mostrar su valor.

#### Scenario: La web nunca recibe el token
- **WHEN** cualquier usuario consulta el saldo
- **THEN** la respuesta no incluye el token ni ningún dato de las credenciales

#### Scenario: Token vacío
- **WHEN** la API arranca con la variable del token de Mercado Pago definida pero vacía
- **THEN** no arranca e informa la variable con "valor inválido", sin mostrar el valor
