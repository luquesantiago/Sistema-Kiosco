# Proposal

## Why

Es lo que da nombre a la Etapa 3. El admin necesita ver desde el celular, de un vistazo, cómo va el kiosco: cuánto vendió y ganó, cuánto gastó, cuánta plata hay en el cajón y cuánto le debe a los proveedores. Los tres cambios anteriores de la etapa dejaron los datos listos (costo en cada venta, gastos con categoría, cuenta de cada movimiento y pedidos), y hoy no hay ninguna pantalla que los junte.

## What Changes

- Pantalla **Dashboard**, solo para el admin, pensada para el celular, **arriba de todo en el panel de administración**, que es donde cae el admin al entrar. Las tarjetas de siempre quedan abajo.
- **Ahora**, sin importar el período elegido:
  - **efectivo en caja**: el esperado del turno abierto o, si no hay ninguno, lo que quedó en el último cierre;
  - **pendiente de pagar**: pedidos por llegar más entregas que quedaron debiendo, con su detalle y enlace a Pedidos.
- **Período:** Hoy (por defecto), Ayer, Semana (lunes a hoy), Mes (1 a hoy), Mes anterior o fechas elegidas, siempre en hora de Argentina. Para ese período se muestran:
  - **Ventas** (sin anuladas, con la cantidad) y **ganancia** (solo sobre ítems con costo, con su margen), las dos **comparadas con el período anterior**. El mes en curso se compara contra los mismos días del mes anterior.
  - Lo **vendido sin costo**, con un enlace a la lista de productos filtrada por "Sin costo" (filtro nuevo) para completarlos.
  - **Gastos** de las dos cuentas, por categoría, y el **resultado** (ganancia − gastos).
  - **Ventas por día** (por hora en "Hoy" y "Ayer") y **ventas por medio de pago**.
  - **Más vendidos** (top 10, sin "Varios"), ordenables por unidades, importe o ganancia.
  - **Plata que se movió:** pagos a proveedores (por cuenta), retiros e ingresos (estos tres no restan del resultado), diferencias de caja de los turnos cerrados en el período (con enlace a Turnos) y ventas anuladas (cantidad e importe).
- **Mercado Pago no aparece** hasta la Etapa 5, que va a traer el saldo real desde la API.
- Un solo pedido a la API: `GET /api/dashboard`, solo para el admin.

Fuera de alcance:
- El saldo de MP (Etapa 5).
- Vista para el empleado: no ve el dashboard, para que el cierre de caja siga siendo ciego.
- Exportar a Excel o PDF, y gráficos interactivos.

## Capabilities

### New Capabilities

- `dashboard`: indicadores del kiosco para el admin por período (ventas, ganancia, gastos, resultado, medios de pago, más vendidos y movimientos de plata) y el estado actual de la caja y de lo pendiente de pagar.

### Modified Capabilities

- `productos`: el admin puede filtrar la lista por productos sin costo (el destino del enlace "vendido sin costo"). Ventas, caja y pedidos no cambian: el dashboard solo lee sus datos.

## Impact

- **API:** nuevo módulo `modules/dashboard` (servicio con consultas agregadas en PostgreSQL y una ruta). Reutiliza `resumenDeCaja` para el efectivo y `lib/fechas` para los rangos.
- **Compartido:** `packages/shared/src/dashboard.ts` (query, respuesta y cálculo de períodos y comparación).
- **Productos:** `sinCosto` en `busquedaProductosSchema` y `buscarProductos` (solo admin), y el filtro en `admin/productos/ListaProductos.tsx`.
- **Web:** `admin/Dashboard.tsx`, insertado arriba en `admin/PanelAdmin.tsx`. Las barras se hacen con CSS (Tailwind), sin agregar dependencias de gráficos.
- **Docs:** la sección Dashboard de `docs/requisitos-y-limites.md` y el estado de las etapas en `docs/README.md` y `README.md`.
- Sin cambios en la base de datos.
