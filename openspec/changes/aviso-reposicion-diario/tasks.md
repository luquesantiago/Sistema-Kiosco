# Tasks

## 1. Tests de valor límite (antes del código)

Se escriben primero, a partir de los escenarios de `specs/reposicion` y `specs/notificaciones`, con los valores exactos del borde. Al terminar este grupo tienen que **compilar y fallar** (las funciones todavía no existen o están vacías); no se toca código de `src/`.

- [x] 1.1 Crear `apps/api/test/reposicion-calculo.test.ts` con tests de la función pura de armado y de `calcularReposicion` contra la base de test, que cubran:
  - Umbral: mínimo 5, máximo 20 con stock 6 (no entra), 5 (sugerido 15), 4 (sugerido 16) y −3 (sugerido 23); producto desactivado con stock 0.
  - Mínimo y máximo 0: stock 0 y −2 no entran; mínimo 0 y máximo 10 con stock 1 (no), 0 (sugerido 10) y −1 (sugerido 11).
  - Sugerido 0: mínimo = máximo = 5 con stock 5 (no aparece), 4 (sugerido 1) y 6 (no entra).
  - Agrupación: dos proveedores, sin proveedor, proveedor desactivado → "Sin proveedor", proveedor que toma pedido hoy sin faltantes no aparece.
  - Orden: los que toman pedido hoy primero, el resto por nombre, "Sin proveedor" al final, productos sin distinguir mayúsculas ni acentos, proveedor sin días de pedido nunca es "hoy".
  - Cambio de día: `2026-11-11T02:59:59Z` es martes y `2026-11-11T03:00:00Z` es miércoles para un proveedor que toma pedido los martes.
  - Pedido por llegar: marca con un pedido, la fecha más cercana con dos, pedido atrasado, sin marca si llegó, está cargado o cancelado.

  Verificar que `pnpm --filter api test reposicion-calculo` compila y falla por falta de implementación.
- [x] 1.2 Crear `apps/api/test/reposicion-aviso.test.ts` comparando el texto completo del aviso, como los tests de los otros avisos: día con faltantes (detalle de los que piden hoy, cantidad del resto, "Sin proveedor" con detalle al final), "1 producto" en singular, marca de pedido por llegar en los dos formatos, día sin faltantes ("Hoy no hay nada para reponer") y "Stock a las 12:00" / "Stock a las 15:20". Verificar que compila y falla.
- [x] 1.3 Crear `apps/api/test/aviso-reposicion-job.test.ts` contra la base de test, llamando a `generarAvisoDelDia` con el reloj fijo:
  - Hora: `2026-11-10T14:59:59Z` → `fuera_de_horario` sin aviso; `15:00:00Z` y `15:00:01Z` → `generado` con "Stock a las 12:00".
  - Recuperación: `21:59:59Z` → `generado`; `22:00:00Z` → `fuera_de_horario`; el 11/11 a las `12:00:00Z` (09:00 de Argentina) no genera ni el del 10/11 ni el del 11/11, y a las `15:00:00Z` genera el del 11/11.
  - Un solo aviso: segunda pasada a `15:01:00Z` y a `21:59:59Z` → `ya_generado`; pasadas a `2026-11-11T02:59:59Z` y `03:00:00Z` no generan; dos llamadas en paralelo (`Promise.all`) dejan un solo aviso y ninguna rechaza.
  - El aviso queda `pendiente`, tipo `reposicion`, destino `admin`, con `creadaEn` igual al reloj, y su fila en `ejecuciones_tarea`.
  - Sin WhatsApp: se genera sin cliente de WAHA y sin número de destino.

  Verificar que compila y falla.
- [x] 1.4 Tests de "Solo el aviso de reposición más reciente" y "Avisos reemplazados":
  - En `aviso-reposicion-job.test.ts`, al generar el aviso del 10/11: con 0 avisos `reposicion` pendientes anteriores no cambia nada más; con 1 (09/11) pasa a `reemplazada`; con 3 (07/11, 08/11, 09/11) pasan los tres; uno `pendiente` con 2 intentos y `proximoIntentoEn` pasa a `reemplazada` sin `proximoIntentoEn`; uno `enviada` y uno en `error` no cambian; una anulación `pendiente` no cambia; una segunda pasada `ya_generado` no cambia ningún estado; en las dos llamadas en paralelo de 1.3 los anteriores quedan `reemplazada` una sola vez y solo hay un `pendiente` de reposición.
  - En `whatsapp-envio.test.ts`, "Tres días sin WhatsApp": con el cliente falso desvinculado se generan los avisos del 07/11 al 10/11; al conectarlo, el número recibe solo el del 10/11 y la anulación pendiente.
  - En `whatsapp.test.ts`, que `GET /api/whatsapp` cuenta 1 pendiente con 1 `pendiente` y 3 `reemplazada`; en el test del reintento, que reintentar un `reemplazada` responde `409` y no lo cambia.
  - En `apps/web/test/` (Avisos), que un aviso `reemplazada` se muestra con "No enviado" y la aclaración, sin **Reintentar**.

  Verificar que compilan y fallan solo porque `reposicion`, `reemplazada` y la tarea todavía no existen.
- [x] 1.5 Crear `apps/api/test/ciclo.test.ts` para `iniciarCiclo`: la primera pasada corre al arrancar, dos pasadas nunca se superponen, un error en la pasada no corta el ciclo y `detener()` espera la pasada en curso. Verificar que compila y falla.

## 2. Modelo de datos y tipo de aviso

- [x] 2.1 Agregar `reposicion` al enum `TipoNotificacion`, `reemplazada` al enum `EstadoNotificacion` y el modelo `EjecucionTarea` (`ejecuciones_tarea`: `tarea`, `fecha` `@db.Date`, `ejecutadaEn`, `notificacionId` único y nullable con FK) con `@@unique([tarea, fecha])` en `schema.prisma`. Generar la migración `aviso_reposicion`. Verificar con `pnpm db:migrate` que se crean los dos valores y la tabla, y que los tests existentes siguen pasando.
- [x] 2.2 Agregar `'reposicion'` al final de `TIPOS_NOTIFICACION` y `'reemplazada'` al final de `ESTADOS_NOTIFICACION` en `packages/shared/src/ventas.ts`. Verificar que pasan los tests de 1.4 de `whatsapp.test.ts` (contador y `409` del reintento) sin tocar `envio.ts`, la ruta de reintento ni `servicio.ts` de WhatsApp; `pnpm typecheck` va a marcar `Avisos.tsx` hasta la tarea 6.1.

## 3. Cálculo de reposición

- [x] 3.1 Implementar en `apps/api/src/modules/reposicion/servicio.ts` la función pura de armado (filtro, mínimo y máximo 0, sugerido ≤ 0, grupos, "Sin proveedor", orden y marca) y `calcularReposicion(prisma, ahora)` con las dos consultas (productos activos con `stockActual <= stockMinimo` y pedidos `por_llegar` por proveedor). Verificar que pasan todos los tests de 1.1.

## 4. Texto del aviso

- [x] 4.1 Agregar a `apps/api/src/lib/formato.ts` el formato "jueves 12/11" para una fecha "AAAA-MM-DD" (sin correrse de día) y implementar `textoAvisoReposicion` en `apps/api/src/modules/reposicion/aviso.ts`. Verificar que pasan todos los tests de 1.2.

## 5. Tarea diaria

- [x] 5.1 Implementar `apps/api/src/jobs/ciclo.ts` (`iniciarCiclo` con `setTimeout` encadenado y `detener()`). Verificar que pasan los tests de 1.5.
- [x] 5.2 Implementar `apps/api/src/jobs/aviso-reposicion.ts`: `generarAvisoDelDia({ prisma, ahora })` con la ventana `[12:00, 19:00)` de Argentina a partir de `rangoDelDiaEnArgentina`, la lectura previa de `ejecuciones_tarea`, la transacción (reemplazo de los `reposicion` pendientes, aviso nuevo y ejecución) y el `P2002` como `ya_generado`; e `iniciarAvisoReposicion` con `iniciarCiclo` cada 60 s. Verificar que pasan todos los tests de 1.3 y los de la API de 1.4.
- [x] 5.3 Arrancar `iniciarAvisoReposicion` desde `server.ts` siempre (fuera del `if (whatsapp)`) y detenerlo en `onClose`. Verificar con `pnpm dev` sin WAHA que el log muestra la tarea iniciada y que, con el reloj de la máquina entre las 12:00 y las 19:00, aparece el aviso pendiente en **Avisos**; y que ningún test importa `server.ts`.

## 6. Web

- [x] 6.1 Actualizar `apps/web/src/admin/Avisos.tsx`: el párrafo menciona el aviso de reposición de las 12:00, y el estado `reemplazada` tiene su entrada en `ESTADO` (insignia gris "No enviado") y la línea "Hubo un aviso de reposición más nuevo; se mandó ese.", sin **Reintentar**. Verificar con el test de Avisos de 1.4, que el texto del párrafo aparece y que un aviso `reposicion` pendiente se muestra como los demás.

## 7. Verificación y documentación

- [x] 7.1 Correr `pnpm --filter api test`, `pnpm --filter web test`, `pnpm typecheck` y `pnpm lint` y verificar que todo pasa sin tests salteados.
- [x] 7.2 Actualizar el README (estado de la Etapa 4) y `docs/README.md`; en `docs/requisitos-y-limites.md`, la regla de mínimo y máximo 0, el sugerido 0, el grupo "Sin proveedor" con detalle, la marca de pedido por llegar, la recuperación hasta las 19:00 y que con WhatsApp caído llega solo el último aviso de reposición; en `docs/estructura-proyecto.md`, la carpeta `src/jobs/`, la tabla `ejecuciones_tarea` y el estado `reemplazada`; en `infra/README.md` (runbook), el `UPDATE` de `reemplazada` a `enviada` antes de volver a una versión anterior. Verificar que los docs coinciden con las specs del cambio.
- [ ] 7.3 Con WAHA de desarrollo y el chip, verificar que el aviso llega al número de destino (con el reloj del job adelantado o esperando a las 12:00) y que se lee bien en el celular.

## Workflow follow-up

- Confirmar con el dueño el supuesto que queda en el design ("Stock a las HH:MM" todos los días); si cambia, ajustar el texto y su test.
- Archivar el cambio con `/opsx:archive` cuando la CI esté en verde y la verificación con el chip esté hecha.
