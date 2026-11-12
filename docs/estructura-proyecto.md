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
                          |           + tareas (aviso 12:00, emisión de facturas)
                          +-- db    : PostgreSQL        (red interna)
                          +-- waha  : WhatsApp HTTP API (red interna)
                          |
            +-------------+--------------+
            v             v              v
         ARCA/AFIP    Mercado Pago    WhatsApp
         (WSFE, CAE)  (API + webhook) (vía waha)
```

- **Lector de código de barras:** USB en modo teclado (HID). Escribe el código y un Enter en el campo activo, así que no necesita integración especial.
- **Servicios:** el detalle de cada servicio y las librerías elegidas está en el [stack tecnológico](stack-tecnologico.md). En [`infra/`](../infra/README.md) están el Compose de desarrollo (PostgreSQL y WAHA) y el de producción (`caddy`, `app`, `db` y `waha`), con los scripts de deploy, backup y restauración y el runbook del servidor.
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
| **IngresoMercaderia** | proveedor, pedido (único; vacío solo en ingresos anteriores a los pedidos), usuario, nota, fecha | Proveedor, Pedido, Usuario, ItemsIngreso, MovimientosStock |
| **Pedido** | número correlativo, proveedor, total del pedido, llega el, nota, creado por y fecha, estado de la mercadería (por_llegar/llego/cargado/cancelado), total final, nota de recepción, quién recibió y cuándo, cancelación (quién, cuándo, motivo), fecha de cierre (cargado + pagado) | Proveedor, Usuarios, IngresoMercaderia (la carga), MovimientoCaja (el pago) |
| **ItemIngreso** | ingreso, producto, cantidad, costo unitario (opcional, solo si lo cargó el admin) | IngresoMercaderia, Producto |
| **Turno** | responsable (quien abrió), apertura (fecha, monto sugerido, monto inicial contado), cierre (quién cerró, fecha, monto contado, retiro al cierre y motivo, esperado, diferencia, lo que quedó en caja); como máximo uno abierto | Usuario, Ventas, MovimientosCaja |
| **MovimientoCaja** | turno (vacío solo en movimientos de Mercado Pago del admin sin turno abierto), tipo (gasto/retiro/ingreso/pago_proveedor/devolucion_cobro), cuenta (efectivo/mercado_pago), categoría (solo en gastos: servicios/insumos/otro), monto, motivo, usuario, pedido (único; solo en pago_proveedor), cobro de MP (el ingreso y la devolución en efectivo de un cobro de una venta cancelada; único por cobro y tipo), fecha; inmutable | Turno, Usuario, Pedido, CobroMp |
| **Venta** | número correlativo, usuario, fecha, turno, total, estado (pagada/anulada/pendiente/cancelada: `pendiente` espera el cobro del Point, `cancelada` no se cobró), aprobación del cobro (fecha), vencimiento de la espera, cancelación (fecha y motivo), anulación (usuario, fecha, motivo, turno abierto al anular) | Turno, Ítems, Pagos, MovimientosStock, CobrosMp, Factura |
| **ItemVenta** | venta, producto (vacío para el ítem "Varios"), descripción (nombre al momento de vender), cantidad, precio unitario, costo unitario (copia fija del costo del producto al vender; vacío en "Varios" y en productos sin costo), subtotal | Venta, Producto |
| **PagoVenta** | venta, medio (efectivo/debito/credito/mercado_pago), monto, monto recibido y vuelto (solo efectivo); uno por medio | Venta |
| **CobroMp** | venta, intento (único por venta), medio elegido, monto enviado al Point, clave de idempotencia y referencia externa (únicas), orden de MP (única), estado (creando/en_espera/cancelando/aprobado/rechazado/vencido/cancelado/a_revisar/a_devolver/devuelto/sin_devolver), detalle de MP, tipo de pago informado, cancelación pedida, creado, última consulta, resuelto, revisión del admin (quién, cuándo, nota) | Venta, Usuario, MovimientosCaja |
| **AvisoMp** | id de la notificación de MP (o `x-request-id`), orden, recibida | — |
| **Factura** | venta, parte (electronica/efectivo; única por venta y parte: hasta dos por venta), quién la pidió (solo la del efectivo), estado (pendiente/en_curso/autorizada/error/cancelada), punto de venta, tipo de comprobante (11 = Factura C), importe, número y fecha del comprobante (se fijan al mandarla a ARCA; únicos por punto de venta y tipo), CAE, vencimiento del CAE, fecha de autorización, intentos, próximo intento, código y motivo del error | Venta, Usuario |
| **TicketAccesoArca** | servicio (`wsfe`), entorno (homologacion/produccion), token, sign, generado, vence; uno por servicio y entorno | — |
| **Pedido** *(opcional)* | proveedor, fecha, ítems sugeridos/pedidos, estado | Proveedor, Productos |
| **Notificacion** | tipo (anulacion_venta/gasto_caja/retiro_caja/cierre_turno/pedido_cerrado/reposicion/factura/cobro_mp_a_revisar/devolucion_cobro_mp), destino, texto, estado (pendiente/enviada/error/reemplazada), fecha de creación, fecha de envío, error, intentos, próximo intento | — |
| **ConfiguracionWhatsapp** | número que recibe los avisos (10 dígitos), chat de WhatsApp, quién lo cargó (una sola fila) | Usuario |
| **EjecucionTarea** | tarea (texto, por ejemplo `aviso_reposicion`), fecha (día de Argentina), cuándo se ejecutó, aviso generado (único, opcional); única por tarea y fecha | Notificacion |

- Se asume **un proveedor por producto**. Si más adelante un producto puede venir de varios proveedores, se agrega una tabla intermedia ProductoProveedor.
- **IDs:** UUID v7 en todas las entidades. Montos en `Decimal`, cantidades y stock enteros, fechas en UTC (ver las convenciones en `apps/api/prisma/schema.prisma`).
- **Notificacion:** se crea como pendiente en la misma transacción que la anulación, el gasto o retiro de un empleado o el cierre de turno, y la envía después el proceso de envío (ver "Avisos por WhatsApp"). Nunca se borra. El estado `reemplazada` es solo para los avisos de reposición: al generarse el del día, los anteriores que seguían pendientes pasan a `reemplazada` y no se envían ni se reintentan.
- **EjecucionTarea** (`ejecuciones_tarea`): registro de las tareas por horario. Su índice único `(tarea, fecha)` garantiza que una tarea diaria corra una sola vez por día, aunque dos pasadas coincidan o la app se reinicie. `tarea` es texto para que la Etapa 5 sume las suyas sin migrar enums.
- **Turno:** el esperado y la diferencia se guardan al cerrar, como foto del cierre. Un índice único parcial (`turnos_un_solo_abierto`) garantiza que haya un solo turno abierto.
- **Factura** (`facturas`): hace de cola de emisión. La automática (`electronica`) vale la suma de los pagos con débito, crédito y MP; la del efectivo, el pago en efectivo. Como hay un pago por medio, las dos suman siempre el total. El único `(venta, parte)` hace idempotente encolar o pedir dos veces, y el único `(punto de venta, tipo, número)` impide que dos procesos reserven el mismo número.
- **CobroMp** (`cobros_mp`): un intento de cobro con el Point (una orden de la Orders API). El índice único parcial `cobros_mp_uno_activo` (estado creando, en_espera o cancelando) garantiza un solo cobro activo a la vez: un segundo pedido simultáneo recibe `409 TERMINAL_OCUPADA`. Cada cambio de estado es un `UPDATE` condicionado al estado anterior, así la misma aprobación por varias vías confirma una sola vez.
- **AvisoMp** (`avisos_mp`): notificaciones de Mercado Pago ya recibidas; la clave primaria evita procesar dos veces la misma.
- **TicketAccesoArca** (`tickets_acceso_arca`): el ticket del WSAA, guardado para reutilizarlo después de un reinicio (ARCA no da otro mientras haya uno vigente).

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
- **Con el Point configurado** (cambio `cobro-mercado-pago`) y una parte electrónica, la venta se guarda `pendiente` con todos sus pagos y sin mover stock, junto con su primer `CobroMp` en `creando`; fuera de la transacción se crea la orden en MP (`POST /v1/orders`, 10 s). La venta pasa a `pagada` en `confirmarCobroAprobado` (`modules/ventas/cobro.ts`): en una transacción descuenta el stock y llama a `encolarFacturaSiCorresponde`. Si la venta ya estaba cancelada, el cobro queda `a_devolver`, se registra el ingreso en la cuenta MP y se avisa al admin.

```
Consulta de respaldo (jobs/cobros-mp.ts), una pasada por segundo, solo con el Point:
   cobros en_espera o cancelando con la última consulta hace 3 s o más
      --> GET /v1/orders/{id} --> aplicar el estado (aprobado / rechazado / vencido / cancelado / a revisar)
   ventas pendiente con vence_en <= ahora (10 min desde el último intento)
      --> consultar; si sigue activo, pedir la cancelación; si no, cancelar ("Venció la espera")

Webhook POST /api/mercado-pago/webhook (única ruta sin sesión, cuerpo hasta 64 KB):
   sin MP_WEBHOOK_SECRET o firma inválida o ts a más de 300 s --> 401
   type != order --> 200; notificación repetida (avisos_mp) --> 200
   cobro por orden o external_reference --> GET /v1/orders/{id} --> aplicar el estado --> 200
```

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

### Avisos por WhatsApp

```
Anulación / gasto o retiro del empleado / cierre de turno
   --> Notificacion "pendiente" (misma transacción)

Proceso de envío, cada 15 s:
   ¿WhatsApp conectado y número cargado? -- no --> no toca nada (esperan sin gastar intentos)
      | sí
      v
   pendientes sin espera, del más viejo al más nuevo, de a uno con 3 s de pausa
      --> WAHA sendText --> OK --> "enviada" con fecha de envío
                         --> WhatsApp caído --> corta la pasada
                         --> rechazo --> intentos + 1, espera 30 s / 2 / 10 / 30 min
                                         5 fallas --> "error" (el admin puede reintentar)
```

### Facturación con ARCA

```
Venta pagada (registrarVenta; con cobro-mercado-pago, también al aprobarse el cobro)
   --> encolarFacturaSiCorresponde, en la misma transacción:
       parte electrónica > 0 --> Factura "pendiente" (o "error" + aviso si alcanza el tope)
   --> después del commit, despertar() a la emisión

F10 / Pedir factura (parte efectivo) --> Factura "pendiente" con quién la pidió

Emisión (jobs/emision-facturas.ts), cada 10 s o al despertar:
   FEDummy caído? -- sí --> nada cambia (no gasta intentos)
   ¿hay una "error" por numeración inconsistente? -- sí --> frena todo hasta "Reintentar"
   ¿hay una "en_curso"? --> FECompConsultar de su número:
       existe igual --> "autorizada" (aviso si la venta se anuló)
       existe distinta --> "error" numeración inconsistente + aviso
       no existe --> venta anulada: "cancelada"; si el número sigue libre, se reenvía;
                     si no, vuelve a "pendiente"
   pendientes vencidas, de la más vieja a la más nueva (hasta 20):
       venta anulada --> "cancelada"
       más de 5 días --> "error" fuera de plazo + aviso
       número = último autorizado + 1 (> 99999999 --> "error" + aviso)
       fecha = la de la venta, o la del último comprobante si es posterior
       reserva: "en_curso" con número y fecha (otro proceso lo tomó --> termina la pasada)
       FECAESolicitar --> autorizada: CAE y vencimiento
                      --> rechazo: libera el número, intentos + 1, espera 30 s / 2 / 10 / 30 min;
                                   5 rechazos --> "error" + aviso
                      --> sin respuesta: queda "en_curso" y termina la pasada
```

- El ticket de acceso del WSAA lo pide solo la tarea de emisión, con el certificado y la clave leídos al arrancar (`server.ts`), y se guarda en la base.
- La anulación de una venta cancela sus facturas `pendiente` o en `error` en la misma transacción; las autorizadas siguen vigentes y el aviso de anulación lo dice (no hay notas de crédito).

### Aviso diario de reposición (12:00)

```
Tarea diaria (jobs/aviso-reposicion.ts), revisa cada 60 s, también sin WAHA:
   ¿entre las 12:00 y las 18:59:59 de Argentina? -- no --> nada
      | sí
   ¿ya hay ejecución "aviso_reposicion" de hoy? -- sí --> nada
      | no
   --> productos activos con stock actual <= stock mínimo (sin mínimo y máximo en 0)
   --> cantidad sugerida = stock máximo - stock actual (si es 0 o menos, no va)
   --> agrupar por proveedor (sin proveedor o desactivado --> "Sin proveedor", al final)
   --> ordenar: primero los proveedores que toman pedido HOY, después el resto por nombre
   --> marca "pedido por llegar" con la fecha más cercana
   --> en una transacción: reposiciones pendientes anteriores --> "reemplazada",
       Notificacion pendiente y EjecucionTarea del día (si otra pasada ganó: se deshace todo)
   --> proceso de envío --> WhatsApp
```

## Estructura de carpetas

Monorepo con **pnpm workspaces** (ver [stack tecnológico](stack-tecnologico.md)):

```
/
├── apps/
│   ├── api/                  # Backend Fastify (TypeScript)
│   │   ├── prisma/           # schema.prisma y migraciones
│   │   └── src/
│   │       ├── modules/      # un módulo por dominio: auth, usuarios, productos, proveedores, stock,
│   │       │                 # pedidos, ventas, caja, notificaciones, whatsapp (cliente de WAHA y envío),
│   │       │                 # reposicion (cálculo y texto del aviso, sin rutas), dashboard, estado,
│   │       │                 # mercadopago (saldo con caché de 60 s y GET /api/mercado-pago/saldo),
│   │       │                 # facturacion (reglas normativas, encolado, pedido, emisión, avisos y rutas del admin)
│   │       ├── plugins/      # sesión y permisos por rol
│   │       ├── lib/          # fechas en Argentina, formatos y utilidades
│   │       ├── cli/          # comandos de consola (crear el primer admin; mp:terminales para el Point)
│   │       ├── integrations/ # clientes de servicios externos que usan varios módulos:
│   │       │                 # mercadopago/ (cliente HTTP con timeout de 10 s, errores "no responde"
│   │       │                 # y "rechazó"; la lectura del saldo, aislada en saldo-cuenta.ts; las órdenes Point en
│   │       │                 # ordenes.ts, la firma de los webhooks en firma.ts y las terminales) y
│   │       │                 # arca/ (WSAA con firma CMS, WSFEv1 por SOAP, ticket de acceso en la base,
│   │       │                 # direcciones por entorno y errores "no disponible" y "rechazo")
│   │       └── jobs/         # tareas periódicas, arrancadas desde server.ts (nunca en los tests):
│   │                         # ciclo.ts (ciclo común, con despertar()), aviso-reposicion.ts (aviso
│   │                         # de las 12:00), emision-facturas.ts (cola de facturas, solo con ARCA) y
│   │                         # cobros-mp.ts (consulta de respaldo y vencimiento, solo con el Point)
│   └── web/                  # Frontend React + Vite
│       └── src/
│           ├── pos/          # pantalla de venta (escritorio, teclado y lector)
│           ├── ventas/       # listado y detalle de ventas, anulación
│           ├── pedidos/      # pedidos a proveedor, recepción, carga de mercadería y recordatorios
│           ├── stock/        # stock, ajustes y escáner de productos
│           ├── admin/        # pantallas de admin (turnos, avisos, WhatsApp...) y dashboard (responsive)
│           └── app/          # ingreso, rutas y layout
├── packages/
│   └── shared/               # esquemas Zod y tipos compartidos entre api y web
├── infra/                    # Compose de desarrollo y producción, Caddyfile, deploy, backup y restauración
├── docs/                     # documentación del proyecto
└── openspec/                 # cambios y specs de OpenSpec
```
