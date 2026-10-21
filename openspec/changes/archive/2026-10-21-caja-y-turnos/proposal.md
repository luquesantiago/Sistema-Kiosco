# Proposal

## Why

El kiosco va a empezar a delegar el mostrador en empleados, y hoy el sistema no sabe cuánta plata tiene que haber en el cajón ni quién es responsable de cada diferencia. La Etapa 2 es la primera que se usa en el kiosco real, así que la caja por turno tiene que estar lista antes de la puesta en marcha.

## What Changes

- **Turnos de caja** con una sola caja: hay como máximo un turno abierto a la vez, y toda venta (también las del admin) cae en él.
- **Apertura** con el monto inicial precargado con lo que quedó en la caja al cerrar el turno anterior. Quien abre puede corregirlo con lo que contó, y la diferencia de apertura queda registrada.
- **Cierre ciego:** quien cierra cuenta el efectivo sin ver el esperado. El sistema calcula el esperado y la diferencia, que ve solo el admin. Al cerrar se puede registrar un retiro, y lo que queda en la caja pasa a ser el monto sugerido del turno siguiente.
- **Turno olvidado:** si alguien se fue sin cerrar, el siguiente cierra ese turno contando la caja. Queda registrado quién lo abrió y quién lo cerró.
- **Movimientos de caja** con monto y motivo obligatorio: el empleado registra gastos y retiros, y el admin además puede registrar ingresos (por ejemplo, lo cobrado durante un corte de luz). Los movimientos no se editan ni se borran.
- **Avisos al admin:** cada gasto o retiro del empleado y cada cierre de turno, con el resumen de ventas por medio, movimientos, esperado, contado y diferencia, generan un aviso pendiente (el envío por WhatsApp llega con el cambio `envio-whatsapp`).
- **Ventas y turno (BREAKING):** registrar una venta exige un turno abierto, y la venta queda asociada a él. El empleado pasa a poder anular solo las ventas del turno abierto, ya no las del día. La devolución en efectivo de una anulación se descuenta del turno abierto al momento de anular.
- **Mostrador:** el POS pide abrir el turno antes de vender, ofrece cerrarlo, y si encuentra abierto el turno de otro empleado le pide que lo cierre antes de abrir el suyo.
- **Pantallas de admin**, usables desde el celular: lista de turnos con sus diferencias y el detalle de cada uno.

Fuera de alcance: pedidos a proveedor (por ahora el pago al proveedor se registra como gasto), el dashboard (Etapa 3), el envío por WhatsApp y la puesta en marcha (cambios aparte de la Etapa 2), y la aplicación de los horarios de 7 a 13 y de 13 a 19 (son una referencia, el sistema no los impone).

## Capabilities

### New Capabilities
- `caja`: turnos de caja (apertura, cierre ciego, esperado y diferencia, turno olvidado) y movimientos de caja (gastos, retiros e ingresos) con sus permisos por rol.

### Modified Capabilities
- `ventas`: una venta exige un turno abierto y queda asociada a él; el empleado anula solo las ventas del turno abierto; la anulación registra en qué turno se devolvió el efectivo.
- `notificaciones`: nuevos tipos de aviso (gasto, retiro y cierre de turno) con su texto.
- `punto-de-venta`: el mostrador exige y gestiona el turno abierto (abrir, cerrar, cerrar el turno de otro) y da acceso a los movimientos de caja.

## Impact

- **Base de datos:** nuevos modelos `Turno` y `MovimientoCaja`; `Venta` suma el turno de la venta y el turno de la anulación; `TipoNotificacion` suma tres valores. Las ventas de desarrollo existentes quedan sin turno, porque la Etapa 1 no se usó en producción.
- **API:** nuevo módulo `caja` (`/api/caja/...`); cambian `registrarVenta` y `anularVenta` en `modules/ventas`.
- **Shared:** esquemas y tipos de turno y movimientos, y nuevos códigos de error.
- **Web:** apertura y cierre en el POS, pantalla de movimientos de caja, y lista y detalle de turnos en el panel de admin.
- **Tests:** tests de API de caja, ajustes en los de ventas (ahora necesitan un turno abierto) y en el e2e del mostrador.
- **Docs:** actualizar el modelo de datos y los requisitos de caja en `docs/`.
