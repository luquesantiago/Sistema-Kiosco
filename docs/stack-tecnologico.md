# Stack tecnológico

> **Estado:** en definición. Este documento junta lo ya decidido y lo que falta decidir.

## Ya definido

| Área | Decisión | Notas |
|---|---|---|
| Tipo de aplicación | Web, hosteada en un servidor | Se accede por navegador desde la PC del kiosco y el celular |
| WhatsApp | **WAHA** (WhatsApp HTTP API) | Self-hosted, normalmente en Docker. Necesita un número vinculado por QR |
| Facturación | **ARCA/AFIP, WSFE** (factura electrónica) | Autenticación por WSAA con certificado digital |
| Pagos | **API de Mercado Pago** | Crear el cobro y confirmar el pago por webhook o consulta |
| Lector de código de barras | USB en modo HID (teclado) | No requiere drivers ni integración |
| Impresora | Térmica de tickets (58 u 80 mm) | No fiscal |

## A definir

### Backend
- Lenguaje y framework.
- Tiene que poder: exponer una API para el frontend, recibir webhooks de Mercado Pago, correr una tarea programada diaria (12:00, hora de Argentina) y consumir los SOAP de ARCA (WSAA y WSFE).
- Conviene evaluar las librerías existentes para ARCA en cada lenguaje.

### Frontend
- Framework o librería de UI.
- El POS es de escritorio, rápido y usable con teclado y lector. Las pantallas de admin tienen que ser responsive.

### Base de datos
- Relacional (los datos son muy estructurados: ventas, ítems, stock, caja).
- Motor a definir.

### Hosting / infraestructura
- Proveedor (VPS, PaaS, etc.).
- Tiene que poder correr: la app, la base de datos y WAHA (contenedor Docker).
- Dominio y HTTPS, necesarios para los webhooks de Mercado Pago.
- Backups automáticos.

### Impresión de tickets
- Cómo imprimir desde el navegador: diálogo de impresión del navegador, impresión silenciosa o un pequeño agente local en la PC.
- Formato del ticket y de la factura (CAE + QR de ARCA).

### Autenticación
- Sesiones o tokens y manejo de roles.

### Otros
- Testing.
- Control de versiones (por ejemplo, un repositorio git).
- Logs y monitoreo (por ejemplo, alertas si WAHA se desconecta o falla ARCA).

## Criterios para decidir

- Fácil de mantener por una sola persona.
- Buen soporte de librerías para ARCA y Mercado Pago.
- Costo de hosting bajo.
- Ecosistema conocido por quien lo va a desarrollar.
