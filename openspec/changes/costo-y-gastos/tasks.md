# Tasks

## 1. Modelo de datos y schemas compartidos

- [x] 1.1 Agregar a `schema.prisma` `ItemVenta.costoUnitario Decimal? @db.Decimal(12, 2)`, el enum `CategoriaGasto { servicios insumos otro }` y `MovimientoCaja.categoria CategoriaGasto?`. Generar la migración `costo_y_gastos` y sumarle a mano `UPDATE movimientos_caja SET categoria = 'otro' WHERE tipo = 'gasto'`. Verificar con `pnpm db:migrate` sobre la base de desarrollo que los gastos existentes quedan en `otro` y los retiros e ingresos en `NULL`, y que los tests existentes siguen pasando.
- [x] 1.2 En `packages/shared/src/caja.ts`:
  - Exportar `CATEGORIAS_GASTO`, `categoriaGastoSchema` y `NOMBRE_CATEGORIA_GASTO`.
  - Convertir `movimientoCajaEntradaSchema` en una unión discriminada por `tipo` (`gasto` exige `categoria`; `retiro` e `ingreso` no la aceptan).
  - Sumar `categoria` (nullable) a `movimientoCajaSchema`.

  Verificar con tests unitarios del schema: un gasto sin categoría, un gasto con `proveedor` y un retiro con categoría se rechazan; un gasto con `insumos` y un retiro sin categoría se aceptan.
- [x] 1.3 En `packages/shared/src/ventas.ts`, sumar `costoUnitario: montoSalidaSchema.nullable().optional()` a los ítems de `ventaDetalleSchema`. Verificar con `pnpm typecheck` en todo el monorepo.

## 2. Costo en las ventas (API)

- [x] 2.1 En `registrarVenta`, sumar `costo` al `select` de productos y guardar `costoUnitario` en cada ítem de catálogo (`null` en "Varios" y en productos sin costo). Verificar con tests de integración en `ventas.test.ts` los escenarios de "Costo de cada ítem vendido": producto con costo, costo que cambia después con un ingreso de mercadería, producto sin costo que después recibe costo, e ítem "Varios".
- [x] 2.2 Hacer que `aDetalle` reciba `{ conCostos }` y pasarlo según el rol del usuario de la sesión en registrar, obtener y anular. Verificar con tests de integración los escenarios de "Listado de ventas según el rol": el admin recibe `costoUnitario` (con valor o `null`) en los tres endpoints, y en las respuestas al empleado la clave `costoUnitario` no aparece.

## 3. Categoría de los gastos (API)

- [x] 3.1 Guardar `categoria` en `registrarMovimientoCaja` y devolverla en `GET /api/caja/movimientos` y en el detalle de turnos del admin. Actualizar los tests de `caja.test.ts` que registran gastos para que manden categoría. Verificar con tests de integración los escenarios de "Movimientos de caja" y "Categoría de los gastos": gasto con categoría guardada y listada, `400` sin categoría, `400` con `proveedor` y `400` en un retiro con categoría.
- [x] 3.2 Sumar `categoria` a `DatosAvisoMovimiento` y al texto de `textoAvisoMovimiento` (`*Gasto de caja · Insumos: $8.000*`), y pasarla desde el servicio. Verificar con tests los escenarios de "Aviso por gasto o retiro del empleado": el gasto incluye la categoría y el retiro sale sin categoría.

## 4. Web

- [x] 4.1 En el diálogo F8 (`pos/Caja.tsx`):
  - Mostrar la fila de categorías (Servicios / Insumos / Otro) solo cuando el tipo es gasto: un grupo de radios con aspecto de botón, sin categoría preseleccionada.
  - Pedir que se elija una antes de registrar.
  - Cambiar el placeholder del motivo.
  - Mostrar la categoría en "Movimientos del turno" (`Gasto · Insumos: Hielo`).

  Actualizar el e2e `mostrador.spec.ts` para que elija la categoría con el teclado (Tab + flechas). Verificar que el e2e pasa y que un registro sin categoría muestra el aviso en el diálogo.
- [x] 4.2 En `admin/Turnos.tsx`, mostrar la categoría de cada gasto en la lista de movimientos del turno. Verificar en el navegador con un turno de desarrollo que tenga un gasto de Insumos y un retiro.
- [x] 4.3 En el detalle de venta de `ventas/Ventas.tsx`, mostrar al admin una columna "Costo" por ítem (vacía o "—" sin costo). El empleado no la ve. Verificar en el navegador con una sesión de admin y una de empleado sobre la misma venta.

## 5. Documentación y cierre

- [x] 5.1 Actualizar `docs/estructura-proyecto.md` (campos de `ItemVenta` y `MovimientoCaja`) y `docs/requisitos-y-limites.md` (costo guardado en cada venta; categorías de gasto en lugar del ejemplo "pago a un proveedor"). Verificar releyendo que coinciden con las specs de este cambio.
- [x] 5.2 Correr `pnpm lint`, `pnpm typecheck`, `pnpm test` y el e2e completos, y verificar que todo pasa.

## Workflow follow-up

- Archivar el cambio cuando la CI esté en verde en la rama `etapa-3`.
- Siguiente cambio de la Etapa 3: `cuenta-mercado-pago`.
