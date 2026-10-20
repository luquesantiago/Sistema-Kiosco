# notificaciones Specification

## Purpose

Guarda los avisos que el sistema tiene que mandarle al admin (por ejemplo, una venta anulada) hasta que se envíen, para que ningún aviso se pierda aunque el envío por WhatsApp falle o todavía no exista.

## Requirements

### Requirement: Avisos pendientes
El sistema SHALL guardar cada aviso con tipo, destinatario (`admin`), texto ya armado, estado (`pendiente`, `enviada` o `error`) y fecha de creación. Un aviso nuevo MUST quedar `pendiente`. Los avisos MUST NOT borrarse.

#### Scenario: Aviso creado
- **WHEN** el sistema genera un aviso de anulación
- **THEN** el aviso queda `pendiente` con su texto completo

### Requirement: Texto del aviso de anulación
El texto del aviso de anulación MUST incluir el número de venta, la fecha y hora en Argentina, el nombre de quien anuló, el motivo, cada ítem con cantidad y subtotal, y el total, en un formato legible por WhatsApp.

#### Scenario: Texto de ejemplo
- **WHEN** Juan anula a las 15:42 la venta #120 de 2 alfajores ($1.800) y 1 gaseosa ($1.500) con motivo "cobré dos veces"
- **THEN** el texto del aviso menciona la venta #120, las 15:42, a Juan, el motivo, los dos ítems y el total $3.300

### Requirement: Lista de avisos para el admin
El admin SHALL poder ver los avisos del más reciente al más antiguo, con su estado y texto. Un empleado MUST NOT poder verlos.

#### Scenario: El admin revisa los avisos
- **WHEN** el admin abre la lista de avisos
- **THEN** ve el aviso de cada anulación con su estado `pendiente`

#### Scenario: Empleado intenta ver los avisos
- **WHEN** un empleado pide la lista de avisos
- **THEN** el sistema responde `403`
