# Spec Delta

## ADDED Requirements

### Requirement: Ticket de una venta facturada
Si la venta tiene al menos una factura autorizada, el ticket MUST llevar arriba el nombre de fantasía en grande y debajo la razón social con el CUIT. Después van los ítems, el total de la venta y los pagos, como siempre. Una sola vez, MUST llevar domicilio, ingresos brutos, inicio de actividades, "Responsable Monotributo" y "Consumidor final" (normativo, verificar).

#### Scenario: Encabezado del emisor
- **WHEN** se imprime una venta con factura autorizada
- **THEN** el ticket empieza con el nombre de fantasía en grande y debajo la razón social con el CUIT

### Requirement: Bloque fiscal por factura
El ticket MUST llevar un bloque fiscal por cada factura autorizada de la venta (normativo, verificar), con "FACTURA C", código 011, número con punto de venta, fecha, "Facturado: $X" por su importe, CAE, vencimiento del CAE y QR. Si queda parte de la venta sin facturar, MUST decir "Sin facturar: $Y – no válido como factura". Con todo facturado, MUST NOT llevar "No válido como factura".

#### Scenario: Ticket de una venta 100% electrónica
- **WHEN** se imprime la venta #120 de $3.300 en débito, con la factura 42 del punto de venta 5 por $3.300, CAE 76451234567890 y vencimiento 20/11/2026
- **THEN** el ticket muestra arriba el nombre de fantasía en grande y debajo la razón social con el CUIT
- **AND** dice "FACTURA C", "Cód. 011", `00005-00000042`, "Facturado: $3.300,00", el CAE, "Vto. CAE: 20/11/2026", "Consumidor final" y el QR por $3.300
- **AND** no dice "No válido como factura"

#### Scenario: Ticket de una venta mixta
- **WHEN** se imprime una venta de $5.000 con $2.000 en efectivo y $3.000 en débito, con la factura automática de $3.000 autorizada
- **THEN** el ticket muestra los ítems, el total $5.000, los dos pagos y un bloque fiscal con "Facturado: $3.000,00", su CAE y su QR por $3.000
- **AND** dice "Sin facturar: $2.000,00 – no válido como factura"

#### Scenario: Ticket de una venta mixta con las dos facturas
- **WHEN** se imprime esa misma venta con la factura de $3.000 y la de $2.000 autorizadas
- **THEN** el ticket muestra dos bloques fiscales, uno por cada factura con su número, importe, CAE y QR, y no dice "Sin facturar"

#### Scenario: Factura en error o cancelada
- **WHEN** se imprime una venta cuya única factura está en `error` o cancelada
- **THEN** el ticket es el de siempre, con la leyenda "No válido como factura"

#### Scenario: Factura de homologación
- **WHEN** se imprime una factura autorizada en el entorno de homologación
- **THEN** el ticket dice "HOMOLOGACIÓN – SIN VALIDEZ FISCAL"

### Requirement: Imprimir con la factura en trámite
Al imprimir una venta con alguna factura en trámite, la pantalla MUST esperar como máximo 5 s a que se autorice. Lo que esté autorizado en ese momento MUST imprimirse como bloque fiscal. Por cada factura que siga en trámite, MUST imprimirse "Factura en trámite: $X – pedila de nuevo desde Ventas".

#### Scenario: Factura autorizada a los 3 s
- **WHEN** el empleado presiona F9 apenas cobra en débito y la factura se autoriza 3 s después
- **THEN** se imprime el ticket con el bloque fiscal de esa factura

#### Scenario: Factura todavía en trámite a los 5 s
- **WHEN** el empleado presiona F9 apenas cobra $3.300 en débito y a los 5 s la factura sigue sin autorizar
- **THEN** se imprime el ticket con "Factura en trámite: $3.300,00 – pedila de nuevo desde Ventas"

### Requirement: Pedir factura desde el mostrador
Después de cobrar una venta con efectivo sin facturar, la pantalla de venta SHALL ofrecer pedir factura con un botón y con el atajo F10, sin diálogos ni datos del cliente. Al pedirla, MUST mostrar que la factura está en trámite y dejar el campo de escaneo listo. La referencia de atajos MUST incluir el de la factura.

#### Scenario: El cliente pide factura después de pagar en efectivo
- **WHEN** después de cobrar en efectivo la venta #120 el empleado presiona F10
- **THEN** la venta #120 queda con su factura en trámite y el campo de escaneo sigue enfocado

#### Scenario: Venta mixta
- **WHEN** la última venta se cobró con $2.000 en efectivo y $3.000 en débito
- **THEN** la pantalla muestra la factura automática de $3.000 y ofrece F10 para facturar los $2.000 en efectivo

#### Scenario: Venta 100% electrónica
- **WHEN** la última venta se cobró toda en débito
- **THEN** la pantalla muestra que la factura está en trámite o autorizada y no ofrece F10

#### Scenario: Sin facturación configurada
- **WHEN** la facturación no está configurada
- **THEN** la pantalla no ofrece pedir factura

#### Scenario: F10 no abre el menú del navegador
- **WHEN** el empleado presiona F10 en la pantalla de venta
- **THEN** se pide la factura y el navegador no abre su barra de menú

### Requirement: Factura desde el listado de ventas
El detalle de una venta del listado SHALL mostrar cada factura de la venta con su importe y estado. Si la venta tiene efectivo sin facturar, SHALL ofrecer pedir factura según los permisos de la facturación. Si alguna factura está autorizada, MUST ofrecer reimprimir el ticket con sus bloques fiscales.

#### Scenario: Reimprimir una factura
- **WHEN** el empleado abre el detalle de una venta de hoy con factura autorizada y pide imprimir
- **THEN** se imprime el ticket con el bloque fiscal de esa factura

#### Scenario: Pedir factura desde el listado
- **WHEN** el empleado abre el detalle de una venta de hoy cobrada en efectivo y sin factura
- **THEN** puede pedir la factura desde ahí

## MODIFIED Requirements

### Requirement: Ticket a pedido
El ticket MUST imprimirse solo cuando el empleado lo pide, con un botón o un atajo después de cobrar o desde el detalle de una venta del listado. El ticket MUST incluir el nombre del kiosco, número y fecha de la venta, ítems con cantidad y subtotal, total, pagos y vuelto si lo hubo, con un formato para papel de 58 u 80 mm. Si la venta no tiene ninguna factura autorizada, MUST llevar además la leyenda "No válido como factura" (ver "Ticket de una venta facturada").

#### Scenario: El cliente pide el ticket
- **WHEN** después de cobrar el empleado presiona el atajo de imprimir
- **THEN** se abre la impresión del ticket de esa venta

#### Scenario: Nadie pide ticket
- **WHEN** el empleado sigue con la próxima venta sin pedir el ticket
- **THEN** no se imprime nada

#### Scenario: Venta sin factura
- **WHEN** se imprime una venta en efectivo sin factura
- **THEN** el ticket es el de siempre, con la leyenda "No válido como factura"
