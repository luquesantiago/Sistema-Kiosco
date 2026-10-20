# Requisitos y límites

## Requisitos funcionales

### Usuarios y roles
- El sistema tiene dos roles: **admin** y **empleado**.
- El empleado puede abrir y cerrar su turno, vender, cobrar y **anular ventas del día** (ver Ventas).
- El empleado **no** puede editar precios, borrar ventas, hacer ajustes de stock ni ver el dashboard completo.
- Las acciones delicadas (anulaciones, descuentos, ajustes de stock, retiros de caja) quedan registradas con usuario y fecha.
- **Ingreso** con usuario y contraseña. La contraseña tiene al menos 8 caracteres. Tras 5 intentos fallidos seguidos, el usuario queda bloqueado 15 minutos.
- **Sesiones:** la del empleado dura **7 horas** desde el ingreso (un turno con margen); la del admin, **30 días**. Desactivar a un usuario, cambiarle el rol o restablecerle la contraseña cierra sus sesiones.
- **Gestión de usuarios:**
  - El admin crea usuarios, cambia nombre y rol, los desactiva o reactiva y restablece contraseñas.
  - Los usuarios nunca se borran.
  - Siempre queda al menos un admin activo, y un admin no puede desactivarse a sí mismo.
  - Cada usuario puede cambiar su propia contraseña.
  - No hay recuperación de contraseña por email: la restablece el admin.
- **Primer admin:** se crea con un comando de consola en el servidor.

### Productos y precios
- Alta, modificación y desactivación de productos con código de barras, nombre, precio de venta, costo (opcional), stock mínimo, stock máximo y proveedor (opcional, uno por producto). Los productos nunca se borran.
- El stock actual se muestra pero no se edita en la ficha: lo mueven las ventas, los ingresos y los ajustes (ver Stock).
- El admin puede **cambiar precios desde el celular**.
- Búsqueda por código de barras exacto (lo que manda el lector) y por parte del nombre, sin distinguir mayúsculas ni acentos.
- El **empleado no ve el costo ni el proveedor** de los productos, y solo encuentra los activos.
- El código de barras es **opcional** y, cuando existe, **único**: los productos sin código (golosinas sueltas, cargas) se buscan por nombre. Para lo que no está cargado existe un ítem **"Varios"** con precio libre.
- **Alta rápida:** si el admin escanea un código que no está cargado, puede crear el producto con ese código ya completo.
- **Historial de precios:** cada cambio de precio o de costo queda registrado con usuario, fecha, valores anterior y nuevo, y origen (manual o aumento masivo). El admin lo ve en la ficha del producto.
- **Aumento masivo por porcentaje:**
  - El admin aplica un porcentaje (de -50% a +200%) a los productos activos de un proveedor o a todos.
  - El precio nuevo se redondea hacia arriba a $1, $10, $50 o $100, y nunca queda en cero.
  - Opcionalmente se aplica el mismo porcentaje al costo, con dos decimales y sin redondeo.
  - Antes de confirmar se ve una vista previa con el precio actual y el nuevo. Se aplica todo junto o nada.
- No hay productos por peso: cantidades y stock son números enteros.

### Proveedores
- Cada proveedor tiene varios productos asociados.
- Cada proveedor tiene **días de toma de pedido** y **días de entrega**, que pueden ser varios por semana o ninguno.
- La lista de proveedores marca cuáles **toman pedido hoy** (según la hora de Argentina) y los muestra primero.
- Los pedidos también se pueden hacer por teléfono en cualquier momento, así que el sistema muestra el teléfono del proveedor como enlace para llamar desde el celular.
- Los proveedores no se borran: se desactivan. Un proveedor desactivado no se puede asignar a productos, pero sus productos conservan la asociación.

### Stock
- La venta descuenta el stock automáticamente.
- El ingreso de mercadería (compra a un proveedor) suma stock.
- Los ajustes manuales (rotura, vencimiento, robo, conteo) requieren un motivo y solo los hace el admin.
- El stock **puede quedar negativo**: nunca bloquea una venta.
- Cada cambio de stock queda como un movimiento (venta, compra, ajuste o anulación) con usuario y fecha; el stock actual del producto se actualiza en la misma operación que el movimiento.
- El admin tiene una carga rápida para descontar varios productos de una vez, con motivo "venta sin sistema" (ver "Corte de internet o de luz").

### Ventas (POS)
- Venta rápida escaneando con el lector de código de barras.
- Modificar cantidades y quitar ítems antes de cobrar.
- Medios de pago: **efectivo**, **débito**, **crédito** y **Mercado Pago**. Las transferencias se reciben por Mercado Pago y se registran con ese medio.
- Con **Mercado Pago**: el sistema genera el cobro mediante la API de MP y **espera la confirmación del pago** antes de cerrar la venta (Etapa 5; antes se registra a mano).
- No hay descuentos.
- Impresión de un ticket o comprobante.
- **Anulación de ventas:**
  - El empleado puede anular ventas del día (desde la Etapa 2, del turno abierto); las anteriores solo las anula el admin.
  - El motivo es obligatorio.
  - La venta queda en estado `anulada` y nunca se borra, y el stock se repone.
  - Se avisa al admin por WhatsApp con la hora, quién anuló, el motivo y el detalle de la venta.

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
- **Dependencia de internet:** al estar hosteado, sin conexión en el kiosco no se puede usar el sistema. No hay modo sin conexión (ver abajo).

## Corte de internet o de luz

No hay modo sin conexión. Durante un corte:

1. El empleado anota en papel lo que vende.
2. Al volver el sistema, el admin descuenta el stock de lo vendido con la carga rápida, motivo "venta sin sistema".
3. El admin registra el total cobrado como un **ingreso de caja** (Etapa 2), así el cierre del turno no da una diferencia falsa.

## Preguntas abiertas

- [x] ¿Qué pasa si se corta internet en el kiosco? → No hay modo sin conexión; se anota en papel y se carga después (ver "Corte de internet o de luz").
- [ ] ¿Qué modalidad de Mercado Pago: QR dinámico, QR estático o terminal Point?
- [x] ¿Qué otros medios de pago hay además de efectivo y MP? → Débito y crédito. Las transferencias entran por Mercado Pago.
- [ ] ¿Se facturan las ventas con débito y crédito, o solo si el cliente lo pide?
- [x] ¿Hay productos sin código de barras? → Sí: el código es opcional, se buscan por nombre y hay un ítem "Varios" con precio libre.
- [x] ¿Se manejan productos por peso (balanza)? → No.
- [x] ¿El empleado puede hacer descuentos o anular ventas? → No hay descuentos. El empleado puede anular ventas del día, con motivo y aviso al admin por WhatsApp.
- [ ] ¿Se registran fiado o cuentas corrientes de clientes?
- [ ] ¿Desde qué número sale el aviso de WhatsApp (el chip vinculado a WAHA)?
- [ ] ¿Hace falta cancelar facturas (notas de crédito C) ante devoluciones?
