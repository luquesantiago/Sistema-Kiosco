# Design

## Context

- **Ya existe (Etapa 1):**
  - `Venta`, sin turno. El schema deja anotado que la Etapa 2 suma `turnoId`.
  - `registrarVenta` y `anularVenta` en `apps/api/src/modules/ventas/servicio.ts`, cada una en una transacción.
  - El empleado anula ventas del día, controlado con `esDeHoy`.
  - `Notificacion` con el tipo `anulacion_venta`. El texto se arma en `modules/ventas/aviso.ts`, con `formatearPesos` y la fecha y hora de Argentina.
  - `ErrorHttp` con `CODIGOS_ERROR` en `@kiosco/shared`, el reloj `ahora()`, `requiereSesion` y `requiereRol`.
  - En la web, el POS (`apps/web/src/pos/Venta.tsx`) con atajos F1-F4, F6, F7 y F9, y el panel de admin con rutas bajo `/admin`.
- **Requisitos:** ver `specs/caja`, `specs/ventas`, `specs/notificaciones` y `specs/punto-de-venta`.
- La Etapa 1 no se usó en producción: no hay ventas reales sin turno para migrar.

## Goals / Non-Goals

**Goals:**
- Que una venta nunca quede en un turno cerrado y que un cierre nunca deje afuera una venta en curso, también con pedidos simultáneos.
- Que el esperado de un turno se pueda explicar línea por línea: el detalle del admin y el resumen del aviso muestran cada término.
- Abrir y cerrar el turno solo con el teclado: Enter en la apertura y monto, Tab y Enter en el cierre.

**Non-Goals:**
- Arqueo por denominación de billetes: solo se carga el total contado.
- Cerrar turnos automáticamente por horario.
- Que los gastos se vinculen con proveedores o pedidos: llega con el cambio de pedidos a proveedor.

## Decisions

### Modelo de datos
- **`Turno`** (`turnos`):
  - Apertura: `abiertoPorId` (responsable), `abiertoEn`, `montoSugerido` y `montoInicial` (lo contado al abrir). La diferencia de apertura se calcula y no se guarda.
  - Cierre, todo opcional mientras está abierto: `cerradoPorId`, `cerradoEn`, `montoContado`, `retiroCierre`, `motivoRetiroCierre`, `esperado`, `diferencia` y `quedoEnCaja`.
  - **El esperado y la diferencia se guardan al cerrar**, como foto del cierre. Si después un admin anula una venta de ese turno, la devolución cae en el turno abierto (ver más abajo) y el cierre histórico no cambia.
  - Montos en `Decimal(12,2)`. Índice por `abiertoEn`.
- **`MovimientoCaja`** (`movimientos_caja`): `turnoId`, `tipo` (enum `TipoMovimientoCaja`: `gasto`, `retiro`, `ingreso`), `monto`, `motivo`, `usuarioId` y `creadoEn`. Es inmutable, igual que `MovimientoStock`.
- **El retiro al cierre se guarda en `Turno`, no como `MovimientoCaja`**. Así no altera el esperado, que se calcula antes de retirar, y lo que quedó en caja es simplemente lo contado menos el retiro. Alternativa descartada: guardarlo como movimiento. Obligaría a excluirlo del esperado con un caso especial.
- **`Venta`** suma `turnoId?` y `anulacionTurnoId?`, con índices.
  - `turnoId` queda **nullable en la base** solo por las ventas de desarrollo previas. El servicio siempre lo completa, y el spec exige turno.
  - Alternativa descartada: `NOT NULL` con un turno ficticio para las ventas viejas. Ensucia los datos para resolver algo que solo pasa en desarrollo.
- **`TipoNotificacion`** suma `gasto_caja`, `retiro_caja` y `cierre_turno`.

### Un solo turno abierto: índice único parcial
- Se agrega a mano en la migración generada:
  ```sql
  CREATE UNIQUE INDEX turnos_un_solo_abierto ON turnos ((true)) WHERE cerrado_en IS NULL;
  ```
  Prisma no puede expresar índices parciales, así que se documenta con un comentario en el schema.
- Abrir es un `INSERT`. Si choca con el índice (`P2002`), se responde `409 TURNO_YA_ABIERTO`. Esto resuelve dos aperturas simultáneas sin locks.
- Alternativa descartada: verificar con un `SELECT` antes de insertar. Tiene una carrera entre la verificación y el insert.

### Ventas y cierres concurrentes: lock de la fila del turno
- Un helper `turnoParaOperar(tx, usuario)` en `modules/caja` lee el turno abierto con `SELECT ... WHERE cerrado_en IS NULL FOR SHARE` (`$queryRaw`). Después aplica la regla de quién opera:
  - Si no hay turno: `409 SIN_TURNO_ABIERTO`.
  - Si un empleado intenta operar en el turno de otro: `409 TURNO_DE_OTRO`, con el nombre del responsable.
- Lo llaman `registrarVenta`, `registrarMovimientoCaja` y `anularVenta` dentro de su transacción.
- El cierre toma el turno con `FOR UPDATE`. Así:
  - Espera a que terminen las ventas que ya lo tomaron con `FOR SHARE`.
  - Calcula el esperado con todo eso ya confirmado.
  - Actualiza con `WHERE id = $1 AND cerrado_en IS NULL`.
- Una venta que llega durante el cierre espera el lock, vuelve a evaluar la fila (ya cerrada), no la encuentra y recibe `409 SIN_TURNO_ABIERTO`.
- Alternativa descartada: un lock de aplicación o `SERIALIZABLE`. Son más frágiles y exigen reintentos.

### Cálculo del esperado
- Una función `resumenDeCaja(tx, turnoId)` hace cuatro agregaciones:
  1. La suma de `PagoVenta.monto` con medio `efectivo` de las ventas con `turnoId = T`, **incluidas las que después se anularon**.
  2. La suma de efectivo de las ventas con `anulacionTurnoId = T`.
  3. Las sumas de los movimientos por tipo.
  4. Los totales por medio y la cantidad de ventas, solo para mostrar.
- `esperado = montoInicial + efectivoVendido + ingresos - gastos - retiros - efectivoAnulado`.
- **Por qué contar las ventas anuladas en su turno de origen y restarlas en el turno de la anulación:** cada caja refleja cuándo entró y cuándo salió la plata de verdad.
  - Si la venta se anula en el mismo turno, se compensa sola.
  - Si se anula días después, la devolución sale del cajón de ese momento.
  - Si se anula sin turno abierto, no resta en ninguna caja, porque el admin devuelve de su bolsillo.
- La misma función alimenta el cierre, el detalle del admin (también con el turno abierto, en vivo) y el texto del aviso.

### Anulación
- `esDeHoy` deja de usarse para anular. La regla pasa a ser:
  - El **empleado** obtiene `turnoParaOperar`, que exige que el turno sea suyo, y la venta tiene que cumplir `turnoId = turno.id`. Si no, `403 FUERA_DE_PLAZO` con un mensaje que menciona el turno.
  - El **admin** lee el turno abierto con `FOR SHARE` si lo hay, sin la regla de dueño, y guarda `anulacionTurnoId = turno?.id ?? null`.
- `esDeHoy` se mantiene para listar y ver ventas: el empleado sigue viendo las del día.

### API: `/api/caja`
| Método y ruta | Quién | Qué hace |
|---|---|---|
| `GET /estado` | todos | `{ turnoAbierto: { id, responsable, abiertoEn, esMio } \| null, montoSugerido }` |
| `POST /turnos` | todos | Abre con `{ montoInicial }`. El sugerido lo calcula el servidor. |
| `POST /turnos/:id/cerrar` | todos | `{ montoContado, retiro?, motivoRetiro? }`. Con retiro, el motivo es obligatorio. |
| `GET /movimientos` | todos | Movimientos del turno abierto. El empleado, solo si el turno es suyo. |
| `POST /movimientos` | todos | `{ tipo, monto, motivo }`. Un `ingreso` de un empleado devuelve `403`. |
| `GET /turnos?pagina=` | admin | Lista paginada |
| `GET /turnos/:id` | admin | Detalle con `resumenDeCaja` y la lista de movimientos y anulaciones |

- **El cierre va por id**, no "cerrar el turno abierto". Así nadie cierra sin querer un turno distinto del que estaba mirando.
- **Cierre ciego por rol:** la respuesta del cierre tiene `esperado` y `diferencia` opcionales en el esquema de shared, y el servicio los omite si quien cierra es empleado. Se testea con un test de API que verifica que esas claves no están.
- Nuevos códigos en `CODIGOS_ERROR`: `SIN_TURNO_ABIERTO`, `TURNO_DE_OTRO`, `TURNO_YA_ABIERTO` y `TURNO_YA_CERRADO`.

### Avisos
- `formatearPesos` y el formato de fecha y hora salen de `modules/ventas/aviso.ts` a `src/lib/formato.ts` para compartirlos.
- Los textos de gasto, retiro y cierre se arman en `modules/caja/avisos.ts`, en el mismo estilo que el de anulación: título en negrita y una línea por dato.
- La `Notificacion` se crea dentro de la misma transacción que el movimiento o el cierre.

### Web
- **`useEstadoCaja`** (TanStack Query sobre `GET /api/caja/estado`) decide qué muestra `/venta`:
  - Sin turno: el diálogo **Abrir turno**, con el monto sugerido seleccionado, así que Enter confirma o se escribe otro monto.
  - Turno de otro y quien entra es empleado: el aviso "El turno de Ana está abierto" con el botón **Cerrar turno de Ana**, que abre el mismo diálogo de cierre.
  - Turno propio, o quien entra es admin: el POS de siempre.
- **Diálogo Cerrar turno:**
  - Pide el efectivo contado, el retiro (opcional) y el motivo del retiro (obligatorio si hay retiro).
  - Al confirmar muestra "Quedan $X en caja" y el botón **Cerrar sesión** con el foco.
  - El botón para abrir el diálogo está deshabilitado con productos en el carrito.
- **Atajo F8 "Caja":** abre gasto o retiro (más ingreso para el admin) y la lista de movimientos del turno. Se suma a la referencia de atajos. El carrito ya persiste, así que no se toca.
- Si una venta o un movimiento recibe `SIN_TURNO_ABIERTO` o `TURNO_DE_OTRO`, la pantalla invalida `estado` y vuelve a mostrar el diálogo correspondiente, sin perder el carrito.
- **Admin:** `/admin/turnos` (lista) y `/admin/turnos/:id` (detalle), pensadas primero para el celular. El detalle muestra el esperado como una suma línea por línea. Se suma la entrada en el panel de admin.

## Risks / Trade-offs

- [Si el admin abre el turno a las 7, el empleado que llega tiene que cerrarlo] → Es lo correcto para el control: la plata del turno del admin es responsabilidad del admin. La pantalla lo explica con el nombre del responsable.
- [El empleado cierra el turno pero no la sesión, y el siguiente vende con la sesión del anterior] → Después del cierre, el foco queda en **Cerrar sesión**. Además, el siguiente no puede vender sin abrir un turno, y el turno nuevo queda a nombre de quien tenga la sesión, así que el error se ve en el detalle. Si pasa seguido, se puede cerrar la sesión automáticamente al cerrar el turno propio.
- [El lock `FOR SHARE` serializa cierres contra ventas] → El cierre dura milisegundos y hay un solo mostrador. No hay contención real.
- [Índice parcial fuera del schema de Prisma: un `migrate dev` futuro podría proponer borrarlo] → Prisma no administra índices que no declara, pero se agrega un test que verifica la restricción (dos aperturas → `409`) para detectar si desaparece.
- [Ventas de desarrollo sin turno] → No aparecen en ningún turno ni afectan cálculos. Se puede resetear la base de desarrollo, como ya documenta `infra/`.

## Migration Plan

1. Migración `caja`: enums, tablas, columnas en `ventas`, valores nuevos de `TipoNotificacion` y el índice parcial agregado a mano.
2. Se despliega junto con la puesta en marcha de la Etapa 2. No hay datos de producción previos.
3. Rollback: revertir el deploy. Como el sistema todavía no tiene producción, no hace falta una migración inversa.
