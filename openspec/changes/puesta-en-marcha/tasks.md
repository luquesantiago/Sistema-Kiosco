# Tasks

> Los grupos 1 a 4 se hacen y se prueban en la máquina de desarrollo con Docker. El grupo 5 necesita las cuentas del dueño (DonWeb, DuckDNS y Google) y se hace junto con él.

## 1. Ajustes de la app para producción

- [x] 1.1 Sumar `src/cli/crear-admin.ts` como entrada de `tsup` y documentar su uso con `node dist/cli/crear-admin.js`. Verificar que, después de `pnpm --filter api build`, el comando compilado crea un admin contra la base de desarrollo.
- [x] 1.2 Agregar la opción `trustProxy` a `crearApp` y activarla en `server.ts` cuando `NODE_ENV=production`. Verificar con un test de API que, con la opción activa, `request.ip` toma `X-Forwarded-For`, y sin ella no.

## 2. Imagen y Compose de producción

- [x] 2.1 Escribir el `Dockerfile` multi-etapa (`deps`, `build`, `migrate`, `runtime` con `pnpm deploy --prod` y usuario `node`) y el `.dockerignore`. Verificar que `docker build --target runtime` y `--target migrate` terminan bien, que la imagen final no incluye el CLI de Prisma ni el código fuente de la web, y que arranca y responde `/api/health` contra la base de desarrollo.
- [x] 2.2 Escribir `infra/docker-compose.prod.yml` (`caddy`, `app`, `migrate` en un perfil, `db`; healthchecks, `restart: unless-stopped`, `TZ`, sin puertos en `db` ni en `app`), `infra/Caddyfile` e `infra/.env.example`. Verificar localmente con `DOMINIO=localhost`:
  - `https://localhost/api/health` responde sano.
  - `http://localhost/venta` redirige a HTTPS.
  - `docker compose port db 5432` no devuelve nada.
  - Sin `DATABASE_URL`, la app no arranca y el log nombra la variable.
  - Si el proceso de la app termina (se simula con `exec app node -e "process.kill(1, 'SIGTERM')"`; un `kill` manual de Docker cuenta como detención pedida y no reinicia), el servicio vuelve solo.
- [x] 2.3 Agregar a la CI un job que construya la imagen, levante el Compose de producción con `DOMINIO=localhost` y verifique HTTPS, la redirección y que la base no publica puertos. Verificar que el job pasa en GitHub.

## 3. Deploy

- [x] 3.1 Escribir `infra/deploy.sh [ref]`: checkout de la referencia, `backup.sh`, etiqueta `anterior`, build, `migrate`, `up -d app`, espera de 60 s al healthcheck y vuelta atrás si falla. Verificar localmente con el Compose de producción:
  - Un deploy de la rama actual termina informando que la app está sana y aplica una migración pendiente.
  - Un deploy de una referencia de prueba cuya app no arranca vuelve a levantar `anterior`, sale con error y `/api/health` sigue respondiendo.
  - `shellcheck` no reporta problemas.
- [x] 3.2 Verificar el primer admin en producción: con la base vacía del Compose local, crear el admin con `docker compose exec app node dist/cli/crear-admin.js`, sin que la contraseña se vea, e ingresar desde `https://localhost`.

## 4. Backups y restauración

- [x] 4.1 Escribir `infra/backup.sh` y las unidades `infra/systemd/kiosco-backup.service` y `.timer` (03:00 en Argentina, `Persistent=true`). Verificar localmente con un remoto de `rclone` apuntado a una carpeta local:
  - Se crea `kiosco-AAAA-MM-DD-HHMMSS.dump` y se sube.
  - Con `db` detenida, el script falla, lo deja en el log y no borra ni reemplaza copias.
  - Con el remoto inaccesible, la copia queda local y la corrida siguiente sube las dos.
  - Con archivos de más de 7 y de 30 días simulados (`touch -d`), se borran solo si la subida terminó bien.
  - `systemd-analyze calendar` muestra las 03:00 en Argentina.
  - `shellcheck` no reporta problemas.
- [x] 4.2 Escribir `infra/restaurar.sh <archivo|fecha>`. Verificar localmente: cargar ventas y un turno, hacer un backup, borrar el volumen de la base, restaurar y comprobar que el admin ve las mismas ventas, el mismo stock y el mismo turno. Pasar `shellcheck`.

## 5. Servidor real, runbook y documentación

- [x] 5.1 Escribir el runbook en `infra/README.md`:
  - Cuentas: DonWeb, DuckDNS y Google.
  - Contratación del Cloud Server (2 vCPU, 4 GB, 30 GB) y subdominio apuntado a su IPv4.
  - Usuario `admin` con llave SSH, firewall del panel y endurecimiento de SSH.
  - Instalación de Docker, git y rclone.
  - `infra/.env`, `deploy.sh` y primer admin.
  - `rclone authorize`, timer, restauración, reautorizar Drive y revisión semanal de `journalctl`.
  - Migraciones compatibles, deploy fuera de horario y qué hacer si el servidor no responde.

  Verificar que cada comando del runbook es el que se probó en los grupos 2 a 4.
- [x] 5.2 Actualizar `docs/stack-tecnologico.md` (cerrar la pregunta abierta de proveedor de VPS y almacenamiento de backups, sumar DuckDNS y el timer de backups), `docs/estructura-proyecto.md` e `infra/README.md` (Compose de producción ya existente). Verificar que coinciden con las specs del cambio.
- [ ] 5.3 Instalar el sistema en el Cloud Server de DonWeb junto con el dueño, siguiendo el runbook. Verificar desde la PC del kiosco:
  - `https://<subdominio>.duckdns.org` abre sin advertencias.
  - HTTP redirige a HTTPS.
  - `nc -zv <ip> 5432` no conecta.
  - SSH con contraseña es rechazado.
  - Después de `sudo reboot` todo vuelve solo.
- [ ] 5.4 Configurar rclone con la cuenta de Google del dueño y habilitar el timer. Forzar un backup y verificar que aparece en la carpeta de Drive. Restaurarlo en una base de prueba del servidor y verificar que tiene los datos cargados.

## Workflow follow-up

- Archivar el cambio con `/opsx:archive` cuando la CI esté en verde y el sistema esté andando en el servidor.
- Sigue `envio-whatsapp`: WAHA en el Compose de producción, envío de los avisos pendientes y alertas (backup fallido, WAHA desconectado).
