# Design

## Context

- **Ya existe:**
  - `Producto` con `stockActual` (puede ser negativo), `stockMinimo`, `stockMaximo`, `proveedorId` (nullable), `activo` y `nombreBusqueda` (sin acentos, en minúsculas). El alta y la edición ya exigen máximo ≥ mínimo (`packages/shared/src/productos.ts`).
  - `Proveedor` con `diasPedido` y `diasEntrega` (`DiaSemana[]`, pueden estar vacíos) y `activo`.
  - `Pedido` con `estado` (`por_llegar`, `llego`, `cargado`, `cancelado`) y `llegaEl` (`@db.Date`).
  - `Notificacion` como cola de salida y `procesarPendientes` / `iniciarEnvio` en `modules/whatsapp/envio.ts`: cada 15 s, solo si hay cliente de WAHA, destino y sesión conectada. Los avisos pendientes esperan sin gastar intentos.
  - El estado del aviso (`EstadoNotificacion`: `pendiente`, `enviada`, `error`) se lee siempre por valor exacto: el envío toma solo `estado = 'pendiente'`, el reintento manual actualiza solo `estado = 'error'` (si no, `409 AVISO_NO_REINTENTABLE`) y `GET /api/whatsapp` cuenta solo `pendiente`. `Avisos.tsx` tiene un `Record<EstadoNotificacion, ...>` con el texto y el color de cada estado.
  - `lib/fechas.ts`: `diaDeHoyEnArgentina`, `fechaEnArgentina` ("AAAA-MM-DD") y `rangoDelDiaEnArgentina` (UTC−3 fijo). `lib/formato.ts`: `formatearHora`, `formatearFechaHora`.
  - `normalizarParaBusqueda` en `packages/shared/src/busqueda.ts`.
  - Los textos de los avisos viven junto a su módulo (`pedidos/aviso.ts`, `caja/avisos.ts`) y se testean comparando el texto completo.
- **No hay ninguna tarea por horario.** El único proceso periódico es el envío de avisos, y solo arranca si hay WAHA (`server.ts`).
- `Avisos.tsx` no muestra el tipo del aviso: solo hay que actualizar el párrafo que explica qué genera avisos.
- Requisitos en `specs/reposicion` y `specs/notificaciones` de este cambio.

## Goals / Non-Goals

**Goals:**
- Que el admin lea en el celular, en un mensaje, qué pedir hoy y a quién, sin abrir el sistema.
- **Exactamente un aviso por día de Argentina**, garantizado por la base y no por el estado en memoria del proceso.
- Todo testeable sin esperar a las 12:00: reloj inyectado y una función de una pasada.
- Dejar armado el patrón de tareas periódicas (`src/jobs/`) para la Etapa 5.

**Non-Goals:**
- Una pantalla o ruta de reposición (decisión del dueño).
- Hora configurable o varias horas por día.
- Reenviar a mano un aviso de reposición: si falla, se usa **Reintentar** de Avisos, como cualquier otro.

## Decisions

### Módulo `modules/reposicion`: cálculo separado del texto
- **`servicio.ts`** exporta `calcularReposicion(prisma, ahora): Promise<Reposicion>`:
  1. Una consulta de productos activos con `stockActual <= stockMinimo` (comparación entre columnas: `prisma.producto.fields.stockMinimo`), con su proveedor.
  2. Una consulta de pedidos `por_llegar` agrupados por proveedor con el `llegaEl` mínimo.
  3. El resto en memoria, con una función pura `armarReposicion(productos, pedidos, hoy)` que filtra, agrupa y ordena. Los tests de valor límite le pegan a esta función sin base, y a `calcularReposicion` con la base de test para las consultas.
- **Filtro:** `sugerido = stockMaximo − stockActual`; se omite si `stockMinimo === 0 && stockMaximo === 0` o si `sugerido <= 0`. Con máximo ≥ mínimo garantizado, `sugerido <= 0` solo pasa con mínimo = máximo = stock.
- **Grupo de un producto:** su proveedor si existe y está activo; si no, "Sin proveedor".
- **Orden:** clave `[tomaPedidoHoy ? 0 : 1, normalizarParaBusqueda(nombre), id]` para los proveedores; el grupo "Sin proveedor" se agrega al final. Productos por `nombreBusqueda` y después `id`, para que el orden sea estable.
- **"Hoy"** es `diaDeHoyEnArgentina(ahora)`; un proveedor con `diasPedido` vacío nunca toma pedido hoy.
- **Forma del resultado** (tipo interno de la API, no va a `shared` porque no hay ruta):
  ```
  Reposicion { fecha: "AAAA-MM-DD", calculadaEn: Date, grupos: Grupo[] }
  Grupo { proveedor: { id, nombre } | null, tomaPedidoHoy, pedidoPorLlegarEl: "AAAA-MM-DD" | null,
          productos: { id, nombre, stockActual, sugerido }[] }
  ```
- Alternativa descartada: hacer todo en SQL (`GROUP BY` con orden por día). Es poco volumen (cientos de productos) y en memoria se testea mucho más fácil.

### Texto del aviso: `modules/reposicion/aviso.ts`
- `textoAvisoReposicion(reposicion): string`, pura. Formato propuesto (negritas de WhatsApp con `*`, como los otros avisos):
  ```
  *Reposición - martes 10/11*
  Stock a las 12:00

  *Coca-Cola* (pide hoy)
  _Ya hay un pedido por llegar el jueves 12/11_
  - Coca 500 ml: 24
  - Sprite 500 ml: 12

  *Otros proveedores*
  - Arcor: 5 productos (pedido por llegar el jueves 12/11)
  - Pepsi: 1 producto

  *Sin proveedor*
  - Hielo: 10
  ```
  Día sin faltantes: las dos primeras líneas y "Hoy no hay nada para reponer".
- El día de la marca se escribe como "jueves 12/11" (día de la semana + `dd/mm`), con una función nueva en `lib/formato.ts` que recibe "AAAA-MM-DD". La fecha de `llegaEl` es una fecha sin hora: se formatea en UTC para que no se corra un día.
- "Stock a las HH:MM" usa `formatearHora(calculadaEn)`: a las 12:00 dice 12:00 y en la recuperación dice la hora real.

### Tareas periódicas: `src/jobs/`
- **Carpeta nueva `apps/api/src/jobs/`** para todo lo que corre solo por horario o intervalo, separado de los módulos (que siguen siendo los dueños de la lógica de negocio). La Etapa 5 (ARCA y Mercado Pago) va a sumar las suyas acá.
- **`jobs/ciclo.ts`** exporta `iniciarCiclo({ nombre, pasada, intervaloMs, log })` → `{ detener(): Promise<void> }`. Es la generalización de `iniciarEnvio`: `setTimeout` encadenado (nunca dos pasadas a la vez), primera pasada al arrancar, errores al log sin cortar el ciclo, y `detener()` que espera la pasada en curso.
  - `iniciarEnvio` **no** se migra en este cambio para no tocar el envío que ya funciona; queda como mejora opcional.
- **`jobs/aviso-reposicion.ts`** exporta:
  - `generarAvisoDelDia({ prisma, ahora }): Promise<'fuera_de_horario' | 'ya_generado' | 'generado'>`, una pasada con el reloj inyectado. Los tests la llaman directo con instantes exactos.
  - `iniciarAvisoReposicion({ prisma, ahora, log })`, que usa `iniciarCiclo` cada 60 s.
- **Ventana horaria sin funciones nuevas de zona:** `fecha = fechaEnArgentina(ahora)`, `desde = rangoDelDiaEnArgentina(fecha).desde`; la ventana es `[desde + 12 h, desde + 19 h)`. Así 15:00:00Z entra, 14:59:59Z no, 21:59:59Z entra y 22:00:00Z no. Las constantes `HORA_AVISO = 12` y `HORA_LIMITE_RECUPERACION = 19` quedan en el archivo.
- **Pasos de `generarAvisoDelDia`:**
  1. Fuera de la ventana → `fuera_de_horario`.
  2. Si ya existe la ejecución `('aviso_reposicion', fecha)` → `ya_generado`. Esta lectura evita calcular cada minuto de la tarde.
  3. `calcularReposicion`, `textoAvisoReposicion` y, en **una transacción**:
     - `updateMany` de los avisos `tipo = 'reposicion'` y `estado = 'pendiente'` a `reemplazada` (con `proximoIntentoEn = null`);
     - crear la `Notificacion` nueva (`tipo: 'reposicion'`, `destino: 'admin'`, `creadaEn: ahora`);
     - crear la fila de ejecución que la referencia.
  4. Si la transacción falla por unicidad (Prisma `P2002` sobre `(tarea, fecha)`) → `ya_generado`; la transacción entera se deshace, así que no queda un aviso huérfano ni avisos reemplazados de más.
- **Arranque en `server.ts`:** se inicia **siempre**, fuera del `if (whatsapp)`, y se detiene en `onClose`. Sin WAHA el aviso queda pendiente y se ve en Avisos. Los tests no importan `server.ts`, así que nunca arranca en ellos.
- **Por qué cada 60 s y no un temporizador "hasta las 12:00":** sobrevive a reinicios, a cambios de hora del servidor y a suspensiones sin lógica extra, y la recuperación sale gratis. El costo es una lectura por índice único por minuto.
- Alternativa descartada: `node-cron` u otra dependencia. Para una tarea diaria con recuperación hay que guardar igual en la base qué día se hizo; la dependencia no ahorra eso.
- Alternativa descartada: cron del sistema operativo o un contenedor aparte. Suma infraestructura y otro lugar donde puede fallar.

### Un aviso por día: tabla `ejecuciones_tarea`
```
EjecucionTarea (ejecuciones_tarea)
  id             uuid
  tarea          String          -- "aviso_reposicion"; la Etapa 5 suma las suyas
  fecha          Date            -- día de Argentina
  ejecutadaEn    Timestamptz
  notificacionId uuid? @unique   -- FK a notificaciones
  @@unique([tarea, fecha])
```
- La restricción única hace el trabajo: dos pasadas a la vez, un reinicio o dos procesos (por un deploy que se superpone) no pueden crear dos avisos del mismo día.
- `tarea` es texto y no un enum para que la Etapa 5 sume tareas sin `ALTER TYPE` y sin chocar en la migración.
- Alternativa descartada: una columna `fecha` en `notificaciones` con único parcial por tipo. Mezcla con la cola un dato que solo sirve para las tareas, y un índice parcial no se expresa en `schema.prisma` (habría que escribirlo a mano en SQL).
- Alternativa descartada: buscar si ya hay una `Notificacion` `reposicion` creada hoy. No es atómico: dos pasadas a la vez generan dos avisos.

### Solo el último aviso de reposición: estado `reemplazada`
- El dueño decidió que, si WhatsApp estuvo caído varios días, al volver llegue solo el aviso de reposición más reciente.
- **Cómo:** valor nuevo `reemplazada` en `EstadoNotificacion`. Al generar el aviso del día, en la misma transacción, los `reposicion` que siguen `pendiente` pasan a `reemplazada` (paso 3 de `generarAvisoDelDia`). Así nunca hay más de un aviso de reposición pendiente, y no se borra historial.
- **Qué no cambia en el código existente**, porque todo filtra por valor exacto:
  - `procesarPendientes` solo toma `pendiente`: los `reemplazada` no se envían sin tocar `envio.ts`.
  - El reintento manual solo acepta `error`: un `reemplazada` responde `409` sin tocar la ruta.
  - El contador de pendientes de `GET /api/whatsapp` no los cuenta.
- **Qué sí cambia:** `ESTADOS_NOTIFICACION` en `packages/shared/src/ventas.ts` y `Avisos.tsx`, que por el `Record<EstadoNotificacion, ...>` no compila sin la entrada nueva: insignia gris "No enviado" y la línea "Hubo un aviso de reposición más nuevo; se mandó ese." en lugar de los datos de envío, sin **Reintentar**.
- **Los avisos en `error` no se tocan:** el admin ya vio que fallaron y puede reintentarlos a mano si quiere. **Los `enviada` tampoco**, ni los de otros tipos.
- **Por qué al generar y no al enviar:** la regla queda en un solo lugar, dentro de la transacción que ya garantiza un aviso por día, y el envío sigue sin saber de tipos de aviso.
- Alternativas descartadas:
  - Filtrar en `procesarPendientes` (mandar solo el `reposicion` más nuevo). No necesita migración, pero los viejos quedarían `pendiente` para siempre: inflan el cartel de pendientes y el envío pasa a conocer reglas de un tipo de aviso.
  - Pasarlos a `enviada` o a `error` con un motivo. `enviada` falsea el historial; `error` muestra **Reintentar**, que los volvería a mandar.
  - Borrarlos: el spec prohíbe borrar avisos.

### Tipo de aviso `reposicion`
- `ALTER TYPE "TipoNotificacion" ADD VALUE 'reposicion'` en la migración, `'reposicion'` en `TIPOS_NOTIFICACION` (`packages/shared/src/ventas.ts`).
- `Avisos.tsx`: el párrafo suma "y todos los días a las 12:00, lo que hay que reponer".

### Archivos compartidos con la Etapa 5 (en paralelo)
La Etapa 5 (ARCA + Mercado Pago) seguramente sume tareas periódicas, tipos de aviso y migraciones. Puntos de choque y cómo evitarlos:

| Archivo | Qué toca este cambio | Recomendación para la Etapa 5 |
|---|---|---|
| `apps/api/prisma/schema.prisma` | Valor `reposicion` en `TipoNotificacion`, modelo `EjecucionTarea` | Sumar sus valores al final del enum; reutilizar `EjecucionTarea` con su propio `tarea` |
| `apps/api/prisma/migrations/` | Una migración `aviso_reposicion` | Si se mezclan, regenerar la migración de la rama que llega segunda para que quede con fecha posterior |
| `apps/api/src/server.ts` | Bloque de arranque de la tarea, fuera del `if (whatsapp)` | Un bloque por tarea con `iniciarCiclo`, cada uno con su `onClose` |
| `TipoNotificacion` (Prisma y `packages/shared/src/ventas.ts`) | `reposicion` | Agregar al final, en los dos lugares a la vez |
| `EstadoNotificacion` (Prisma, `ESTADOS_NOTIFICACION` y `Avisos.tsx`) | `reemplazada` | Si suma estados, filtrar siempre por valor exacto y agregar su entrada en `Avisos.tsx` |
| `apps/api/src/config.ts` | No se toca: la hora es fija | Sus variables nuevas, opcionales como las de WAHA |
| `apps/api/src/jobs/` | Crea `ciclo.ts` y `aviso-reposicion.ts` | Un archivo por tarea, usando `ciclo.ts` |
| `apps/web/src/admin/Avisos.tsx` | Párrafo explicativo | Mismo párrafo: conviene mergear este cambio primero |

Conviene mergear este cambio a `main` antes que los de la Etapa 5, porque crea `src/jobs/` y `ejecuciones_tarea`.

## Risks / Trade-offs

- **[El servidor tiene la hora mal]** El aviso sale a otra hora. → El servidor usa NTP; la hora se calcula en UTC con desfase fijo, sin depender de la zona del sistema.
- **[Un deploy que dura de 11:59 a 12:01 con dos instancias]** → La restricción única evita el duplicado; la primera que llega lo genera.
- **[El aviso se genera pero WhatsApp lo manda dos veces]** → Igual que los demás avisos (ver `envio-whatsapp`): se acepta, el texto trae la fecha.
- **[Mensaje muy largo]** Con muchos faltantes en proveedores de hoy. → WhatsApp acepta varios miles de caracteres; con cientos de productos sobra. Si algún día pasa, se ve en el uso real.
- **[Argentina vuelve a tener horario de verano]** → Igual que el resto del sistema: `lib/fechas.ts` es el único lugar a cambiar.
- **[El envío manda un aviso viejo justo mientras se reemplaza]** `procesarPendientes` leyó el aviso del día anterior antes de la transacción y lo envía después. → Llega igual (como mucho, uno de más) y el `update` del envío lo deja `enviada`, que es lo que pasó. Solo puede ocurrir en el minuto de las 12:00 con WhatsApp volviendo justo; se acepta.
- **[Stock negativo por ventas sin stock cargado]** El sugerido supera al máximo (mínimo 5, máximo 20, stock −3 → 23). → Es correcto: hace falta reponer lo vendido de más; el dueño lo ve y decide.

## Migration Plan

1. Migración `aviso_reposicion`: `ALTER TYPE "TipoNotificacion" ADD VALUE 'reposicion'`, `ALTER TYPE "EstadoNotificacion" ADD VALUE 'reemplazada'` y la tabla `ejecuciones_tarea` con su único `(tarea, fecha)` y la FK a `notificaciones`. No toca datos.
2. Primer deploy: si sale entre las 12:00 y las 19:00, el aviso de ese día se genera al arrancar (es lo que pide la recuperación). Si se prefiere que no, desplegar fuera de ese horario.
3. Vuelta atrás: `deploy.sh` a la versión anterior. La tabla y los valores de enum nuevos no molestan al código viejo, salvo que ya haya avisos `reemplazada`: la versión anterior valida la respuesta de `GET /api/notificaciones` con un enum sin ese valor y la lista de **Avisos** fallaría. En ese caso, antes de volver atrás: `UPDATE notificaciones SET estado = 'enviada' WHERE estado = 'reemplazada'` (queda anotado en el runbook). Los valores de enum no se pueden sacar sin recrear el tipo, como en `pedidos-proveedor`.

## Open Questions

Decisiones del dueño del 2026-11-10, ya volcadas en los specs: al volver WhatsApp se manda solo el último aviso de reposición (estado `reemplazada`); los renglones con sugerido 0 o menos no aparecen; el grupo "Sin proveedor" va siempre con detalle.

Queda un supuesto menor, que no cambia la estructura ni las tareas:

1. **"Stock a las HH:MM" también a las 12:00.** La línea va siempre, no solo en la recuperación, para que el mensaje tenga todos los días el mismo formato. Si el dueño prefiere que vaya solo cuando el aviso sale tarde, se ajusta el texto y su test.
