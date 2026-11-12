# Proposal

## Why

Hoy el empleado cobra con débito, crédito o Mercado Pago en el Point por su cuenta: tipea el monto en la terminal y después aprieta F2, F3 o F4 en el sistema. Nada garantiza que el monto tipeado sea el de la venta ni que el pago se haya aprobado, y las ventas quedan `pagada` aunque el cobro haya fallado. El dueño decidió que **todo cobro de Mercado Pago pase por el sistema**: el sistema le manda el monto al Point (modo integrado) y la venta se confirma solo cuando Mercado Pago aprueba el pago. Ya no se aceptan transferencias por alias.

## What Changes

- **Cobro con el Point integrado:** con F2 (débito), F3 (crédito) o F4 (Mercado Pago, QR en la pantalla del Point), el sistema crea el cobro en la terminal por el monto exacto; el empleado no tipea nada.
- **Venta en espera:** una venta con una parte cobrada por el Point se registra en estado **`pendiente`** y pasa a **`pagada`** cuando Mercado Pago aprueba el pago. Mientras espera:
  - **no descuenta stock**, no cuenta en la **caja** ni en el **dashboard**;
  - el mostrador muestra una **pantalla de espera** con **Cancelar**, **Reintentar** (si se rechazó o venció) y **Cobrar de otra forma** (vuelve al carrito sin perderlo).
- **Confirmación segura:** el sistema recibe las **notificaciones de Mercado Pago (webhooks) con firma verificada** y además **consulta el estado del cobro cada 3 s** mientras espera (obligatorio, porque hasta tener el servidor no hay HTTPS público). Ante cada aviso consulta el estado real en Mercado Pago antes de confirmar; un aviso repetido no se procesa dos veces.
- **Stock al aprobarse:** el stock se descuenta en el momento de la aprobación. Si el pago se rechaza, vence o se cancela, no hay nada que deshacer.
- **Estado nuevo `cancelada`** para las ventas en espera que no se cobraron (cancelación del empleado o vencimiento a los **10 minutos** del último intento). Conservan su número y se ven en el listado.
- **Pago mixto:** se permite **una sola** parte por el Point más efectivo. Primero se cobra la parte del Point; cuando se aprueba, el mostrador indica cuánto cobrar en efectivo y el vuelto.
- **Pago aprobado después de cancelar:** la venta **no** revive (sigue `cancelada`, sin stock ni factura). Lo cobrado queda como ingreso en la cuenta de Mercado Pago y se le devuelve al cliente **en efectivo desde la caja abierta**, como las anulaciones. El mostrador muestra un aviso que no se puede pasar por alto ("Entró un pago de $X de un cobro cancelado: devolvé $X en efectivo") con **Ya devolví $X** y **El cliente ya se fue**. Al confirmar, se registra la salida de efectivo en el turno (baja el esperado) y le llega un aviso al admin.
- **El turno no se puede cerrar con un cobro en espera ni con una devolución pendiente** (`409`).
- **Mercado Pago caído:** no hay registro manual. Mientras MP no responda solo se cobra en efectivo, y el mostrador lo dice: "Mercado Pago no responde. Por ahora cobrá solo en efectivo (F1) o reintentá en un rato."
- **Corrección de un error latente:** el efectivo esperado de la caja sumaba las ventas del turno sin mirar su estado. Ahora excluye las `pendiente` y `cancelada`; el dashboard ya contaba solo las `pagada` y queda explícito en su spec.
- **Facturación:** en el momento en que la venta queda `pagada`, se llama a `encolarFacturaSiCorresponde` del cambio `facturacion-arca`, que factura solo la parte electrónica (en pago mixto el efectivo se factura aparte si el cliente lo pide). Las ventas en espera o canceladas nunca se facturan, tampoco cuando su cobro se devuelve en efectivo. Este cambio no diseña la facturación.
- Sin Point configurado (desarrollo, antes de tener credenciales), F2, F3 y F4 siguen registrando la venta como hoy.
- **BREAKING:** con el Point configurado, una venta no puede tener dos medios electrónicos (por ejemplo débito y crédito juntos).

Fuera de alcance:
- Reembolsos por la API de Mercado Pago: las anulaciones siguen devolviéndose en efectivo por el total.
- QR dinámico generado por el sistema: la terminal del kiosco es un Point Smart, que muestra el QR.
- Saldo de la cuenta (cambio `saldo-mercado-pago`), facturación (cambio `facturacion-arca`).
- Varias terminales Point.

## Capabilities

### New Capabilities

- `mercado-pago`: este cambio le suma el cobro con la terminal Point, las notificaciones firmadas, la consulta de respaldo y los cobros a revisar. (La capacidad la crea `saldo-mercado-pago` con el saldo; si este cambio se archiva primero, la crea este.)

### Modified Capabilities

- `ventas`: estados `pendiente` y `cancelada`, registro en espera, confirmación al aprobarse, stock al aprobarse, un solo medio electrónico por venta, vencimiento y punto de llamada a la facturación.
- `punto-de-venta`: cobro con F2/F3/F4 por el Point, pantalla de espera, pago mixto con el Point primero y retomar el cobro al recargar.
- `caja`: el esperado excluye las ventas en espera y canceladas; devolución en efectivo de un cobro de una venta cancelada; el turno no se cierra con un cobro en espera ni con una devolución pendiente.
- `dashboard`: ventas, medios de pago y más vendidos excluyen explícitamente las ventas en espera y canceladas.
- `notificaciones`: avisos al admin de un cobro a devolver o a revisar y de cada devolución en efectivo.

## Impact

- **Base de datos:** una migración con `pendiente` y `cancelada` en `EstadoVenta`, `cobro_mp_a_revisar` y `devolucion_cobro_mp` en `TipoNotificacion`, `devolucion_cobro` en `TipoMovimientoCaja`, `movimientos_caja.cobro_mp_id`, columnas nuevas en `ventas` (`pagada_en`, `vence_en`, `cancelada_en`, `motivo_cancelacion`) y las tablas `cobros_mp` y `avisos_mp`.
- **API:**
  - `src/integrations/mercadopago/` (de `saldo-mercado-pago`): operaciones de órdenes Point y verificación de la firma.
  - `modules/ventas/` (registro en espera, confirmación, cancelación y rutas del cobro), `modules/mercadopago/` (webhook y cobros a revisar), `modules/caja/servicio.ts` (esperado y cierre), `src/jobs/cobros-mp.ts` (consulta y vencimiento con `iniciarCiclo` de `aviso-reposicion-diario`).
  - `config.ts` (`MP_TERMINAL_ID`, `MP_WEBHOOK_SECRET`), `app.ts`, `server.ts`.
  - El webhook es la **única ruta nueva sin sesión** (`rutas-protegidas.test.ts`).
- **Compartido:** `ventas.ts` (estados, cobro en la venta), `mercadopago.ts`, `errores.ts`.
- **Web:** `pos/Venta.tsx` y `pos/Dialogos.tsx` (pantalla de espera, pago mixto, aviso de devolución), `pos/Caja.tsx` (cierre con cobro en espera o devolución pendiente), `ventas/Ventas.tsx` (estados nuevos), `admin/MercadoPago.tsx` (cobros a revisar), `admin/Turnos.tsx` (línea "Devoluciones").
- **Integración con `facturacion-arca`:** un único punto de llamada cuando la venta queda `pagada`.
- **Docs:** `docs/requisitos-y-limites.md` (cierra la pregunta "¿QR o Point?", saca las transferencias por alias), `docs/estructura-proyecto.md`, `infra/README.md` y los `.env.example`.
