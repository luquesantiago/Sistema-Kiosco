# Design

## Context

- **Hoy:** solo existe el Compose de desarrollo (`infra/docker-compose.dev.yml`, PostgreSQL 18 en `127.0.0.1`). No hay Dockerfile.
- **La app ya está preparada para producción:**
  - `pnpm build` compila la web (`apps/web/dist`) y la API con `tsup` (`apps/api/dist/server.js`), y la API sirve la web.
  - Con `NODE_ENV=production` la cookie de sesión es `Secure`.
  - `GET /api/health` informa el estado de la API y de la base, y la configuración se valida al arrancar (spec `estado-del-servicio`).
- **Lo que falta en la app:**
  - El comando `crear-admin` no está en el build: hoy corre con `tsx`.
  - Fastify no confía en el proxy, así que los logs mostrarían la IP de Caddy.
- **Stack decidido:** VPS con Docker Compose, Caddy con HTTPS automático, `pg_dump` diario con 30 días de retención. Ver `docs/stack-tecnologico.md`.
- **Decisiones del dueño:** todo gratis (servidor y dominio), backups en Google Drive, deploy manual por script, WAHA en un cambio aparte.
- **Requisitos:** ver `specs/despliegue` y `specs/backups`.

## Goals / Non-Goals

**Goals:**
- Que el sistema quede en internet a bajo costo y pagando en pesos, con HTTPS y la base a salvo.
- Que actualizar sea un comando, con backup previo y vuelta atrás automática si la versión nueva no arranca.
- Que el dueño pueda reconstruir todo en un servidor nuevo siguiendo el runbook.

**Non-Goals:**
- Alta disponibilidad o réplicas: un solo servidor alcanza para un kiosco.
- Monitoreo externo y alertas: llegan con WhatsApp (`envio-whatsapp`).
- Deploy automático desde GitHub.

## Decisions

### Servidor: Cloud Server de DonWeb (Argentina)
- **Plan:** 2 vCPU, 4 GB de RAM y 30 GB de disco libre, con Ubuntu LTS (Debian si no hay), pago anual en pesos. Los nodos están en Argentina y el servidor trae una IPv4 pública fija.
- **Por qué:** el dueño prefirió pagar en pesos a un proveedor local. No hay percepciones por compra en dólares, la latencia desde el kiosco es la mínima y el soporte es en castellano. Con 4 GB alcanza también para WAHA (que usa un Chromium).
- **Arquitectura:** x86 (amd64), la misma de la CI. La imagen igual se construye para arm64 y amd64, así que cambiar de proveedor no toca el código.
- **Alternativas descartadas** (precios del 21/10/2026):
  - Oracle Cloud "Always Free" (ARM, gratis): reclama instancias ociosas, puede no tener capacidad y en 2026 recortó el cupo.
  - OVHcloud VPS-1 (4 GB, USD 5,35): más barato, pero en dólares (con impuestos, unos USD 8) y desde Canadá.
  - Google Cloud y Azure gratis: 1 GB de RAM, no alcanza.
- **Renovación:** el precio anual es de promoción. El dueño anota la fecha y el precio de renovación. Si sube mucho, se puede migrar con el procedimiento de "Se perdió el servidor" del runbook (deploy y restauración desde Drive).

### Dominio: subdominio de DuckDNS
- `<nombre>.duckdns.org`, apuntado a la IPv4 fija del servidor. Es gratuito, permanente y compatible con el desafío HTTP de Let's Encrypt que usa Caddy.
- El dominio es una variable (`DOMINIO`): pasar a un `.com.ar` propio más adelante es cambiar esa variable y el DNS.
- **Alternativa descartada:** `sslip.io` o `nip.io` con la IP. Dependen de un tercero sin cuenta y comparten límites de Let's Encrypt con todos sus usuarios.

### Servicios: `infra/docker-compose.prod.yml`
| Servicio | Imagen | Detalle |
|---|---|---|
| `caddy` | `caddy:2` | Único con puertos publicados (80 y 443). `{$DOMINIO} { encode; reverse_proxy app:3000 }`. Volúmenes para certificados. |
| `app` | build del `Dockerfile` | `NODE_ENV=production`, `PORT=3000`. Healthcheck con `fetch` a `/api/health`. Arranca cuando `db` está sana. |
| `db` | `postgres:18-alpine` | Sin puertos publicados. Volumen `db-data`. Healthcheck con `pg_isready`. |

- Todos llevan `restart: unless-stopped` y `TZ=America/Argentina/Buenos_Aires`.
- Las variables vienen de `infra/.env`, ignorado por git. Se versiona `infra/.env.example` con `DOMINIO`, `POSTGRES_PASSWORD` y `DATABASE_URL` armada con esa contraseña.

### Imagen: `Dockerfile` multi-etapa
- **Base:** `node:24-bookworm-slim`, con glibc para usar los binarios precompilados de `argon2` en arm64 y amd64.
- **Etapas:**
  1. `deps`: `pnpm install --frozen-lockfile` con caché del store.
  2. `build`: `pnpm build` y `prisma generate`.
  3. `migrate`: hereda de `build` y corre `prisma migrate deploy`. Es un target aparte para que el CLI de Prisma, que es dependencia de desarrollo, no quede en la imagen final.
  4. `runtime`: `pnpm deploy --filter api --prod` más `apps/web/dist`. Corre como usuario `node`.
- **El build se hace en el propio servidor**, así no hace falta un registro de imágenes ni credenciales de GitHub en el servidor.
- **Alternativa descartada:** construir en GitHub Actions y publicar en GHCR. Exige un build multiplataforma y que el servidor se autentique contra el registro.

### Deploy: `infra/deploy.sh [ref]`
Son dos partes. La primera la corre el script de la versión instalada:
1. Rechaza el deploy si hay cambios sin commitear: se colarían en la imagen.
2. `git fetch`. Si `ref` es una rama, se resuelve como `origin/<rama>` (la rama local del clone queda vieja).
3. Si existe el volumen de la base, aunque el contenedor esté detenido, la levanta y corre `backup.sh` solo local (`BACKUP_REMOTO=''`, sufijo `-predeploy`). Así el deploy no depende de Google Drive.
4. `git checkout` y `exec` del `deploy.sh` de la versión nueva, con el commit previo y la ruta de la copia. Así un cambio en el script toma efecto en el mismo deploy.

La segunda la corre el script de la versión nueva:
1. Etiqueta como `kiosco-app:anterior` la imagen del **contenedor que está corriendo**, no la última `actual`, que un deploy cortado pudo dejar apuntando a una imagen sin verificar.
2. Valida el Caddyfile con `caddy validate`.
3. Actualiza las imágenes base (Node, Caddy, PostgreSQL). Si falla, sigue con las que ya están.
4. Construye, corre `migrate`, recrea solo `app` y espera hasta 60 segundos a que su healthcheck quede `healthy`. Caddy espera a la app, así que un `up` de todo fallaría antes de poder volver atrás.
5. **Si queda sana:** `up` del resto (toman las imágenes nuevas), recrea Caddy para que lea el Caddyfile nuevo, borra las imágenes sin etiqueta y la caché de build de más de un mes, y muestra la ruta de la copia previa.
6. **Si algo falla** (validación, build, migraciones, salud) **o lo interrumpen** (Ctrl+C, TERM): vuelve el código al commit previo y `actual` a `anterior`, y, si ya se había recreado la app, la levanta con la imagen anterior. Ignora SIGHUP: un corte de SSH no frena el deploy. Además, el runbook manda correrlo dentro de `tmux`.

- El contrato `deploy.sh --continuar <commit previo> <copia>` no puede cambiar entre versiones.
- Las migraciones no se revierten. La regla, que se documenta, es escribir migraciones compatibles con la versión anterior (agregar antes de quitar). Si una migración rompe datos: `deploy.sh <commit anterior>` y después `restaurar.sh` con la copia `-predeploy`.

### Backups: timer de systemd en el servidor más `rclone`
- **`infra/backup.sh`:**
  0. Espera hasta 2 minutos a que `pg_isready` responda: con `Persistent=true`, la corrida perdida se dispara apenas arranca el servidor, cuando Postgres puede estar iniciando.
  1. Corre `docker compose exec -T db pg_dump -Fc`, que ya sale comprimido, hacia `/var/backups/kiosco/kiosco-AAAA-MM-DD-HHMMSS.dump`. Primero escribe en un archivo temporal y lo renombra solo si `pg_dump` terminó bien.
  2. Sube con `rclone copy /var/backups/kiosco gdrive:kiosco-backups`. Como `copy` es idempotente, sube también los que hayan fallado otro día.
  3. Solo si la subida terminó bien, borra en Drive con `rclone delete --min-age 30d` y en el servidor los archivos de más de 7 días.
- **Timer:** `kiosco-backup.timer` con `OnCalendar=*-*-* 03:00 America/Argentina/Buenos_Aires` y `Persistent=true`, para que corra al volver si el servidor estaba apagado a esa hora. Los logs quedan en `journalctl -u kiosco-backup`.
- **rclone y Google Drive:**
  - Se configura con alcance `drive.file`: solo ve los archivos que crea, no el resto del Drive.
  - La autorización se hace con `rclone authorize "drive"` desde una PC con navegador, porque el servidor no tiene pantalla.
  - Se usa el cliente OAuth propio de rclone: su token se renueva solo. Un cliente propio en modo "Testing" vence cada 7 días.
- **Alternativa descartada:** un contenedor con cron para los backups. Suma una imagen más y la zona horaria del cron es más difícil de controlar. El timer del host es más simple y el stack ya descarta el cron solo para la tarea de la app.
- **Copias privadas:** `umask 077` en los scripts y `UMask=0077` en la unidad. Las copias tienen todos los datos y los hashes de las contraseñas.
- **`infra/restaurar.sh <archivo|fecha> [--si] [--sin-copia-previa]`:**
  1. Si se le pasa una fecha, busca la última copia de ese día en el servidor y, si no hay, la baja de Drive.
  2. **Antes de tocar nada**, verifica que la copia se lea entera (`pg_restore --file=/dev/null`) y pide escribir `RESTAURAR`.
  3. Guarda lo que hay en `antes-de-restaurar-*.dump`. Si no puede, aborta (salvo `--sin-copia-previa`, para una base rota).
  4. Detiene la app, recrea la base y corre `pg_restore --single-transaction`. Si algo falla desde acá, muestra cómo volver con la copia del paso 3.
  5. Compara con `prisma migrate status` las migraciones de la copia con las de la versión instalada. Si no coinciden, deja la app detenida y explica las dos salidas: aplicar las migraciones o desplegar la versión de la copia.
  6. Levanta la app y espera a que quede sana.

### Cambios en la app
- `tsup` suma la entrada `src/cli/crear-admin.ts`. En producción se usa `docker compose exec app node dist/cli/crear-admin.js --usuario ... --nombre ...`.
- `crearApp` acepta `trustProxy`, y `server.ts` lo activa en producción.
- `server.ts` espera hasta 60 segundos a que la base responda antes de atender pedidos, y si no responde, sale (`esperarBase`). Al reiniciar el servidor, Docker levanta los contenedores sin respetar `depends_on`.
- `/api/health` no loguea cada pedido (`logLevel: 'warn'`): el healthcheck lo llama cada 10 segundos. Además, todos los servicios rotan sus logs (`local`, 5 × 10 MB).
- La imagen final deja el código como propiedad de root (el proceso corre como `node` y no lo puede modificar) y no incluye llaves ni certificados (`.dockerignore`).

### Firewall
- **Firewall de DonWeb** (desde el área de cliente): entrada solo en 22, 80 y 443.
- **SSH:** DonWeb entrega `root` con contraseña. Se crea el usuario `admin` con llave SSH y `sudo`, y recién después se fija `PasswordAuthentication no` y `PermitRootLogin no` (en `00-kiosco.conf`, para que gane sobre otros archivos).
- La base no publica puertos, así que no depende de ninguna regla para quedar cerrada.

### Verificación en la CI
- Un job nuevo construye la imagen (amd64) y levanta el Compose de producción con `DOMINIO=localhost`. Con ese dominio, Caddy usa su CA interna.
- Espera a que `app` quede sana y verifica:
  - `curl -k https://localhost/api/health` → `ok`.
  - `curl -I http://localhost/` → redirección a HTTPS.
  - Que `db` no publique puertos (`docker compose port db 5432` falla).

## Risks / Trade-offs

- [El precio de promoción de DonWeb sube al renovar] → El dueño anota fecha y precio. Migrar a otro proveedor es seguir el procedimiento de servidor perdido, sin cambios de código.
- [El disco de DonWeb es de bajo rendimiento (alrededor de 300 IOPS)] → Alcanza para un kiosco. Si los backups o el build se vuelven lentos, se amplía el plan.
- [El firewall del panel viene con reglas por defecto] → El runbook pide dejar solo 22, 80 y 443, y la base no publica puertos en el Compose.
- [DuckDNS es un servicio gratuito sin garantía] → El dominio es una variable. Migrar a un dominio propio lleva minutos y no toca código.
- [El token de Google Drive se revoca (cambio de contraseña o de permisos)] → La subida falla y las copias quedan en el servidor 7 días. El runbook explica cómo reautorizar. Hasta que lleguen las alertas por WhatsApp, el dueño revisa `journalctl` una vez por semana, como indica el runbook.
- [Una migración incompatible rompe la versión anterior y la vuelta atrás no alcanza] → Backup automático antes de migrar y la regla de migraciones compatibles.
- [Build en el servidor: consume CPU durante el deploy] → Se despliega fuera del horario del kiosco (antes de las 7 o después de las 19). El runbook lo indica.

## Migration Plan

1. El dueño crea las cuentas de DonWeb, DuckDNS y Google y contrata el Cloud Server siguiendo el runbook. Se lo acompaña paso a paso.
2. Se apunta el subdominio a la IPv4, se crea el usuario `admin` con llave SSH, se cierra el firewall a 22, 80 y 443, y se instalan Docker, git y rclone.
3. Se clona el repositorio, se completa `infra/.env`, se corre `deploy.sh` y se crea el primer admin.
4. Se configura rclone, se habilita el timer y se fuerza un backup. Después se prueba `restaurar.sh` sobre esa copia.
5. Se cargan los productos reales y se usa el sistema en paralelo al papel un día antes del primer día real.

Rollback: el kiosco vuelve al papel. Los datos quedan en el último backup.

## Open Questions

- La versión exacta de Ubuntu (o Debian) depende de lo que ofrezca DonWeb al contratar. No cambia nada del diseño.
- El nombre del subdominio de DuckDNS lo elige el dueño.
