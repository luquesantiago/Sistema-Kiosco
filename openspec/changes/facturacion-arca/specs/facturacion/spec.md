# Spec Delta

## Purpose

Emite la Factura C electrónica del kiosco (monotributista) ante ARCA para las ventas que la necesitan, sin frenar nunca el mostrador: decide qué se factura, numera sin saltos ni duplicados, reintenta sola cuando ARCA falla y deja al admin ver y resolver lo que quedó trabado.

## ADDED Requirements

### Requirement: Facturación configurada por el entorno
La facturación SHALL activarse solo si están configurados juntos el CUIT, el punto de venta, el entorno (`homologacion` o `produccion`), el certificado, la clave y los datos del emisor (nombre de fantasía incluido). Si falta alguno y hay otro, el sistema MUST NOT arrancar y MUST nombrar lo que falta, sin mostrar valores. Sin ninguno, el sistema MUST funcionar como antes y MUST NOT crear facturas.

#### Scenario: Sin configuración de ARCA
- **WHEN** no hay ninguna variable de ARCA y se cobra una venta en débito
- **THEN** la venta se registra como siempre y no se crea ninguna factura

#### Scenario: Configuración incompleta
- **WHEN** están el CUIT y el punto de venta pero falta la ruta de la clave
- **THEN** el sistema no arranca y el error nombra la variable de la clave, sin mostrar el CUIT

#### Scenario: Certificado ilegible
- **WHEN** la configuración está completa pero el archivo del certificado no existe o no se puede leer
- **THEN** el sistema no arranca y el error nombra el certificado

### Requirement: Punto de venta de hasta 5 dígitos
El punto de venta configurado MUST ser un entero entre 1 y 99999 (normativo, verificar). Fuera de ese rango el sistema MUST NOT arrancar. En el comprobante impreso, el punto de venta MUST mostrarse con 5 dígitos y el número con 8, separados por un guion.

#### Scenario: Punto de venta en los bordes
- **WHEN** el punto de venta configurado es 0, 1, 99999 o 100000
- **THEN** con 0 y con 100000 el sistema no arranca, y con 1 y con 99999 arranca

#### Scenario: Formato del número impreso
- **WHEN** se imprime la factura número 42 del punto de venta 1, y la 99999999 del punto de venta 99999
- **THEN** se ven como `00001-00000042` y `99999-99999999`

### Requirement: Ventas que se facturan solas
Una venta que queda `pagada` con pagos en débito, crédito o Mercado Pago MUST facturarse sola por la suma de esos pagos (la parte electrónica). Lo cobrado en efectivo MUST NOT facturarse solo (normativo, confirmar con el contador que facturar solo una parte de la venta es válido). Una venta sin parte electrónica, o con parte electrónica de $0,00, MUST NOT facturarse sola.

#### Scenario: Venta 100% electrónica
- **WHEN** se cobra una venta de $3.300 en débito
- **THEN** queda una factura automática `pendiente` de $3.300 para esa venta

#### Scenario: Pago mixto con efectivo
- **WHEN** se cobra una venta de $5.000 con $2.000 en efectivo y $3.000 en débito
- **THEN** queda una factura automática `pendiente` por $3.000, solo la parte en débito
- **AND** los $2.000 en efectivo quedan sin factura

#### Scenario: Parte electrónica de un centavo
- **WHEN** se cobra una venta de $5.000 con $4.999,99 en efectivo y $0,01 con Mercado Pago
- **THEN** queda una factura automática `pendiente` por $0,01

#### Scenario: Efectivo de un centavo
- **WHEN** se cobra una venta de $5.000 con $0,01 en efectivo y $4.999,99 en crédito
- **THEN** queda una factura automática `pendiente` por $4.999,99

#### Scenario: Varios medios electrónicos
- **WHEN** se cobra una venta de $6.000 con $1.000 en efectivo, $2.000 en débito y $3.000 con Mercado Pago
- **THEN** queda una factura automática `pendiente` por $5.000

#### Scenario: Venta 100% efectivo
- **WHEN** se cobra una venta de $3.300 solo en efectivo
- **THEN** la venta no tiene factura

#### Scenario: Importe en el borde
- **WHEN** se cobra en débito una venta de $0,00 y otra de $0,01
- **THEN** la de $0,00 no tiene factura y la de $0,01 queda con una factura `pendiente` de $0,01

### Requirement: Encolado al quedar pagada
La factura automática MUST quedar encolada en la misma operación en que la venta pasa a `pagada`, de modo que o se guardan las dos o ninguna. Cada venta MUST tener como máximo una factura automática. La emisión ante ARCA MUST NOT ocurrir dentro de esa operación.

#### Scenario: Venta guardada con su factura pendiente
- **WHEN** se registra una venta con crédito y ARCA no responde
- **THEN** la venta se registra en el tiempo habitual y su factura queda `pendiente`

#### Scenario: Una sola factura automática por venta
- **WHEN** se intenta encolar dos veces la factura automática de la misma venta
- **THEN** la venta sigue con una sola factura automática

### Requirement: Facturas de una venta
Una venta MUST tener como máximo dos facturas: la automática, por la parte electrónica, y la pedida por el cliente, por la parte en efectivo. La suma de los importes de las facturas de una venta MUST NOT superar nunca el total de la venta.

#### Scenario: Venta mixta facturada completa
- **WHEN** una venta de $5.000 con $2.000 en efectivo y $3.000 en débito tiene la factura automática de $3.000 y el cliente pide factura
- **THEN** la venta queda con dos facturas, de $3.000 y de $2.000, que suman $5.000

#### Scenario: Nunca más que el total
- **WHEN** en esa venta se vuelve a pedir factura
- **THEN** la venta sigue con dos facturas que suman $5.000

### Requirement: Factura a pedido del cliente
Para una venta `pagada` con cobro en efectivo, el cliente SHALL poder pedir factura por lo cobrado en efectivo. Puede pedirla el empleado, si la venta es del día en Argentina, o el admin, dentro del plazo de días anteriores. Pedirla de nuevo MUST devolver la misma factura. En una venta sin efectivo, MUST devolver la automática sin crear otra. Una venta `anulada` MUST NOT facturarse.

#### Scenario: El cliente pide factura de una venta en efectivo
- **WHEN** el empleado pide la factura de la venta #120, cobrada hoy $3.300 en efectivo
- **THEN** queda una factura `pendiente` de $3.300 para la venta #120

#### Scenario: Factura del resto de una venta mixta
- **WHEN** el cliente pide factura de una venta de $5.000 con $2.000 en efectivo y $3.000 en débito, cuya factura automática de $3.000 ya está autorizada
- **THEN** queda una segunda factura `pendiente` de $2.000

#### Scenario: Efectivo de un centavo pedido
- **WHEN** el cliente pide factura de una venta de $5.000 con $0,01 en efectivo y $4.999,99 en crédito
- **THEN** queda una segunda factura `pendiente` de $0,01

#### Scenario: Venta 100% electrónica pedida
- **WHEN** el empleado pide la factura de una venta cobrada toda en débito
- **THEN** el sistema devuelve la factura automática y no crea otra

#### Scenario: Pedir dos veces
- **WHEN** el empleado pide dos veces la factura de una venta en efectivo
- **THEN** la segunda vez el sistema devuelve la misma factura y no crea otra

#### Scenario: Venta de las 23:59 pedida a las 00:01
- **WHEN** la venta es del 09/11 a las 23:59 de Argentina y el empleado pide la factura el 10/11 a las 00:01
- **THEN** el sistema responde `403` porque la venta es de un día anterior
- **AND** si la pide el admin a esa hora, la factura queda `pendiente`

#### Scenario: Venta anulada
- **WHEN** se pide la factura de una venta `anulada`
- **THEN** el sistema responde `409` y no crea factura

#### Scenario: Sin facturación configurada
- **WHEN** se pide una factura y la facturación no está configurada
- **THEN** el sistema responde `409` con el motivo y no crea factura

### Requirement: Plazo para facturar días anteriores
Una factura MUST emitirse solo si la fecha de la venta en Argentina es como máximo 5 días anterior a la fecha de emisión en Argentina (normativo, verificar). Si la venta es más vieja, el pedido del admin MUST rechazarse con `422`, y una factura de la cola MUST pasar a `error` sin consultar a ARCA, con el motivo y sin reintento automático.

#### Scenario: Cinco días atrás
- **WHEN** el 10/11 el admin pide la factura de una venta del 05/11
- **THEN** la factura queda `pendiente`

#### Scenario: Seis días atrás
- **WHEN** el 10/11 el admin pide la factura de una venta del 04/11
- **THEN** el sistema responde `422` y no crea factura

#### Scenario: Bordes de medianoche en el plazo
- **WHEN** el 10/11 a las 00:01 de Argentina el admin pide las facturas de una venta del 05/11 a las 00:00 y de otra del 04/11 a las 23:59
- **THEN** la del 05/11 queda `pendiente` y la del 04/11 se rechaza con `422`

#### Scenario: Factura de la cola fuera de plazo
- **WHEN** una factura de una venta del 04/11 sigue `pendiente` el 10/11 porque ARCA estuvo caído
- **THEN** pasa a `error` con el motivo de plazo vencido, sin intentar emitirla, y se avisa al admin

### Requirement: Consumidor final sin identificar
Toda factura MUST emitirse a consumidor final sin identificar: tipo de documento 99, número 0 y condición frente al IVA del receptor 5 (normativo, verificar). El sistema MUST NOT pedir ni guardar datos del cliente.

#### Scenario: Datos del receptor
- **WHEN** se emite cualquier factura
- **THEN** el pedido a ARCA lleva documento tipo 99, número 0 y condición frente al IVA 5

### Requirement: Tope para no identificar al cliente
El tope de consumidor final sin identificar ($10.000.000, RG 5700/2025, normativo, verificar) MUST evaluarse por factura, con su importe. Una factura de importe igual o mayor que el tope MUST NOT emitirse: MUST quedar en `error` con ese motivo, sin consultar a ARCA, sin reintento automático y con aviso al admin. El tope MUST poder cambiarse sin tocar la lógica.

#### Scenario: Justo debajo del tope
- **WHEN** se cobra en débito una venta de $9.999.999,99
- **THEN** la factura se emite normalmente

#### Scenario: Tope evaluado por factura
- **WHEN** una venta de $12.000.000 se cobra con $6.000.000 en débito y $6.000.000 en efectivo, y el cliente pide factura
- **THEN** las dos facturas, de $6.000.000 cada una, se emiten normalmente

#### Scenario: Parte electrónica en el tope
- **WHEN** una venta de $10.000.001 se cobra con $10.000.000 en crédito y $1 en efectivo
- **THEN** la factura automática de $10.000.000 queda en `error` con el motivo del tope

#### Scenario: En el tope
- **WHEN** se cobra en débito una venta de $10.000.000,00
- **THEN** la factura queda en `error` con el motivo del tope, no se consulta a ARCA y se avisa al admin

#### Scenario: Arriba del tope
- **WHEN** se cobra en crédito una venta de $10.000.000,01
- **THEN** la factura queda en `error` con el motivo del tope y no se emite

### Requirement: Datos de la Factura C
Cada factura MUST pedirse como Factura C (tipo 11), concepto productos (1), en pesos (`PES`) con cotización 1, sin IVA discriminado: importe neto igual al total, e IVA, tributos, no gravado y exento en 0. Todos los importes van con 2 decimales. El CAE y su vencimiento MUST guardarse tal como los devuelve ARCA.

#### Scenario: Pedido de una factura de $3.300,50
- **WHEN** se emite una factura de $3.300,50
- **THEN** el pedido lleva tipo 11, concepto 1, moneda `PES`, cotización 1, total 3300.50, neto 3300.50 e IVA 0

#### Scenario: Factura autorizada
- **WHEN** ARCA autoriza la factura con CAE 76451234567890 y vencimiento 20261120
- **THEN** la factura queda `autorizada` con ese CAE, vencimiento 20/11/2026 y la fecha de autorización

### Requirement: Fecha del comprobante
La fecha de la factura MUST ser la fecha de la venta en Argentina, salvo que sea anterior a la del último comprobante autorizado del punto de venta. En ese caso, MUST usarse la fecha de ese último comprobante (normativo, verificar). La fecha MUST NOT ser posterior a la de emisión.

#### Scenario: Venta de las 23:59 emitida a las 00:01
- **WHEN** una venta en débito del 09/11 a las 23:59 de Argentina se emite el 10/11 a las 00:01, y el último autorizado es del 09/11
- **THEN** la factura lleva fecha 09/11/2026

#### Scenario: Venta de las 00:00
- **WHEN** una venta en débito del 10/11 a las 00:00:00 de Argentina se emite a las 00:00:05
- **THEN** la factura lleva fecha 10/11/2026

#### Scenario: Ya hay un comprobante con fecha posterior
- **WHEN** queda pendiente la factura de una venta del 09/11 y el último autorizado del punto de venta es del 10/11
- **THEN** la factura lleva fecha 10/11/2026

### Requirement: Numeración correlativa
Cada factura MUST llevar el número siguiente al último autorizado por ARCA para el punto de venta y el tipo. Dos facturas MUST NOT compartir número en el mismo punto de venta y tipo. Si el número siguiente supera los 8 dígitos, la factura MUST quedar en `error` con aviso al admin.

#### Scenario: Último más uno
- **WHEN** el último autorizado del punto de venta es el 41
- **THEN** la próxima factura se pide con el número 42

#### Scenario: Primera factura del punto de venta
- **WHEN** ARCA informa que el último autorizado es 0
- **THEN** la factura se pide con el número 1

#### Scenario: Borde de 8 dígitos
- **WHEN** el último autorizado es 99999998, se emite una factura, y después queda otra pendiente
- **THEN** la primera se pide con el número 99999999
- **AND** la segunda queda en `error` porque se agotó la numeración, y se avisa al admin

### Requirement: Número reservado antes de enviar
Antes de mandar una factura a ARCA, el sistema MUST guardar su número y fecha y dejarla `en_curso`. Si no se sabe si ARCA la autorizó (corte, timeout o caída del proceso), antes de volver a mandarla MUST consultar ese número en ARCA. Si está autorizado con el mismo importe y fecha, MUST tomar ese CAE sin emitir otra.

#### Scenario: Corte después de que ARCA autorizó
- **WHEN** ARCA autorizó la factura 42 pero la respuesta no llegó por un timeout
- **THEN** en la pasada siguiente el sistema consulta el número 42, encuentra el CAE y deja la factura `autorizada` sin pedir otro número

#### Scenario: Corte antes de que ARCA la registre
- **WHEN** la factura quedó `en_curso` con el número 42, la consulta dice que el 42 no existe y el último autorizado es el 41
- **THEN** el sistema vuelve a pedir la autorización con el número 42

#### Scenario: Numeración que no coincide
- **WHEN** la factura quedó `en_curso` con el número 42 y ARCA tiene un 42 con otro importe
- **THEN** la factura pasa a `error` por numeración inconsistente, se frena la emisión de las demás y se avisa al admin

#### Scenario: Una por vez
- **WHEN** hay una factura `en_curso` sin resolver y otras `pendiente`
- **THEN** ninguna otra se manda a ARCA hasta resolver la que está `en_curso`

### Requirement: Emisión por detrás de la venta
Las facturas pendientes MUST emitirse solas, de a una, de la más vieja a la más nueva, fuera del pedido que registra la venta. Con ARCA funcionando, una factura nueva MUST quedar autorizada en menos de un minuto. Una falla de ARCA MUST NOT demorar ni rechazar ninguna venta.

#### Scenario: Factura autorizada al rato
- **WHEN** se cobra una venta en débito con ARCA funcionando
- **THEN** antes de un minuto su factura queda `autorizada` con su CAE

#### Scenario: Orden de emisión
- **WHEN** hay facturas pendientes de las ventas #120, #121 y #122
- **THEN** se emiten en ese orden con números correlativos

### Requirement: Reintentos de una factura rechazada
Si ARCA rechaza una factura, el sistema MUST sumar un intento, guardar el motivo y reintentarla con esperas de 30 s, 2 min, 10 min y 30 min. Al quinto intento rechazado MUST quedar en `error` con el motivo, MUST NOT reintentarse sola y MUST avisarse al admin. Una factura en espera MUST NOT frenar a las siguientes.

#### Scenario: Espera después del primer rechazo
- **WHEN** ARCA rechaza una factura por primera vez a las 10:00:00
- **THEN** queda `pendiente` con 1 intento, y una pasada a las 10:00:29 no la manda pero una a las 10:00:30 sí

#### Scenario: Cuarto rechazo
- **WHEN** una factura con 3 intentos es rechazada otra vez a las 10:00:00
- **THEN** queda `pendiente` con 4 intentos y no se reintenta antes de las 10:30:00

#### Scenario: Quinto rechazo
- **WHEN** una factura con 4 intentos es rechazada otra vez
- **THEN** queda en `error` con 5 intentos y el motivo de ARCA, no se reintenta sola y se avisa al admin

#### Scenario: Rechazo y después autorización
- **WHEN** el primer pedido de una factura es rechazado y el segundo autorizado
- **THEN** la factura queda `autorizada`

### Requirement: ARCA caído no gasta intentos
Si ARCA no responde, da timeout, contesta con error del servidor o informa sus servicios caídos, las facturas MUST quedar como estaban, sin sumar intentos, y MUST emitirse solas cuando ARCA vuelva. Si el corte ocurre después de haber mandado el pedido de CAE, no se sabe si ARCA la autorizó: esa factura MUST quedar `en_curso` con su número reservado, sin sumar intentos, y resolverse consultando ese número en ARCA (ver "Número reservado antes de enviar").

#### Scenario: Corte al pedir el CAE
- **WHEN** una factura `pendiente` con 4 intentos se manda a ARCA y ARCA no contesta al pedido de CAE
- **THEN** queda `en_curso` con su número reservado y 4 intentos
- **AND** no se manda ninguna otra hasta consultar ese número en ARCA

#### Scenario: ARCA caído toda la tarde
- **WHEN** ARCA no responde de 14:00 a 18:00 y se cobran 30 ventas con tarjeta
- **THEN** las 30 facturas siguen `pendiente` con 0 intentos
- **AND** cuando ARCA vuelve se emiten todas, en orden

#### Scenario: Caída con intentos previos
- **WHEN** una factura tiene 4 intentos y en el reintento siguiente ARCA no responde
- **THEN** sigue `pendiente` con 4 intentos

### Requirement: Autenticación con ARCA
El sistema MUST guardar en la base el ticket de acceso de ARCA y reutilizarlo mientras falten más de 60 s para su vencimiento. Recién después MUST pedir uno nuevo. Si ARCA no da un ticket nuevo porque hay uno vigente que se perdió, MUST tratarse como ARCA no disponible y el estado MUST indicarlo.

#### Scenario: Ticket vigente
- **WHEN** el ticket guardado vence a las 20:00:00 y se emite una factura a las 19:58:59
- **THEN** se usa el ticket guardado sin pedir otro

#### Scenario: Ticket a 60 s de vencer
- **WHEN** el ticket guardado vence a las 20:00:00 y se emite una factura a las 19:59:00
- **THEN** se pide un ticket nuevo, se guarda y se usa

#### Scenario: Ticket vencido por 1 s
- **WHEN** el ticket guardado vence a las 20:00:00 y se emite una factura a las 20:00:01
- **THEN** se pide un ticket nuevo antes de emitir

#### Scenario: Reinicio del sistema
- **WHEN** el sistema se reinicia con un ticket vigente guardado
- **THEN** emite con ese ticket sin pedir otro

#### Scenario: Ticket vigente perdido
- **WHEN** la base no tiene ticket y ARCA responde que ya hay uno vigente
- **THEN** las facturas siguen `pendiente` sin sumar intentos y el estado de la facturación avisa que la autenticación está bloqueada hasta que venza el ticket anterior

### Requirement: Código QR de la factura
Cada factura autorizada MUST tener el QR de ARCA (RG 4892/2020, normativo, verificar): la dirección de ARCA para QR seguida de `?p=` y el texto JSON en base64. El JSON lleva `ver` 1, `fecha`, `cuit`, `ptoVta`, `tipoCmp`, `nroCmp`, `importe`, `moneda`, `ctz`, `tipoDocRec`, `nroDocRec`, `tipoCodAut` "E" y `codAut` (el CAE).

#### Scenario: Contenido del QR
- **WHEN** se autoriza con CAE 76451234567890 la factura 42 del punto de venta 5, CUIT 20123456786, fecha 09/11/2026 y total $3.300,50
- **THEN** el JSON del QR es exactamente `{"ver":1,"fecha":"2026-11-09","cuit":20123456786,"ptoVta":5,"tipoCmp":11,"nroCmp":42,"importe":3300.5,"moneda":"PES","ctz":1,"tipoDocRec":99,"nroDocRec":0,"tipoCodAut":"E","codAut":76451234567890}`
- **AND** el QR codifica `https://www.afip.gob.ar/fe/qr/?p=` seguido de la base64 de ese texto

#### Scenario: Importes en el QR
- **WHEN** el total de la factura es $0,01, $1.000,00 o $9.999.999,99
- **THEN** el `importe` del QR es 0.01, 1000 y 9999999.99

#### Scenario: Factura sin autorizar
- **WHEN** la factura está `pendiente`, `en_curso` o en `error`
- **THEN** no tiene QR

### Requirement: Estado de la facturación para el admin
El admin SHALL ver el estado de la conexión con ARCA, el entorno, el punto de venta, el último número autorizado y las facturas `pendiente`, `en_curso` y `error` con su venta, importe, intentos y motivo. Si hay facturas en `error`, el panel del admin MUST mostrar un cartel con la cantidad. Un empleado MUST NOT ver esta información.

#### Scenario: Facturas trabadas
- **WHEN** hay 2 facturas pendientes y 1 en `error` por el tope
- **THEN** el admin ve las 3 con su venta, importe y estado, y el motivo de la que está en `error`
- **AND** el panel del admin muestra un cartel con 1 factura con error

#### Scenario: Sin facturación configurada
- **WHEN** el admin abre la pantalla sin facturación configurada
- **THEN** ve que la facturación no está configurada y el cartel no aparece

#### Scenario: Empleado intenta ver el estado
- **WHEN** un empleado pide el estado de la facturación
- **THEN** el sistema responde `403`

### Requirement: Reintento manual de una factura
El admin SHALL poder reintentar una factura en `error`: vuelve a `pendiente` con 0 intentos. Si el error fue por el tope o por el plazo vencido, o si la venta está anulada, el reintento MUST rechazarse con `409`. Un empleado MUST NOT poder reintentar.

#### Scenario: Admin reintenta una rechazada
- **WHEN** el admin reintenta una factura en `error` después de 5 rechazos
- **THEN** la factura vuelve a `pendiente` con 0 intentos y se emite en la próxima pasada

#### Scenario: Reintentar una factura del tope
- **WHEN** el admin reintenta una factura en `error` por el tope de $10.000.000
- **THEN** el sistema responde `409` y la factura no cambia

#### Scenario: Reintentar una autorizada
- **WHEN** el admin reintenta una factura `autorizada`
- **THEN** el sistema responde `409` y la factura no cambia

#### Scenario: Empleado intenta reintentar
- **WHEN** un empleado pide reintentar una factura
- **THEN** el sistema responde `403`
