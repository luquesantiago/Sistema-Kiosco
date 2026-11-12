# Design

## Context

- **Ya existe:**
  - `Venta` con `estado` (`pagada`, `anulada`), `total`, `creadaEn` y `pagos` (`PagoVenta`: `medio`, `monto`). Hoy toda venta nace `pagada` dentro de la transacción de `registrarVenta` (`modules/ventas/servicio.ts`).
  - `anularVenta` hace un `updateMany ... WHERE estado = 'pagada'` y crea el aviso de anulación en la misma transacción.
  - La cola de avisos: `Notificacion` con `intentos` y `proximoIntentoEn`, procesada por `modules/whatsapp/envio.ts`:
    - Hace una pasada con reloj inyectable y separa dos tipos de error: `WhatsappNoDisponible` no gasta intento y `WhatsappRechazo` sí.
    - `MAX_INTENTOS = 5` y `ESPERAS_MS = [30 s, 2 min, 10 min, 30 min]`.
  - El patrón de cliente inyectable: `ClienteWhatsapp` en `modules/whatsapp/cliente.ts`, con `clienteWaha` usando `fetch` y timeout, y `test/whatsapp-falso.ts`. `crearApp` recibe `whatsapp?`.
  - `config.ts` valida con Zod y la regla "todas juntas o ninguna" (WAHA). Los errores nombran la variable, nunca el valor.
  - `lib/fechas.ts`: `fechaEnArgentina` y `rangoDelDiaEnArgentina`, con UTC−3 fijo.
  - Sobre `Ticket.tsx`:
    - Imprime con `flushSync` + `window.print()` y lleva la leyenda fija "No válido como factura".
    - `Venta.tsx` guarda `ultimaVenta` y la imprime con F9.
    - `ventas/Ventas.tsx` reimprime desde el detalle.
- **Cambios en curso que este diseño reutiliza o con los que convive:**
  - `aviso-reposicion-diario` crea `apps/api/src/jobs/ciclo.ts` (`iniciarCiclo({ nombre, pasada, intervaloMs, log })` → `{ detener() }`, con `setTimeout` encadenado y primera pasada al arrancar) y la tabla `ejecuciones_tarea`. Este cambio usa `iniciarCiclo` para la emisión.
  - `cobro-mercado-pago` va a hacer que las ventas con MP nazcan `pendiente` y pasen a `pagada` al aprobarse.
  - `saldo-mercado-pago` suma variables y una tarea de MP.
- **ARCA (normativo, verificar todo contra el manual del desarrollador de WSFEv1 vigente):**
  - **WSAA** (`LoginCms`): recibe un TRA (XML con `uniqueId`, `generationTime`, `expirationTime` y `service = wsfe`) firmado en CMS/PKCS#7 con el certificado y la clave, en base64. Devuelve `token`, `sign` y `expirationTime`, unas 12 h. Mientras hay un ticket vigente para ese certificado y servicio, no da otro: responde `coe.alreadyAuthenticated`.
  - **WSFEv1:**
    - `FEDummy` informa el estado de los servidores y no necesita autenticación.
    - `FECompUltimoAutorizado(PtoVta, CbteTipo)`.
    - `FECompConsultar(CbteTipo, CbteNro, PtoVta)`.
    - `FECAESolicitar`, con cabecera (`CantReg`, `PtoVta`, `CbteTipo`) y detalle. El detalle lleva `Concepto`, `DocTipo`, `DocNro`, `CbteDesde`, `CbteHasta`, `CbteFch` `yyyymmdd`, `ImpTotal`, `ImpTotConc`, `ImpNeto`, `ImpOpEx`, `ImpIVA`, `ImpTrib`, `MonId`, `MonCotiz` y `CondicionIVAReceptorId`. La respuesta trae `Resultado` `A`/`R`, `CAE`, `CAEFchVto`, `Observaciones` y `Errors`.
  - **Direcciones** (constantes en un solo archivo; verificar si ARCA las migró a `arca.gob.ar`):
    - WSAA en homologación: `https://wsaahomo.afip.gov.ar/ws/services/LoginCms`.
    - WSAA en producción: `https://wsaa.afip.gov.ar/ws/services/LoginCms`.
    - WSFEv1 en homologación: `https://wswhomo.afip.gov.ar/wsfev1/service.asmx`.
    - WSFEv1 en producción: `https://servicios1.afip.gov.ar/wsfev1/service.asmx`.
- Requisitos en `specs/facturacion`, `specs/punto-de-venta`, `specs/ventas` y `specs/notificaciones` de este cambio.

## Goals / Non-Goals

**Goals:**
- **El mostrador nunca espera a ARCA.** La transacción de la venta solo inserta una fila; todo lo que habla con ARCA corre en la tarea periódica.
- **Ningún número salteado ni repetido, ninguna parte de una venta facturada dos veces**, aunque el proceso se corte en el peor momento. La base y ARCA son la fuente de verdad, no la memoria.
- Todo testeable sin certificado: cliente de ARCA falso inyectado, reloj inyectable y una función de una pasada.
- Dejar armado el enganche `encolarFacturaSiCorresponde` para `cobro-mercado-pago`.

**Non-Goals:**
- Notas de crédito, Facturas A o B, CAEA, receptor identificado y envío de la factura al cliente.
- Emitir varias facturas en un solo pedido (`CantReg > 1`). Con el volumen de un kiosco, de a una alcanza y simplifica la recuperación.
- Monitorear el vencimiento del certificado. Va como riesgo y en el runbook; si molesta, se suma después.

## Decisions

### Integración `src/integrations/arca`: cliente detrás de una interfaz
- Carpeta nueva `apps/api/src/integrations/` para clientes de servicios externos sin rutas propias. ARCA es el primero; MP puede sumarse ahí. `modules/whatsapp/cliente.ts` no se mueve.
- **Archivos:**
  - `cliente.ts`: la interfaz `ClienteArca`, los errores y la fábrica `clienteArca(opciones)`.
  - `wsaa.ts`: arma y firma el TRA, llama a `LoginCms` y lee el ticket.
  - `wsfe.ts`: los sobres SOAP y la lectura de las respuestas.
  - `direcciones.ts`: las direcciones por entorno.
  - `tickets.ts`: guarda y lee el ticket de acceso en la base.
- **Interfaz** (todo lo que la emisión necesita, sin detalles de SOAP):
  ```
  ClienteArca {
    estadoServidores(): Promise<'ok' | 'caido'>                       // FEDummy
    ultimoAutorizado(ptoVta, tipo): Promise<{ numero, fecha: "AAAA-MM-DD" | null }>
    consultar(ptoVta, tipo, numero): Promise<ComprobanteArca | null>   // null = no existe
    solicitarCae(pedido: PedidoCae): Promise<{ cae, vencimiento: "AAAA-MM-DD" }>
  }
  ```
  - `ultimoAutorizado` devuelve también la fecha del último: con `FECompUltimoAutorizado` + `FECompConsultar` de ese número, porque la regla de fecha la necesita.
  - La autenticación queda adentro del cliente: cada llamada que la necesita pide el ticket a `tickets.ts`, que reutiliza o renueva.
- **Errores, como en WhatsApp:**
  - `ArcaNoDisponible`: red, timeout de 15 s, HTTP 5xx, SOAP Fault del servidor, `FEDummy` con algún servidor no `OK` y `coe.alreadyAuthenticated`. Lleva un `motivo` (`caido` o `autenticacion_bloqueada`) para la pantalla de estado. **No gasta intento.**
  - `ArcaRechazo`: `Resultado = R` o `Errors` en la respuesta con el servicio funcionando. Lleva el código y el mensaje de ARCA, recortado, sin el token. **Gasta intento.**
- **`test/arca-falso.ts`:** cliente en memoria con numeración propia por punto de venta, fallas programables en cola (`'rechazo' | 'no_disponible' | 'timeout_autorizado' | null`) y registro de pedidos. `timeout_autorizado` autoriza y después tira `ArcaNoDisponible`: simula el corte después de que ARCA autorizó. Los tests de `wsaa.ts` y `wsfe.ts` corren contra un servidor HTTP local que devuelve XML grabado de homologación, como `whatsapp-cliente.test.ts`.

### Librerías
- **`node-forge`** para firmar el TRA (PKCS#7 `SignedData` con el contenido adjunto, SHA-256). Es JavaScript puro, no necesita `openssl` en la imagen y se testea con un certificado autofirmado generado en el test.
  - Descartado: `openssl smime` con `child_process`. Depende del binario de la imagen y escribir archivos temporales con la clave.
  - Descartado: `node:crypto`, que no arma CMS.
- **`fast-xml-parser`** para leer las respuestas. Los sobres de pedido se arman con plantillas de texto, escapando los valores: son pocos y fijos.
  - Descartado: el paquete `soap`. Baja el WSDL en tiempo de ejecución, es pesado y oculta los errores de red que necesitamos clasificar.
- **`fetch` nativo** con `AbortSignal.timeout(15_000)`, como `clienteWaha`.
- **`qrcode`** en la web. Su `QRCode.create(texto)` es sincrónico: el SVG se dibuja dentro del render del ticket, compatible con `flushSync` + `print()`.
  - Descartado: generar la imagen en la API. Agranda cada detalle de venta y no evita la librería.
- **Descartados también:**
  - SDKs de terceros como `@afipsdk/afip.js`: las versiones actuales pasan por un servicio en la nube del proveedor, así que el certificado o los datos saldrían a un tercero.
  - `pyafipws`: es de otro lenguaje.

### Configuración (`config.ts`)
- **Variables nuevas, todas opcionales pero todas juntas o ninguna** (regla generalizada del `superRefine` de WAHA a un grupo):
  - `ARCA_CUIT`: 11 dígitos con dígito verificador válido.
  - `ARCA_PUNTO_VENTA`: entero de 1 a 99999.
  - `ARCA_ENTORNO`: `homologacion` o `produccion`.
  - `ARCA_CERT_PATH` y `ARCA_KEY_PATH`.
  - Datos del emisor: `ARCA_NOMBRE_FANTASIA` (va en grande arriba del ticket con factura), `ARCA_RAZON_SOCIAL`, `ARCA_DOMICILIO`, `ARCA_INICIO_ACTIVIDADES` (`AAAA-MM-DD`) e `ARCA_IIBB`.
  - `ARCA_NOMBRE_FANTASIA` no reemplaza a `VITE_NOMBRE_KIOSCO`, que sigue encabezando el ticket sin factura. Los dos suelen ser iguales; unificarlos queda para después, porque `VITE_` se fija en el build y este viene de la API.
- **`server.ts`** lee el certificado y la clave al arrancar. Si no puede, sale con un error que nombra el archivo, nunca el contenido. La clave queda solo en memoria y nunca va a la base ni a los logs.
- **Montaje en producción:** los archivos se montan de solo lectura en `infra/docker-compose.prod.yml` (`./arca:/run/secrets/arca:ro`). `infra/arca/` va al `.gitignore`.
- **Las constantes que dependen de la norma** van en `modules/facturacion/reglas.ts`, con el número de RG en un comentario:
  - `TOPE_CONSUMIDOR_FINAL = "10000000.00"`.
  - `DIAS_ATRAS_MAXIMO = 5`.
  - `TIPO_FACTURA_C = 11`, `CONCEPTO_PRODUCTOS = 1`.
  - `DOC_TIPO_SIN_IDENTIFICAR = 99`, `CONDICION_IVA_CONSUMIDOR_FINAL = 5`.
  - `URL_QR = "https://www.afip.gob.ar/fe/qr/"`.

  El tope no se pone en el entorno: cambia por resolución, no por instalación, y así queda testeado.

### Modelo de datos
```
enum EstadoFactura { pendiente  en_curso  autorizada  error  cancelada }
enum ParteFactura  { electronica  efectivo }    // electronica = automática; efectivo = pedida por el cliente

Factura (facturas)
  id                uuid
  ventaId           uuid
  parte             ParteFactura
  pedidaPorId       uuid?                    -- quien la pidió (parte efectivo)
  estado            EstadoFactura @default(pendiente)
  puntoVenta        Int                      -- del config al encolar
  tipoComprobante   Int                      -- 11
  importe           Decimal(12,2)            -- suma de los pagos de esa parte
  numero            Int?                     -- se fija al pasar a en_curso
  fechaComprobante  Date?                    -- idem
  cae               String?
  caeVencimiento    Date?                    -- tal como lo devuelve ARCA
  autorizadaEn      Timestamptz?
  intentos          Int @default(0)
  proximoIntentoEn  Timestamptz?
  codigoError       String?                  -- tope | fuera_de_plazo | rechazo_arca | numeracion_agotada | numeracion_inconsistente
  error             String?                  -- motivo legible
  creadaEn          Timestamptz
  @@unique([ventaId, parte])                         -- hasta dos por venta
  @@unique([puntoVenta, tipoComprobante, numero])   -- NULLs distintos en Postgres
  @@index([estado, creadaEn])

TicketAccesoArca (tickets_acceso_arca)
  servicio  String   -- "wsfe"
  entorno   String   -- homologacion | produccion
  token     String
  sign      String
  generadoEn  Timestamptz
  expiraEn    Timestamptz
  @@id([servicio, entorno])
```
- **Una factura por parte de la venta** (decisión del dueño: se factura solo lo electrónico).
  - La parte `electronica` vale la suma de los pagos en débito, crédito y MP, y la parte `efectivo`, el pago en efectivo. Como `PagoVenta` tiene un pago como máximo por medio y los pagos suman el total, **las dos partes suman siempre el total de la venta**. El invariante "nunca más que el total" sale de la estructura, sin cuentas acumuladas.
  - El único `(ventaId, parte)` hace idempotente pedir factura dos veces.
  - Una factura cancelada no libera su parte para otra: la cancelación solo pasa al anular la venta, y una venta anulada no se factura.
  - Alternativa descartada: una sola factura por venta y, si el cliente pide factura con la automática todavía pendiente, subirle el importe al total. Es más simple solo en ese caso. Con la automática ya autorizada igual hace falta una segunda factura, así que habría dos caminos en lugar de uno.
  - Alternativa descartada: una tercera factura "por el total" que reemplace a las otras. Exigiría una nota de crédito, que está fuera de alcance.
- **`numero` y `fecha` son nullables** porque se fijan recién al reservar. El único `(puntoVenta, tipoComprobante, numero)` hace que dos procesos que lean el mismo "último" no puedan reservar el mismo número: el segundo falla con `P2002` y abandona la pasada.
- **Un rechazo libera el número** (`numero = null`): ARCA no lo consumió.
- `codigoError` decide si la factura se puede reintentar: `tope` y `fuera_de_plazo` no.
- **El token y el sign se guardan en texto plano.** Valen 12 h para un solo servicio, la base no está expuesta y los backups ya son sensibles. Cifrarlos agregaría una clave más que custodiar.
- Alternativa descartada: guardar la factura como columnas de `Venta`. Mezcla la cola y su historial con la venta, y no deja el único de numeración limpio.

### Encolado: `modules/facturacion/encolado.ts`
- **`importePorParte(pagos)`** es una función pura que devuelve `{ electronica, efectivo }` (strings con 2 decimales). La usan el encolado, el pedido y el detalle de la venta.
- **`encolarFacturaSiCorresponde(tx, venta, { facturacion, ahora })`**, donde `venta` trae `id`, `estado`, `total` y `pagos`:
  1. Sin facturación configurada o si la venta no está `pagada`, no hace nada.
  2. Si `electronica <= 0`, no hace nada.
  3. Crea la `Factura` con `parte = electronica` e `importe = electronica`, y la crea igual si ese importe alcanza el tope (ver abajo).
  - Es idempotente: con `createMany({ skipDuplicates: true })` sobre el único `(ventaId, parte)`, llamarla dos veces deja una sola factura.
  - `registrarVenta` la llama al final de su transacción. `cobro-mercado-pago` la va a llamar en la transacción que pasa la venta a `pagada`.
- **`pedirFactura(prisma, ventaId, usuario, ahora)`**, para `POST /api/ventas/:id/factura`:
  - Sin configuración: `409 FACTURACION_NO_CONFIGURADA`.
  - Venta anulada: `409 VENTA_YA_ANULADA` (código existente).
  - El empleado, con una venta que no es del día en Argentina: `403 FUERA_DE_PLAZO`, el código existente, con el mismo criterio que `esDeHoy`.
  - Fuera de los 5 días: `422 FACTURA_FUERA_DE_PLAZO`.
  - Si las dos partes son 0 (venta de total $0): `422`.
  - Si `efectivo <= 0` (venta 100% electrónica), devuelve la factura `electronica` con `200` y no crea nada.
  - Si ya existe la de `efectivo`, la devuelve con `200`. Si no, la crea con `parte = efectivo`, `importe = efectivo` y `pedidaPorId`, y responde `201`.
  - En una venta solo en efectivo, la parte `efectivo` es el total: es la factura "de la venta" de siempre.
- **El tope se resuelve al encolar, por factura**, comparando el importe de cada una: la factura nace en `error` con `codigoError = tope`, sin pasar por ARCA, y en la misma transacción se crea el aviso `factura`. Así el admin se entera al instante y la cola nunca la ve.
- Después del commit de la venta (o del pedido), la ruta llama a `facturacion.despertar()` para que la emisión no espere al próximo intervalo.

### Emisión: `modules/facturacion/emision.ts` + `jobs/emision-facturas.ts`
- **`procesarFacturas({ prisma, arca, config, ahora })`** hace una pasada:
  1. **Servidores:** si `arca.estadoServidores()` no es `ok`, termina sin tocar nada.
  2. **Bloqueo por inconsistencia:** si hay una factura en `error` con `numeracion_inconsistente`, termina. Se destraba cuando el admin la reintenta.
  3. **Resolver la `en_curso`** (como máximo hay una; ver "Una por vez") con `arca.consultar(pv, 11, numero)`:
     - Si existe con el mismo importe y fecha, queda `autorizada` con el CAE de la consulta. Si la venta está anulada, además se crea el aviso de factura de venta anulada.
     - Si existe con otros datos, queda en `error` con `numeracion_inconsistente`, se crea el aviso y la pasada termina.
     - Si no existe y la venta está anulada, queda `cancelada`.
     - Si no existe y la venta sigue pagada, se reenvía el mismo número (paso 4.f) si `ultimoAutorizado = numero − 1`. Si no, se libera el número y vuelve a `pendiente` sin gastar intento.
  4. **Pendientes:** las vencidas, por `creadaEn` y `id`, hasta 20 por pasada. Para cada una:
     1. Si la venta está anulada, se cancela. Es defensa: la anulación ya lo hace.
     2. Si `fechaVenta < hoy − 5`, queda en `error` con `fuera_de_plazo` y su aviso.
     3. Se pide `arca.ultimoAutorizado` y se calcula `numero = último + 1`. Si pasa de 99999999, queda en `error` con `numeracion_agotada` y su aviso.
     4. Se calcula `fecha = max(fechaVenta, fechaUltimo)`.
     5. **Reserva:** `updateMany WHERE id AND estado = 'pendiente'` → `en_curso`, con `numero` y `fecha`. Si `count = 0` (la anularon en el medio), se sigue con la siguiente. Si hay `P2002`, termina la pasada.
     6. `arca.solicitarCae(...)`:
        - Si autoriza: `autorizada`, con CAE, vencimiento y `autorizadaEn`.
        - Si hay `ArcaRechazo`: se libera el número, vuelve a `pendiente`, suma 1 a `intentos` y guarda el motivo. Al quinto intento queda en `error` con `rechazo_arca` y su aviso; si no, `proximoIntentoEn` toma la espera que corresponde.
        - Si hay `ArcaNoDisponible`: **queda `en_curso`** y la pasada termina. La siguiente pasada la resuelve en el paso 3.
- **Una por vez:** dentro de la pasada, el paso 4 es secuencial y no avanza mientras haya una `en_curso`. Entre procesos, el único de numeración lo garantiza (ver Riesgos).
- **Reglas comunes con WhatsApp:** `MAX_INTENTOS` y `ESPERAS_MS` se importan de `modules/whatsapp/envio.ts` en lugar de duplicarlos. Si después se quiere mover a `lib/reintentos.ts`, es un cambio chico.
- **Por qué el tope y el plazo no gastan intentos:** no son fallas de ARCA. Reintentarlos daría el mismo resultado.
- **`jobs/emision-facturas.ts`:** `iniciarEmisionFacturas(...)` usa `iniciarCiclo` cada 10 s y expone `despertar()`. Para eso, a `iniciarCiclo` se le suma `despertar()`: cancela la espera y corre la pasada ya, y si hay una en curso, marca otra para el final. Es un agregado compatible con lo que define `aviso-reposicion-diario`.
- **`server.ts`** la arranca solo si hay configuración de ARCA, y la detiene en `onClose`.
- **Los pasos se loguean** con `ventaId`, número y resultado, nunca el token, el sign ni el XML completo.

### Autenticación: `integrations/arca/tickets.ts`
- **`obtenerTicket(prisma, entorno, ahora)`:**
  - Si hay una fila con `expiraEn − ahora > 60 s`, la usa.
  - Si no, pide uno a `LoginCms` (TRA con `uniqueId` = segundos de `ahora`, `generationTime = ahora − 10 min`, `expirationTime = ahora + 10 min`) y hace `upsert` con lo que devolvió ARCA.
- **El margen de 60 s** evita mandar un ticket que vence durante el pedido.
- **`coe.alreadyAuthenticated`** se traduce a `ArcaNoDisponible('autenticacion_bloqueada')`: se resuelve solo cuando vence el ticket perdido. Pasa, por ejemplo, si se restauró un backup viejo o se cambió de base.
- **Solo la tarea de emisión autentica.** Las rutas no hablan con el WSFE salvo `FEDummy`, que no necesita ticket. Así nunca hay dos pedidos de ticket en carrera.

### Fecha del comprobante y plazo
- `fechaVenta = fechaEnArgentina(venta.creadaEn)` y `hoy = fechaEnArgentina(ahora)`. `hoy − 5` se calcula sumando días a la fecha "AAAA-MM-DD" en UTC, sin horas, con una función nueva `sumarDias(fecha, n)` en `lib/fechas.ts`.
- La fecha nunca es posterior a hoy: `fechaVenta ≤ hoy` siempre, y `fechaUltimo ≤ hoy` según ARCA.
- `CbteFch` es la fecha sin guiones.

### QR y número: `packages/shared/src/facturacion.ts`
- **`urlQrFactura({ fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, cae })`** arma el JSON:
  - Las claves van en el orden del spec.
  - `importe` es `Number(importe)`, que con 2 decimales da `3300.5` y `1000`.
  - `ctz` es 1, `tipoDocRec` es 99, `nroDocRec` es 0 y `tipoCodAut` es `"E"`.
  - `codAut` es `Number(cae)`: 14 dígitos entran en un `number`.
  - Devuelve `URL_QR + "?p=" + base64` estándar, con `+`, `/` y `=`, sin pasar a url-safe (normativo, verificar).
  - Va en shared para que la API la incluya en el detalle de la venta y la web la pueda testear.
- **`formatearNumeroComprobante(pv, numero)`** devuelve `"00005-00000042"`.

### API
- **`POST /api/ventas/:id/factura`** (admin y empleado): `pedirFactura`, que devuelve la factura.
- **`GET /api/facturacion`** (admin): devuelve
  ```
  { estado: 'no_configurado' | 'disponible' | 'no_disponible' | 'autenticacion_bloqueada',
    entorno, puntoVenta, ultimoNumero,
    pendientes: n, enError: n, facturas: FacturaListado[] }
  ```
  - `estado` sale de la última pasada de la emisión, guardada en memoria: no llama a ARCA en cada pedido.
  - `ultimoNumero` es el máximo autorizado local.
  - `facturas` son las `pendiente`, `en_curso` y `error`, con número de venta, parte e importe.
- **`POST /api/facturas/:id/reintentar`** (admin): `updateMany WHERE id AND estado = 'error' AND codigoError NOT IN ('tope', 'fuera_de_plazo')` y venta `pagada` → `pendiente`, con `intentos = 0`, `proximoIntentoEn = null` y `numero = null`. Si no actualiza nada, responde `409 FACTURA_NO_REINTENTABLE`, o `404`.
- **`VentaDetalle`** suma:
  - `facturas: FacturaVenta[]` (0 a 2, `electronica` primero), cada una con parte, estado, número formateado, fecha, importe, CAE, vencimiento y `qrUrl`.
  - `sinFacturar`: el total menos lo autorizado.
  - `puedePedirFactura`: hay efectivo sin factura de parte `efectivo`.
  - `emisor`: nombre de fantasía, razón social, CUIT, domicilio, IIBB, inicio de actividades y entorno. Sale de la configuración, así la web no necesita variables `VITE_` nuevas.

  `VentaResumen` suma `importeFacturado` (lo autorizado).
- **`anularVenta`**, en la misma transacción:
  - `updateMany` de las facturas de la venta `WHERE estado IN ('pendiente', 'error')` → `cancelada`.
  - Por cada autorizada, el texto del aviso de anulación suma una línea con número e importe.
  - La respuesta ya trae `facturas` en el detalle, y la web arma el aviso con eso.
- Todas las rutas nuevas van al test de rutas protegidas.
- `crearApp` recibe `facturacion?: { config, arca, despertar, estado() }`.

### Web
- **`Ticket.tsx`, con al menos una factura autorizada:**
  - **Encabezado:** `emisor.nombreFantasia` en grande y debajo "razón social – CUIT xx-xxxxxxxx-x".
  - **Cuerpo:** ítems, total de la venta y pagos, sin cambios.
  - **`PieFiscal`:**
    - Una vez: domicilio, IIBB, inicio de actividades, "Responsable Monotributo" y "Consumidor final".
    - Un `BloqueFactura` por cada autorizada: "FACTURA C – Cód. 011", número, fecha, "Facturado: $X", CAE, "Vto. CAE" y el QR (SVG con `qrcode`) por ese importe.
    - Por cada factura en trámite, "Factura en trámite: $X – pedila de nuevo desde Ventas".
    - Si `sinFacturar > 0` y no hay nada en trámite que lo cubra, "Sin facturar: $Y – no válido como factura".
    - En homologación, "HOMOLOGACIÓN – SIN VALIDEZ FISCAL" en cada bloque.
- **`Ticket.tsx`, sin factura autorizada:** queda como hoy, salvo la línea de trámite si corresponde.
- **Por qué no se reparten los ítems entre las facturas:** el WSFE con concepto productos no exige ítems. Un reparto de ítems por medio de pago sería arbitrario y además no cerraría en centavos. El ticket muestra la venta completa y el importe que ampara cada factura (normativo, confirmar con el contador).
- **`useImpresionTicket`** suma `imprimirConFactura(venta)`: si alguna factura está en trámite, consulta `GET /ventas/:id` cada 1 s hasta 5 s y después imprime lo que haya.
- **`Venta.tsx`:**
  - F10 y el botón **Pedir factura** en la franja de "Última venta", si `puedePedirFactura` y la facturación está configurada (el estado de la caja suma `facturacionHabilitada`). En una venta mixta, el botón dice **Facturar efectivo ($2.000)**.
  - Muestra el estado de cada factura: "Factura en trámite" o "Factura 00005-00000042".
  - F10 hace `preventDefault`, como las otras F, y se suma a la referencia de atajos. Que no abra la barra de menú en el navegador real de la PC del kiosco es una tarea de verificación.
- **`ventas/Ventas.tsx`:**
  - En el detalle: cada factura con su importe y estado, "Sin facturar: $Y", **Pedir factura**, la reimpresión y el aviso antes de anular, que lista las facturas autorizadas.
  - En el listado: una marca "Factura" o "Factura parcial" según `importeFacturado`.
- **`admin/Facturacion.tsx`** (`/admin/facturacion`):
  - Estado de ARCA, entorno (con "HOMOLOGACIÓN" bien visible), punto de venta, último número, y la tabla de pendientes, en curso y con error, con **Reintentar** donde aplica.
  - Refresca cada 30 s.
- **`PanelAdmin.tsx`** suma la entrada "Facturación" y `CartelFacturacion`, que aparece con facturas en `error`.
- **`rutas.tsx`** suma la ruta.

### Avisos
- Valor `factura` en `TipoNotificacion`, al final, en Prisma y en `TIPOS_NOTIFICACION` a la vez.
- Los textos van en `modules/facturacion/avisos.ts`: factura con error (uno por motivo) y factura autorizada de una venta anulada. El aviso de anulación suma la línea en `modules/ventas/aviso.ts`.
- Se crean en la misma transacción que el paso a `error`.

### Archivos compartidos con los otros cambios en curso

| Archivo | Qué toca este cambio | Choque con | Cómo evitarlo |
|---|---|---|---|
| `apps/api/prisma/schema.prisma` | Modelos `Factura` y `TicketAccesoArca`, enums `EstadoFactura` y `ParteFactura`, relación en `Venta` y `Usuario` | `aviso-reposicion-diario` (`EjecucionTarea`), `cobro-mercado-pago` (`EstadoVenta.pendiente`, pagos de MP), `saldo-mercado-pago` | Modelos nuevos al final del archivo; no se toca `EstadoVenta` |
| `apps/api/prisma/migrations/` | Migración `facturacion_arca` | Los tres | Orden sugerido: `aviso_reposicion` → `facturacion_arca` → los de MP. La rama que llega segunda regenera su migración con fecha posterior |
| `TipoNotificacion` (Prisma y `packages/shared/src/ventas.ts`) | Valor `factura` | `aviso-reposicion-diario` (`reposicion`), posiblemente `saldo-mercado-pago` | Agregar al final, en los dos lugares a la vez; resolver el merge conservando todos los valores |
| `apps/api/src/config.ts` | Grupo `ARCA_*` "todas o ninguna" | `saldo-mercado-pago` y `cobro-mercado-pago` (credenciales de MP) | Extraer un ayudante `todasONinguna(grupo)` en el `superRefine` y que cada cambio sume su grupo |
| `apps/api/.env.example`, `infra/.env.example` | Variables `ARCA_*` comentadas | Cambios de MP | Bloque propio con título `# ARCA` |
| `infra/docker-compose.prod.yml` | Montaje `./arca:/run/secrets/arca:ro` y variables en `app` | `puesta-en-marcha`, MP | Solo líneas nuevas en `app` |
| `apps/api/src/server.ts` | Bloque de arranque de la emisión, con `onClose` | `aviso-reposicion-diario`, `saldo-mercado-pago` | Un bloque por tarea, con `iniciarCiclo` |
| `apps/api/src/jobs/ciclo.ts` | Suma `despertar()` (compatible) | `aviso-reposicion-diario` lo crea | Mergear `aviso-reposicion-diario` primero; si no está, crearlo según su design más `despertar()` |
| `apps/api/src/app.ts` | Opción `facturacion?`, rutas `/facturacion` y `/facturas` | `cobro-mercado-pago` (webhook), `saldo-mercado-pago` | Una opción y un `register` por módulo |
| `apps/api/src/modules/ventas/servicio.ts` | Llamada a `encolarFacturaSiCorresponde` en `registrarVenta`, cancelación en `anularVenta` y `facturas` en el detalle | `cobro-mercado-pago` (venta `pendiente` → `pagada`) | `cobro-mercado-pago` solo agrega la llamada a `encolarFacturaSiCorresponde` en su transición; con una venta `pendiente`, la función no hace nada |
| `packages/shared/src/index.ts` | `export * from './facturacion.js'` | Cambios de MP | Una línea por archivo, en orden alfabético |
| `apps/web/src/pos/Ticket.tsx` | Variante Factura C y leyenda en trámite | `cobro-mercado-pago` (posible estado `pendiente` en el ticket) | La parte fiscal va en un subcomponente `<PieFiscal>`, para que el resto del ticket se toque sin chocar |
| `apps/web/src/pos/Venta.tsx` | F10, estado de la factura en "Última venta", impresión con espera | `cobro-mercado-pago` (QR de cobro y espera de pago) | La franja de "Última venta" pasa a un componente `UltimaVenta` en su propio archivo, y cada cambio toca su parte |
| `apps/web/src/admin/PanelAdmin.tsx` | Entrada "Facturación" y `CartelFacturacion` | `saldo-mercado-pago` (saldo o cartel) | Una línea en la lista y un cartel por módulo |
| `apps/web/src/app/rutas.tsx` | Ruta `facturacion` | Cambios de MP | Una línea por ruta |
| `apps/web/src/admin/Avisos.tsx` | Párrafo que explica qué genera avisos | `aviso-reposicion-diario` | Mergear `aviso-reposicion-diario` primero |

Orden de merge recomendado: `aviso-reposicion-diario` → `facturacion-arca` → `cobro-mercado-pago` (que agrega la llamada al enganche) → `saldo-mercado-pago`.

## Risks / Trade-offs

- **[Dos procesos emitiendo a la vez durante un deploy]** → El único `(puntoVenta, tipo, numero)` impide que reserven el mismo número, y ARCA rechaza un número que no sea último + 1. El peor caso es un rechazo que gasta un intento.
- **[Corte entre la autorización y el guardado del CAE]** → La factura queda `en_curso` y la pasada siguiente la consulta. No se emite dos veces.
- **[ARCA autoriza la factura de una venta que se anuló mientras estaba en curso]** → Se acepta. La factura es válida, y el aviso al admin le dice que haga la nota de crédito por fuera.
- **[El dueño factura a mano en el mismo punto de venta]** → La numeración se cruza y aparece `numeracion_inconsistente`. Por eso el punto de venta es exclusivo del sistema; va en el runbook.
- **[Una factura vieja pendiente toma la fecha de la última autorizada]** → Es lo que exige ARCA para mantener las fechas crecientes. La venta conserva su fecha real.
- **[Se pierde el ticket de acceso (restauración de backup)]** → Hasta 12 h sin facturar, con las facturas pendientes sin perder intentos y el estado "autenticación bloqueada" visible.
- **[Vence el certificado (dura hasta 2 años)]** → ARCA rechaza el login y la pantalla muestra "no disponible" con el motivo. Va en el runbook con la fecha de vencimiento a anotar.
- **[El tope, el plazo, la leyenda o la URL del QR cambian por resolución]** → Son constantes de un solo archivo, con sus tests de borde.
- **[Homologación y producción mezclados]** → El ticket se guarda por entorno, y la pantalla del admin y el log de arranque muestran el entorno. En homologación, la factura impresa dice "HOMOLOGACIÓN – SIN VALIDEZ FISCAL".
- **[Más fricción en el mostrador]** → F9 puede esperar hasta 5 s si el cliente pide el ticket apenas paga con tarjeta. Con `despertar()` la factura suele estar en 1 o 2 s.

## Migration Plan

1. **Migración `facturacion_arca`:** enums, tablas `facturas` y `tickets_acceso_arca`, y `ALTER TYPE "TipoNotificacion" ADD VALUE 'factura'`. No toca datos.
2. **Deploy sin variables `ARCA_*`:** el sistema funciona igual que hoy. No se facturan las ventas anteriores a la configuración, porque el encolado solo mira las ventas nuevas.
3. **Homologación:** el dueño genera el certificado de testing (WSASS) y la app corre con `ARCA_ENTORNO=homologacion` en desarrollo. Se prueban los escenarios del grupo 7 de tasks.
4. **Producción:**
   - Certificado de producción, servicio wsfe asociado, punto de venta "RECE" exclusivo y datos del emisor.
   - Se copian los archivos a `infra/arca/` con permisos de solo lectura, se completan las variables y se hace el deploy.
   - Primera venta con tarjeta de prueba y control en el sitio de ARCA.
5. **Vuelta atrás:** sacar las variables `ARCA_*` y reiniciar. Las facturas pendientes quedan en la base y se emiten al volver a configurar, salvo las que vencieron el plazo. El código viejo ignora las tablas nuevas, y el valor de enum no se puede sacar, como en los cambios anteriores.

## Open Questions

**Resueltas por el dueño (2026-11-10):**
1. **Pago mixto:** se factura solo la parte electrónica. El efectivo se factura aparte si el cliente lo pide (segunda factura). Ver "Modelo de datos" y "Encolado".
2. **Leyenda de la Ley 27.743:** no va.
3. **Nombre en el ticket con factura:** el nombre de fantasía en grande (`ARCA_NOMBRE_FANTASIA`) y debajo la razón social con el CUIT.
4. **Atajo F10:** se queda. Que no abra la barra de menú en la PC del kiosco es una tarea de verificación. Si falla, se cambia por F5 con `preventDefault` o un atajo con Ctrl; F11 y F12 no sirven.
5. **Marca en homologación:** sí, "HOMOLOGACIÓN – SIN VALIDEZ FISCAL".

**Pendientes (no cambian la estructura ni las tareas):**
- Si el contador dice que no se puede facturar solo una parte de la venta, se cambia `importePorParte` para que la parte electrónica valga el total, y se desactiva la factura de efectivo en ventas mixtas. Son una función y sus tests.

**Datos normativos a verificar con el manual de WSFEv1 vigente o con el contador antes de producción:**
- Que sea válido facturar solo la parte electrónica de una venta, y que el ticket muestre la venta completa con "Facturado: $X" (normativo, confirmar con el contador).
- El tope de $10.000.000 (RG 5700/2025) y que el borde sea "igual o mayor".
- Los 5 días hacia atrás para concepto 1 y que la fecha no pueda ser anterior a la del último comprobante.
- `CondicionIVAReceptorId = 5` como obligatorio.
- El formato y la URL del QR (RG 4892/2020): dominio `afip.gob.ar` o `arca.gob.ar`, base64 estándar o url-safe, y si van `tipoDocRec` y `nroDocRec` con consumidor final sin identificar.
- El rango de 5 dígitos del punto de venta y de 8 del número.
- Los datos obligatorios de la Factura C impresa (RG 1415).
- Las direcciones de WSAA y WSFEv1.
