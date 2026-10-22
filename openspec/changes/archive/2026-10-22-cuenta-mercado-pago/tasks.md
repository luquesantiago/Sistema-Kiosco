# Tasks

## 1. Modelo de datos y schemas compartidos

- [x] 1.1 En `schema.prisma`, agregar el enum `Cuenta { efectivo mercado_pago }`, `MovimientoCaja.cuenta Cuenta @default(efectivo)` y volver nullable `MovimientoCaja.turnoId`. Generar la migración `cuenta_mercado_pago` y correr `prisma generate`. Verificar con `pnpm db:migrate` que los movimientos existentes quedan en `efectivo` y que los tests existentes de la API siguen pasando.
- [x] 1.2 En `packages/shared/src/caja.ts`:
  - Exportar `CUENTAS`, `cuentaSchema` y `NOMBRE_CUENTA` (`Efectivo`, `Mercado Pago`).
  - Sumar `cuenta` opcional con default `efectivo` a las dos ramas de `movimientoCajaEntradaSchema`.
  - Sumar `cuenta` y `turnoId` (nullable) a `movimientoCajaSchema`.
  - Renombrar `efectivoAnulado` a `devoluciones` en `ResumenCaja`.
  - Agregar el schema de query del listado de MP.
  - Hacer que `nombreMovimientoCaja` agregue " · Mercado Pago" cuando corresponda.

  Verificar con tests unitarios: sin cuenta da `efectivo`, una cuenta desconocida se rechaza, y el nombre de un gasto de MP es `Gasto · Insumos · Mercado Pago`.

## 2. API

- [x] 2.1 En `registrarMovimientoCaja`:
  - `403` para un retiro de MP de un empleado.
  - Turno opcional para el admin con MP (`turnoAbiertoBloqueado`).
  - Guardar `cuenta`.

  Verificar con tests de integración los escenarios de "Cuenta de cada movimiento" y los nuevos de "Quién opera en el turno abierto": el admin sin turno registra un gasto de MP sin turno, el empleado sin turno recibe `409`, el retiro de MP del empleado recibe `403` y un movimiento sin cuenta queda en efectivo.
- [x] 2.2 En `resumenDeCaja`, sumar solo los movimientos en efectivo y calcular `devoluciones` con el total de las ventas anuladas en el turno. Actualizar `Turnos`, el texto del cierre ("Devoluciones de anulaciones") y los tests que usan `efectivoAnulado`. Verificar con tests de integración los escenarios de "Efectivo esperado" y "Devolución de una anulación en la caja": gasto de MP que no toca el esperado, venta con débito anulada en el mismo turno y anulación de un pago mixto de un turno anterior.
- [x] 2.3 Implementar `GET /api/caja/movimientos-mp` (solo admin, rango en hora de Argentina, página de 50, del más reciente al más antiguo) y sumarlo al test de rutas protegidas. Verificar con tests de integración los escenarios de "Movimientos de Mercado Pago para el admin": solo cuenta MP, con y sin turno, rango de fechas, `400` si `desde > hasta` y `403` al empleado.
- [x] 2.4 Sumar la cuenta al texto del aviso de gasto (`*Gasto de Mercado Pago · Insumos: …*`). Verificar con tests el escenario "Gasto del empleado con Mercado Pago" y que el gasto en efectivo sigue saliendo como `*Gasto de caja · …*`.

## 3. Web

- [x] 3.1 En F8 (`pos/Caja.tsx`), agregar "Sale de: [Efectivo] [Mercado Pago]", con Efectivo preseleccionado: en los gastos para todos, y en los tres tipos para el admin. Mandar `cuenta`. Verificar con tests de componente que el empleado ve el selector en gastos y no en retiros, que el admin lo ve en retiros, y que se envía `cuenta: 'mercado_pago'`. Verificar también que el e2e del mostrador sigue pasando sin tocar la cuenta.
- [x] 3.2 En `admin/Turnos.tsx`, renombrar la línea a "Devoluciones de anulaciones" y mostrar la cuenta en los movimientos (vía `nombreMovimientoCaja`). Verificar con el test de componente del detalle de turno.
- [x] 3.3 Crear `admin/MercadoPago.tsx` en `/admin/mercado-pago`:
  - Formulario con tipo, categoría si es gasto, monto y motivo; la cuenta es siempre MP.
  - Lista con fechas (por defecto, desde el 1 del mes hasta hoy) y "Ver más".
  - Tarjeta en `PanelAdmin` y ruta solo para el admin.

  Verificar con tests de componente (registrar un gasto de MP, filtrar por fechas, el empleado no entra) y en el navegador, a ancho de celular, con el admin de verificación.

## 4. Documentación y cierre

- [x] 4.1 Actualizar `docs/requisitos-y-limites.md` (dos cuentas, gastos y retiros de MP, devolución siempre en efectivo por el total, saldo de MP en la Etapa 5 visible también para el empleado) y `docs/estructura-proyecto.md` (campos de `MovimientoCaja`). Verificar releyendo que coinciden con las specs de este cambio.
- [x] 4.2 Correr `pnpm lint`, `pnpm typecheck`, `pnpm test` (web con `--no-file-parallelism` si hay timeouts por carga) y el e2e, y verificar que todo pasa.

## Workflow follow-up

- Archivar el cambio cuando la CI esté en verde en `etapa-3`.
- Siguiente cambio de la Etapa 3: `pedidos-proveedor`, que reutiliza `Cuenta` para el pago de cada pedido.
