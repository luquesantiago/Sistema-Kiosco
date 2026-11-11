# Spec Delta

## ADDED Requirements

### Requirement: Aviso de factura con error
Cuando una factura pasa a `error`, el sistema MUST crear en la misma operación un aviso pendiente de tipo `factura` para el admin. El texto MUST incluir el número y la fecha de la venta, el importe de la factura, el motivo y que se revisa en Administración → Facturación. Cada paso a `error` MUST generar un solo aviso.

#### Scenario: Quinto rechazo de ARCA
- **WHEN** la factura de $3.300 de la venta #120 queda en `error` al quinto rechazo
- **THEN** queda un aviso `pendiente` de tipo `factura` que menciona la venta #120, $3.300, el motivo de ARCA y la pantalla de Facturación

#### Scenario: Factura en el tope
- **WHEN** se cobra en débito una venta de $10.000.000
- **THEN** queda un aviso de tipo `factura` que dice que la factura no se emitió porque alcanza el tope para no identificar al cliente

#### Scenario: Reintento que vuelve a fallar
- **WHEN** el admin reintenta una factura en `error` y vuelve a quedar en `error` después de 5 rechazos
- **THEN** se crea un aviso nuevo para ese segundo paso a `error`

### Requirement: Aviso de factura de una venta anulada
Cuando se autoriza la factura de una venta que ya estaba anulada, el sistema MUST crear un aviso pendiente de tipo `factura` para el admin, con el número de venta, el número y el importe de la factura y que la nota de crédito se hace por fuera.

#### Scenario: Factura autorizada después de anular
- **WHEN** se autoriza la factura `00005-00000042` de $3.300 de la venta #120, que se anuló mientras estaba en curso
- **THEN** queda un aviso que menciona la venta #120 anulada, la factura `00005-00000042`, $3.300 y la nota de crédito por fuera

## MODIFIED Requirements

### Requirement: Texto del aviso de anulación
El texto del aviso de anulación MUST incluir el número de venta, la fecha y hora en Argentina, el nombre de quien anuló, el motivo, cada ítem con cantidad y subtotal, y el total, en un formato legible por WhatsApp. Si la venta tenía facturas autorizadas, el texto MUST incluir además el número y el importe de cada una y que siguen vigentes, para hacer la nota de crédito por fuera.

#### Scenario: Texto de ejemplo
- **WHEN** Juan anula a las 15:42 la venta #120 de 2 alfajores ($1.800) y 1 gaseosa ($1.500) con motivo "cobré dos veces"
- **THEN** el texto del aviso menciona la venta #120, las 15:42, a Juan, el motivo, los dos ítems y el total $3.300

#### Scenario: Anulación de una venta facturada
- **WHEN** Juan anula la venta #120, que tiene la factura `00005-00000042` de $3.300 autorizada
- **THEN** el texto del aviso dice además que la Factura C `00005-00000042` por $3.300 sigue vigente y que hay que hacer la nota de crédito por fuera

#### Scenario: Anulación de una venta con dos facturas
- **WHEN** se anula una venta mixta con las facturas `00005-00000042` ($3.000) y `00005-00000043` ($2.000) autorizadas
- **THEN** el texto del aviso menciona las dos facturas con su importe y que las dos siguen vigentes

#### Scenario: Anulación con la factura pendiente
- **WHEN** se anula una venta cuya única factura estaba `pendiente`
- **THEN** el texto del aviso no menciona ninguna factura
