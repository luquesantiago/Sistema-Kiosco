# Design

## Context

- **Datos que ya existen** (de los cambios anteriores de la Etapa 3):
  - `ItemVenta.costoUnitario` (fijo, nullable) y `subtotal`; `Venta.estado`, `creadaEn` y `anuladaEn`; `PagoVenta.medio` y `monto`.
  - `MovimientoCaja` con `tipo` (gasto, retiro, ingreso o pago_proveedor), `cuenta`, `categoria` y `creadoEn`. `Turno` con `cerradoEn`, `diferencia`, `retiroCierre` y `quedoEnCaja`.
  - `Pedido` con `estado`, `totalPedido`, `total` y su pago (`MovimientoCaja.pedidoId`).
- **Funciones que se reutilizan:**
  - `resumenDeCaja(db, turno)` devuelve el esperado en vivo de un turno.
  - `lib/fechas` tiene `fechaEnArgentina` y `rangoDelDiaEnArgentina`. Argentina es siempre UTC−3.
- **La web** no tiene librería de gráficos y el panel de admin es una grilla de tarjetas (`admin/PanelAdmin.tsx`).
- Requisitos en `specs/dashboard` de este cambio.

## Goals / Non-Goals

**Goals:**
- Una sola respuesta de la API con todo lo que muestra la pantalla, calculada en la base: rápida en el celular y sin lógica de negocio en la web.
- Que la pantalla entre en 375 px sin desborde y se lea de arriba abajo, sin tablas anchas.

**Non-Goals:**
- Tablas precalculadas o caché: el volumen de un kiosco (cientos de ventas por día) se agrega en milisegundos.
- Gráficos con librería, exportación y tiempo real.

## Decisions

### La API recibe `desde`/`hasta` y calcula sola la comparación
- `GET /api/dashboard?desde=AAAA-MM-DD&hasta=AAAA-MM-DD` (solo admin). Sin fechas, devuelve hoy. Los atajos (Hoy, Ayer, Semana, Mes, Mes anterior) los traduce la web a fechas con `rangoDelPeriodo(periodo, hoy)` en `packages/shared`.
- El período anterior lo calcula `periodoAnterior(desde, hasta)` en `shared`, con tres reglas:
  - `desde` es día 1 y `hasta` es el último día del mismo mes → el mes anterior completo (así "Mes anterior" compara septiembre entero con agosto entero);
  - `desde` es día 1 y `hasta` cae en el mismo mes → los mismos días del mes anterior, recortados a su último día;
  - en cualquier otro caso → la misma cantidad de días, terminando el día antes de `desde`.
- La respuesta incluye las fechas del período anterior, para que la pantalla diga contra qué compara ("vs. ayer", "vs. 1–22 sep").
- Alternativa descartada: que la web pida dos veces el dashboard (actual y anterior). Duplica consultas y obliga a armar la comparación en la web.

### Consultas agregadas en PostgreSQL, en un solo `Promise.all`
- Las **ventas** del período son las `pagada` registradas en el rango (`creadaEn`). Una venta anulada no cuenta aunque se haya anulado después. Las **anuladas** del período se cuentan por `anuladaEn`.
- **Ganancia y vendido sin costo:** una sola consulta SQL sobre `items_venta` unido a `ventas`, con `SUM(subtotal - cantidad * costo_unitario) FILTER (WHERE costo_unitario IS NOT NULL)`, `SUM(subtotal) FILTER (WHERE costo_unitario IS NOT NULL)` (base del margen) y `SUM(subtotal) FILTER (WHERE costo_unitario IS NULL)`. Se calcula también para el período anterior.
- **Ventas por día u hora:** `$queryRaw` con `date_trunc('day' | 'hour', creada_en AT TIME ZONE 'America/Argentina/Buenos_Aires')`. Los días u horas sin ventas los completa la web con cero para que las barras no tengan huecos. Si el rango es de un día va por hora; si no, por día. Para rangos mayores a 62 días se agrupa por semana, así un rango largo no dibuja cientos de barras.
- **Medios de pago:** `groupBy` de `PagoVenta` por `medio`, filtrando por ventas pagadas del rango.
- **Más vendidos:** SQL agrupado por `producto_id` (sin "Varios"), con unidades, importe y ganancia (nula si algún ítem no tiene costo). Se devuelven los 10 primeros de cada orden: tres listas chicas, así la web cambia de orden sin volver a pedir.
- **Gastos, pagos a proveedores, retiros e ingresos:** `groupBy` de `MovimientoCaja` por `tipo`, `cuenta` y `categoria` en el rango. A los retiros se suma `Turno.retiroCierre` de los turnos cerrados en el rango.
- **Diferencias:** `aggregate` de `Turno.diferencia` de los cerrados en el rango, más la cantidad con diferencia distinta de cero.
- **Ahora:**
  - Efectivo: si hay turno abierto, `resumenDeCaja(...).esperado`; si no, `quedoEnCaja` del último cerrado ($0 si no hubo ninguno).
  - Pendiente: dos `aggregate` de `Pedido` (por llegar → `totalPedido`; llegó o cargado sin pago → `total`).
- Montos como string con dos decimales, igual que el resto de la API. Porcentajes calculados en `shared` (`variacion(actual, anterior)` devuelve `null` si el anterior es cero).

### Pantalla
- `admin/Dashboard.tsx`, insertado al principio de `PanelAdmin`.
- **Selector de período:** botones con `aria-pressed` y una opción "Fechas" que despliega dos `input type=date`. El período se guarda en la URL (`?periodo=mes` o `?desde=&hasta=`), así un recargo o un "atrás" no lo pierde.
- **Bloques apilados de una columna en el celular** (dos en escritorio):
  - "Ahora" (efectivo, pendiente);
  - "Ventas y resultado";
  - barras de ventas por día u hora (divs con altura proporcional; el monto se ve al tocar la barra, sin hover);
  - medios de pago (barras horizontales con porcentaje);
  - más vendidos (lista numerada con selector de orden);
  - "Plata que se movió".
- **Enlaces:**
  - "vendido sin costo" → `/admin/productos?sinCosto=1`, que agrega el filtro "Sin costo" a la lista de productos (cambio chico en `ListaProductos` y en `GET /api/productos`, solo para el admin);
  - diferencias → `/admin/turnos`;
  - pendiente → `/pedidos`.

## Risks / Trade-offs

- [Ventas viejas sin costo inflan "vendido sin costo" y bajan el margen aparente] → Es la decisión tomada en `costo-y-gastos`: el margen se calcula solo sobre lo que tiene costo, y el aviso invita a completar costos.
- [Rangos muy largos] → La agrupación por semana evita una respuesta con cientos de puntos. Las demás consultas son agregados, y su costo no depende de cuántas filas devuelven.

## Migration Plan

Sin cambios en la base. Se despliega con el resto de la etapa; volver atrás es revertir el commit.
