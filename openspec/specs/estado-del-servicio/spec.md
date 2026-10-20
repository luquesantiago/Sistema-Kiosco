# estado-del-servicio Specification

## Purpose

Permite saber si la API del kiosco está funcionando y si puede usar su base de datos, para el desarrollo, la CI y el monitoreo del servidor.

## Requirements

### Requirement: Chequeo de estado de la API
La API SHALL exponer `GET /api/health` sin autenticación. La respuesta MUST ser JSON e indicar el estado general, el estado de la base de datos y la hora del servidor en UTC (ISO 8601). La respuesta MUST NOT incluir credenciales, cadenas de conexión ni detalles internos del error.

#### Scenario: Servicio y base de datos funcionando
- **WHEN** se llama a `GET /api/health` y la base de datos responde
- **THEN** la API responde `200` con `{ "estado": "ok", "baseDeDatos": "ok", "hora": "<ISO 8601 UTC>" }`

#### Scenario: Base de datos caída
- **WHEN** se llama a `GET /api/health` y la base de datos no responde
- **THEN** la API responde `503` con `"estado": "degradado"` y `"baseDeDatos": "error"`
- **AND** el detalle del error queda en el log del servidor y no en la respuesta

#### Scenario: Sin sesión iniciada
- **WHEN** se llama a `GET /api/health` sin cookie de sesión
- **THEN** la API responde igual que con sesión, sin pedir autenticación

### Requirement: Respuesta rápida ante una base de datos colgada
El chequeo de estado MUST responder en 3 segundos o menos aunque la base de datos no conteste, y reportar ese caso como base de datos con error.

#### Scenario: Base de datos que no contesta
- **WHEN** la consulta a la base de datos no termina en 2 segundos
- **THEN** la API responde `503` con `"baseDeDatos": "error"` antes de los 3 segundos

### Requirement: Configuración validada al arrancar
La API MUST validar su configuración de entorno al iniciar y MUST NOT empezar a atender pedidos si falta una variable obligatoria o tiene un valor inválido.

#### Scenario: Falta la URL de la base de datos
- **WHEN** la API arranca sin `DATABASE_URL`
- **THEN** el proceso termina con código distinto de 0
- **AND** el log nombra la variable faltante sin mostrar los valores de las demás

### Requirement: Rutas de API inexistentes
Una ruta bajo `/api/` que no existe MUST responder `404` con un cuerpo JSON, nunca con la página de la aplicación web.

#### Scenario: Ruta de API desconocida
- **WHEN** se llama a `GET /api/no-existe`
- **THEN** la API responde `404` con un cuerpo JSON que describe el error
