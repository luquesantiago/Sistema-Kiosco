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
- **Servicios:** el detalle de cada servicio y las librerías elegidas está en el [stack tecnológico](stack-tecnologico.md). El Compose de producción (con `caddy` y `waha`) se arma en la Etapa 2, con la puesta en marcha. Durante la Etapa 1 solo existe el Compose de desarrollo de [`infra/`](../infra/README.md), con PostgreSQL.
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
| **Turno** | usuario, apertura (fecha, monto inicial), cierre (fecha, monto contado), diferencia | Usuario, Ventas, MovimientosCaja |
| **MovimientoCaja** | turno, tipo (retiro/ingreso/gasto), monto, motivo, usuario | Turno |
| **Venta** | número correlativo, usuario, fecha, total, estado (pagada/anulada; `pendiente` llega con Mercado Pago en la Etapa 5), anulación (usuario, fecha, motivo); el turno se agrega en la Etapa 2 | Ítems, Pagos, MovimientosStock, Pago MP, Factura |
| **ItemVenta** | venta, producto (vacío para el ítem "Varios"), descripción (nombre al momento de vender), cantidad, precio unitario, subtotal | Venta, Producto |
| **PagoVenta** | venta, medio (efectivo/debito/credito/mercado_pago), monto, monto recibido y vuelto (solo efectivo); uno por medio | Venta |
| **PagoMercadoPago** | venta, id de pago MP, estado, monto, fecha | Venta |
| **Factura** | venta, tipo (C), punto de venta, número, CAE, vencimiento del CAE, estado | Venta |
| **Pedido** *(opcional)* | proveedor, fecha, ítems sugeridos/pedidos, estado | Proveedor, Productos |
| **Notificacion** | tipo (anulacion_venta), destino, texto, estado (pendiente/enviada/error), fecha de creación, fecha de envío, error | — |

- Se asume **un proveedor por producto**. Si más adelante un producto puede venir de varios proveedores, se agrega una tabla intermedia ProductoProveedor.
- **IDs:** UUID v7 en todas las entidades. Montos en `Decimal`, cantidades y stock enteros, fechas en UTC (ver las convenciones en `apps/api/prisma/schema.prisma`).
- **Notificacion:** la Etapa 1 solo las crea como pendientes (por ejemplo, al anular una venta). El envío por WAHA se suma en la Etapa 2, con la puesta en marcha.

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
Abrir turno (monto inicial) --> Ventas / retiros --> Cerrar turno
                                                       |
                                     Contar efectivo --+--> Diferencia
                                                            (esperado vs contado)
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
