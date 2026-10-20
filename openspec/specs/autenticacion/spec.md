# autenticacion Specification

## Purpose

Controla quién entra al sistema del kiosco y qué puede hacer: ingreso con usuario y contraseña, sesiones que vencen según el rol y rechazo de los pedidos sin sesión o sin permiso.

## Requirements

### Requirement: Ingreso con usuario y contraseña
El sistema SHALL permitir ingresar con usuario y contraseña a los usuarios activos. El usuario MUST compararse sin distinguir mayúsculas de minúsculas. Al ingresar, el sistema MUST iniciar una sesión y devolver el nombre, el usuario y el rol de quien ingresó.

#### Scenario: Ingreso correcto
- **WHEN** un usuario activo envía su usuario y contraseña correctos
- **THEN** el sistema responde con su nombre, usuario y rol
- **AND** deja una cookie de sesión `httpOnly`

#### Scenario: Usuario escrito con mayúsculas
- **WHEN** el usuario `juan` ingresa escribiendo `Juan` con su contraseña correcta
- **THEN** el ingreso es correcto

#### Scenario: Usuario desactivado
- **WHEN** un usuario desactivado envía su usuario y contraseña correctos
- **THEN** el sistema rechaza el ingreso con el mismo error que para credenciales incorrectas

### Requirement: Error de ingreso sin pistas
Ante un ingreso rechazado, el sistema MUST responder `401` con el mismo mensaje, sin indicar si el usuario existe, si la contraseña es incorrecta o si el usuario está desactivado.

#### Scenario: Usuario inexistente y contraseña incorrecta
- **WHEN** se intenta ingresar con un usuario que no existe
- **AND** se intenta ingresar con un usuario existente y una contraseña incorrecta
- **THEN** ambas respuestas son `401` con el mismo código y el mismo mensaje

### Requirement: Bloqueo por intentos fallidos
Tras 5 intentos fallidos seguidos para un mismo usuario, el sistema MUST rechazar todo ingreso de ese usuario durante 15 minutos, incluso con la contraseña correcta. Un ingreso correcto antes del bloqueo MUST reiniciar el contador.

#### Scenario: Quinto intento fallido
- **WHEN** un usuario acumula 5 intentos fallidos seguidos
- **THEN** durante los 15 minutos siguientes su ingreso es rechazado aunque use la contraseña correcta
- **AND** el mensaje indica que el ingreso está bloqueado temporalmente

#### Scenario: Fin del bloqueo
- **WHEN** pasaron 15 minutos desde el bloqueo
- **THEN** el usuario puede ingresar con su contraseña correcta

#### Scenario: Ingreso correcto reinicia el contador
- **WHEN** un usuario falla 4 veces, luego ingresa correctamente y después vuelve a fallar 4 veces
- **THEN** su usuario no queda bloqueado

### Requirement: Vencimiento de la sesión según el rol
La sesión de un empleado MUST vencer 7 horas después del ingreso y la de un admin 30 días después del ingreso. Una sesión vencida MUST tratarse como inexistente.

#### Scenario: Sesión de empleado vencida
- **WHEN** un empleado usa su sesión más de 7 horas después de haber ingresado
- **THEN** el sistema responde `401` y el empleado tiene que volver a ingresar

#### Scenario: Sesión de admin vigente
- **WHEN** un admin usa su sesión 10 días después de haber ingresado
- **THEN** el sistema acepta el pedido

### Requirement: Cierre de sesión
El sistema SHALL permitir cerrar la sesión actual. Después de cerrarla, la cookie MUST dejar de servir aunque alguien la conserve.

#### Scenario: Cerrar sesión
- **WHEN** un usuario cierra su sesión y luego se reutiliza la misma cookie
- **THEN** el sistema responde `401`

### Requirement: Sesión actual
El sistema SHALL exponer los datos del usuario de la sesión actual (nombre, usuario y rol) para que la web sepa quién está conectado.

#### Scenario: Consultar la sesión
- **WHEN** un usuario con sesión vigente consulta la sesión actual
- **THEN** el sistema responde con su nombre, usuario y rol

#### Scenario: Sin sesión
- **WHEN** se consulta la sesión actual sin cookie o con una sesión vencida
- **THEN** el sistema responde `401`

### Requirement: Cambio de la propia contraseña
Todo usuario SHALL poder cambiar su contraseña indicando la actual. La nueva contraseña MUST tener al menos 8 caracteres. Al cambiarla, el sistema MUST cerrar las demás sesiones del usuario y mantener la actual.

#### Scenario: Cambio correcto
- **WHEN** un usuario envía su contraseña actual correcta y una nueva de 8 caracteres o más
- **THEN** a partir de ese momento ingresa con la nueva contraseña
- **AND** sus sesiones en otros dispositivos dejan de servir

#### Scenario: Contraseña actual incorrecta
- **WHEN** un usuario envía una contraseña actual incorrecta
- **THEN** el sistema rechaza el cambio y la contraseña no cambia

#### Scenario: Contraseña nueva corta
- **WHEN** la contraseña nueva tiene menos de 8 caracteres
- **THEN** el sistema responde `400` y la contraseña no cambia

### Requirement: Acceso a la API según sesión y rol
Toda ruta de la API, salvo el ingreso y el chequeo de estado, MUST exigir una sesión vigente y responder `401` sin ella. Las rutas reservadas al admin MUST responder `403` a un empleado.

#### Scenario: Pedido sin sesión
- **WHEN** se llama a una ruta protegida sin cookie de sesión
- **THEN** el sistema responde `401` con el formato de error común

#### Scenario: Empleado en una ruta de admin
- **WHEN** un empleado con sesión vigente llama a una ruta reservada al admin
- **THEN** el sistema responde `403` y no ejecuta la acción

### Requirement: Contraseñas nunca expuestas
El sistema MUST guardar las contraseñas solo como hash y MUST NOT devolver contraseñas ni hashes en ninguna respuesta ni escribirlos en los logs.

#### Scenario: Respuestas sin contraseñas
- **WHEN** se ingresa, se consulta la sesión o se listan usuarios
- **THEN** ninguna respuesta incluye la contraseña ni su hash
