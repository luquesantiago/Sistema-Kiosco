# Spec Delta

## ADDED Requirements

### Requirement: Anulación de una venta con factura pendiente
Al anular una venta, cada factura suya `pendiente` o en `error` MUST cancelarse en la misma operación que la anulación, y MUST NOT emitirse. La anulación MUST hacerse igual que la de una venta sin factura.

#### Scenario: Anular antes de que se emita la factura
- **WHEN** se anula una venta en débito cuya factura sigue `pendiente` porque ARCA está caído
- **THEN** la venta queda `anulada` y su factura queda cancelada
- **AND** cuando ARCA vuelve, esa factura no se emite

#### Scenario: Anular una venta con factura en error
- **WHEN** se anula una venta cuya factura está en `error` por el tope
- **THEN** la venta queda `anulada` y su factura queda cancelada

### Requirement: Anulación de una venta con factura autorizada
El sistema MUST permitir anular una venta con facturas autorizadas, pero MUST NOT emitir notas de crédito. Antes de confirmar, la pantalla MUST avisar qué facturas siguen vigentes en ARCA y que la nota de crédito se hace por fuera. La respuesta de la anulación y el detalle de la venta MUST indicar el número de cada factura vigente.

#### Scenario: Anular una venta facturada
- **WHEN** el empleado va a anular la venta #120, que tiene la factura `00005-00000042` autorizada
- **THEN** antes de confirmar ve que la Factura C `00005-00000042` sigue vigente y que la nota de crédito se hace por fuera
- **AND** al confirmar, la venta queda `anulada` y la factura sigue `autorizada`

#### Scenario: Anular una venta con dos facturas autorizadas
- **WHEN** se va a anular una venta mixta con las facturas `00005-00000042` ($3.000) y `00005-00000043` ($2.000) autorizadas
- **THEN** antes de confirmar se ven las dos facturas vigentes con su importe
- **AND** al confirmar, las dos siguen `autorizada`

#### Scenario: Una factura autorizada y otra pendiente
- **WHEN** se anula una venta mixta con la factura automática autorizada y la del efectivo `pendiente`
- **THEN** la del efectivo queda cancelada y se avisa que la automática sigue vigente

### Requirement: Anulación con la factura en curso
Si al anular la venta alguna factura suya está `en_curso`, la anulación MUST hacerse igual. Si después ARCA confirma que esa factura quedó autorizada, MUST quedar `autorizada` y MUST avisarse al admin que es la factura de una venta anulada. Si ARCA no la registró, MUST cancelarse sin volver a enviarla.

#### Scenario: La factura se autorizó igual
- **WHEN** se anula una venta con la factura `en_curso` y la consulta siguiente a ARCA la encuentra autorizada
- **THEN** la factura queda `autorizada` y se crea un aviso al admin de que es la factura de la venta anulada

#### Scenario: ARCA no la había registrado
- **WHEN** se anula una venta con la factura `en_curso` y la consulta siguiente a ARCA no la encuentra
- **THEN** la factura queda cancelada y no se vuelve a mandar

### Requirement: Facturas en el detalle de la venta
El detalle de una venta MUST incluir sus facturas, cada una con estado, importe, punto de venta, número, fecha, CAE, vencimiento del CAE y la dirección del QR cuando está autorizada. Admin y empleado MUST verlas con los mismos permisos que la venta. El listado MUST indicar el importe facturado y autorizado de cada venta.

#### Scenario: Detalle de una venta facturada
- **WHEN** el empleado abre el detalle de una venta de hoy con factura autorizada
- **THEN** ve el número de factura, el importe, el CAE y su vencimiento

#### Scenario: Detalle de una venta mixta
- **WHEN** se abre el detalle de una venta de $5.000 con la factura de $3.000 autorizada y sin factura del efectivo
- **THEN** el detalle muestra la factura de $3.000 y que quedan $2.000 sin facturar

#### Scenario: Venta sin factura
- **WHEN** se abre el detalle de una venta en efectivo sin factura
- **THEN** el detalle indica que no tiene factura
