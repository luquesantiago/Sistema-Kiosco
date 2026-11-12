# Tasks

## 1. Tests de valor límite (antes del código)

Se escriben primero, a partir de los escenarios de `specs/facturacion`, `specs/ventas`, `specs/punto-de-venta` y `specs/notificaciones`, con los valores exactos del borde. Al terminar este grupo tienen que **compilar y fallar**: las funciones todavía no existen o están vacías, con solo las firmas que define el design. No se toca lógica de `src/`. Todos usan el reloj fijo y el cliente de ARCA falso (`test/arca-falso.ts`, que se crea en este grupo solo con su interfaz).

- [x] 1.1 Crear `packages/shared/src/facturacion.test.ts` para `urlQrFactura` y `formatearNumeroComprobante` (quedó en `packages/shared/test/facturacion.test.ts`, donde viven los demás tests de shared):
  - El JSON exacto del escenario "Contenido del QR" (orden de claves incluido) y la URL con `https://www.afip.gob.ar/fe/qr/?p=` + base64 estándar de ese texto.
  - `importe` 0.01, 1000 y 9999999.99 para $0,01, $1.000,00 y $9.999.999,99.
  - `codAut` de 14 dígitos sin perder precisión.
  - `00001-00000042` y `99999-99999999`.

  Verificar que `pnpm --filter @kiosco/shared test facturacion` compila y falla.
- [x] 1.2 Sumar a `apps/api/test/config.test.ts`:
  - Arranca sin ninguna variable `ARCA_*`.
  - Con una sola falta (la clave), falla nombrando `ARCA_KEY_PATH` sin mostrar el CUIT.
  - Punto de venta 0 y 100000 fallan; 1 y 99999 pasan.
  - CUIT con dígito verificador inválido falla.
  - `ARCA_ENTORNO` distinto de `homologacion` o `produccion` falla.

  Verificar que compila y falla.
- [x] 1.3 Crear `apps/api/test/facturacion-encolado.test.ts` contra la base de test. Cubre `importePorParte` (pura) y `encolarFacturaSiCorresponde` a través de `registrarVenta`:
  - **Venta 100% electrónica:** débito, crédito y MP por $3.300 → factura `electronica` `pendiente` de $3.300.
  - **Venta mixta:**
    - $2.000 efectivo + $3.000 débito → $3.000.
    - $4.999,99 efectivo + $0,01 MP → $0,01.
    - $0,01 efectivo + $4.999,99 crédito → $4.999,99.
    - $1.000 efectivo + $2.000 débito + $3.000 MP → $5.000.
  - **Venta 100% efectivo:** sin factura.
  - **Importe:** total $0,00 en débito → sin factura; $0,01 → factura de $0,01.
  - **Tope por factura:**
    - Parte electrónica de $9.999.999,99 → `pendiente`.
    - $10.000.000,00 y $10.000.000,01 → `error` con `tope`, aviso `factura` en la misma transacción y ningún pedido al cliente falso.
    - $10.000.000 en crédito + $1 en efectivo → la automática en `error` por tope.
  - **Sin efecto:** sin facturación configurada → sin factura. Llamar dos veces la función → una sola factura `electronica`. Una venta que no está `pagada` → nada.

  Verificar que compila y falla.
- [x] 1.4 Crear `apps/api/test/facturacion-pedido.test.ts` para `POST /api/ventas/:id/factura`:
  - **Venta en efectivo de hoy, pedida por el empleado:** → `201` con una factura `efectivo` por el total; la segunda vez → `200` con la misma.
  - **Venta mixta** de $5.000 ($2.000 efectivo + $3.000 débito) con la automática autorizada:
    - Pedido → `201` con una factura `efectivo` de $2.000. Las dos suman $5.000.
    - Un tercer pedido → `200` con la de $2.000 y sigue habiendo dos.
    - La misma venta con la automática todavía `pendiente` → igual, dos facturas.
  - **Efectivo de $0,01** ($0,01 efectivo + $4.999,99 crédito): pedido → factura de $0,01.
  - **Venta 100% electrónica:** pedido → `200` con la automática y no se crea otra.
  - **Venta de total $0,00:** → `422`.
  - **Tope por factura:** $12.000.000 con $6.000.000 en débito y $6.000.000 en efectivo → las dos facturas de $6.000.000 quedan `pendiente`.
  - **Invariante:** para cada caso, la suma de los importes de las facturas de la venta es ≤ el total.
  - Venta del 09/11 a las 23:59 de Argentina (`2026-11-10T02:59:00Z`) pedida el 10/11 a las 00:01 (`2026-11-10T03:01:00Z`): el empleado → `403`, el admin → `201`.
  - El admin el 10/11 (a las 00:01): venta del 05/11 a las 00:00 (`2026-11-05T03:00:00Z`) → `201`; del 04/11 a las 23:59 (`2026-11-05T02:59:00Z`) → `422`.
  - Venta anulada → `409`. Sin configuración → `409`. Sin sesión → `401`.

  Verificar que compila y falla.
- [x] 1.5 Crear `apps/api/test/facturacion-emision.test.ts` para `procesarFacturas`, con el cliente falso y la base de test:
  - **Numeración:** último 41 → pide el 42; último 0 → el 1; último 99999998 → el 99999999 y la siguiente en `error` con `numeracion_agotada` y aviso.
  - **Datos del pedido:** tipo 11, concepto 1, `PES`, cotización 1, total = neto = 3300.50, IVA 0, documento 99/0 y condición 5.
  - **Fecha:** venta `2026-11-10T02:59:00Z` emitida a `2026-11-10T03:01:00Z` → `20261109`; venta `2026-11-10T03:00:00Z` emitida a `03:00:05Z` → `20261110`; venta del 09/11 con el último autorizado del 10/11 → `20261110`.
  - **Plazo en la cola:** pendiente de una venta del 04/11 procesada el 10/11 → `error` con `fuera_de_plazo`, sin pedido a ARCA y con aviso; una del 05/11 → se emite.
  - **Autorización:** CAE y vencimiento `20261120` guardados tal cual, con `autorizadaEn`.
  - **Reintentos:**
    - Primer rechazo a las 10:00:00 → 1 intento; una pasada a las 10:00:29 no la manda y una a las 10:00:30 sí.
    - Con 3 intentos y otro rechazo → 4 y espera hasta las 10:30:00.
    - Con 4 y otro rechazo → `error` con 5 intentos y aviso.
    - Rechazo y después autorización → `autorizada`.
    - Un rechazo libera el número.
  - **ARCA caído:**
    - `FEDummy` caído → nada cambia.
    - 30 pendientes con 0 intentos siguen así y se emiten en orden al volver.
    - Con 4 intentos y caída → sigue con 4.
  - **Corte:**
    - `timeout_autorizado` → queda `en_curso`, y la pasada siguiente consulta y deja `autorizada` sin pedir otro número.
    - `en_curso` con el 42 que no existe y último 41 → reenvía el 42.
    - El 42 en ARCA con otro importe → `error` con `numeracion_inconsistente`, aviso y ninguna otra se emite hasta el reintento del admin.
    - Con una `en_curso` sin resolver, ninguna pendiente se manda.
  - **Orden:** #120, #121 y #122 salen con números correlativos en ese orden.
  - **Venta anulada con factura `en_curso`:** si la consulta la encuentra → `autorizada` y aviso de venta anulada; si no la encuentra → `cancelada` sin reenvío.
  - **Concurrencia:** dos `procesarFacturas` en paralelo (`Promise.all`) no reservan el mismo número y ninguna rechaza con error no controlado.

  Verificar que compila y falla.
- [x] 1.6 Crear `apps/api/test/arca-tickets.test.ts` para `obtenerTicket`, con un servidor WSAA local:
  - Ticket que vence a las `20:00:00Z`: a las `19:58:59Z` se reutiliza sin pedido; a las `19:59:00Z` y a las `20:00:01Z` se pide uno nuevo y se guarda.
  - Al reiniciar (otra instancia del cliente con la misma base), se reutiliza el guardado.
  - `coe.alreadyAuthenticated` → `ArcaNoDisponible` con motivo `autenticacion_bloqueada`.
  - Homologación y producción no comparten ticket.

  Verificar que compila y falla.
- [x] 1.7 Crear `apps/api/test/facturacion-rutas.test.ts`:
  - `GET /api/facturacion`: estado, pendientes, en error con motivo, `no_configurado` sin configuración.
  - `POST /api/facturas/:id/reintentar`:
    - En `error` por rechazos → `pendiente` con 0 intentos.
    - Por `tope`, por `fuera_de_plazo`, `autorizada` o con la venta anulada → `409` sin cambios.
    - Inexistente → `404`.
  - El empleado → `403` en las dos.

  Verificar que compila y falla.
- [x] 1.8 Sumar a `apps/api/test/ventas.test.ts` los escenarios de anulación:
  - Factura `pendiente` o en `error` → `cancelada` en la misma transacción y no se emite después.
  - Factura `autorizada` → la venta queda `anulada`, la factura sigue `autorizada` y el aviso de anulación menciona `00005-00000042`, $3.300 y la nota de crédito por fuera.
  - Venta mixta con dos facturas autorizadas → el aviso menciona las dos con su importe.
  - Una autorizada y otra `pendiente` → la pendiente queda `cancelada` y el aviso menciona solo la autorizada.
  - Única factura `pendiente` → el aviso no menciona factura.
  - Detalle con `facturas`, `sinFacturar` y `puedePedirFactura` para el empleado y el admin (venta mixta con la automática autorizada → `sinFacturar` $2.000), e `importeFacturado` en el listado.

  Comparar el texto completo de los avisos, como los demás tests de avisos. Verificar que compila y falla.
- [x] 1.9 Crear los tests de la web (Testing Library):
  - `Ticket.test.tsx`:
    - **Venta 100% electrónica:** nombre de fantasía arriba, razón social con CUIT debajo, un bloque con "Facturado: $3.300,00", CAE, vencimiento y QR, y sin "No válido como factura".
    - **Venta mixta con la automática autorizada:** total $5.000, un bloque con "Facturado: $3.000,00" y "Sin facturar: $2.000,00 – no válido como factura".
    - **Venta mixta con las dos autorizadas:** dos bloques y sin "Sin facturar".
    - **Factura en trámite:** su línea con el importe.
    - **Factura en `error` o `cancelada`:** el ticket de siempre.
    - **Homologación:** "HOMOLOGACIÓN – SIN VALIDEZ FISCAL".
  - `Venta.test.tsx`:
    - F10 pide la factura y el foco vuelve al escaneo.
    - En una venta mixta, el botón dice **Facturar efectivo ($2.000)**.
    - F10 no aparece en una venta 100% electrónica, si el efectivo ya tiene factura o si la facturación no está configurada.
    - F9 con la factura que se autoriza a los 3 s imprime la Factura C, y a los 5 s sin autorizar imprime la leyenda en trámite (timers falsos).
  - `Facturacion.test.tsx`: lista, **Reintentar** y cartel en el panel.

  Verificar que `pnpm --filter web test` compila y estos fallan.

  Archivos escritos (en Windows `Venta.test.tsx` chocaría con `venta.test.tsx`): `apps/web/test/factura-ticket.test.tsx`, `factura-venta.test.tsx`, `factura-ventas.test.tsx` (detalle, aviso antes de anular, `422` de plazo y marca del listado, de la tarea 7.3) y `facturacion.test.tsx`, con los datos en `factura-datos.ts`.

## 2. Modelo de datos, configuración y compartido

- [x] 2.1 Sumar a `schema.prisma`:
  - `EstadoFactura`, `ParteFactura` y el valor `factura` al final de `TipoNotificacion`.
  - Los modelos `Factura`, con el único `(ventaId, parte)`, el único `(puntoVenta, tipoComprobante, numero)` y el índice `(estado, creadaEn)`, y `TicketAccesoArca`, con la clave `(servicio, entorno)`.
  - Las relaciones en `Venta` y `Usuario`.

  Generar la migración `facturacion_arca` (después de `aviso_reposicion` si ya está mergeado). Verificar con `pnpm db:migrate` y que los tests existentes siguen pasando.
- [x] 2.2 Agregar a `packages/shared`:
  - `facturacion.ts`: esquemas `facturaVentaSchema` y `estadoFacturacionSchema`, `urlQrFactura`, `formatearNumeroComprobante` y `URL_QR`.
  - `facturas`, `sinFacturar`, `puedePedirFactura` y `emisor` en `ventaDetalleSchema`, `importeFacturado` en `ventaResumenSchema` y `factura` en `TIPOS_NOTIFICACION`.
  - Los códigos `FACTURACION_NO_CONFIGURADA`, `FACTURA_FUERA_DE_PLAZO` y `FACTURA_NO_REINTENTABLE`.
  - El export en `index.ts`.

  Verificar que pasan los tests de 1.1.
- [x] 2.3 Sumar a `cargarConfig` el grupo `ARCA_*`, incluido `ARCA_NOMBRE_FANTASIA`, con la regla "todas o ninguna" (ayudante `todasONinguna`), el rango del punto de venta y el dígito verificador del CUIT. Agregar las variables comentadas a `apps/api/.env.example`. Verificar que pasan los tests de 1.2.
- [x] 2.4 Agregar `sumarDias(fecha, n)` a `lib/fechas.ts` y `reglas.ts` en `modules/facturacion` con las constantes normativas comentadas con su RG. Verificar con tests de `fechas.test.ts`: cambio de mes (`2026-11-01` − 5 → `2026-10-27`) y de año.

## 3. Integración con ARCA

- [x] 3.1 Agregar `node-forge` (con `@types/node-forge`) y `fast-xml-parser` a `apps/api`. Verificar que `pnpm install` y `pnpm --filter api typecheck` pasan.
- [x] 3.2 Implementar `integrations/arca/wsaa.ts`: el TRA, la firma CMS con `node-forge` y la lectura de `LoginCms`, incluido `coe.alreadyAuthenticated`. Verificar con un test que firma con un certificado autofirmado generado en el test y comprueba la firma, y contra el servidor local con XML grabado.
- [x] 3.3 Implementar `integrations/arca/tickets.ts` (`obtenerTicket` con margen de 60 s y `upsert` por entorno). Verificar que pasan los tests de 1.6.
- [x] 3.4 Implementar `integrations/arca/wsfe.ts`, `direcciones.ts` y `cliente.ts`:
  - `estadoServidores`, `ultimoAutorizado` (con la fecha), `consultar` y `solicitarCae`.
  - Timeout de 15 s y la diferencia entre `ArcaNoDisponible` y `ArcaRechazo`.
  - Completar `test/arca-falso.ts`.

  Verificar con `apps/api/test/arca-cliente.test.ts` contra un servidor HTTP local:
  - Aprobado, rechazado con `Errors` y con `Observaciones`.
  - SOAP Fault, HTTP 500, timeout y `FEDummy` con un servidor caído.
  - Valores escapados en el XML y que el token no aparece en los mensajes de error.

## 4. Encolado y pedido de factura

- [x] 4.1 Implementar `modules/facturacion/encolado.ts` (`importePorParte` y `encolarFacturaSiCorresponde` por la parte electrónica, con el tope por factura y su aviso) y llamarla al final de la transacción de `registrarVenta`. Pasar `facturacion?` por `crearApp` y `rutasVentas`, y llamar a `despertar()` después del commit. Verificar que pasan los tests de 1.3 y que `ventas.test.ts` sigue verde sin configuración.
- [x] 4.2 Implementar `pedirFactura` (factura de la parte `efectivo`, idempotente, y la automática si no hay efectivo) y `POST /api/ventas/:id/factura`, y sumar la ruta al test de rutas protegidas. Verificar que pasan los tests de 1.4.
- [x] 4.3 Sumar `facturacionHabilitada` al estado de la caja que consulta el mostrador. Verificar con un test de la ruta de estado de la caja con y sin configuración.

## 5. Emisión por detrás de la venta

- [x] 5.1 Implementar `modules/facturacion/emision.ts` (`procesarFacturas`): servidores, bloqueo por inconsistencia, resolución de la `en_curso`, reserva, emisión, reintentos con `MAX_INTENTOS` y `ESPERAS_MS` de WhatsApp, plazo, numeración agotada y avisos en la misma transacción. Textos en `modules/facturacion/avisos.ts`. Verificar que pasan los tests de 1.5.
- [x] 5.2 Sumar `despertar()` a `jobs/ciclo.ts`. Si `aviso-reposicion-diario` no está mergeado, crear `ciclo.ts` según su design. Verificar con `ciclo.test.ts`:
  - `despertar()` adelanta la pasada.
  - Durante una pasada, `despertar()` agenda una sola más al terminar.
  - Los tests previos de `ciclo` siguen pasando.
- [x] 5.3 Implementar `jobs/emision-facturas.ts` (`iniciarEmisionFacturas` con `iniciarCiclo` cada 10 s, guardando el último estado para `GET /api/facturacion`). Arrancarlo desde `server.ts` solo con la configuración de ARCA, con el certificado y la clave leídos al arrancar, y detenerlo en `onClose`. Verificar:
  - Con un test, que `detener()` espera la pasada en curso.
  - A mano, que `pnpm --filter api dev` sin `ARCA_*` arranca y loguea que la facturación está desactivada.
  - Que con un certificado inexistente sale nombrando el archivo.

## 6. Anulación, detalle y rutas del admin

- [x] 6.1 En `anularVenta`, cancelar las facturas `pendiente` o en `error`, y sumar al aviso de anulación una línea por cada factura vigente (`modules/ventas/aviso.ts`). Sumar al detalle `facturas`, `sinFacturar`, `puedePedirFactura` y `emisor`, con el `qrUrl` de cada factura, e `importeFacturado` al listado. Verificar que pasan los tests de 1.8.
- [x] 6.2 Implementar `GET /api/facturacion` y `POST /api/facturas/:id/reintentar` (`modules/facturacion/rutas.ts`) y sumarlas al test de rutas protegidas. Verificar que pasan los tests de 1.7.

## 7. Web

- [x] 7.1 Agregar `qrcode` (con `@types/qrcode`) a `apps/web`. En `Ticket.tsx`:
  - Sumar el encabezado con el nombre de fantasía y la razón social con el CUIT.
  - Sumar `PieFiscal`: datos del emisor una vez, un `BloqueFactura` por cada factura autorizada con "Facturado: $X" y su QR en SVG, las líneas "Factura en trámite" y "Sin facturar" y la marca de homologación.
  - Sumar `imprimirConFactura` en `useImpresionTicket`, que espera hasta 5 s consultando la venta.

  Verificar que pasa `Ticket.test.tsx` de 1.9 y, a mano, que la Factura C entra en 58 y 80 mm (vista previa de impresión). _Tests ya escritos por el agente de tests: `apps/web/test/factura-ticket.test.tsx`._ _Pasan los tests; la vista previa de impresión en 58 y 80 mm queda para verla a mano en la PC del kiosco (el QR mide 30 mm)._
- [x] 7.2 En `Venta.tsx`, pasar la franja de última venta a `UltimaVenta`, con F10 y **Pedir factura** (**Facturar efectivo ($X)** en una venta mixta), el estado de cada factura y F9 con espera. Sumar F10 a la referencia de atajos. Verificar que pasa `Venta.test.tsx` de 1.9. _Tests ya escritos por el agente de tests: `apps/web/test/factura-venta.test.tsx`._
- [x] 7.3 En `ventas/Ventas.tsx`, sumar al detalle cada factura con su importe y estado, "Sin facturar", **Pedir factura** y la reimpresión, y el aviso antes de anular, que lista las facturas autorizadas. En el listado, la marca "Factura" o "Factura parcial". Verificar con tests de Testing Library el aviso previo a la anulación y el `422` de plazo que muestra el mensaje. _Tests ya escritos por el agente de tests: `apps/web/test/factura-ventas.test.tsx`._
- [x] 7.4 Crear `admin/Facturacion.tsx` en `/admin/facturacion`, con la entrada en `PanelAdmin` y la ruta en `rutas.tsx`, y `CartelFacturacion` en el panel. Actualizar el párrafo de `Avisos.tsx`. Verificar que pasa `Facturacion.test.tsx` de 1.9 y que un empleado no accede. _Tests ya escritos por el agente de tests: `apps/web/test/facturacion.test.tsx` (incluye el empleado sin acceso)._
- [ ] 7.5 Verificar F10 en el navegador real de la PC del kiosco. Presionarlo en la pantalla de venta tiene que pedir la factura sin abrir la barra de menú, y hay que probarlo también con el foco en el campo de escaneo. Si el navegador no permite interceptarlo, cambiar el atajo (F5 con `preventDefault` o uno con Ctrl; F11 y F12 no sirven) y actualizar la referencia de atajos, los tests y este archivo. Anotar acá el navegador, su versión y el resultado.

## 8. Infraestructura

- [x] 8.1 Sumar a `infra/docker-compose.prod.yml` el montaje `./arca:/run/secrets/arca:ro` y las variables `ARCA_*` en `app`. Agregarlas a `infra/.env.example` y `infra/arca/` al `.gitignore`. Verificar que el job de producción de la CI levanta el Compose sin `ARCA_*` y que `/api/health` responde `200`. _Verificado localmente con `docker compose config` (sin `ARCA_*` las variables no llegan a la app) y arrancando la API sin `ARCA_*` (`/api/health` 200); el job de la CI corre al subir la rama._

## 9. Verificación y documentación

- [ ] 9.1 Correr `pnpm --filter api test`, `pnpm --filter web test`, `pnpm typecheck` y `pnpm lint`, y verificar que todo pasa, incluidos los tests de valor límite del grupo 1.
  _Pasan las tres suites y `pnpm lint`. `pnpm typecheck` falla solo por la ayuda de test `apps/web/test/factura-datos.ts` (línea 66: `sinFacturar = total` en el mismo patrón de parámetros da TS7022); se arregla en el test (por ejemplo, `sinFacturar = undefined as string | undefined` en los parámetros y `sinFacturar: sinFacturar ?? total` en el objeto que devuelve), que no se tocó._
- [x] 9.2 Documentar:
  - `docs/requisitos-y-limites.md`: qué se factura (la parte electrónica sola y el efectivo a pedido, con hasta dos facturas por venta), el tope por factura, el plazo, que no hay notas de crédito y los datos normativos a verificar.
  - `docs/stack-tecnologico.md`: `node-forge`, `fast-xml-parser` y `qrcode`, y por qué.
  - `docs/estructura-proyecto.md`: `src/integrations/`, `Factura` y el flujo de emisión.
  - `infra/README.md`:
    - Cómo generar la clave y el pedido de certificado (`openssl req`).
    - Cómo asociar el servicio wsfe, crear el punto de venta, pasar de homologación a producción y renovar el certificado.
    - Qué hacer con "autenticación bloqueada" y con "numeración inconsistente".

  Verificar que los docs coinciden con las specs del cambio.

## 10. Prueba en homologación (cuando el dueño tenga el certificado de testing)

- [ ] 10.1 Con `ARCA_ENTORNO=homologacion` y el certificado de testing:
  - Cobrar en débito y ver la factura autorizada en menos de un minuto, con un CAE real de homologación.
  - Cobrar una venta mixta, ver la factura solo por la parte electrónica, pedir la del efectivo con F10 y ver las dos en el ticket.
  - Imprimir con F9 y escanear el QR con el celular.
  - Pedir factura de una venta en efectivo con F10.
  - Cortar la red durante una emisión y ver que se recupera sin saltear números.
  - Reiniciar la app y ver que reutiliza el ticket.
  - Anular una venta facturada y ver el aviso.

  Anotar en este archivo la fecha y lo verificado.

## Qué tiene que aportar el dueño

No son tareas del sistema, pero sin esto no se puede pasar a producción (ni probar en homologación el grupo 10):

- **Clave fiscal nivel 3** en ARCA, del titular del monotributo.
- **Certificado digital:**
  - Para homologación, generado en WSASS ("Autogestión Certificados Homologación").
  - Para producción, en "Administración de Certificados Digitales", a partir del pedido (CSR) que genera el sistema según `infra/README.md`. La clave privada no sale de la PC o del servidor del kiosco.
- **Alta del servicio** "Facturación Electrónica" (wsfe) en el Administrador de Relaciones de Clave Fiscal, asociado al certificado.
- **Punto de venta nuevo** del tipo "Factura Electrónica – Monotributo – Web Services" (RECE), exclusivo del sistema, con el domicilio del kiosco. El número va en `ARCA_PUNTO_VENTA`.
- **Datos del comprobante:**
  - Nombre de fantasía del kiosco, que va en grande arriba del ticket con factura.
  - Razón social (nombre y apellido del titular), domicilio comercial y CUIT.
  - Número de ingresos brutos (o "Exento"/"Convenio Multilateral", según corresponda) y fecha de inicio de actividades.
- **Confirmación del contador** sobre los datos normativos a verificar del design: tope, plazo, datos de la Factura C impresa y, sobre todo, que sea válido facturar solo la parte electrónica de una venta mixta, con el ticket mostrando la venta completa y "Facturado: $X".

## Workflow follow-up

- Archivar el cambio con `/opsx:archive` cuando la CI esté en verde. La prueba en homologación (10.1) puede quedar para cuando llegue el certificado, si el usuario lo decide así, como en `envio-whatsapp`.
- Recordarle a `cobro-mercado-pago` que, al pasar una venta a `pagada`, tiene que llamar a `encolarFacturaSiCorresponde` dentro de su transacción.
