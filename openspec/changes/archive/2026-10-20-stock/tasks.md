# Tasks

> Este cambio requiere que `productos-y-proveedores` esté implementado y archivado antes de empezar.

## 1. Modelo de datos y esquemas

- [x] 1.1 Agregar a `schema.prisma` los enums `TipoMovimiento` y `MotivoAjuste` y los modelos `MovimientoStock`, `IngresoMercaderia` e `ItemIngreso` según `design.md`, y generar la migración `stock`; verificar con `pnpm db:migrate` que se crean las tablas e índices
- [x] 1.2 Agregar en `packages/shared` los esquemas Zod de ajuste (nota obligatoria si el motivo es `otro`), conteo, ventas sin sistema, ingreso (1 a 200 ítems, cantidad de 1 a 100.000, costo opcional) y movimiento; verificar con tests unitarios de cada regla

## 2. Movimientos en la API

- [x] 2.1 Implementar `registrarMovimiento(tx, ...)` con incremento atómico, `stockResultante` desde el `UPDATE` y error `PRODUCTO_NO_ENCONTRADO` para productos inexistentes o desactivados; verificar con tests de integración el escenario "Movimiento y stock coinciden", el de "Stock negativo permitido" y dos movimientos simultáneos (`Promise.all`) que dejan el stock y los resultantes consistentes
- [x] 2.2 Agregar la ayuda de test que compara `stockActual` con la suma de movimientos y usarla en los tests de este cambio; verificar que falla si se modifica `stockActual` sin movimiento

## 3. Ajustes, conteo y ventas sin sistema

- [x] 3.1 Implementar `POST /api/stock/ajustes` (solo admin) y `GET /api/stock/productos/:id/movimientos`; verificar con tests los escenarios de "Ajustes de stock", "Movimientos inmutables" (no existen rutas de edición ni borrado) e "Historial de movimientos"
- [x] 3.2 Implementar `POST /api/stock/conteos` con bloqueo de la fila y ajuste por diferencia; verificar con tests los escenarios de "Conteo rápido"
- [x] 3.3 Implementar `POST /api/stock/ventas-sin-sistema` en una transacción; verificar con tests los escenarios de "Ventas hechas sin sistema", incluido que un producto inválido no deja cambios parciales

## 4. Ingreso de mercadería en la API

- [x] 4.1 Implementar `POST /api/stock/ingresos` (admin y empleado; agrupa repetidos; `400 COSTO_NO_PERMITIDO` si un empleado manda costos; actualiza el costo y crea `CambioPrecio` solo si el admin lo cambió); verificar con tests todos los escenarios de "Registro de un ingreso de mercadería" y "Costo opcional y precargado para el admin"
- [x] 4.2 Implementar `GET /api/stock/ingresos` y `GET /api/stock/ingresos/:id` (solo admin); verificar con tests el escenario de "Consulta de ingresos"
- [x] 4.3 Agregar las rutas nuevas al test de rutas protegidas y verificar `401` sin sesión, `403` del empleado en las rutas de admin y que el empleado sí puede registrar ingresos

## 5. Web

- [x] 5.1 Crear `/stock/ingreso` (campo de escaneo siempre enfocado, suma 1 al repetir, búsqueda por nombre con flechas y Enter, aviso de código inexistente sin perder la lista, costo precargado solo para el admin, `Ctrl+Enter` para confirmar, aviso al salir con cambios) y agregarla al menú de admin y empleado; verificar con tests de Testing Library el escaneo repetido, el código inexistente, que el empleado no ve la columna de costo y la confirmación
- [x] 5.2 Crear `/admin/stock` (buscar producto, ajustar con motivo, contar, ver movimientos) y `/admin/stock/ventas-sin-sistema`; verificar con tests el ajuste con motivo `otro` sin nota, el resultado del conteo y la carga de ventas sin sistema
- [x] 5.3 Crear `/admin/stock/ingresos` (lista y detalle); verificar con un test que el detalle muestra productos, cantidades, costos y quién lo cargó
- [x] 5.4 Verificar en el navegador con la base de desarrollo: como empleado, cargar un ingreso escaneando con el teclado (sin ver costos); como admin, cargar otro ingreso cambiando un costo y ver el historial de precios; hacer un ajuste, un conteo y una carga de ventas sin sistema; revisar los movimientos y las pantallas de admin en ancho de celular (375 px)

## 6. Documentación

- [x] 6.1 Actualizar `docs/requisitos-y-limites.md` (ingreso cargado por admin o empleado, costo opcional y solo visible para el admin, motivos de ajuste, conteo, movimientos inmutables) y `docs/estructura-proyecto.md` (modelo de `MovimientoStock`, `IngresoMercaderia` e `ItemIngreso`); verificar que coinciden con las specs del cambio

## Workflow follow-up

- Archivar el cambio con `/opsx:archive` cuando la CI esté en verde.
- Proponer el último cambio de la Etapa 1: `venta-pos`, que reutiliza `registrarMovimiento` con tipos `venta` y `anulacion`.
