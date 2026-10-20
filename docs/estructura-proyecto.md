# Estructura del proyecto

## Arquitectura general

El sistema está **hosteado en un servidor**. La PC del kiosco y el celular del admin acceden por navegador.

```
   [Celular admin] -------+
   (precios, dashboard)   |
                          v
   [PC kiosco] ------> SERVIDOR
   + lector código        |
     de barras (USB)      +-- Aplicación (backend + frontend)
   + impresora de         +-- Base de datos
     tickets térmica      +-- WAHA (WhatsApp HTTP API)
                          +-- Tareas programadas (aviso 12:00)
                          |
            +-------------+--------------+
            v             v              v
         ARCA/AFIP    Mercado Pago    WhatsApp
         (WSFE, CAE)  (API + webhook) (vía WAHA)
```

- **Lector de código de barras:** USB en modo teclado (HID). Escribe el código y un Enter en el campo activo, así que no necesita integración especial.
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
| **Proveedor** | nombre, teléfono, día de toma de pedido, día de entrega, notas | Productos |
| **Producto** | código de barras, nombre, precio de venta, costo, stock actual, stock mínimo, stock máximo, activo | Proveedor (uno) |
| **MovimientoStock** | producto, tipo (venta/compra/ajuste), cantidad, motivo, usuario, fecha | Producto, Usuario |
| **Turno** | usuario, apertura (fecha, monto inicial), cierre (fecha, monto contado), diferencia | Usuario, Ventas, MovimientosCaja |
| **MovimientoCaja** | turno, tipo (retiro/ingreso/gasto), monto, motivo, usuario | Turno |
| **Venta** | turno, usuario, fecha, total, medio de pago, estado (pendiente/pagada/anulada) | Ítems, Pago MP, Factura |
| **ItemVenta** | venta, producto, cantidad, precio unitario | Venta, Producto |
| **PagoMercadoPago** | venta, id de pago MP, estado, monto, fecha | Venta |
| **Factura** | venta, tipo (C), punto de venta, número, CAE, vencimiento del CAE, estado | Venta |
| **Pedido** *(opcional)* | proveedor, fecha, ítems sugeridos/pedidos, estado | Proveedor, Productos |

> Se asume **un proveedor por producto**. Si más adelante un producto puede venir de varios proveedores, se agrega una tabla intermedia ProductoProveedor.

## Flujos principales

### Venta

```
Escanear productos --> Elegir medio de pago
                          |
          +---------------+-----------------+
          v                                 v
     Efectivo / otro                  Mercado Pago
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
          +---------> Imprimir ticket / comprobante
```

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

**Pendiente**: se define junto con el [stack tecnológico](stack-tecnologico.md).
