# Proposal

## Why

Hoy el sistema sabe el stock de cada producto, su mínimo y su máximo, el proveedor y qué días toma pedidos, pero el dueño tiene que recorrer la lista para saber qué pedir. La Etapa 4 cierra ese hueco con lo que pidió desde el principio (`requisitos-y-limites.md`, Reposición, Fase A): **un WhatsApp todos los días a las 12:00** con lo que hay que reponer, que lee desde el celular sin entrar al sistema. El envío por WhatsApp (Etapa 2) y los pedidos a proveedor (Etapa 3) ya están, así que el aviso se apoya en los dos.

## What Changes

- **Cálculo de reposición (Fase A):**
  - Un producto activo entra si su stock actual es menor o igual al mínimo. La cantidad sugerida es máximo − stock actual.
  - Un producto con mínimo 0 y máximo 0 significa "no reponer nunca" y no aparece. Con mínimo 0 y máximo mayor que 0, entra al llegar a 0 o menos.
  - Los renglones con sugerido 0 o menos no aparecen.
  - Agrupado por proveedor: primero los que toman pedido hoy, después el resto por nombre, y al final un grupo **Sin proveedor** con los productos sin proveedor o con el proveedor desactivado. Los productos, por nombre.
  - Si el proveedor ya tiene un pedido por llegar, sus productos se muestran igual, con la marca "Ya hay un pedido por llegar el <día>".
- **Aviso diario por WhatsApp**, un solo mensaje por día, al número de **Administración → WhatsApp**:
  - Productos y cantidades completos de los proveedores que toman pedido hoy (y del grupo Sin proveedor); del resto, el nombre del proveedor y cuántos productos le faltan.
  - El mensaje dice la fecha y "Stock a las HH:MM".
  - Un día sin faltantes llega igual un mensaje corto: "Hoy no hay nada para reponer".
- **Hora:** todos los días a las 12:00 de Argentina. Si el sistema estaba apagado a esa hora, se genera al volver, siempre que sea el mismo día y antes de las 19:00. Nunca más de un aviso por día, ni siquiera si dos pasadas coinciden.
- **Sin WhatsApp configurado o caído**, el aviso se genera igual y queda pendiente en **Avisos**, como los demás; sale cuando WhatsApp vuelve.
- **Solo el aviso de reposición más reciente:** al generarse el del día, los avisos de reposición anteriores que sigan pendientes pasan a un estado nuevo, `reemplazada`, que no se envía. Si WhatsApp estuvo caído varios días, al volver llega solo el último. No se borra nada: en **Avisos** se ven con una aclaración. Los enviados o en error no cambian.
- **Tipo de aviso nuevo `reposicion`**, que se ve en **Avisos** como el resto.

Fuera de alcance:
- Una pantalla de reposición o un endpoint para consultarla: el dueño eligió "solo WhatsApp". El empleado no ve nada de esto.
- La Fase B (sugerencia según ventas diarias y días hasta la entrega).
- Configurar la hora del aviso o el horario de recuperación desde el panel.
- Crear el pedido al proveedor desde el aviso.

## Capabilities

### New Capabilities
- `reposicion`: qué productos hay que reponer y cuánto, cómo se agrupan y ordenan por proveedor, y el aviso diario de las 12:00 (texto, hora, recuperación y uno solo por día).

### Modified Capabilities
- `notificaciones`: suma el aviso diario de reposición como tipo de aviso y el estado `reemplazada` para los avisos de reposición anteriores que quedaron sin enviar: no se envían, no cuentan como pendientes, no se reintentan y se ven en Avisos con su aclaración. El envío y los reintentos de los demás avisos no cambian.

## Impact

- **Base de datos:**
  - Valor `reposicion` en el enum `TipoNotificacion` y valor `reemplazada` en `EstadoNotificacion`.
  - Tabla nueva `ejecuciones_tarea` (tarea + fecha de Argentina, única), que garantiza un solo aviso por día y queda para las tareas periódicas de la Etapa 5.
- **API:**
  - Módulo `modules/reposicion` (cálculo y texto del aviso), sin rutas.
  - Carpeta nueva `src/jobs/` con la tarea diaria y un ciclo común, arrancada desde `server.ts` aunque no haya WAHA. Nunca arranca en los tests.
  - Sin variables de entorno nuevas: la hora es fija.
- **Compartido:** `reposicion` en `TIPOS_NOTIFICACION` y `reemplazada` en `ESTADOS_NOTIFICACION` (`packages/shared/src/ventas.ts`).
- **Web:** `admin/Avisos.tsx`: el texto explicativo y cómo se muestra un aviso `reemplazada`.
- **Docs:** README, `docs/README.md`, `docs/requisitos-y-limites.md` (reglas de mínimo 0 y recuperación) y `docs/estructura-proyecto.md` (`src/jobs/`).
- **Etapa 5 en paralelo:** comparte `schema.prisma`, `TipoNotificacion`, `EstadoNotificacion`, `server.ts` y `config.ts`; ver design.
