# Estructura del proyecto

## Arquitectura general

El sistema está **hosteado en un servidor**. La PC del kiosco y el celular del admin acceden por navegador.

```
   [Celular admin] -------+
   (precios, dashboard)   |
                          v  HTTPS
   [PC kiosco] ------> VPS (Docker Compose)
   + lector código        |
     de barras (USB)      +-- caddy : proxy inverso + HTTPS (único puerto expuesto)
   + impresora de         |     |
     tickets térmica      |     v
                          +-- app   : Fastify (API + build de React)
                          |           + tarea programada (aviso 12:00)
                          +-- db    : PostgreSQL        (red interna)
                          +-- waha  : WhatsApp HTTP API (red interna)
                          |
            +-------------+--------------+
            v             v              v
         ARCA/AFIP    Mercado Pago    WhatsApp
         (WSFE, CAE)  (API + webhook) (vía waha)
```

- **Lector de código de barras:** USB en modo teclado (HID). Escribe el código y un Enter en el campo activo, así que no necesita integración especial.
- **Servicios:** el detalle de cada servicio y las librerías elegidas está en el [stack tecnológico](stack-tecnologico.md). En [`infra/`](../infra/README.md) están el Compose de desarrollo (PostgreSQL) y el de producción (`caddy`, `app` y `db`; `waha` se suma con `envio-whatsapp`), con los scripts de deploy, backup y restauración y el runbook del servidor.
- **Impresora:** térmica de tickets común (58 u 80 mm). Con factura electrónica **no hace falta impresora fiscal**.

## Módulos y dependencias

```
                 +------------------+
                 | Usuarios / Roles |
                 +--------+---------+
                          | (todo requiere usuario)
     +--------------------+---------------------+
     v                    v                     v
+-----------+      +-------------+       +-------------+
| Productos |<---->| Proveedores |       | Caja/Turnos |
+-----+-----+      +------+------+       +------+------+
      |                   |                     ^
      v                   |                     |
+-----------+             |              +------+------+
|   Stock   |<------------+--------------|   Ventas    |
+-----+-----+                            |    (POS)    |
      |                                  +--+-------+--+
      v                                     |       |
+-------------+                             v       v
| Reposición  |                    +-------------+ +-------------+
| + WhatsApp  |                    | Facturación | | Mercado Pago|
+-------------+                    |  (ARCA)     |<+   (API)     |
                                   +-------------+ +-------------+
      Dashboard: lee de Ventas, Stock y Caja
```

## Modelo de datos (borrador)

| Entidad | Campos principales | Relaciones |
|---|---|---|
| **Usuario** | nombre, usuario, contraseña (hash), rol (admin/empleado), activo | Turno, Venta |
| **Proveedor** | nombre, teléfono, notas, días de toma de pedido (lista de `DiaSemana`), días de entrega (lista de `DiaSemana`), activo | Productos |
| **Producto** | código de barras (opcional, único si existe), nombre, nombre de búsqueda (sin acentos ni mayúsculas), precio de venta, costo (opcional), stock actual (puede ser negativo, empieza en 0), stock mínimo, stock máximo, activo | Proveedor (uno, opcional), CambiosPrecio |
| **CambioPrecio** | producto, usuario, precio anterior y nuevo, costo anterior y nuevo, origen (manual/aumento_masivo), fecha | Producto, Usuario |
| **MovimientoStock** | producto, tipo (venta/compra/ajuste/anulacion), motivo (obligatorio en los ajustes: rotura/vencimiento/robo/conteo/venta_sin_sistema/correccion/otro), cantidad con signo, stock resultante, nota, usuario, fecha; inmutable | Producto, Usuario, IngresoMercaderia (opcional) |
| **IngresoMercaderia** | proveedor (opcional), usuario, nota, fecha | Proveedor, Usuario, ItemsIngreso, MovimientosStock |
| **ItemIngreso** | ingreso, producto, cantidad, costo unitario (opcional, solo si lo cargó el admin) | IngresoMercaderia, Producto |
| **Turno** | responsable (quien abrió), apertura (fecha, monto sugerido, monto inicial contado), cierre (quién cerró, fecha, monto contado, retiro al cierre y motivo, esperado, diferencia, lo que quedó en caja); como máximo uno abierto | Usuario, Ventas, MovimientosCaja |
| **MovimientoCaja** | turno, tipo (gasto/retiro/ingreso), monto, motivo, usuario, fecha; inmutable | Turno, Usuario |
| **Venta** | número correlativo, usuario, fecha, turno, total, estado (pagada/anulada; `pendiente` llega con Mercado Pago en la Etapa 5), anulación (usuario, fecha, motivo, turno abierto al anular) | Turno, Ítems, Pagos, MovimientosStock, Pago MP, Factura |
| **ItemVenta** | venta, producto (vacío para el ítem "Varios"), descripción (nombre al momento de vender), cantidad, precio unitario, subtotal | Venta, Producto |
| **PagoVenta** | venta, medio (efectivo/debito/credito/mercado_pago), monto, monto recibido y vuelto (solo efectivo); uno por medio | Venta |
| **PagoMercadoPago** | venta, id de pago MP, estado, monto, fecha | Venta |
| **Factura** | venta, tipo (C), punto de venta, número, CAE, vencimiento del CAE, estado | Venta |
| **Pedido** *(opcional)* | proveedor, fecha, ítems sugeridos/pedidos, estado | Proveedor, Productos |
| **Notificacion** | tipo (anulacion_venta/gasto_caja/retiro_caja/cierre_turno), destino, texto, estado (pendiente/enviada/error), fecha de creación, fecha de envío, error | — |

- Se asume **un proveedor por producto**. Si más adelante un producto puede venir de varios proveedores, se agrega una tabla intermedia ProductoProveedor.
- **IDs:** UUID v7 en todas las entidades. Montos en `Decimal`, cantidades y stock enteros, fechas en UTC (ver las convenciones en `apps/api/prisma/schema.prisma`).
- **Notificacion:** por ahora solo se crean como pendientes (al anular una venta, por un gasto o retiro de un empleado y al cerrar un turno). El envío por WAHA se suma con el cambio `envio-whatsapp` de la Etapa 2.
- **Turno:** el esperado y la diferencia se guardan al cerrar, como foto del cierre. Un índice único parcial (`turnos_un_solo_abierto`) garantiza que haya un solo turno abierto.

## Flujos principales

### Venta

```
Escanear productos --> Elegir medio de pago (F1-F4) o pago mixto (F6)
                          |
          +---------------+-----------------+
          v                                 v
  Efectivo / tarjeta / mixto           Mercado Pago
  (efectivo: "paga con" y vuelto)
          |                                 |
          |                    Crear cobro en la API de MP
          |                                 |
          |                    Esperar confirmación del pago
          |                       (webhook / consulta)
          |                                 |
          |                         Pago aprobado?
          |                         /           \
          |                       sí             no --> reintentar / cambiar medio
          v                       v
   Registrar venta          Registrar venta
   (descuenta stock)        (descuenta stock)
          |                       |
   Factura si el            Factura C automática
   cliente la pide          (ARCA --> CAE)
          |                       |
          +---------> Imprimir ticket solo si lo piden (F9)
```

- Registrar la venta es una sola transacción: el servidor toma los precios del catálogo (si no coinciden con el total que vio el mostrador, responde `409` con los precios nuevos), valida que los pagos sumen el total, calcula el vuelto, guarda la venta con sus ítems y pagos, y descuenta el stock con un movimiento `venta` por producto.
- Anular también es una sola transacción: la venta pasa a `anulada` (solo si estaba `pagada`), el stock vuelve con movimientos `anulacion` y queda un aviso pendiente para el admin.

### Turno de caja

```
Abrir turno ------------------> Ventas, gastos, retiros --> Cerrar turno (ciego)
(monto sugerido = lo que         (ingresos: solo admin)      contar efectivo
 quedó; se corrige si                                         + retiro opcional
 no coincide)                                                       |
                                                                    v
                                          Diferencia = contado - esperado (la ve el admin)
                                          Quedó en caja = contado - retiro
                                          Aviso de cierre al admin
```

Cambio de turno a las 13:00 (una sola PC):

```
A cierra su turno --> A cierra sesión --> B ingresa --> B abre con lo que quedó

Si A se fue sin cerrar:
B ingresa --> "El turno de A está abierto" --> B lo cierra contando la caja
          --> queda registrado: responsable A, cerró B --> B abre su turno
```

### Aviso diario de reposición (12:00)

```
Tarea programada 12:00
   --> productos con stock actual <= stock mínimo
   --> cantidad sugerida = stock máximo - stock actual
   --> agrupar por proveedor
   --> ordenar: primero los proveedores que toman pedido HOY
   --> armar mensaje --> WAHA --> <NUMERO_WHATSAPP_ADMIN>
```

## Estructura de carpetas

Monorepo con **pnpm workspaces** (ver [stack tecnológico](stack-tecnologico.md)):

```
/
├── apps/
│   ├── api/                  # Backend Fastify (TypeScript)
│   │   ├── prisma/           # schema.prisma y migraciones
│   │   └── src/
│   │       ├── modules/      # un módulo por dominio: usuarios, productos, proveedores, stock, ventas, caja...
│   │       ├── integrations/ # clientes de ARCA, Mercado Pago y WAHA
│   │       └── jobs/         # tareas programadas (aviso de reposición 12:00)
│   └── web/                  # Frontend React + Vite
│       └── src/
│           ├── pos/          # pantalla de venta (escritorio, teclado y lector)
│           └── admin/        # pantallas de admin y dashboard (responsive)
├── packages/
│   └── shared/               # esquemas Zod y tipos compartidos entre api y web
├── infra/                    # docker-compose.yml, Caddyfile y scripts de backup
├── docs/                     # documentación del proyecto
└── openspec/                 # cambios y specs de OpenSpec
```
