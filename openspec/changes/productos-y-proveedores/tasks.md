# Tasks

## 1. Modelo de datos y utilidades compartidas

- [ ] 1.1 Agregar a `schema.prisma` los enums `DiaSemana` y `OrigenCambioPrecio` y los modelos `Proveedor`, `Producto` y `CambioPrecio` según `design.md`, y generar la migración `productos_y_proveedores`; verificar con `pnpm db:migrate` que se crean las tablas y que el índice único de `codigo_barras` admite varios `NULL`
- [ ] 1.2 Agregar en `packages/shared` los esquemas Zod de proveedor (alta, edición, listado con `tomaPedidoHoy`), producto (alta, edición, `productoVentaSchema`, `productoAdminSchema`, búsqueda), montos como texto decimal (acepta coma), aumento masivo (porcentaje -50 a 200 distinto de 0, redondeo 1/10/50/100) y la función `normalizarParaBusqueda`; verificar con tests unitarios (acentos, mayúsculas, montos con coma, porcentaje fuera de rango)

## 2. Proveedores en la API

- [ ] 2.1 Implementar el helper `diaDeHoyEnArgentina(ahora)` en `src/lib/fechas.ts`; verificar con tests que el miércoles 22:00 de Argentina (jueves 01:00 UTC) devuelve `miercoles`
- [ ] 2.2 Implementar `GET`/`POST`/`PATCH /api/proveedores` (solo admin, `tomaPedidoHoy`, `productosActivos`, orden con los de hoy primero, `incluirInactivos`); verificar con tests de integración los escenarios de la spec `proveedores`

## 3. Productos en la API

- [ ] 3.1 Implementar `POST`/`PATCH`/`GET /api/productos/:id` (solo admin) con `nombreBusqueda`, código recortado y único (`409 CODIGO_EXISTENTE` indicando el producto), validación de precio, mínimo y máximo, proveedor activo (`400 PROVEEDOR_INACTIVO`), stock actual no editable y registro en `CambioPrecio` cuando cambian precio o costo; verificar con tests los escenarios de "Alta de producto", "Código de barras único", "Edición y desactivación de productos" e "Historial de cambios de precio"
- [ ] 3.2 Implementar `GET /api/productos?q=` (código exacto primero y después nombre normalizado, 50 por página, `incluirInactivos` solo admin, respuesta según el rol) y `GET /api/productos/:id/historial-precios`; verificar con tests los escenarios de "Búsqueda de productos", incluido que la respuesta del empleado no contiene `costo` ni `proveedor`
- [ ] 3.3 Implementar el cálculo del aumento masivo con `Decimal` y las rutas de vista previa y de aplicación (transacción `Serializable`, recálculo, omisión de los productos sin cambio, historial con origen `aumento_masivo`); verificar con tests unitarios del cálculo ($905 +10% con redondeo $10 da $1.000, mínimo un redondeo, costo a 2 decimales) y de integración (la vista previa no escribe, solo afecta a productos activos y un fallo no deja cambios parciales)
- [ ] 3.4 Agregar las rutas nuevas al test de rutas protegidas y verificar que todas responden `401` sin sesión y que las de admin responden `403` al empleado

## 4. Web

- [ ] 4.1 Agregar "Productos" y "Proveedores" al menú y al panel del admin, y el formateo de pesos (`Intl.NumberFormat` es-AR) más la entrada de montos con coma; verificar con tests unitarios del formateo y de la conversión de entrada
- [ ] 4.2 Crear `/admin/proveedores` (lista con enlace `tel:`, marca "Toma pedido hoy", alta y edición con casillas de días, activar y desactivar); verificar con tests de Testing Library el alta con varios días y la marca de hoy
- [ ] 4.3 Crear `/admin/productos` (búsqueda con foco inicial y Enter, tabla y tarjetas, "Crear producto con este código" para códigos inexistentes), `/admin/productos/nuevo` y `/admin/productos/:id` (formulario, activar y desactivar, historial de precios); verificar con tests el alta rápida desde un código escaneado, el error `409` de código repetido y que el historial se muestra
- [ ] 4.4 Crear `/admin/productos/aumento` (formulario, vista previa con precio actual y nuevo, confirmación); verificar con tests que la confirmación solo aparece después de la vista previa y que se muestra el resultado
- [ ] 4.5 Verificar en el navegador con la base de desarrollo: crear dos proveedores (uno que toma pedido hoy), crear productos escaneando o escribiendo códigos, cambiar un precio y ver el historial, aplicar un aumento del 10% a un proveedor y revisar `/admin/productos` y `/admin/proveedores` en ancho de celular (375 px)

## 5. Documentación

- [ ] 5.1 Actualizar `docs/requisitos-y-limites.md` (proveedores con varios días de pedido y de entrega, aumento masivo por porcentaje con redondeo, historial de precios, el empleado no ve costos) y `docs/estructura-proyecto.md` (modelo de `Proveedor`, `Producto` y `CambioPrecio`); verificar que ambos coinciden con las specs del cambio

## Workflow follow-up

- Archivar el cambio con `/opsx:archive` cuando la CI esté en verde.
- Proponer el siguiente cambio de la Etapa 1: `stock`.
