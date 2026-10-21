# Spec Delta

## Purpose

Define cómo corre el sistema en producción, accesible por internet de forma segura, y cómo se actualiza sin dejar el kiosco sin sistema por una versión rota.

## ADDED Requirements

### Requirement: Acceso solo por HTTPS
En producción el sistema SHALL atenderse por HTTPS en el dominio configurado, con un certificado válido que se renueva solo. Un pedido por HTTP MUST redirigirse a la misma ruta en HTTPS. La cookie de sesión MUST enviarse solo por HTTPS.

#### Scenario: Entrar por HTTP
- **WHEN** alguien abre `http://<dominio>/venta`
- **THEN** el servidor lo redirige a `https://<dominio>/venta`

#### Scenario: Certificado válido
- **WHEN** el navegador del kiosco abre `https://<dominio>`
- **THEN** la conexión es segura, sin advertencias de certificado

### Requirement: Superficie expuesta mínima
Desde internet MUST alcanzarse solo el proxy HTTPS (puertos 80 y 443) y el acceso SSH con llave. La base de datos y la app MUST NOT escuchar en interfaces públicas. El acceso SSH MUST NOT aceptar contraseñas ni el usuario root.

#### Scenario: Intentar conectarse a la base desde afuera
- **WHEN** alguien intenta conectarse al puerto 5432 del servidor desde internet
- **THEN** la conexión no se establece

#### Scenario: SSH con contraseña
- **WHEN** alguien intenta entrar por SSH con usuario y contraseña
- **THEN** el servidor lo rechaza

### Requirement: Secretos fuera del repositorio
La configuración de producción (contraseña de la base, dominio, credenciales de Google Drive) SHALL vivir en un archivo del servidor que no está en el repositorio, con un ejemplo sin valores reales versionado. La app MUST NOT arrancar si falta una variable obligatoria.

#### Scenario: Falta una variable
- **WHEN** se levanta la app sin la URL de la base
- **THEN** la app no arranca y el log indica qué variable falta, sin mostrar valores

### Requirement: Reinicio automático
Los servicios SHALL reiniciarse solos si se caen y al reiniciar el servidor, y la app MUST esperar a que la base esté lista antes de atender pedidos. Todos los contenedores MUST usar la zona horaria de Argentina.

#### Scenario: Corte de luz del datacenter o reinicio del servidor
- **WHEN** el servidor se reinicia
- **THEN** la base, la app y el proxy vuelven a estar disponibles sin intervención

### Requirement: Deploy seguro
Actualizar el sistema SHALL hacerse con un solo comando en el servidor, que aplica las migraciones pendientes antes de arrancar la versión nueva. Si la versión nueva no responde el chequeo de estado como sana en 60 segundos, el comando MUST volver a levantar la versión anterior e informar el error.

#### Scenario: Deploy correcto
- **WHEN** el admin corre el deploy de una versión nueva
- **THEN** se aplican las migraciones, arranca la versión nueva y el comando termina informando que `/api/health` responde sano

#### Scenario: Versión rota
- **WHEN** la versión nueva no responde sana en 60 segundos
- **THEN** el comando vuelve a levantar la imagen anterior y termina con error

### Requirement: Primer admin en producción
En un servidor recién instalado SHALL poder crearse el primer admin con el comando de consola existente, ejecutado dentro del contenedor de la app y pidiendo la contraseña sin mostrarla.

#### Scenario: Instalación nueva
- **WHEN** el dueño corre el comando de crear admin en el contenedor de producción
- **THEN** se crea el admin y puede ingresar desde el navegador
