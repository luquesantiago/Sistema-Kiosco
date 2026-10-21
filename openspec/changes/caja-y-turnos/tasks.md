# Tasks

## 1. Modelo de datos y utilidades compartidas

- [x] 1.1 Agregar a `schema.prisma` el modelo `Turno`, el enum `TipoMovimientoCaja`, el modelo `MovimientoCaja`, `turnoId` y `anulacionTurnoId` opcionales en `Venta`, y los valores `gasto_caja`, `retiro_caja` y `cierre_turno` en `TipoNotificacion`. Generar la migración `caja` y agregarle a mano el índice único parcial `turnos_un_solo_abierto`, con un comentario en el schema. Verificar con `pnpm db:migrate` que se crean las tablas y el índice (`\d turnos`).
- [x] 1.2 Agregar a `packages/shared` los esquemas Zod de apertura, cierre (motivo obligatorio si hay retiro, retiro no mayor que lo contado), movimiento de caja (tipo, monto mayor que cero, motivo de 3 a 200), estado de la caja, resumen y detalle de turno (con `esperado` y `diferencia` opcionales), y los códigos `SIN_TURNO_ABIERTO`, `TURNO_DE_OTRO`, `TURNO_YA_ABIERTO` y `TURNO_YA_CERRADO`. Verificar con tests unitarios de los esquemas.
- [x] 1.3 Mover `formatearPesos` y el formato de fecha y hora de `modules/ventas/aviso.ts` a `src/lib/formato.ts`. Verificar que los tests del aviso de anulación siguen pasando sin cambios.

## 2. Turnos en la API

- [x] 2.1 Implementar en `modules/caja` el helper `turnoParaOperar(tx, usuario)` (`FOR SHARE`, `409 SIN_TURNO_ABIERTO`, `409 TURNO_DE_OTRO` para el empleado) y `resumenDeCaja(tx, turnoId)` con la fórmula del esperado. Verificar con tests de integración los escenarios de "Efectivo esperado", incluido el vuelto que no suma y la anulación en el mismo turno que se compensa.
- [x] 2.2 Implementar `GET /api/caja/estado` y `POST /api/caja/turnos` (sugerido calculado por el servidor, `P2002` → `409 TURNO_YA_ABIERTO`). Verificar con tests los escenarios de "Un solo turno abierto" (incluidas dos aperturas simultáneas), "Apertura con monto sugerido" y "Estado de la caja para quien opera".
- [x] 2.3 Implementar `POST /api/caja/turnos/:id/cerrar` (`FOR UPDATE`, foto del esperado y la diferencia, lo que quedó en caja, `409 TURNO_YA_CERRADO`, respuesta sin esperado ni diferencia para el empleado) junto con el aviso `cierre_turno` en la misma transacción, con su texto en `modules/caja/avisos.ts`. Verificar con tests los escenarios de "Cierre ciego", "Cierre del turno de otro" (incluidos dos cierres simultáneos) y "Resumen del cierre de turno", y con un test unitario del texto.
- [x] 2.4 Implementar `GET` y `POST /api/caja/movimientos` (ingreso solo admin, empleado solo en su turno) con los avisos `gasto_caja` y `retiro_caja` cuando quien registra es empleado. Verificar con tests los escenarios de "Movimientos de caja", "Quién opera en el turno abierto" y "Aviso por gasto o retiro del empleado".
- [x] 2.5 Implementar `GET /api/caja/turnos` y `GET /api/caja/turnos/:id` (solo admin, el detalle con el desglose del esperado, los movimientos y las anulaciones descontadas, en vivo si el turno está abierto). Verificar con tests los escenarios de "Turnos para el admin".
- [x] 2.6 Agregar las rutas de caja al test de rutas protegidas. Verificar `401` sin sesión y `403` del empleado en las rutas de admin.

## 3. Ventas con turno

- [x] 3.1 Hacer que `registrarVenta` llame a `turnoParaOperar` dentro de su transacción y guarde `turnoId`. Agregar un helper de tests para abrir un turno y usarlo en `ventas.test.ts` y en los tests que registran ventas. Verificar con tests los escenarios de "Registro de una venta", incluida la venta sin turno, que no mueve stock, y una venta concurrente con un cierre que, o entra en el esperado, o recibe `409`.
- [x] 3.2 Cambiar `anularVenta`: el empleado anula solo ventas de su turno abierto, el admin lee el turno abierto si lo hay, y se guarda `anulacionTurnoId`. Verificar con tests los escenarios de "Anulación de ventas" y de "Devolución de una anulación en la caja" (venta de ayer anulada con la caja abierta y anulación sin turno).

## 4. Caja en la web

- [x] 4.1 Crear `useEstadoCaja` y el diálogo **Abrir turno** en `/venta` (sugerido seleccionado, Enter confirma) y el aviso del turno de otro empleado con **Cerrar turno de X**. Ante `SIN_TURNO_ABIERTO` o `TURNO_DE_OTRO`, refrescar el estado sin perder el carrito. Verificar con tests de Testing Library los escenarios de "Abrir el turno antes de vender".
- [x] 4.2 Crear el diálogo **Cerrar turno** (contado, retiro y motivo, sin esperado; "Quedan $X en caja" y **Cerrar sesión** con el foco), deshabilitado con el carrito lleno. Verificar con tests los escenarios de "Cerrar el turno desde el mostrador".
- [x] 4.3 Crear el diálogo **Caja** con F8 (gasto, retiro, ingreso solo para el admin, y los movimientos del turno) y sumarlo al pie de atajos. Verificar con tests los escenarios de "Movimientos de caja desde el mostrador" y que el carrito se conserva.
- [x] 4.4 Crear `/admin/turnos` y `/admin/turnos/:id`, responsive y con el esperado desglosado línea por línea, y la entrada en el panel de admin. Verificar con tests que se muestran las diferencias y que un empleado no tiene acceso.

## 5. Pruebas de punta a punta, verificación y documentación

- [x] 5.1 Actualizar el e2e del mostrador para que abra el turno antes de vender, y agregar un flujo de cambio de turno: Ana vende en efectivo, registra un gasto y cierra con retiro; Juan ingresa, abre con el monto sugerido y vende; el admin ve los dos turnos con sus diferencias y los avisos de gasto y de cierre. Verificar que pasa en local y en la CI.
- [x] 5.2 Verificar en el navegador con la base de desarrollo, solo con el teclado: apertura con Enter, una venta en efectivo, F8 gasto, cierre con retiro, ingreso con otro empleado con el turno anterior abierto y cierre en su nombre, y el detalle del turno desde la vista móvil del admin.
- [x] 5.3 Actualizar `docs/requisitos-y-limites.md` (caja: una sola caja, sugerido de apertura, cierre ciego, turno olvidado, permisos de movimientos, avisos; ventas: anulación del empleado limitada al turno) y `docs/estructura-proyecto.md` (modelo de `Turno`, `MovimientoCaja` y `Venta` con turno, y el flujo de turno con el cambio de las 13:00). Verificar que coinciden con las specs del cambio.

## Workflow follow-up

- Archivar el cambio con `/opsx:archive` cuando la CI, incluido el e2e, esté en verde.
- Siguen en la Etapa 2 `puesta-en-marcha` (VPS, Compose de producción, Caddy, deploy y backups) y `envio-whatsapp` (WAHA y envío de los avisos pendientes, también los de caja).
