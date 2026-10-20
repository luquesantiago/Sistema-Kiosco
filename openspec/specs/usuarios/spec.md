# usuarios Specification

## Purpose

Permite al admin gestionar quién usa el sistema del kiosco: crear usuarios con su rol, editarlos, desactivarlos y restablecer sus contraseñas, sin perder nunca el acceso de administración.

## Requirements

### Requirement: Roles admin y empleado
Cada usuario SHALL tener exactamente uno de dos roles: `admin` o `empleado`. Solo un admin MUST poder ver y gestionar usuarios.

#### Scenario: Empleado intenta listar usuarios
- **WHEN** un empleado pide la lista de usuarios
- **THEN** el sistema responde `403`

### Requirement: Alta de usuario
El admin SHALL poder crear un usuario indicando nombre, usuario, rol y contraseña inicial. El usuario MUST tener entre 3 y 30 caracteres (letras, números, punto, guion o guion bajo), se guarda en minúsculas y MUST ser único sin distinguir mayúsculas. La contraseña inicial MUST tener al menos 8 caracteres.

#### Scenario: Alta correcta
- **WHEN** el admin crea el usuario `Maria` con rol empleado y una contraseña de 8 caracteres
- **THEN** el usuario `maria` queda activo y puede ingresar con esa contraseña

#### Scenario: Usuario repetido
- **WHEN** el admin crea un usuario `JUAN` y ya existe `juan`
- **THEN** el sistema responde `409` indicando que el usuario ya existe

#### Scenario: Datos inválidos
- **WHEN** el usuario tiene espacios o menos de 3 caracteres, o la contraseña tiene menos de 8
- **THEN** el sistema responde `400` y no crea el usuario

### Requirement: Lista de usuarios
El admin SHALL poder ver la lista de usuarios con nombre, usuario, rol, si está activo y la fecha del último ingreso.

#### Scenario: Ver usuarios
- **WHEN** el admin abre la lista de usuarios
- **THEN** ve todos los usuarios, activos y desactivados, sin contraseñas

### Requirement: Edición de usuario
El admin SHALL poder cambiar el nombre y el rol de un usuario. El nombre de usuario MUST NOT cambiar después del alta. Si cambia el rol, las sesiones abiertas de ese usuario MUST cerrarse.

#### Scenario: Pasar un empleado a admin
- **WHEN** el admin cambia el rol de un empleado a admin
- **THEN** el usuario tiene que volver a ingresar y entra con los permisos de admin

### Requirement: Desactivación sin borrado
El admin SHALL poder desactivar y reactivar usuarios. Los usuarios MUST NOT borrarse. Al desactivar un usuario, sus sesiones abiertas MUST cerrarse.

#### Scenario: Desactivar un empleado con sesión abierta
- **WHEN** el admin desactiva a un empleado que está usando el sistema
- **THEN** el siguiente pedido de ese empleado recibe `401`
- **AND** el empleado ya no puede volver a ingresar

#### Scenario: Reactivar
- **WHEN** el admin reactiva un usuario desactivado
- **THEN** el usuario puede volver a ingresar con su contraseña

### Requirement: Siempre queda un admin activo
El sistema MUST rechazar cualquier cambio que deje al sistema sin admins activos, ya sea desactivando o cambiando de rol al último admin activo. Un admin MUST NOT poder desactivarse a sí mismo.

#### Scenario: Último admin
- **WHEN** hay un solo admin activo y se intenta desactivarlo o pasarlo a empleado
- **THEN** el sistema responde `409` y el usuario sigue siendo admin activo

#### Scenario: Desactivarse a sí mismo
- **WHEN** un admin intenta desactivar su propio usuario
- **THEN** el sistema responde `409` y el usuario sigue activo

### Requirement: Restablecer la contraseña de otro usuario
El admin SHALL poder fijar una contraseña nueva, de al menos 8 caracteres, para cualquier usuario. Al hacerlo, las sesiones abiertas de ese usuario MUST cerrarse.

#### Scenario: Empleado que olvidó la contraseña
- **WHEN** el admin restablece la contraseña de un empleado
- **THEN** el empleado ingresa con la contraseña nueva y la anterior deja de servir

### Requirement: Creación del primer admin
El sistema SHALL ofrecer un comando de consola del servidor para crear un usuario admin, que pide la contraseña sin mostrarla en pantalla. El comando MUST aplicar las mismas validaciones que el alta de usuario.

#### Scenario: Base sin usuarios
- **WHEN** se ejecuta el comando en una base sin usuarios, con usuario, nombre y una contraseña válida
- **THEN** queda creado un admin activo que puede ingresar desde la web

#### Scenario: Usuario ya existente
- **WHEN** se ejecuta el comando con un usuario que ya existe
- **THEN** el comando termina con error y no modifica ese usuario
