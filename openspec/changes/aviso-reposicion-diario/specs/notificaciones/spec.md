# Spec Delta

## MODIFIED Requirements

### Requirement: Avisos pendientes
El sistema SHALL guardar cada aviso con tipo, destinatario (`admin`), texto ya armado, estado (`pendiente`, `enviada`, `error` o `reemplazada`) y fecha de creación. Un aviso nuevo MUST quedar `pendiente`. Los avisos MUST NOT borrarse.

#### Scenario: Aviso creado
- **WHEN** el sistema genera un aviso de anulación
- **THEN** el aviso queda `pendiente` con su texto completo

## ADDED Requirements

### Requirement: Aviso diario de reposición
El sistema MUST crear el aviso diario de reposición (ver `reposicion`) como un aviso pendiente de tipo `reposicion` para el admin, con su texto ya armado. Se MUST enviar por el mismo envío automático que los demás avisos y verse en la lista de avisos del admin. Un empleado MUST NOT poder verlo.

#### Scenario: Aviso de reposición creado
- **WHEN** a las 12:00 del 10/11 se genera el aviso de reposición
- **THEN** queda un aviso `pendiente` de tipo `reposicion` para el admin con el texto completo

#### Scenario: Aviso de reposición enviado
- **WHEN** se genera el aviso de reposición con WhatsApp conectado y número cargado
- **THEN** antes de un minuto el número de destino lo recibe y el aviso queda `enviada`

#### Scenario: El admin lo ve en Avisos
- **WHEN** el admin abre la lista de avisos después de las 12:00
- **THEN** ve el aviso de reposición del día con su estado

#### Scenario: Empleado intenta ver los avisos
- **WHEN** un empleado pide la lista de avisos
- **THEN** el sistema responde `403`

### Requirement: Solo el aviso de reposición más reciente
Al generarse el aviso de reposición del día, en la misma operación, cada aviso `reposicion` anterior que siga `pendiente` (aunque esté esperando un reintento) MUST pasar a `reemplazada`. Así nunca hay más de un aviso de reposición pendiente. Los avisos `reposicion` `enviada` o en `error` y los avisos de otros tipos MUST NOT cambiar.

#### Scenario: Sin avisos de reposición anteriores pendientes
- **WHEN** se genera el aviso del 10/11 y no hay avisos `reposicion` pendientes
- **THEN** queda el aviso del 10/11 `pendiente` y ningún otro aviso cambia

#### Scenario: Un aviso anterior pendiente
- **WHEN** se genera el aviso del 10/11 y el del 09/11 sigue `pendiente`
- **THEN** el del 09/11 queda `reemplazada` y el del 10/11 `pendiente`

#### Scenario: Tres días sin WhatsApp
- **WHEN** el chip estuvo desvinculado desde el sábado 07/11 y se genera el aviso del martes 10/11 con los del 07/11, 08/11 y 09/11 `pendiente`
- **THEN** los del 07/11, 08/11 y 09/11 quedan `reemplazada`
- **AND** al volver a vincular el chip el número de destino recibe solo el aviso de reposición del 10/11

#### Scenario: Aviso anterior esperando un reintento
- **WHEN** se genera el aviso del 10/11 y el del 09/11 está `pendiente` con 2 intentos fallidos
- **THEN** el del 09/11 queda `reemplazada` y no se vuelve a intentar

#### Scenario: Aviso anterior ya enviado
- **WHEN** se genera el aviso del 10/11 y el del 09/11 está `enviada`
- **THEN** el del 09/11 sigue `enviada` con su fecha de envío

#### Scenario: Aviso anterior en error
- **WHEN** se genera el aviso del 10/11 y el del 08/11 está en `error`
- **THEN** el del 08/11 sigue en `error` con su motivo y la opción de reintentarlo

#### Scenario: Aviso pendiente de otro tipo
- **WHEN** se genera el aviso del 10/11 y hay una anulación del 09/11 `pendiente`
- **THEN** la anulación sigue `pendiente` y se envía cuando WhatsApp esté disponible

#### Scenario: Segunda revisión del mismo día
- **WHEN** el aviso del 10/11 ya existe y el sistema vuelve a revisar ese día
- **THEN** ningún aviso cambia de estado

### Requirement: Avisos reemplazados
Un aviso `reemplazada` MUST NOT enviarse, MUST NOT contar como pendiente en el estado de WhatsApp y MUST NOT poder reintentarse. En la lista de avisos del admin MUST mostrarse con un texto que explique que no se envió porque hubo un aviso de reposición más nuevo.

#### Scenario: No se envía
- **WHEN** WhatsApp vuelve a estar disponible y hay un aviso `reemplazada`
- **THEN** el aviso no se envía y sigue `reemplazada`

#### Scenario: El admin lo ve en Avisos
- **WHEN** el admin abre la lista de avisos y hay un aviso `reemplazada`
- **THEN** lo ve con su texto y la aclaración de que no se envió porque hubo uno más nuevo, sin la opción de reintentarlo

#### Scenario: Intento de reintentarlo
- **WHEN** el admin pide reintentar un aviso `reemplazada`
- **THEN** el sistema responde `409` y el aviso no cambia

#### Scenario: Cartel de WhatsApp
- **WHEN** WhatsApp está desvinculado con 1 aviso `pendiente` y 3 `reemplazada`
- **THEN** el estado de WhatsApp informa 1 aviso pendiente
