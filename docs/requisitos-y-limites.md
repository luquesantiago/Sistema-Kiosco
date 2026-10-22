# Requisitos y límites

## Requisitos funcionales

### Usuarios y roles
- El sistema tiene dos roles: **admin** y **empleado**.
- El empleado puede abrir y cerrar su turno, vender, cobrar, registrar gastos y retiros de caja y **anular ventas de su turno** (ver Ventas y Caja).
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
- **Ingreso de mercadería** (compra a un proveedor): lo cargan **el admin o el empleado**, escaneando los productos con el lector (escanear dos veces suma una unidad) o buscándolos por nombre. El proveedor es opcional y se puede agregar una nota (por ejemplo, el número de remito). Suma stock con un movimiento `compra` por producto.
- **Costo en el ingreso:** opcional y **solo visible para el admin**, que ve el costo actual precargado. Si lo cambia, se actualiza el costo del producto y queda en el historial de precios. El empleado no ve ni carga costos.
- Si se escanea un código que no está cargado, la pantalla avisa que lo tiene que cargar el admin, sin perder lo ya cargado.
- **Ajustes manuales:** solo el admin, con un motivo obligatorio: rotura, vencimiento, robo, conteo, venta sin sistema, corrección u otro (con "otro" la nota es obligatoria).
- **Conteo rápido:** el admin carga la cantidad contada y el sistema registra un ajuste por la diferencia (nada si coincide).
- El stock **puede quedar negativo**: nunca bloquea una venta.
- Cada cambio de stock queda como un movimiento (venta, compra, ajuste o anulación) con usuario y fecha; el stock actual del producto se actualiza en la misma operación que el movimiento.
- Los movimientos **no se editan ni se borran**: un error se corrige con otro movimiento (por ejemplo, un ajuste con motivo "corrección").
- El admin tiene una carga rápida para descontar varios productos de una vez, con motivo "venta sin sistema" (ver "Corte de internet o de luz").
- El admin ve el historial de movimientos de cada producto y la lista de ingresos con su detalle.

### Ventas (POS)
- Venta rápida escaneando con el lector de código de barras: el campo de escaneo queda siempre listo y escanear de nuevo suma una unidad. Los productos sin código se buscan por nombre y se eligen con las flechas.
- Ítem **"Varios"** con precio libre (y descripción opcional) para lo que no está cargado; no mueve stock.
- Modificar cantidades y quitar ítems antes de cobrar. El carrito sobrevive a una recarga accidental de la página.
- **Atajos de teclado** (siempre visibles al pie): F1 efectivo, F2 débito, F3 crédito, F4 Mercado Pago, F6 pago mixto, F7 "Varios", flechas para elegir un ítem, + y − para la cantidad, Supr para quitar, Ctrl+Supr para vaciar (con confirmación) y F9 para imprimir el ticket.
- Medios de pago: **efectivo**, **débito**, **crédito** y **Mercado Pago**. Las transferencias se reciben por Mercado Pago y se registran con ese medio.
- **Pago mixto:** el total se puede repartir entre varios medios (un pago por medio); no se confirma hasta que lo asignado sume exactamente el total.
- **Vuelto opcional:** en efectivo, el empleado puede escribir con cuánto paga el cliente y ve el vuelto; si lo deja vacío, se cobra el total justo.
- **Precios definidos por el servidor:** el precio de cada producto se toma del catálogo al registrar la venta. Si cambió mientras se armaba el carrito, la venta se rechaza, el carrito muestra los precios nuevos y se vuelve a cobrar.
- Cada venta tiene un número correlativo, y la venta, sus pagos y el descuento de stock se guardan juntos o nada.
- **Costo de lo vendido:** cada ítem guarda el costo que tenía el producto al venderse, para calcular la ganancia. Si el producto no tenía costo (o es "Varios"), el ítem queda sin costo y no se completa después. Solo el admin ve los costos en el detalle de la venta.
- Con **Mercado Pago**: el sistema genera el cobro mediante la API de MP y **espera la confirmación del pago** antes de cerrar la venta (Etapa 5; antes se registra a mano).
- No hay descuentos.
- **Ticket solo a pedido:** después de cobrar (F9 o botón) o desde el detalle de una venta. Papel de 58 u 80 mm, con la leyenda "No válido como factura".
- **Listado de ventas:** el empleado ve las del día; el admin, cualquier rango de fechas.
- **Anulación de ventas:**
  - El empleado puede anular solo las ventas del turno abierto que él abrió; las demás solo las anula el admin.
  - El motivo es obligatorio.
  - La venta queda en estado `anulada` y nunca se borra, y el stock se repone.
  - **La devolución es siempre en efectivo, por el total de la venta**, aunque se haya cobrado con débito, crédito o Mercado Pago (nunca se devuelve por transferencia). Sale de la caja del turno abierto al anular, aunque la venta sea de otro turno. Si el admin anula sin ningún turno abierto, no afecta ninguna caja.
  - Se avisa al admin por WhatsApp con la hora, quién anuló, el motivo y el detalle de la venta.

### Caja y turnos
- 2 turnos de 6 horas: de 7:00 a 13:00 y de 13:00 a 19:00. Son una referencia: el sistema no los impone.
- **Una sola caja:** hay como máximo un turno abierto a la vez. Toda venta, también las del admin, queda asociada al turno abierto y a quien la registró. Sin turno abierto no se puede vender.
- **Quién opera:** el empleado vende y mueve la caja solo en el turno que abrió; el admin, en el turno abierto de cualquiera.
- **Apertura:** el monto inicial sale precargado con lo que quedó en la caja al cerrar el turno anterior. Quien abre puede corregirlo con lo que contó, y la diferencia de apertura queda registrada.
- **Cierre ciego:** quien cierra cuenta el efectivo sin ver cuánto debería haber. Opcionalmente registra un retiro al cierre, con motivo; lo que queda en la caja es lo contado menos ese retiro.
- **Dos cuentas:** el **efectivo** del cajón y la **cuenta de Mercado Pago del kiosco**, donde caen las ventas con débito, crédito (Point), transferencias por alias y MP. Es una cuenta distinta de la cuenta personal del admin.
- **Efectivo esperado** = monto inicial + ventas en efectivo + ingresos en efectivo − gastos en efectivo − retiros en efectivo − total de las ventas anuladas durante el turno. El vuelto no cuenta, y las tarjetas, Mercado Pago y los movimientos de la cuenta de MP no afectan el efectivo. El esperado y la diferencia los ve solo el admin.
- **Turno olvidado:** si alguien se fue sin cerrar, el siguiente cierra ese turno contando la caja. Queda registrado quién lo abrió (el responsable) y quién lo cerró.
- **Movimientos de caja** con monto y motivo obligatorio: el empleado registra gastos y retiros; los ingresos son solo del admin. No se editan ni se borran.
- **Cuenta de cada movimiento:** al registrar un gasto se elige si sale del **Efectivo** (lo preseleccionado) o de **Mercado Pago**. Los retiros e ingresos de Mercado Pago (por ejemplo, la plata que el admin pasa a su cuenta personal) son solo del admin, que los registra desde **Administración → Mercado Pago** aunque no haya un turno abierto. El retiro al cierre es siempre en efectivo.
- **Saldo de Mercado Pago:** no se calcula a mano. Llega en la Etapa 5, leído desde la API de Mercado Pago, y lo ven el admin y el empleado.
- **Categoría de los gastos:** cada gasto lleva una categoría fija, elegida con botones: **Servicios** (luz, internet, alquiler), **Insumos** (bolsas, rollos, limpieza) u **Otro**. No hay categoría de proveedor: los pagos a proveedores van por los pedidos (Etapa 3).
- **Avisos al admin:** cada gasto o retiro de un empleado y cada cierre de turno (con ventas por medio, movimientos, esperado, contado, diferencia y lo que quedó) dejan un aviso que se envía por WhatsApp (ver "Avisos por WhatsApp").
- El admin ve la lista de turnos con sus diferencias y el detalle de cada uno desde el celular.

### Avisos por WhatsApp
- Salen desde un **chip dedicado**, vinculado por QR desde **Administración → WhatsApp**, sin depender de quien hizo el sistema. El celular del chip tiene que conectarse a internet al menos cada ~14 días; si no, WhatsApp desvincula la sesión.
- Van a **un solo número**, que el admin carga en la misma pantalla: código de área sin 0 y número sin 15. El sistema verifica que tenga WhatsApp y hay un botón para mandar una prueba.
- Con WhatsApp funcionando, cada aviso sale dentro del minuto. En "Avisos" se ve si se envió y cuándo.
- Si WhatsApp no está vinculado, no responde o falta el número, los avisos **esperan** sin darse por fallados, y el panel del admin muestra un cartel con cuántos hay esperando. Al volver, se mandan uno por uno, del más viejo al más nuevo, con unos segundos entre cada uno.
- Si un aviso falla con WhatsApp conectado, se reintenta esperando cada vez más (30 s, 2, 10 y 30 min). Después de 5 fallas queda con error y su motivo, y el admin puede reintentarlo.
- Puede llegar algún aviso repetido (si WhatsApp tarda en confirmar el envío): es preferible a perder uno.

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
- Todos los días a las **12:00** se envía un WhatsApp, vía WAHA, al número que recibe los avisos.
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

- **WAHA no es la API oficial de WhatsApp.** Usa una sesión de WhatsApp Web vinculada por QR y el número puede ser bloqueado. Por eso se usa un chip dedicado, que solo le escribe al número del admin y con pausa entre mensajes.
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
- [x] ¿El empleado puede hacer descuentos o anular ventas? → No hay descuentos. El empleado puede anular ventas de su turno, con motivo y aviso al admin por WhatsApp.
- [ ] ¿Se registran fiado o cuentas corrientes de clientes?
- [x] ¿Desde qué número sale el aviso de WhatsApp (el chip vinculado a WAHA)? → Desde un chip dedicado del dueño, vinculado por QR desde Administración → WhatsApp.
- [ ] ¿Hace falta cancelar facturas (notas de crédito C) ante devoluciones?
