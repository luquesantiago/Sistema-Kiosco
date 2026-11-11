# Proposal

## Why

El kiosco es de un monotributista y las ventas con débito, crédito y Mercado Pago quedan registradas en los bancos y en MP: tienen que tener su factura. Hoy el sistema solo imprime un ticket que dice "No válido como factura", y facturar a mano en el sitio de ARCA venta por venta es inviable en el mostrador. Es la parte de ARCA de la Etapa 4, y el dueño ya aprobó cómo tiene que funcionar (2026-11-10).

## What Changes

- **Factura C electrónica por los web services de ARCA:**
  - Autenticación con WSAA. El ticket de acceso se guarda en la base y se reutiliza mientras esté vigente (dura unas 12 h y ARCA no da otro mientras tanto).
  - Emisión con WSFEv1 (`FECAESolicitar`) y consulta del último número autorizado y de un comprobante puntual (`FECompUltimoAutorizado`, `FECompConsultar`).
  - Siempre a consumidor final sin identificar: el sistema nunca pide datos del cliente.
- **Qué se factura:**
  - Sola, la **parte electrónica** de toda venta que queda `pagada`: la suma de lo cobrado con débito, crédito y Mercado Pago. En un pago mixto, el efectivo queda sin factura (decisión del dueño; que sea válido facturar solo una parte es un dato normativo a confirmar con el contador).
  - Lo cobrado en efectivo, solo si el cliente pide factura: hay una acción nueva en el mostrador (F10), después de cobrar o desde el listado de ventas. En una venta mixta ya facturada en parte, se emite una segunda factura por el efectivo. Una venta tiene como máximo dos facturas, y nunca suman más que su total.
  - El admin puede facturar ventas de días anteriores, dentro del plazo que permite ARCA.
- **El mostrador nunca se frena:**
  - La venta se guarda y la factura queda en una cola. Se emite por detrás, de a una, con reintentos: 5 intentos con esperas crecientes, y si ARCA no responde, la espera no gasta intentos.
  - Sin CAEA.
- **Numeración segura:**
  - El número se guarda antes de mandarlo a ARCA.
  - Después de un corte, se consulta en ARCA antes de reintentar, para no saltear números ni facturar dos veces la misma parte de una venta.
- **Tope para no identificar al cliente:** se evalúa por factura. Si su importe llega a $10.000.000, la factura no se emite y queda marcada para el admin. El tope es una constante y es un dato normativo a verificar.
- **Ticket:**
  - Cuando la venta tiene factura autorizada, F9 imprime arriba el nombre de fantasía en grande y debajo la razón social con el CUIT.
  - Siguen los ítems, el total de la venta y los pagos, y un bloque fiscal por cada factura autorizada: número, "Facturado: $X", CAE, vencimiento del CAE y QR de ARCA por ese importe.
  - En una venta mixta con el efectivo sin facturar, el ticket dice cuánto quedó sin facturar.
  - Si la factura todavía está en trámite, el ticket lo dice. Sin factura, el ticket sigue igual que hoy.
  - En homologación, la factura impresa dice "SIN VALIDEZ FISCAL".
- **Pantalla Administración → Facturación:**
  - Estado de la conexión con ARCA y facturas pendientes o con error, con **Reintentar**.
  - Cartel en el panel cuando hay facturas con error.
  - Aviso por WhatsApp al admin cuando una factura queda en error.
- **Anulación de una venta facturada:**
  - El sistema no emite notas de crédito: avisa claro que la factura sigue vigente y que la nota de crédito se hace por fuera.
  - Si la factura todavía no se había emitido, la emisión se cancela.
- **Configuración por variables de entorno:** CUIT, punto de venta, entorno, rutas del certificado y de la clave, y datos del emisor (nombre de fantasía, razón social, domicilio, inicio de actividades e ingresos brutos). Se cargan todas juntas o ninguna. Sin configuración, el sistema funciona igual que hoy, sin facturar.

Fuera de alcance:
- Notas de crédito y débito, y Facturas A o B: el kiosco es monotributista.
- Identificar al cliente con DNI o CUIT.
- CAEA (autorización anticipada para contingencias).
- Mandar la factura por mail o WhatsApp al cliente.
- Cobrar con Mercado Pago integrado: es el cambio `cobro-mercado-pago`, que solo va a tener que llamar a la función de encolado de este cambio cuando una venta pase a `pagada`.

## Capabilities

### New Capabilities
- `facturacion`: la factura electrónica del kiosco. Cubre la configuración, qué parte de cada venta se factura y cuándo, las hasta dos facturas por venta, los datos de la Factura C, la numeración, la cola de emisión con reintentos, la autenticación con ARCA, el plazo para días anteriores, el tope de consumidor final, el QR, y la pantalla y el reintento del admin.

### Modified Capabilities
- `punto-de-venta`:
  - El ticket impreso suma el encabezado del emisor y un bloque fiscal por cada factura autorizada, o dice que la factura está en trámite.
  - Nueva acción para pedir factura de lo cobrado en efectivo.
- `ventas`:
  - La anulación de una venta con facturas cancela las emisiones pendientes o avisa qué facturas siguen vigentes.
  - El detalle de la venta muestra sus facturas y lo que quedó sin facturar.
- `notificaciones`:
  - Aviso nuevo cuando una factura queda en error.
  - El aviso de anulación menciona cada factura autorizada de la venta.

## Impact

- **Base de datos:** una migración con:
  - Los modelos `Factura` (hasta dos por venta, una por parte electrónica y otra por efectivo; número único por punto de venta y tipo) y `TicketAccesoArca`.
  - Los enums de estado y parte (electrónica o efectivo) de la factura.
  - El valor `factura` en `TipoNotificacion`.
- **API:**
  - Integración `src/integrations/arca` (WSAA, WSFEv1, QR, cliente falso para los tests).
  - Módulo `modules/facturacion` (encolado, emisión, rutas de admin, avisos).
  - Tarea `src/jobs/emision-facturas.ts` sobre `jobs/ciclo.ts`.
  - Cambios en `modules/ventas/servicio.ts` (encolado al registrar y anulación).
  - `POST /api/ventas/:id/factura`, `GET /api/facturacion` y `POST /api/facturas/:id/reintentar`.
  - Variables `ARCA_*` en `config.ts`.
- **Dependencias nuevas:**
  - `node-forge`, para firmar el pedido de acceso al WSAA.
  - `fast-xml-parser`, para leer las respuestas SOAP.
  - En la web, `qrcode`, para dibujar el QR del ticket.
- **Compartido:** esquemas de la factura en `packages/shared` (detalle de venta, estado de la facturación, armado del QR y formato del número).
- **Web:** `Ticket.tsx`, `Venta.tsx` (acción de pedir factura e impresión), `ventas/Ventas.tsx`, la pantalla nueva `admin/Facturacion.tsx`, `PanelAdmin.tsx` y `rutas.tsx`.
- **Infraestructura:** el certificado y la clave montados como archivos de solo lectura en el Compose de producción, y las variables `ARCA_*` en `infra/.env.example` y `apps/api/.env.example`.
- **Docs:** `docs/requisitos-y-limites.md`, `docs/stack-tecnologico.md`, `docs/estructura-proyecto.md` e `infra/README.md` (cómo generar el certificado y pasar de homologación a producción).
- **Lo que tiene que aportar el dueño antes de producción:** clave fiscal nivel 3, certificado, alta del servicio wsfe, punto de venta de web services y los datos del emisor.
