# Tasks

## 1. Esquemas y cálculo de períodos (shared)

- [x] 1.1 Crear `packages/shared/src/dashboard.ts` (exportado desde `index.ts`) con:
  - el schema de la query (`desde`, `hasta`);
  - el schema de la respuesta: ahora, período y su anterior, ventas, ganancia, sin costo, gastos por categoría, resultado, serie por día/hora/semana, medios, más vendidos (tres órdenes) y movimientos;
  - `PERIODOS` con sus nombres, `rangoDelPeriodo(periodo, hoy)`, `periodoAnterior(desde, hasta)` y `variacion(actual, anterior)`.

  Verificar con tests unitarios:
  - Semana del jueves 22/10/2026 → 19 al 22; Mes → 1 al 22; Mes anterior → 1 al 30 de septiembre.
  - Anterior de un día → el día antes; de 19–22/10 → 15–18/10; de 1–22/10 → 1–22/09; de 1–31/03 → 1–29/02 (2028); de septiembre completo → agosto completo.
  - `variacion(108000, 100000)` → 8 y `variacion(x, 0)` → null.

## 2. API del dashboard

- [x] 2.1 Crear `modules/dashboard` con el servicio y `GET /api/dashboard` (solo admin), registrado en la app y sumado al test de rutas protegidas. Implementar "ahora" (efectivo con `resumenDeCaja` o el último cierre; pendiente con los pedidos) y ventas, ganancia, sin costo y comparación. Verificar con tests de integración:
  - los escenarios de "Acceso al dashboard" (`403` al empleado);
  - "Período del dashboard" (`400` con el rango al revés y sin fechas devuelve hoy);
  - "Efectivo en caja y pendiente de pagar" (turno abierto, sin turno y pedidos en los tres estados más uno cancelado);
  - "Ventas y ganancia del período" (anulada fuera, "Varios" sin costo, margen);
  - "Comparación con el período anterior".
- [x] 2.2 Agregar gastos por categoría y cuenta, resultado, pagos a proveedores por cuenta, retiros (con los del cierre), ingresos, diferencias de los turnos cerrados y anuladas por `anuladaEn`. Verificar con tests los escenarios de "Gastos y resultado" (los pagos a proveedores no restan) y "Movimientos de plata del período".
- [x] 2.3 Agregar la serie de ventas (`date_trunc` en hora de Argentina: por hora si es un día, por semana si son más de 62 días, si no por día), los medios de pago y los más vendidos en sus tres órdenes. Verificar con tests:
  - una venta a las 23:30 en Argentina cae en su día y no en el siguiente;
  - el pago mixto suma a cada medio;
  - "Varios" no aparece en los más vendidos;
  - un producto sin costo no aparece en el orden por ganancia.

## 3. Filtro de productos sin costo

- [x] 3.1 Sumar `sinCosto` a `busquedaProductosSchema` y a `buscarProductos` (solo admin; se ignora para el empleado), y un control "Sin costo" en `ListaProductos.tsx` que lee `?sinCosto=1` de la URL. Verificar con un test de integración (el admin ve solo los activos sin costo; el empleado recibe la búsqueda normal) y uno de componente (la lista abierta con `?sinCosto=1` muestra el filtro activo).

## 4. Pantalla

- [x] 4.1 Crear `admin/Dashboard.tsx` e insertarlo al principio de `PanelAdmin`:
  - selector de período en la URL (con "Fechas");
  - bloques "Ahora", "Ventas y resultado" (con variación y el enlace a lo vendido sin costo), barras de ventas, medios de pago, más vendidos con selector de orden y "Plata que se movió" (con enlaces a Turnos y Pedidos);
  - estados de carga y error;
  - sin MP.

  Verificar con tests de componente: el período por defecto es Hoy y cambiarlo pide las fechas correctas, la variación se muestra solo cuando existe, el orden de más vendidos cambia sin pedir de nuevo, y los enlaces apuntan bien.
- [x] 4.2 Verificar en el navegador, con `verif-admin` y a 375 px, sobre los datos de desarrollo: que no haya desborde horizontal, que el período cambie, y que efectivo y pendiente coincidan con la pantalla de Turnos y con la de Pedidos. Revisar también la vista de escritorio.

## 5. Documentación y cierre

- [x] 5.1 Actualizar la sección Dashboard de `docs/requisitos-y-limites.md` (qué muestra, MP en la Etapa 5, comparación y resultado sin pagos a proveedores) y el estado de las etapas en `README.md` y `docs/README.md` (la Etapa 3 queda con código terminado). Verificar releyendo que coincide con la spec.
- [x] 5.2 Correr `pnpm lint`, `pnpm typecheck`, `pnpm test` (web con `--no-file-parallelism` si hay timeouts por carga) y el e2e, y verificar que todo pasa.

## Workflow follow-up

- Archivar el cambio cuando la CI esté en verde en `etapa-3`.
- Con esto se completa el código de la Etapa 3. Queda decidir si `etapa-3` se une a `main` (las Etapas 2 y 3 todavía no se unieron).
