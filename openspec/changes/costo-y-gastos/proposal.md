# Proposal

## Why

El dashboard de la Etapa 3 tiene que mostrar la ganancia y el resultado del período, y hoy faltan dos datos para calcularlos. Los ítems vendidos no guardan el costo: `Producto.costo` cambia con cada ingreso o aumento, así que después no se puede saber a qué costo se vendió. Y los gastos de caja son texto libre, sin forma de separar servicios de insumos. Conviene agregarlos ahora, antes de que el sistema se use en el kiosco, para que todas las ventas reales tengan su costo desde el primer día.

## What Changes

- Cada ítem de una venta guarda una **copia fija del costo unitario** del producto en el momento de vender (`Producto.costo`). No cambia aunque después cambie el costo del producto. Queda vacío si el producto no tiene costo o si es el ítem "Varios". Las ventas viejas sin costo no se completan después.
- El detalle de una venta muestra el costo de cada ítem **solo al admin**. El empleado sigue sin ver costos, ni en el POS ni en el listado.
- Los **gastos** de caja llevan una **categoría fija**: Servicios, Insumos u Otro. El admin no puede editar la lista. Es obligatoria en los gastos y no existe en retiros ni ingresos. El motivo sigue siendo texto libre y obligatorio.
- En la pantalla de movimientos de caja (F8), la categoría se elige con **botones** cuando el tipo es gasto.
- La categoría aparece en el **aviso de WhatsApp** del gasto y en los listados de movimientos (caja del mostrador y Turnos del admin).
- Migración: los gastos ya registrados, que son solo de desarrollo, quedan como "Otro".

Fuera de alcance (siguientes cambios de la Etapa 3):
- `cuenta-mercado-pago`: la segunda caja y desde qué caja sale cada gasto.
- `pedidos-proveedor`: los pagos a proveedor dejan de ser gastos. Por eso no hay categoría "Proveedor".
- `dashboard`: el cálculo de la ganancia, solo sobre los ítems que tienen costo.

## Capabilities

### New Capabilities

(ninguna)

### Modified Capabilities

- `ventas`: cada ítem guarda el costo unitario del momento de la venta, y el detalle muestra ese costo solo al admin.
- `caja`: los gastos llevan una categoría obligatoria (Servicios, Insumos u Otro).
- `notificaciones`: el aviso de un gasto incluye la categoría.

## Impact

- **Base de datos:** una migración que agrega `items_venta.costo_unitario` (nullable), el enum `CategoriaGasto` y `movimientos_caja.categoria` (nullable, con los gastos existentes en `otro`).
- **API:** `modules/ventas/servicio.ts` (copiar el costo al vender, exponerlo en el detalle según el rol) y `modules/caja` (validar y guardar la categoría, texto del aviso).
- **Compartido:** `packages/shared/src/ventas.ts` (costo opcional en el detalle) y `caja.ts` (categorías, entrada y salida de movimientos).
- **Web:** `pos/Caja.tsx` (botones de categoría y listado), `admin/Turnos.tsx` (listado) y `ventas/Ventas.tsx` (costo en el detalle del admin).
- **Tests:** `ventas.test.ts`, `caja.test.ts` y los tests de avisos.
- Sin dependencias nuevas.
