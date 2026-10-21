# Proposal

## Why

Con la caja por turno lista, el sistema ya cubre lo necesario para el primer día real en el kiosco, pero hoy solo corre en la máquina de desarrollo. Hace falta ponerlo en un servidor accesible por internet, con HTTPS, y con copias diarias de la base fuera del servidor: si se pierde la base, se pierden las ventas, el stock y las cajas. El dueño eligió un servidor barato en Argentina, que se paga en pesos.

## What Changes

- **Imagen de producción** de la app (API + web compilada) y un **Compose de producción** con `caddy`, `app` y `db`. Solo Caddy expone puertos, con HTTPS automático y redirección de HTTP a HTTPS. La base nunca queda expuesta a internet.
- **Servidor en Argentina:** guía para contratar un Cloud Server de DonWeb (2 vCPU, 4 GB, 30 GB, pago anual en pesos) con un subdominio gratuito de DuckDNS, endurecer el acceso (usuario propio con llave SSH, sin root ni contraseñas, firewall con solo los puertos 22, 80 y 443) e instalar Docker.
- **Deploy manual con un script** (`infra/deploy.sh`) que se corre por SSH en el servidor: baja la versión indicada del repositorio, construye la imagen, aplica las migraciones y reinicia la app, y verifica `/api/health` antes de darlo por bueno. Si el chequeo falla, vuelve a levantar la versión anterior.
- **Backups diarios** a las 03:00 (hora de Argentina): `pg_dump` comprimido, guardado 7 días en el servidor y copiado a una carpeta de **Google Drive** con `rclone`, con retención de 30 días. Un procedimiento de **restauración** documentado y probado.
- **Primer admin en producción:** el comando de consola existente se incluye en la imagen para crearlo dentro del contenedor.
- **Runbook** en `infra/README.md`: primer arranque, deploy, restaurar un backup, renovar la autorización de Google Drive y qué hacer si el servidor no responde.

Fuera de alcance: WAHA y el envío de avisos (cambio `envio-whatsapp`), las alertas automáticas si falla un backup (se suman con WhatsApp) y el deploy automático desde GitHub.

## Capabilities

### New Capabilities
- `despliegue`: cómo corre el sistema en producción (servicios, HTTPS, puertos expuestos, configuración y secretos, reinicio automático) y cómo se actualiza de forma segura (migraciones, verificación y vuelta atrás).
- `backups`: copias diarias de la base fuera del servidor, su retención y la restauración.

### Modified Capabilities
<!-- Ninguna: el chequeo de estado y la validación de la configuración ya existen en `estado-del-servicio` y se reutilizan sin cambios de comportamiento. -->

## Impact

- **Nuevos archivos:** `Dockerfile` (multi-etapa, para `linux/arm64` y `linux/amd64`), `.dockerignore`, `infra/docker-compose.prod.yml`, `infra/Caddyfile`, `infra/.env.example`, `infra/deploy.sh`, `infra/backup.sh`, `infra/restaurar.sh`.
- **API:** el build (`tsup`) suma el comando `crear-admin` para usarlo en producción; Fastify confía en el proxy (Caddy) para la IP real en los logs.
- **CI:** un job que construye la imagen de Docker y levanta el Compose de producción contra un dominio local para verificar que arranca y responde `/api/health`.
- **Docs:** `infra/README.md` (runbook) y `docs/stack-tecnologico.md` (proveedor de VPS, dominio y almacenamiento de backups elegidos).
- **Cuentas externas** que crea el dueño: DonWeb (el servidor, que se paga en pesos), DuckDNS y la cuenta de Google donde quedan los backups.
