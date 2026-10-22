# Tasks

## 1. Modelo de datos, configuración y cliente de WAHA

- [x] 1.1 Agregar a `schema.prisma` `intentos` y `proximoIntentoEn` en `Notificacion`, con el índice `(estado, creadaEn)`, y el modelo `ConfiguracionWhatsapp` (`id` fijo en 1, `numero`, `chatId`, `actualizadoEn`, `actualizadoPorId`). Generar la migración `envio_whatsapp`. Verificar con `pnpm db:migrate` que se crean las columnas y la tabla, y que los tests existentes siguen pasando.
- [x] 1.2 Agregar a `packages/shared`:
  - `intentos` en `notificacionSchema`.
  - Los esquemas del estado de WhatsApp, del destino y del QR.
  - `normalizarNumeroArgentino`.
  - Los códigos `WHATSAPP_NO_CONECTADO`, `NUMERO_CON_15`, `NUMERO_SIN_WHATSAPP` y `AVISO_NO_REINTENTABLE`.

  Verificar con tests unitarios de la normalización: `+54 9 11 2345-6789`, `011 2345 6789`, `5491123456789`, con 15 y con largo inválido.
- [x] 1.3 Sumar `WAHA_URL` y `WAHA_API_KEY` opcionales a `cargarConfig`; si está una, tiene que estar la otra. Verificar con tests de `config.test.ts` que arranca sin ninguna de las dos y que falla nombrando la variable si falta una sola.
- [x] 1.4 Implementar `modules/whatsapp/cliente.ts` con la interfaz `ClienteWhatsapp`, la traducción de estados de WAHA, la diferencia entre "no disponible" y "rechazo", y `clienteWaha(url, apiKey)` con `fetch` y timeout. Crear un cliente falso para los tests en `test/`. Verificar con tests unitarios del cliente contra un servidor HTTP local que simula las respuestas de WAHA: estados, QR en base64, `check-exists`, error de red y timeout.

## 2. Envío de avisos

- [x] 2.1 Implementar `procesarPendientes` en `modules/whatsapp/envio.ts`: orden por `creadaEn`, pausa inyectable, corte sin tocar avisos si WhatsApp no está disponible, reintentos con espera creciente y `error` al quinto intento. Verificar con tests de integración, con el cliente falso y el reloj controlado, los escenarios de:
  - "Envío automático por WhatsApp".
  - "Espera mientras WhatsApp no está disponible", incluido el caso sin número.
  - "Avisos acumulados en orden".
  - "Reintentos de un aviso que falla".
- [x] 2.2 Implementar `iniciarEnvio` con `setTimeout` encadenado y `detener()`, y arrancarlo desde `server.ts` solo si hay cliente, deteniéndolo en `onClose`. Verificar con un test que dos pasadas nunca se superponen y que `detener()` corta el ciclo.
- [x] 2.3 Implementar `POST /api/notificaciones/:id/reintentar` y sumarlo al test de rutas protegidas. Verificar con tests los escenarios de "Reintento manual".

## 3. Conexión con WhatsApp en la API

- [x] 3.1 Implementar `GET /api/whatsapp` (estado, cuenta, destino y cantidad de pendientes) y aceptar `whatsapp?` en `crearApp`. Verificar con tests los escenarios de "Estado de la conexión" y "Sistema sin WhatsApp configurado", incluido que `GET /api/health` responde `200` con WAHA caído.
- [x] 3.2 Implementar `POST /api/whatsapp/vincular`, `GET /api/whatsapp/qr` y `POST /api/whatsapp/desvincular`. Verificar con tests los escenarios de "Vinculación del chip por QR" (con sesión conectada no hace nada, `FAILED` reinicia, QR con `409` fuera de `esperando_qr`) y de "Desvinculación del chip".
- [x] 3.3 Implementar `PUT /api/whatsapp/destino` y `POST /api/whatsapp/prueba`. Verificar con tests los escenarios de "Número que recibe los avisos" y "Mensaje de prueba", incluido que la prueba no crea ningún aviso.
- [x] 3.4 Sumar todas las rutas de `/api/whatsapp` al test de rutas protegidas. Verificar `401` sin sesión y `403` del empleado.

## 4. Web

- [x] 4.1 Crear `/admin/whatsapp`:
  - Estado con refresco, QR renovado mientras se espera y **Generar QR nuevo**.
  - Número con el formato de ejemplo, **Guardar** y **Mandar prueba**.
  - **Desvincular** con confirmación.
  - Entrada en el panel de admin.

  Verificar con tests de Testing Library el paso de `esperando_qr` a `conectado`, los errores `NUMERO_CON_15` y `NUMERO_SIN_WHATSAPP`, la prueba fallida con su motivo y que un empleado no tiene acceso.
- [x] 4.2 Agregar el cartel de WhatsApp en `PanelAdmin`, con la cantidad de avisos pendientes y el link. Verificar con tests los escenarios de "Aviso de WhatsApp sin funcionar", y que con `no_configurado` no se muestra.
- [x] 4.3 Actualizar `Avisos.tsx`: fecha de envío, motivo del error, botón **Reintentar** y el texto de la pantalla. Verificar con tests el escenario "Aviso con error" y que al reintentar el aviso pasa a pendiente.

## 5. Infraestructura y documentación

- [x] 5.1 Sumar `waha` a `infra/docker-compose.dev.yml` con el perfil `whatsapp`, en `127.0.0.1:${WAHA_PORT:-3200}`, con la sesión en un volumen. Agregar los scripts `whatsapp:up` y `whatsapp:down` y las variables comentadas en `apps/api/.env.example`. Verificar con `pnpm whatsapp:up` que WAHA responde con la API key y rechaza sin ella, y que `pnpm db:up` no lo levanta.
- [ ] 5.2 Sumar `waha` a `infra/docker-compose.prod.yml`:
  - Imagen GOWS fijada, sin puertos, dashboard y Swagger desactivados, volumen de sesión, logs y zona horaria.
  - `WAHA_URL` y `WAHA_API_KEY` en la `app`, sin `depends_on`.
  - `WAHA_API_KEY` en `infra/.env.example`.

  Verificar que el job de producción de la CI levanta el Compose, que `/api/health` responde y que desde fuera del Compose no hay puerto de WAHA.
- [x] 5.3 Documentar en `infra/README.md` cómo vincular el chip, qué hacer si se desvincula (celular sin internet más de ~14 días) y cómo cambiar de chip. Actualizar el README (desarrollo con `pnpm whatsapp:up`), `docs/stack-tecnologico.md` (motor GOWS), `docs/estructura-proyecto.md` (modelo y flujo de envío) y `docs/requisitos-y-limites.md` (cerrar la pregunta del chip y describir reintentos y acumulados). Verificar que los docs coinciden con las specs del cambio.

## 6. Verificación con el chip real

- [x] 6.1 Con WAHA de desarrollo y el chip, verificar en el navegador (2026-10-22: vinculación, número, prueba y anulación verificados con el chip; el aviso llegó a los 16 s. La parte de desvincular y acumulados no se probó con el chip por decisión del usuario: la cubren los tests y la prueba contra WAHA real):
  - Vincular por QR desde `/admin/whatsapp` con el celular del chip.
  - Cargar el número del dueño, una vez con 15 para ver el rechazo, y mandar la prueba.
  - Anular una venta y ver que el mensaje llega en menos de un minuto.
  - Desvincular, generar 3 avisos (gasto, retiro y cierre), ver el cartel con 3 pendientes, volver a vincular y ver que llegan los 3 en orden.

## Workflow follow-up

- Archivar el cambio con `/opsx:archive` cuando la CI esté en verde y la verificación con el chip esté hecha.
- Con esto se completa la Etapa 2 de desarrollo. Queda pendiente instalarla en el servidor (tareas 5.3 y 5.4 de `puesta-en-marcha`), que el usuario decidió dejar para cuando el sistema esté terminado.
