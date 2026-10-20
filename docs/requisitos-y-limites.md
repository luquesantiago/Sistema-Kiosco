# Requisitos y límites

## Requisitos funcionales

### Usuarios y roles
- El sistema tiene dos roles: **admin** y **empleado**.
- El empleado puede abrir y cerrar su turno, vender y cobrar.
- El empleado **no** puede editar precios, borrar ventas, hacer ajustes de stock ni ver el dashboard completo.
- Las acciones delicadas (anulaciones, descuentos, ajustes de stock, retiros de caja) quedan registradas con usuario y fecha.

### Productos y precios
- Alta, baja y modificación de productos con código de barras, nombre, precio, costo, stock mínimo y stock máximo.
- El admin puede **cambiar precios desde el celular**.
- Búsqueda por código de barras y por nombre.

### Proveedores
- Cada proveedor tiene varios productos asociados.
- Cada proveedor tiene un **día de toma de pedido** y un **día de entrega** fijos.
- Los pedidos también se pueden hacer por teléfono en cualquier momento, así que el sistema muestra el teléfono del proveedor.

### Stock
- La venta descuenta el stock automáticamente.
- El ingreso de mercadería (compra a un proveedor) suma stock.
- Los ajustes manuales (rotura, vencimiento, robo, conteo) requieren un motivo y solo los hace el admin.

### Ventas (POS)
- Venta rápida escaneando con el lector de código de barras.
- Modificar cantidades y quitar ítems antes de cobrar.
- Medios de pago: efectivo, **Mercado Pago** y otros a definir.
- Con **Mercado Pago**: el sistema genera el cobro mediante la API de MP y **espera la confirmación del pago** antes de cerrar la venta.
- Impresión de un ticket o comprobante.

### Caja y turnos
- 2 turnos de 6 horas: de 7:00 a 13:00 y de 13:00 a 19:00.
- Apertura con monto inicial y cierre con conteo del efectivo.
- Cálculo de la diferencia entre el efectivo esperado y el contado.
- Registro de retiros, gastos e ingresos de caja con motivo.
- Cada venta queda asociada al turno y al empleado.

### Dashboard (admin)
- Ventas por día, semana y mes.
- Productos más vendidos.
- Ingresos y egresos.
- Resumen de turnos y diferencias de caja.
- Accesible desde el celular.

### Reposición
- **Fase A (inicial):** un producto necesita reposición cuando su stock actual es menor o igual al stock mínimo. Cantidad sugerida = stock máximo − stock actual.
- **Fase B (futura):** la sugerencia se calcula según el promedio de ventas diarias y los días hasta la próxima entrega del proveedor.
- Las recomendaciones se agrupan **por proveedor**.
- Todos los días a las **12:00** se envía un WhatsApp, vía WAHA, al `<NUMERO_WHATSAPP_ADMIN>`.
- Primero aparecen los proveedores que toman pedido ese día.

### Facturación
- Factura electrónica mediante los web services de ARCA (WSFE), con obtención de CAE.
- Tipo de comprobante: **Factura C** (monotributista).
- **Toda venta cobrada con Mercado Pago se factura automáticamente.**
- Las demás ventas se facturan **solo si el cliente lo pide**.
- El comprobante impreso incluye el CAE y el código QR exigido por ARCA.

## Requisitos no funcionales

- **Velocidad en el mostrador:** escanear y cobrar tiene que ser fluido y usable solo con lector y teclado.
- **Pantalla del POS:** pensada para la PC del kiosco (escritorio).
- **Pantallas de admin** (precios, productos, dashboard): **responsive**, usables en el celular.
- **Hosting:** en un servidor, accesible por internet.
- **Seguridad:** acceso con usuario y contraseña, y permisos por rol.
- **Backups** periódicos de la base de datos.
- **Hora del sistema:** zona horaria de Argentina (UTC−3) para turnos, reportes y el aviso de las 12:00.

## Límites (fuera de alcance)

- Varias sucursales o kioscos.
- Tienda online o ventas por delivery.
- Liquidación de sueldos o control horario de empleados más allá de los turnos de caja.
- Contabilidad completa (la deben llevar el contador o ARCA).
- Factura A o B (solo Factura C mientras sea monotributista).
- Impresora fiscal (se usa factura electrónica).
- Pedidos automáticos a proveedores: el sistema **recomienda**, pero el pedido lo hace una persona.

## Restricciones y riesgos

- **WAHA no es la API oficial de WhatsApp.** Usa una sesión de WhatsApp Web vinculada por QR y el número puede ser bloqueado. Se recomienda un número o chip dedicado.
- **ARCA:** requiere certificado digital, un punto de venta habilitado para web services y pruebas en el entorno de homologación antes de producción.
- **Mercado Pago:** requiere credenciales de la cuenta del kiosco y una URL pública para recibir notificaciones (webhooks).
- **Dependencia de internet:** al estar hosteado, sin conexión en el kiosco no se puede usar el sistema.

## Preguntas abiertas

- [ ] ¿Qué pasa si se corta internet en el kiosco? ¿Se acepta no vender por el sistema o hace falta un modo sin conexión?
- [ ] ¿Qué modalidad de Mercado Pago: QR dinámico, QR estático o terminal Point?
- [ ] ¿Qué otros medios de pago hay además de efectivo y MP (débito o crédito con otro posnet, transferencia)? ¿Se facturan?
- [ ] ¿Hay productos sin código de barras (golosinas sueltas, fiambre, cargas)? ¿Cómo se venden?
- [ ] ¿Se manejan productos por peso (balanza)?
- [ ] ¿El empleado puede hacer descuentos o anular ventas? ¿Con autorización del admin?
- [ ] ¿Se registran fiado o cuentas corrientes de clientes?
- [ ] ¿Desde qué número sale el aviso de WhatsApp (el chip vinculado a WAHA)?
- [ ] ¿Hace falta cancelar facturas (notas de crédito C) ante devoluciones?
