# Spec Delta

## ADDED Requirements

### Requirement: Envío automático por WhatsApp
El sistema SHALL enviar solo, sin intervención del admin, cada aviso pendiente por WhatsApp al número de destino, con su texto tal como fue guardado. Con WhatsApp funcionando, un aviso nuevo MUST enviarse dentro del minuto. Al enviarse, MUST quedar `enviada` con la fecha de envío.

#### Scenario: Anulación avisada
- **WHEN** un empleado anula una venta con WhatsApp conectado y número cargado
- **THEN** antes de un minuto el número de destino recibe el texto del aviso
- **AND** el aviso queda `enviada` con su fecha de envío

### Requirement: Espera mientras WhatsApp no está disponible
Mientras WhatsApp no está configurado, no está conectado, no responde o falta el número de destino, los avisos MUST quedar `pendiente` sin contar intentos fallidos. Cuando WhatsApp vuelve a estar disponible, MUST enviarse sin intervención.

#### Scenario: Chip sin internet un fin de semana
- **WHEN** el chip está desvinculado desde el sábado y se generan avisos hasta el lunes
- **THEN** todos siguen `pendiente` sin intentos fallidos
- **AND** al volver a vincular el chip se envían

### Requirement: Avisos acumulados en orden
Cuando hay varios avisos pendientes, el sistema MUST enviarlos de a uno, del más antiguo al más reciente, con una pausa de algunos segundos entre cada envío. Cada aviso MUST enviarse como un mensaje independiente con su texto original.

#### Scenario: Siete avisos acumulados
- **WHEN** se vuelve a vincular el chip con 2 cierres, 1 anulación y 4 gastos pendientes
- **THEN** el número de destino recibe 7 mensajes separados, en el orden en que se generaron los avisos

### Requirement: Reintentos de un aviso que falla
Si el envío de un aviso falla con WhatsApp conectado, el sistema MUST reintentarlo esperando cada vez más entre intentos. Después de 5 intentos fallidos, el aviso MUST quedar `error` con el motivo de la última falla y MUST NOT reintentarse solo.

#### Scenario: Falla pasajera
- **WHEN** el primer envío de un aviso falla y el segundo funciona
- **THEN** el aviso queda `enviada`

#### Scenario: Falla persistente
- **WHEN** un aviso falla 5 veces con WhatsApp conectado
- **THEN** queda `error` con el motivo de la última falla
- **AND** el sistema no vuelve a intentarlo solo

### Requirement: Reintento manual
El admin SHALL poder reintentar un aviso en `error`, que vuelve a `pendiente` con los intentos en cero. Un aviso que no está en `error` MUST NOT poder reintentarse. Un empleado MUST NOT poder reintentar avisos.

#### Scenario: Admin reintenta un aviso
- **WHEN** el admin reintenta un aviso en `error`
- **THEN** el aviso vuelve a `pendiente` y se envía en el próximo ciclo

#### Scenario: Reintentar un aviso ya enviado
- **WHEN** el admin intenta reintentar un aviso `enviada`
- **THEN** el sistema responde `409` y el aviso no cambia

#### Scenario: Empleado intenta reintentar
- **WHEN** un empleado pide reintentar un aviso
- **THEN** el sistema responde `403`

## MODIFIED Requirements

### Requirement: Lista de avisos para el admin
El admin SHALL poder ver los avisos del más reciente al más antiguo, con su estado y texto. Los avisos enviados MUST mostrar la fecha de envío y los avisos en `error` MUST mostrar el motivo de la falla. Un empleado MUST NOT poder verlos.

#### Scenario: El admin revisa los avisos
- **WHEN** el admin abre la lista de avisos
- **THEN** ve el aviso de cada anulación con su estado

#### Scenario: Aviso con error
- **WHEN** el admin abre la lista y hay un aviso en `error`
- **THEN** ve el motivo de la falla y la opción de reintentarlo

#### Scenario: Empleado intenta ver los avisos
- **WHEN** un empleado pide la lista de avisos
- **THEN** el sistema responde `403`
