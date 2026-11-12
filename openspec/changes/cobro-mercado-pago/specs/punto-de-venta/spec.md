# Spec Delta

## MODIFIED Requirements

### Requirement: Cobro rápido con un solo medio
Desde el carrito, un atajo por cada medio de pago SHALL abrir el cobro del total con ese medio. Para efectivo, la pantalla SHALL permitir escribir con cuánto paga el cliente y mostrar el vuelto en grande; dejarlo vacío MUST cobrar el total justo. Enter MUST confirmar el cobro. Con el Point configurado, confirmar un cobro con débito, crédito o Mercado Pago MUST enviar el monto al Point y abrir la pantalla de espera, sin que el empleado tipee nada en la terminal.

#### Scenario: Efectivo con vuelto
- **WHEN** el total es $3.300, el empleado elige efectivo y escribe 5000
- **THEN** la pantalla muestra vuelto $1.700 y Enter registra la venta

#### Scenario: Débito en dos teclas
- **WHEN** con el Point configurado el empleado presiona el atajo de débito y luego Enter
- **THEN** el Point muestra el total para pagar con débito y el mostrador abre la pantalla de espera

#### Scenario: Débito sin Point configurado
- **WHEN** sin el Point configurado el empleado presiona el atajo de débito y luego Enter
- **THEN** la venta se registra con un pago en débito por el total

### Requirement: Pago mixto
El cobro SHALL permitir repartir el total entre varios medios, mostrando cuánto falta asignar. La confirmación MUST estar deshabilitada mientras lo asignado no sume exactamente el total. Con el Point configurado, MUST permitirse como máximo un medio distinto de efectivo: primero se cobra esa parte por el Point y, cuando se aprueba, la pantalla MUST indicar en grande cuánto cobrar en efectivo y el vuelto.

#### Scenario: Parte efectivo y parte tarjeta
- **WHEN** el total es $5.000 y el empleado asigna $2.000 en efectivo
- **THEN** la pantalla muestra que faltan $3.000
- **AND** al asignar $3.000 en débito puede confirmar la venta

#### Scenario: El Point primero, después el efectivo
- **WHEN** con el Point configurado el empleado confirma $3.000 en débito y $2.000 en efectivo, con $5.000 recibidos
- **THEN** el Point cobra $3.000 y, al aprobarse, la pantalla muestra "Cobrá $2.000 en efectivo · vuelto $3.000"

#### Scenario: Segundo medio electrónico
- **WHEN** con el Point configurado el empleado ya asignó una parte en débito e intenta asignar otra en crédito
- **THEN** la pantalla no lo permite y explica que solo una parte se cobra con el Point

## ADDED Requirements

### Requirement: Pantalla de espera del cobro
Mientras el Point cobra, el mostrador MUST mostrar el monto, el medio y el estado del cobro, actualizado sin intervención del empleado. Al aprobarse, MUST comportarse como después de cobrar. Ante un rechazo, un vencimiento o la falta de respuesta, MUST mostrar el motivo y ofrecer **Reintentar** (Enter), **Cobrar de otra forma** (vuelve al carrito intacto) y **Cancelar** (Esc, con confirmación).

#### Scenario: Pago aprobado
- **WHEN** el cliente paga con débito en el Point
- **THEN** a más tardar 5 segundos después el mostrador muestra la venta cobrada, vacía el carrito y deja el escaneo listo

#### Scenario: Tarjeta rechazada
- **WHEN** el Point rechaza la tarjeta del cliente
- **THEN** la pantalla de espera muestra "Rechazado: tarjeta rechazada por el banco" y ofrece Reintentar, Cobrar de otra forma y Cancelar

#### Scenario: Reintentar
- **WHEN** después de un rechazo el empleado presiona Enter
- **THEN** se envía un cobro nuevo al Point por el mismo monto y la pantalla vuelve a esperar

#### Scenario: Cobrar de otra forma
- **WHEN** después de un rechazo el empleado elige Cobrar de otra forma
- **THEN** la venta en espera se cancela y el mostrador vuelve al carrito con los mismos productos, listo para elegir otro medio

#### Scenario: Cancelar con el cobro en el Point
- **WHEN** el empleado presiona Esc y confirma con el cobro en la pantalla del Point
- **THEN** la pantalla muestra "Cancelando en el Point…" hasta que Mercado Pago confirma, y después vuelve al carrito intacto

#### Scenario: El cliente pagó mientras se cancelaba
- **WHEN** el empleado pidió cancelar y el pago se aprueba antes de que Mercado Pago confirme la cancelación
- **THEN** la pantalla avisa "El cliente llegó a pagar: la venta quedó cobrada" y muestra la venta cobrada

#### Scenario: Mercado Pago no responde
- **WHEN** Mercado Pago no responde al enviar el cobro
- **THEN** la pantalla de espera muestra "Mercado Pago no responde. Por ahora cobrá solo en efectivo (F1) o reintentá en un rato." con Reintentar, Cobrar de otra forma y Cancelar

### Requirement: Aviso de devolución pendiente en el mostrador
Mientras haya un cobro "a devolver", la pantalla de venta de quien opera el turno abierto MUST mostrar encima de todo, sin poder cerrarse ni seguir vendiendo, el aviso "Entró un pago de $X de un cobro cancelado (venta #N): devolvé $X en efectivo", con **Ya devolví $X** y **El cliente ya se fue**. El aviso MUST aparecer a más tardar 5 segundos después de detectarse el pago, y también al abrir un turno si quedó pendiente.

#### Scenario: Pago que entra después de cancelar
- **WHEN** el empleado canceló la venta #120 y 3 segundos después Mercado Pago aprueba el cobro de $3.000
- **THEN** el mostrador muestra encima de todo "Entró un pago de $3.000,00 de un cobro cancelado (venta #120): devolvé $3.000,00 en efectivo"
- **AND** el escaneo queda bloqueado hasta que elige una de las dos opciones

#### Scenario: Confirmar la devolución
- **WHEN** el empleado entrega los $3.000 y presiona Ya devolví $3.000
- **THEN** el aviso se cierra, el escaneo vuelve a estar listo y la devolución queda registrada en su turno

#### Scenario: El cliente ya se fue
- **WHEN** el empleado presiona El cliente ya se fue
- **THEN** el aviso se cierra sin registrar salida de efectivo y el admin queda avisado

#### Scenario: Pendiente de un día sin turno
- **WHEN** el pago entró sin turno abierto y a la mañana el empleado abre su turno
- **THEN** apenas abre el turno ve el aviso de la devolución pendiente

### Requirement: Retomar un cobro en espera
Si el mostrador se recarga o se cierra mientras hay una venta en espera del turno, al volver MUST mostrar de nuevo su pantalla de espera con el estado actual del cobro. Mientras una venta está en espera, el mostrador MUST NOT permitir empezar otro cobro por el Point.

#### Scenario: Se recarga la página durante el cobro
- **WHEN** el empleado recarga la pantalla de venta con un cobro esperando en el Point
- **THEN** vuelve a ver la pantalla de espera de esa venta con su estado actual

#### Scenario: Otra venta con el cobro abierto
- **WHEN** hay una venta en espera y el empleado intenta cobrar otra con crédito
- **THEN** el mostrador indica que primero hay que terminar o cancelar el cobro en espera
