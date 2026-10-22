# Design

## Context

- **Ya existe:**
  - `Notificacion` (`notificaciones`) con `tipo`, `destino` (siempre `"admin"`), `texto`, `estado` (`pendiente`, `enviada` o `error`), `creadaEn`, `enviadaEn` y `error`.
  - Los avisos se crean en la misma transacción que la anulación, el gasto o retiro del empleado y el cierre de turno (`modules/ventas`, `modules/caja`).
  - `GET /api/notificaciones` (solo admin, paginado) y la pantalla `Avisos.tsx`, que ya muestra los tres estados.
- **No hay ningún proceso periódico en la API.** Este cambio crea el primero; la Etapa 4 lo va a reutilizar para el aviso de las 12:00.
- `crearApp` recibe sus dependencias inyectadas (`prisma`, `ahora`, `verificarBase`), y los tests de integración corren contra `kiosco_test`. `cargarConfig` valida el entorno con Zod.
- **Producción** (`puesta-en-marcha`): Compose con `caddy`, `app` y `db`, `infra/.env` fuera del repo, `deploy.sh` que verifica `/api/health` y vuelve atrás si falla. El servidor de DonWeb es x86.
- **En la PC de desarrollo** el puerto 3000 ya está ocupado por otro contenedor.
- **WAHA:**
  - Una sesión (`default`) con estados `STOPPED`, `STARTING`, `SCAN_QR_CODE`, `WORKING` y `FAILED`.
  - Endpoints:
    - `POST /api/sessions/{s}/start` es idempotente; también hay `restart` y `logout`.
    - `GET /api/sessions/{s}` devuelve el estado y `GET /api/sessions/{s}/me` el número vinculado.
    - `GET /api/{s}/auth/qr` devuelve el QR en base64 con `Accept: application/json`.
    - `GET /api/contacts/check-exists?phone=&session=` devuelve `numberExists` y `chatId`.
    - `POST /api/sendText` recibe `{ session, chatId, text }`.
  - Autenticación con el header `X-Api-Key`. La sesión se guarda en `/app/.sessions`.
  - Cada QR dura 20 s (el primero 60 s). Después de 6 QR sin escanear, la sesión pasa a `FAILED`.
- Requisitos en `specs/whatsapp` y `specs/notificaciones`.

## Goals / Non-Goals

**Goals:**
- **Ningún aviso se pierde ni se marca como fallado por algo que no es culpa del aviso**, como WhatsApp caído o sin número. Para eso, la tabla `notificaciones` hace de cola de salida.
- El envío no compite con el mostrador: corre fuera de los pedidos HTTP y, si WAHA tarda o se cae, las ventas no lo notan.
- Todo se puede testear sin WAHA ni chip, con un cliente falso inyectado y el reloj controlado.

**Non-Goals:**
- Garantizar exactamente un envío por aviso. Ver Riesgos: se acepta un duplicado ocasional.
- Varias sesiones de WhatsApp, varios destinos o grupos.
- Webhooks de WAHA: el estado se consulta cuando se necesita.

## Decisions

### Motor de WAHA: GOWS, imagen fijada
- Se usa la imagen `devlikeapro/waha` con el motor **GOWS**: Go, sin navegador, y según WAHA el reemplazo futuro de NOWEB. La versión queda fijada en el Compose, sin `latest`.
- La integración usa solo endpoints que son iguales en todos los motores (sesiones, QR, `check-exists`, `sendText`). Si GOWS diera problemas con el chip, pasar a NOWEB es cambiar la imagen y `WHATSAPP_DEFAULT_ENGINE`.
- Alternativa descartada: WEBJS, el motor por defecto. Levanta un Chromium entero (cientos de MB) para mandar unos pocos mensajes por día.
- **Los estados `PASSKEY_*` propios de GOWS** se muestran como `desvinculado`, con el detalle de que hay que confirmar en el celular.

### Cliente de WAHA detrás de una interfaz
- `modules/whatsapp/cliente.ts` define `ClienteWhatsapp`, con estas operaciones: `estado()`, `iniciar()`, `reiniciar()`, `desvincular()`, `qr()`, `verificarNumero(numero)` y `enviarTexto(chatId, texto)`.
- La implementación `clienteWaha(url, apiKey)` usa `fetch` con un timeout de 10 s, sin dependencias nuevas.
- `crearApp` recibe `whatsapp?: ClienteWhatsapp`. Sin él (no hay `WAHA_URL`), el estado es `no_configurado` y el envío no arranca.
- Los tests inyectan un cliente falso con estado y respuestas programables.
- **Estados de WAHA traducidos a los del spec:**

  | WAHA | Spec |
  |---|---|
  | `WORKING` | `conectado` |
  | `SCAN_QR_CODE` | `esperando_qr` |
  | `STARTING` | `esperando_qr` |
  | `STOPPED`, `FAILED`, `PASSKEY_*` o sesión inexistente | `desvinculado` |
  | Error de red o timeout | `no_disponible` |

  `STARTING` se muestra como `esperando_qr` porque, para el admin, en los dos casos está "preparando el QR".
- **Errores al enviar:** se distinguen dos tipos, porque los avisos cuentan intentos según la diferencia.
  - **No disponible:** red, timeout o sesión que no está `WORKING`. No cuenta como intento.
  - **Rechazo:** WAHA responde 4xx o 5xx con la sesión conectada. Cuenta como intento.

### Número de destino: tabla de una fila
- Modelo `ConfiguracionWhatsapp` (`configuracion_whatsapp`) con estos campos: `id` (siempre `1`), `numero` (10 dígitos), `chatId` (el que devuelve WAHA, que puede ser `@c.us` o `@lid`), `actualizadoEn` y `actualizadoPorId`.
- Se envía siempre al `chatId` guardado, sin rearmarlo desde el número.
- **Normalización:**
  1. Quitar todo lo que no sea dígito.
  2. Quitar un `54` inicial, después un `9` inicial y después un `0` inicial.
  3. Exigir exactamente 10 dígitos.

  Un número con 15 queda con 12 dígitos y se rechaza con el código `NUMERO_CON_15`. Detectar y quitar el 15 automáticamente es ambiguo porque el código de área tiene 2 a 4 dígitos, así que se le pide a quien carga el número.
- **Validación con WhatsApp:** `check-exists` con `549` + los 10 dígitos. Sin sesión conectada se responde `409 WHATSAPP_NO_CONECTADO`; si el número no existe, `422 NUMERO_SIN_WHATSAPP`.
- Alternativa descartada: una tabla genérica de configuración clave-valor. Pierde los tipos y las relaciones para un solo dato; si la Etapa 4 necesita más ajustes, se ve en ese momento.
- Alternativa descartada: guardar el número en una variable de entorno. Obligaría al dueño a pedir un cambio por SSH.
- El campo `destino = "admin"` de `Notificacion` no cambia: el número real se resuelve al enviar. Si el admin cambia el número, los pendientes van al número nuevo.

### Rutas de la API (solo admin)
- `GET /api/whatsapp`: devuelve `{ estado, cuenta?: { numero }, destino?: { numero }, pendientes }`, donde `pendientes` es la cantidad de avisos pendientes. El cartel del panel usa esta misma ruta.
- `POST /api/whatsapp/vincular`:
  - Si el estado es `conectado`, no hace nada.
  - Si está `FAILED` o `STOPPED`, reinicia la sesión.
  - En cualquier otro caso, la inicia; si no existe, la crea.
- `GET /api/whatsapp/qr`: devuelve `{ imagen: "data:image/png;base64,..." }`, o `409` si el estado no es `esperando_qr`.
- `POST /api/whatsapp/desvincular`: hace logout de la sesión.
- `PUT /api/whatsapp/destino`: recibe `{ numero }`, lo normaliza, lo verifica con WhatsApp y lo guarda.
- `POST /api/whatsapp/prueba`: envía un texto fijo directo, sin pasar por `notificaciones`, y responde `204` o un error con el motivo.
- `POST /api/notificaciones/:id/reintentar`: con `UPDATE ... WHERE id = $1 AND estado = 'error'`, pone `pendiente`, `intentos = 0`, `proximoIntentoEn = null` y `error = null`. Si no actualiza nada, responde `409 AVISO_NO_REINTENTABLE`, o `404` si el aviso no existe.
- Todas se suman al test de rutas protegidas.

### Proceso de envío: cola sobre `notificaciones`
- **`Notificacion` suma dos campos:** `intentos Int @default(0)` y `proximoIntentoEn DateTime?`. También un índice `(estado, creadaEn)`.
- `modules/whatsapp/envio.ts` exporta `procesarPendientes({ prisma, whatsapp, ahora, pausa })`, que hace una pasada completa:
  1. Si no hay cliente, no hay destino o `estado()` no es `conectado`, termina sin tocar nada.
  2. Busca los avisos `pendiente` con `proximoIntentoEn` nulo o vencido, ordenados por `creadaEn` y `id`.
  3. Los envía de a uno, con `pausa` (3 s) entre cada envío:
     - **Si sale bien:** `enviada`, con `enviadaEn = ahora()` y `error = null`.
     - **Si WhatsApp no está disponible:** corta la pasada sin tocar el aviso.
     - **Si hay rechazo:** suma 1 a `intentos` y guarda el motivo en `error`, sin detalles internos de WAHA. Con menos de 5 intentos, fija `proximoIntentoEn` según la espera (30 s, 2 min, 10 min y 30 min) y sigue con el siguiente aviso. Al llegar a 5, pasa a `error`.
- **`iniciarEnvio(...)`** corre `procesarPendientes` cada 15 s con `setTimeout` encadenado: nunca hay dos pasadas a la vez, aunque una tarde más que el intervalo. Devuelve `detener()`, que se llama en `onClose` de la app. El intervalo arranca solo desde `server.ts`, nunca en los tests.
- **Por qué hacer polling y no enviar en el mismo pedido que crea el aviso:** el aviso se crea dentro de la transacción de la venta o del cierre, y llamar a WAHA ahí la haría depender de un servicio externo. Con el polling, una caída de WAHA nunca demora el mostrador. Una demora de hasta 15 s cumple con "dentro del minuto".
- **Por qué no se usa una cola dedicada (pg-boss o BullMQ):** hay una sola instancia de la app y unos pocos mensajes por día. La tabla ya guarda el estado y el historial que pide el spec. No hace falta `SKIP LOCKED` porque hay un solo proceso y la pasada nunca se superpone.
- **Orden:** dentro de cada pasada, del más viejo al más nuevo. Un aviso en espera de reintento no frena a los siguientes. En la práctica casi no pasa: con la sesión conectada, las fallas suelen afectar a todos los avisos por igual (por ejemplo, un número dado de baja).

### Pantalla de WhatsApp y cartel
- **`/admin/whatsapp` (`admin/Whatsapp.tsx`):**
  - **Estado:** con React Query, cada 3 s mientras está en `esperando_qr` y cada 30 s el resto del tiempo.
  - **QR:** se pide de nuevo cada 15 s mientras se espera, para no mostrar uno vencido. Si la sesión cae a `desvinculado` mientras se esperaba, se muestra **Generar QR nuevo**, que llama a `vincular`.
  - **Número:** un campo con el formato de ejemplo (`11 2345-6789`, "sin 0 ni 15"), **Guardar** y **Mandar prueba**.
  - **Desvincular:** pide confirmación.
  - Pensada para el celular: el dueño puede vincular desde la PC del kiosco con el celular del chip en la mano.
- **El cartel en `PanelAdmin`** usa `GET /api/whatsapp`. Se muestra si el estado no es `conectado` o falta el destino, con la cantidad de pendientes y un link a la pantalla. Si el estado es `no_configurado` no se muestra: es desarrollo o un error de instalación, y ese caso lo cubre el runbook.
- **`Avisos.tsx`:**
  - Muestra la fecha de envío y, en los de `error`, el motivo y el botón **Reintentar**.
  - Se cambia el texto que dice "el envío por WhatsApp se suma más adelante".
  - `notificacionSchema` suma `intentos`.

### Infraestructura
- **Producción (`infra/docker-compose.prod.yml`):** se suma el servicio `waha`.
  - Imagen GOWS fijada, `restart: unless-stopped`, los mismos logs con límite y la misma zona horaria.
  - Volumen `waha-sesiones:/app/.sessions`.
  - Variables: `WHATSAPP_DEFAULT_ENGINE=GOWS`, `WAHA_API_KEY`, `WAHA_DASHBOARD_ENABLED=false` y `WHATSAPP_SWAGGER_ENABLED=false`.
  - Sin `ports`.
  - La `app` recibe `WAHA_URL=http://waha:3000` y la misma `WAHA_API_KEY`, y **no** tiene `depends_on: waha`: si WAHA no levanta, la app y el deploy siguen funcionando.
- **`infra/.env.example`** suma `WAHA_API_KEY` (generada con `openssl rand -hex 24`).
- **Desarrollo (`infra/docker-compose.dev.yml`):** `waha` con el perfil `whatsapp`, así `pnpm db:up` no lo descarga. Se publica en `127.0.0.1:${WAHA_PORT:-3200}` y el dashboard queda activado para depurar.
  - Scripts nuevos: `pnpm whatsapp:up` y `pnpm whatsapp:down`.
  - `apps/api/.env.example` suma `WAHA_URL` y `WAHA_API_KEY` comentadas.
- **`cargarConfig`:** `WAHA_URL` (URL) y `WAHA_API_KEY` son opcionales, pero si está una tiene que estar la otra. Si falta una sola, la app no arranca y nombra la variable faltante.
- **Backups:** la sesión de WAHA no se respalda. Si se pierde, se vuelve a escanear el QR, que es más simple que restaurar archivos de sesión.

## Risks / Trade-offs

- **[WhatsApp bloquea el número por usar una API no oficial]** → Se usa un chip dedicado, se envían pocos mensajes y siempre al mismo contacto, con pausa entre envíos, y el chip no inicia conversaciones con desconocidos. Conviene que el dueño agende el número del chip y le escriba una vez antes de usarlo.
- **[El celular del chip pasa más de ~14 días sin internet y la sesión se desvincula]** → El cartel en el panel y la re-vinculación por QR la resuelven en un minuto. Va en el runbook: dejar el celular del chip cargando y con Wi-Fi.
- **[Duplicados]** Si WAHA envía pero la respuesta no llega (timeout) o falla el `UPDATE` posterior, el aviso se reintenta y llega dos veces. → Se acepta: un aviso repetido es mejor que uno perdido, y el texto trae fecha y hora.
- **[Cambios en la API de WAHA entre versiones]** → La imagen queda fijada y solo se actualiza a mano. El cliente está aislado en un solo archivo.
- **[El `chatId` cambia]** Un `@lid` puede no ser estable si el destino cambia de número. → Pasa a `error` y se corrige volviendo a guardar el número, lo que actualiza el `chatId`.
- **[QR visible para cualquier admin]** Quien escanea el QR con su celular toma la sesión. → El QR solo lo ven los admins, y vincular un número distinto al del chip no da acceso a nada más que a enviar los avisos.

## Migration Plan

1. Migración `envio_whatsapp`: columnas `intentos` (default 0) y `proximo_intento_en` en `notificaciones`, el índice y la tabla `configuracion_whatsapp`. No afecta los datos existentes.
2. En producción no hay avisos previos, porque el sistema todavía no se instaló. En desarrollo, los pendientes viejos se enviarían al vincular el chip: se pueden marcar como `enviada` a mano antes de vincular.
3. El primer deploy con WAHA necesita `WAHA_API_KEY` en `infra/.env`. Después se vincula desde **Administración → WhatsApp**.
4. **Vuelta atrás:** `deploy.sh` a la versión anterior. Las columnas nuevas no molestan al código viejo, y el servicio `waha` se puede detener sin afectar al resto.
