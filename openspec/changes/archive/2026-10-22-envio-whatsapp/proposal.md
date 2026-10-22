# Proposal

## Why

Las anulaciones, los gastos y retiros de los empleados y cada cierre de turno ya generan un aviso para el admin, pero hoy solo se ven en la pantalla **Avisos**: nadie se entera si no entra a mirarla. Es lo último que falta de la Etapa 2 para que el sistema pueda usarse en el kiosco. El dueño ya tiene un chip dedicado, así que se envían por WhatsApp con WAHA, como estaba previsto.

## What Changes

- **WAHA** (WhatsApp HTTP API, versión Core gratuita y con un motor sin navegador) se suma como servicio interno: en el Compose de producción, sin puertos publicados y con API key, y en el de desarrollo, para probar todo con el chip antes de contratar el servidor.
- **Pantalla WhatsApp en el panel del admin:**
  - Muestra el estado de la conexión y el QR para vincular el chip desde el celular o la PC del kiosco, sin depender de quien hizo el sistema.
  - Permite desvincular el chip.
  - Tiene el número que recibe los avisos (uno solo), validado contra WhatsApp, y el botón **Mandar prueba**.
- **Cartel en el panel del admin** cuando WhatsApp no está vinculado o falta el número. Si WhatsApp está caído, el sistema es el único lugar donde el dueño se puede enterar.
- **Envío automático de los avisos pendientes** desde un proceso dentro de la app:
  - Mientras WhatsApp no está disponible, los avisos esperan sin gastar intentos.
  - Si fallan con la conexión activa, se reintentan con espera creciente y, después de 5 intentos, quedan en `error` con el motivo.
  - Los acumulados se mandan uno por uno, en orden y con una pausa entre cada uno.
- **Avisos:** muestra el motivo de los que fallaron y suma el botón **Reintentar**.

Fuera de alcance:
- El aviso de reposición de las 12:00. Es de la Etapa 4, que va a reutilizar este envío.
- Enviar a varios números o a un grupo.
- Responder o procesar los mensajes que lleguen al chip.
- La API oficial de WhatsApp: sus plantillas no admiten los textos de varias líneas de los avisos.

## Capabilities

### New Capabilities
- `whatsapp`: la conexión del sistema con WhatsApp. Cubre la vinculación del chip por QR, el estado de la conexión y su aviso en el panel, el número que recibe los avisos y el mensaje de prueba, y que el servicio de WhatsApp no quede expuesto.

### Modified Capabilities
- `notificaciones`: los avisos pendientes pasan a enviarse solos por WhatsApp, con reintentos, estado `error` con motivo, reintento manual del admin y envío ordenado de los acumulados. El texto y la creación de cada aviso no cambian.

## Impact

- **Base de datos:**
  - `Notificacion` suma `intentos` y `proximoIntentoEn`.
  - Una tabla nueva de una sola fila con el número de destino y su `chatId` de WhatsApp.
- **API:**
  - Módulo `whatsapp` con el cliente de WAHA, las rutas de admin (`/api/whatsapp/...`) y el proceso de envío. Es el primer proceso periódico de la app.
  - `POST /api/notificaciones/:id/reintentar`.
  - Variables opcionales `WAHA_URL` y `WAHA_API_KEY`: sin ellas la app funciona igual y el envío queda desactivado. Así siguen andando los tests y la CI.
  - `GET /api/health` no cambia: una caída de WhatsApp no tiene que hacer fallar el deploy.
- **Web:** la pantalla `/admin/whatsapp`, el cartel en `PanelAdmin` y los cambios en `Avisos`.
- **Infraestructura:**
  - El servicio `waha` en `infra/docker-compose.prod.yml`, con la sesión en un volumen, y en `infra/docker-compose.dev.yml`, con un perfil aparte.
  - `WAHA_API_KEY` en `infra/.env.example`.
  - En el runbook, cómo vincular y qué hacer si se desvincula.
- **Docs:** `requisitos-y-limites.md` (se cierra la pregunta del chip), `stack-tecnologico.md`, `estructura-proyecto.md` y el README.
- **Operación:** el celular del chip tiene que conectarse a internet al menos cada ~14 días, o WhatsApp desvincula la sesión.
