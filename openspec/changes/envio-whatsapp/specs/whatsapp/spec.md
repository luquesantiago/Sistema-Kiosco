# Spec Delta

## Purpose

Conecta el sistema con WhatsApp a través de un chip dedicado, para mandarle avisos al admin. Cubre la vinculación del chip, el estado de la conexión, el número que recibe los avisos y la protección del servicio de WhatsApp.

## ADDED Requirements

### Requirement: Estado de la conexión
El admin SHALL poder consultar el estado de la conexión con WhatsApp: `no_configurado` (el sistema no tiene WhatsApp configurado), `desvinculado`, `esperando_qr`, `conectado` o `no_disponible` (el servicio de WhatsApp no responde). Cuando está `conectado`, MUST indicar el número del chip vinculado. Un empleado MUST NOT poder consultarlo.

#### Scenario: Chip vinculado
- **WHEN** el admin consulta el estado con el chip vinculado
- **THEN** ve `conectado` y el número del chip

#### Scenario: Servicio de WhatsApp caído
- **WHEN** el admin consulta el estado y el servicio de WhatsApp no responde
- **THEN** ve `no_disponible`, sin detalles internos del error

#### Scenario: Empleado consulta el estado
- **WHEN** un empleado pide el estado de WhatsApp
- **THEN** el sistema responde `403`

### Requirement: Vinculación del chip por QR
El admin SHALL poder vincular el chip desde el sistema. Al pedir la vinculación, el sistema MUST mostrar el QR de WhatsApp y renovarlo mientras se espera el escaneo. Al escanearlo, el estado MUST pasar a `conectado` sin recargar la página. Si el QR se vence sin escanear, el admin MUST poder pedir uno nuevo.

#### Scenario: Vinculación exitosa
- **WHEN** el admin pide vincular y escanea el QR con el celular del chip
- **THEN** la pantalla pasa a `conectado` y muestra el número del chip

#### Scenario: QR vencido
- **WHEN** pasan los QR sin que nadie escanee
- **THEN** la pantalla ofrece generar un QR nuevo

#### Scenario: Vincular con el chip ya conectado
- **WHEN** el admin pide vincular y el estado ya es `conectado`
- **THEN** el sistema no muestra QR y mantiene la sesión actual

### Requirement: Desvinculación del chip
El admin SHALL poder desvincular el chip, por ejemplo para cambiarlo por otro. Al desvincular, el estado MUST pasar a `desvinculado` y los avisos MUST quedar pendientes hasta una nueva vinculación.

#### Scenario: Cambio de chip
- **WHEN** el admin desvincula el chip
- **THEN** el estado pasa a `desvinculado`
- **AND** los avisos nuevos quedan pendientes

### Requirement: Número que recibe los avisos
El sistema SHALL guardar un solo número de destino, que el admin carga y cambia. MUST aceptarse con o sin `+54`, `9` o `0`, y con espacios o guiones, y quedar con 10 dígitos (área y número, sin el 15). Antes de guardarlo, el sistema MUST verificar que el número tiene WhatsApp, lo que requiere el chip `conectado`.

#### Scenario: Número con formato internacional
- **WHEN** el admin carga `+54 9 11 2345-6789` y el número tiene WhatsApp
- **THEN** el número queda guardado como `11 2345-6789`

#### Scenario: Número con el 15
- **WHEN** el admin carga `11 15 2345-6789`
- **THEN** el sistema lo rechaza con un mensaje que pide cargarlo sin el 15

#### Scenario: Número sin WhatsApp
- **WHEN** el admin carga un número que no tiene WhatsApp
- **THEN** el sistema lo rechaza y conserva el número anterior

#### Scenario: Cargar el número sin el chip vinculado
- **WHEN** el admin carga un número con el estado `desvinculado`
- **THEN** el sistema lo rechaza con un mensaje que pide vincular WhatsApp primero

### Requirement: Mensaje de prueba
El admin SHALL poder mandar un mensaje de prueba al número de destino y ver en el momento si se envió o por qué falló. El mensaje de prueba MUST NOT guardarse como aviso.

#### Scenario: Prueba exitosa
- **WHEN** el admin manda la prueba con el chip conectado y un número cargado
- **THEN** el número de destino recibe el mensaje y la pantalla confirma el envío

#### Scenario: Prueba sin número
- **WHEN** el admin manda la prueba sin número de destino cargado
- **THEN** el sistema responde con un error que pide cargar el número

### Requirement: Aviso de WhatsApp sin funcionar
El panel del admin MUST mostrar un cartel con acceso a la pantalla de WhatsApp cuando el estado no es `conectado` o falta el número de destino, e indicar cuántos avisos esperan envío. Cuando WhatsApp funciona y hay número, el cartel MUST NOT mostrarse.

#### Scenario: Chip desvinculado con avisos acumulados
- **WHEN** el admin abre el panel con el chip desvinculado y 3 avisos pendientes
- **THEN** ve un cartel que dice que WhatsApp no está vinculado y que hay 3 avisos esperando

#### Scenario: Todo funcionando
- **WHEN** el admin abre el panel con el chip conectado y número cargado
- **THEN** no ve el cartel

### Requirement: Sistema sin WhatsApp configurado
La API MUST arrancar y atender pedidos aunque no tenga configurado el servicio de WhatsApp. En ese caso no se envía nada y el estado es `no_configurado`. Una caída del servicio de WhatsApp MUST NOT cambiar la respuesta del chequeo de estado de la API.

#### Scenario: Desarrollo sin WhatsApp
- **WHEN** la API arranca sin la configuración de WhatsApp
- **THEN** atiende pedidos normalmente y los avisos quedan pendientes

#### Scenario: WhatsApp caído en producción
- **WHEN** el servicio de WhatsApp no responde y se llama a `GET /api/health` con la base funcionando
- **THEN** la API responde `200` con `"estado": "ok"`

### Requirement: Servicio de WhatsApp protegido
El servicio de WhatsApp MUST NOT ser accesible desde internet ni publicar puertos en el servidor. Solo la app MUST poder usarlo, autenticándose con una clave que vive en la configuración del servidor, fuera del repositorio. Sus paneles propios MUST quedar desactivados en producción.

#### Scenario: Acceso desde internet
- **WHEN** alguien intenta conectarse desde internet al servicio de WhatsApp
- **THEN** no hay ningún puerto que responda

#### Scenario: Pedido sin la clave
- **WHEN** un contenedor de la red interna llama al servicio de WhatsApp sin la clave
- **THEN** el servicio rechaza el pedido
