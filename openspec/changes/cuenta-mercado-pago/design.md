# Design

## Context

- **Ya existe:**
  - `MovimientoCaja` con `turnoId` obligatorio, `tipo`, `categoria` (solo gastos), `monto`, `motivo`, `usuarioId` y `creadoEn`.
  - `registrarMovimientoCaja` (`modules/caja/servicio.ts`) busca el turno con `turnoParaOperar`: falla con `409` si no hay turno abierto o si es de otro empleado. Después crea el movimiento y, si es de un empleado, el aviso.
  - `resumenDeCaja` calcula el esperado con:
    - todos los movimientos del turno, agrupados por tipo;
    - `efectivoAnulado`, que suma los pagos **en efectivo** de las ventas anuladas en el turno (`anulacionTurnoId`).
  - El cierre guarda una foto del esperado (`Turno.esperado`), así que los turnos cerrados no cambian si cambia el cálculo.
  - `GET /api/ventas` ya resuelve rangos de fechas en hora de Argentina con página (`listadoVentasQuerySchema`, `rangoDelDiaEnArgentina`, `VENTAS_POR_PAGINA`).
  - El panel de admin (`admin/PanelAdmin.tsx`) es una lista de tarjetas con enlaces.
- Requisitos en `specs/caja` y `specs/notificaciones` de este cambio.

## Goals / Non-Goals

**Goals:**
- Que el esperado del turno cuente solo plata que pasa por el cajón.
- Que el admin pueda anotar desde el celular, sin abrir un turno, lo que sale o entra de la cuenta de MP del kiosco.
- Dejar el concepto de "cuenta" listo para que `pedidos-proveedor` lo reutilice al pagar.

**Non-Goals:**
- Saldo de MP, saldo inicial o ajustes contra la app. Eso es de la Etapa 5, con la API de MP.
- Reportes por cuenta (cambio `dashboard`).
- Separar la plata de MP de las ventas de cada turno: las ventas con tarjeta o MP ya quedan por medio en `PagoVenta`.

## Decisions

### Un enum `Cuenta` en el movimiento, no una tabla de cuentas
- `enum Cuenta { efectivo mercado_pago }` y `MovimientoCaja.cuenta Cuenta @default(efectivo)`. Los movimientos existentes quedan en `efectivo` por el default, sin `UPDATE` a mano.
- Alternativa descartada: un modelo `Cuenta` con filas (y saldo). Hay exactamente dos cuentas fijas y el saldo no se calcula. Un enum es más simple y `pedidos-proveedor` lo puede usar igual (`PagoPedido.cuenta`).
- En la entrada (`movimientoCajaEntradaSchema`), `cuenta` es opcional con default `efectivo` en las dos ramas de la unión. Así siguen andando sin cambios los clientes y tests que no la mandan.

### `turnoId` nullable, solo para el admin con MP
- La columna pasa a ser nullable. En `registrarMovimientoCaja`:
  - **Admin con `mercado_pago`:** usa `turnoAbiertoBloqueado(tx)`, que puede devolver `null`. Si hay turno abierto, el movimiento se asocia a él para que aparezca en ese turno.
  - **Cualquier otro caso:** sigue usando `turnoParaOperar`, con los mismos `409` de hoy.
- Las reglas de rol se validan antes de la transacción, junto al `403` de ingreso que ya existe. El empleado no puede hacer un retiro de MP: `403`.
- Alternativa descartada: crear un "turno fantasma" o exigir siempre un turno. Obligaría al admin a abrir la caja desde la casa para pagar la luz.

### El esperado filtra por cuenta y la devolución es el total de la venta
- En `resumenDeCaja`:
  - El `groupBy` de movimientos suma `cuenta: 'efectivo'` al `where`.
  - La devolución pasa de sumar `pagoVenta` en efectivo a sumar `venta.total` de las ventas con `anulacionTurnoId = turno`.
- El campo `efectivoAnulado` de `ResumenCaja` se renombra a **`devoluciones`**, porque ya no es "el efectivo de la venta" sino lo que se devolvió en efectivo. Se usa en `Turnos.tsx`, en el texto del cierre ("Devoluciones de anulaciones") y en los tests. Al renombrarlo, cualquier uso que quede con el significado viejo falla en tiempo de compilación.
- Una venta en efectivo anulada en el mismo turno sigue dando cero: el esperado suma el pago en efectivo y resta el total. Una venta con débito anulada en el mismo turno resta su total, que es lo que salió del cajón.

### Nombre del movimiento en los listados
- `nombreMovimientoCaja` (shared) suma la cuenta cuando es MP: `Gasto · Insumos · Mercado Pago`. Así F8, Turnos y la pantalla nueva lo muestran igual sin repetir lógica.
- Aviso al admin: el título del gasto pasa a `*Gasto de Mercado Pago · Insumos: $ 6.000,00*` cuando la cuenta es MP. En efectivo sigue `*Gasto de caja · …*`.

### Listado de MP para el admin
- `GET /api/caja/movimientos-mp?desde&hasta&pagina`, solo admin (`requiereRol('admin')`). Reusa `fechaSchema` y `rangoDelDiaEnArgentina`, con el mismo criterio de `listarVentas`: sin fechas, hoy, y `400` si `desde > hasta`. Página de 50.
- La salida suma `turnoId` (nullable) a cada movimiento.

### Pantallas
- **F8:** cuando el tipo es gasto aparece "Sale de: [Efectivo] [Mercado Pago]", con Efectivo preseleccionado porque es lo común en el mostrador. Son radios con aspecto de botón, como las categorías. Para el admin, el selector aparece en los tres tipos. El empleado no lo ve en los retiros.
- **Administración → Mercado Pago (`/admin/mercado-pago`):** pensada para el celular.
  - Formulario con tipo (gasto, retiro o ingreso), categoría si es gasto, monto y motivo. La cuenta es siempre MP.
  - Debajo, la lista con selector de fechas (por defecto, desde el 1 del mes hasta hoy) y "Ver más" para paginar.
  - Tarjeta nueva en `PanelAdmin`.

## Risks / Trade-offs

- [El empleado puede anotar un gasto como "Mercado Pago" por error y así descuadrar menos el cajón] → Le llega un aviso al admin con la cuenta indicada. Cuando la Etapa 5 traiga el saldo real, se va a ver en MP.
- [Una anulación de una venta con tarjeta que en realidad no se devolvió deja un faltante en el cierre] → Es la regla que eligió el usuario (siempre se devuelve en efectivo). El faltante aparece en el cierre y el admin lo ve.
- [Cambia el cálculo del esperado de un turno abierto en el momento del deploy] → No hay turnos reales todavía: el sistema no se usa hasta tener todas las etapas. Los turnos cerrados guardan su foto.

## Migration Plan

1. Migración Prisma `cuenta_mercado_pago`: crea el enum `Cuenta`, agrega `movimientos_caja.cuenta "Cuenta" NOT NULL DEFAULT 'efectivo'` y saca el `NOT NULL` de `movimientos_caja.turno_id`.
2. Para volver atrás: revertir el commit. Si quedaran movimientos sin turno, habría que borrarlos o asignarlos antes de volver a poner el `NOT NULL`. En desarrollo no hay datos que importen.

## Open Questions

- En la Etapa 5: confirmar que la API de Mercado Pago deja leer el saldo de la cuenta del kiosco. Si no, se agrega ahí un ajuste manual. No cambia nada de este cambio.
