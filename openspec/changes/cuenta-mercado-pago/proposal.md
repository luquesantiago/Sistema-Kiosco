# Proposal

## Why

El kiosco maneja plata en dos lugares: el **efectivo** del cajón y la **cuenta de Mercado Pago del kiosco**, donde caen las ventas con débito, crédito (Point), transferencias por alias y MP. Hoy cualquier gasto o retiro se descuenta del efectivo esperado, aunque se haya pagado desde MP, y el admin no puede registrar desde el celular lo que sale de MP, como la plata que pasa a su cuenta personal. El dashboard y los pedidos a proveedor de esta etapa necesitan saber de qué cuenta salió cada peso.

## What Changes

- Cada movimiento de caja indica de qué **cuenta** sale o entra: **Efectivo** o **Mercado Pago**. Si no se indica, es Efectivo. Solo los movimientos en efectivo afectan el efectivo esperado del turno.
- En F8, el **gasto** se puede marcar como pagado con Mercado Pago (admin y empleado). Los retiros e ingresos desde MP los registra **solo el admin**.
- El admin puede registrar movimientos de Mercado Pago **sin un turno abierto**, por ejemplo desde el celular a la noche. Para eso se suma la pantalla **Administración → Mercado Pago**, que permite registrar gastos, retiros e ingresos de MP y lista los de un rango de fechas.
- **Las anulaciones siempre se devuelven en efectivo.** Cuando se anula una venta con un turno abierto, el esperado de ese turno baja por el **total** de la venta, sin importar con qué medio se cobró. Hoy baja solo por la parte en efectivo. **BREAKING** para el cálculo del esperado.
- El aviso de WhatsApp de un gasto del empleado dice si salió de Mercado Pago.
- Los listados de movimientos muestran la cuenta cuando es Mercado Pago.

Fuera de alcance:
- **El saldo de Mercado Pago no se calcula ni se muestra.** Lo va a leer la Etapa 5 desde la API de MP, y ahí también lo va a ver el empleado. Hasta entonces el sistema no se usa en el kiosco.
- Pagos a proveedor (cambio `pedidos-proveedor`, que va a reutilizar la cuenta) y reportes (cambio `dashboard`).

## Capabilities

### New Capabilities

(ninguna)

### Modified Capabilities

- `caja`: los movimientos tienen cuenta (Efectivo o Mercado Pago); los movimientos de MP no afectan el esperado y el admin los registra sin turno; hay un listado de movimientos de MP para el admin; la devolución de una anulación es el total de la venta en efectivo.
- `notificaciones`: el aviso de un gasto indica cuando salió de Mercado Pago.

## Impact

- **Base de datos:** una migración con el enum `Cuenta` (`efectivo`, `mercado_pago`), la columna `movimientos_caja.cuenta` (no nula, por defecto `efectivo`) y `movimientos_caja.turno_id` nullable.
- **API:** `modules/caja/servicio.ts` (registro según cuenta y rol, esperado solo con efectivo, devolución por el total) y `rutas.ts` (`GET /api/caja/movimientos-mp`, solo admin); texto del aviso en `modules/caja/avisos.ts`.
- **Compartido:** `packages/shared/src/caja.ts` (cuenta en la entrada y la salida de movimientos; el campo `efectivoAnulado` del resumen pasa a ser la devolución total).
- **Web:** `pos/Caja.tsx` (selector de cuenta en los gastos), `admin/Turnos.tsx` (nombre de la línea de devoluciones y cuenta en los movimientos) y una pantalla nueva `admin/MercadoPago.tsx` enlazada desde el panel de admin.
- **Docs:** `docs/requisitos-y-limites.md` y `docs/estructura-proyecto.md`.
