# Infraestructura

| Archivo | Para qué |
|---|---|
| `docker-compose.dev.yml` | PostgreSQL para desarrollo y tests |
| `docker-compose.prod.yml`, `Caddyfile`, `.env.example` | El sistema en producción: `caddy` (HTTPS), `app` y `db` |
| `deploy.sh` | Actualizar el sistema en el servidor |
| `backup.sh`, `systemd/` | Copia diaria de la base a Google Drive (timer de las 03:00) |
| `restaurar.sh` | Volver a una copia |
| `lib.sh` | Funciones comunes de los tres scripts |

La imagen de la app se arma con el `Dockerfile` de la raíz del repositorio.

## Base de datos de desarrollo

`docker-compose.dev.yml` levanta PostgreSQL 18 escuchando solo en `127.0.0.1`, con dos bases:

| Base | Uso | URL |
|---|---|---|
| `kiosco` | desarrollo (`apps/api/.env`) | `postgresql://kiosco:kiosco@localhost:5432/kiosco` |
| `kiosco_test` | tests de la API | `postgresql://kiosco:kiosco@localhost:5432/kiosco_test` |

`kiosco_test` la crea `db/init/01-test-db.sql` la primera vez que se inicializa el volumen.

Desde la raíz del repositorio:

```bash
pnpm db:up
```

Levanta el contenedor y espera a que la base esté lista.

```bash
pnpm db:down
```

Detiene y borra el contenedor. Los datos quedan en el volumen.

Para **resetear** la base (borra todos los datos de desarrollo y de test):

```bash
docker compose -f infra/docker-compose.dev.yml down -v
```

Después, `pnpm db:up` la recrea vacía, incluida `kiosco_test`.

### Puerto ocupado

Si el puerto 5432 ya lo usa otro PostgreSQL, levantá la base en otro puerto y ajustá las URLs:

```bash
DB_PORT=5433 pnpm db:up
```

- En `apps/api/.env`, cambiá el puerto de `DATABASE_URL` a `5433`.
- Para los tests, definí `TEST_DATABASE_URL` con el mismo puerto.

## Producción (runbook)

```
 Internet --HTTPS--> [ caddy :80 :443 ] --> [ app :3000 ] --> [ db :5432 ]
                       único con puertos      red interna      red interna
                                                                   |
                       timer 03:00 --> backup.sh --pg_dump-------+
                                           |
                                           +--rclone--> Google Drive (30 días)
```

- **Servidor:** Cloud Server de DonWeb, en Argentina: 2 vCPU, 4 GB de RAM y 30 GB de disco, con Ubuntu. Se paga en pesos.
- **Dominio:** subdominio gratuito de DuckDNS (`<nombre>.duckdns.org`) apuntado a la IPv4 fija del servidor.
- **Usuarios del servidor:**
  - `root` es el que entrega DonWeb. Se usa solo en el paso 3 y después queda sin acceso por SSH.
  - `admin` es el que se crea en el paso 3. Entra con la llave SSH y tiene `sudo`.
  - `kiosco` corre el sistema y los backups. No tiene contraseña ni `sudo`, y es dueño de `/opt/kiosco` (el repositorio) y `/var/backups/kiosco` (7 días de copias; Drive guarda 30).
  - Cada bloque de comandos dice con qué usuario se corre. Para pasar de `admin` a `kiosco`: `sudo -iu kiosco`. Para volver: `exit`.
- **En la PC:** los comandos son de **Git Bash** (viene con Git para Windows). En PowerShell, `curl` y `nc` no funcionan igual.
- Los pasos 1 a 6 se hacen una sola vez. Lo de todos los días está en [Operación](#operación).

### 1. Cuentas

1. **DonWeb** (`donweb.com`): crear la cuenta de cliente con los datos del dueño. Ahí llegan las facturas y los datos de acceso al servidor.
2. **DuckDNS** (`duckdns.org`): entrar con la cuenta de Google, crear el subdominio (por ejemplo `mi-kiosco`) y dejar la página abierta para el paso 2.
3. **Google:** la cuenta donde van a quedar los backups (conviene la del dueño). No hay que crear nada todavía. **Nunca quitar el acceso de "rclone"** en la seguridad de esa cuenta: con el permiso que usa (solo los archivos que creó), una autorización nueva no ve las copias viejas (ver [Restaurar un backup](#restaurar-un-backup)).

### 2. Contratar el servidor

1. En `donweb.com/es-ar/cloud-server-vps`, armar el Cloud Server:
   - **Sistema operativo:** Ubuntu, la versión LTS más nueva que ofrezca (24.04 o posterior). Si no hay Ubuntu LTS, Debian 12 o posterior también sirve.
   - **vCPU y RAM:** 2 vCPU con **4 GB**. Con 2 GB alcanza para hoy, pero WhatsApp (WAHA) va a necesitar más.
   - **Disco libre:** **30 GB**. Alcanza para las imágenes de Docker y 7 días de copias. El disco se puede ampliar, pero no achicar.
   - **Pago:** anual, porque sale bastante más barato que el mensual. Anotar la fecha de renovación y el precio que va a cobrar.
2. Cuando esté listo, en el **área de cliente** de DonWeb están la **IPv4** del servidor y la **contraseña de `root`**.
3. En DuckDNS, poner esa IPv4 en el subdominio y *update ip*. La IP del servidor es fija: no hace falta actualizarla mientras exista el servidor.

### 3. Acceso seguro y firewall

1. **En la PC** (Git Bash), crear una llave SSH (una sola vez) y copiarla al servidor (pide la contraseña de `root`):

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/kiosco -C kiosco
   ssh-copy-id -i ~/.ssh/kiosco.pub root@<IP>
   ```

2. **En el servidor, como `root`** (`ssh -i ~/.ssh/kiosco root@<IP>`), crear el usuario `admin` con la misma llave:

   ```bash
   adduser --gecos '' admin           # pide una contraseña: la usa sudo, guardarla en un lugar seguro
   usermod -aG sudo admin
   install -d -o admin -g admin -m 700 /home/admin/.ssh
   install -o admin -g admin -m 600 /root/.ssh/authorized_keys /home/admin/.ssh/authorized_keys
   ```

3. **En otra ventana de la PC**, comprobar que `admin` entra con la llave **antes** de cerrar la sesión de `root`: `ssh -i ~/.ssh/kiosco admin@<IP>`, y adentro `sudo whoami` (tiene que decir `root`).
4. **Firewall de DonWeb** (área de cliente → el Cloud Server → *Firewall*): dejar entrar solo TCP **22** (SSH), **80** y **443**, y cerrar el resto. Si el panel trae otras reglas abiertas por defecto, quitarlas.

La base no publica puertos en el Compose, así que queda cerrada aunque se abra algo más por error.

### 4. Preparar el servidor

**Como `admin`:**

```bash
sudo apt update && sudo apt full-upgrade -y

# SSH solo con llave y sin root. "00-" para que se lea antes que los demás:
# en sshd gana el primer valor.
printf 'PasswordAuthentication no\nPermitRootLogin no\n' | sudo tee /etc/ssh/sshd_config.d/00-kiosco.conf
sudo sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin) '   # tienen que decir "no"
sudo systemctl reload ssh

# Zona horaria (los logs y el timer usan la de Argentina igual, pero así coinciden).
sudo timedatectl set-timezone America/Argentina/Buenos_Aires

# Actualizaciones de seguridad automáticas.
sudo apt install -y unattended-upgrades

# Docker, git, tmux y rclone (su instalador necesita unzip).
curl -fsSL https://get.docker.com | sudo sh
sudo apt install -y git tmux unzip
curl -fsSL https://rclone.org/install.sh | sudo bash

# Usuario que corre el sistema y los backups.
sudo adduser --disabled-password --gecos '' kiosco
sudo usermod -aG docker kiosco
sudo install -d -o kiosco -g kiosco -m 755 /opt/kiosco
sudo install -d -o kiosco -g kiosco -m 700 /var/backups/kiosco
```

Ubuntu instala solo las actualizaciones de seguridad del sistema (`unattended-upgrades`). Las de Caddy, PostgreSQL y Node llegan con cada deploy: conviene correr `./infra/deploy.sh` al menos una vez por mes aunque no haya cambios.

### 5. Instalar el sistema

**Como `kiosco`** (desde `admin`: `sudo -iu kiosco`):

```bash
git clone https://github.com/luquesantiago/Sistema-Kiosco.git /opt/kiosco
cd /opt/kiosco
cp infra/.env.example infra/.env
chmod 600 infra/.env
openssl rand -hex 24   # copiar el resultado como POSTGRES_PASSWORD
nano infra/.env        # DOMINIO, POSTGRES_PASSWORD, NOMBRE_KIOSCO (sin comillas)
./infra/deploy.sh
```

El primer deploy tarda unos minutos porque construye la imagen. Al terminar dice `Listo: la app responde sana`.

Crear el primer admin (pide la contraseña dos veces, sin mostrarla) y volver a `admin`:

```bash
docker compose -f infra/docker-compose.prod.yml exec app \
  node dist/cli/crear-admin.js --usuario dueno --nombre "Nombre del dueño"
exit
```

Desde la PC del kiosco abrir `https://<subdominio>.duckdns.org` e ingresar. El primer acceso puede tardar unos segundos mientras Caddy pide el certificado.

Verificar **desde la PC** (Git Bash):

```bash
curl -I http://<subdominio>.duckdns.org        # 308 hacia https://
timeout 5 bash -c 'echo > /dev/tcp/<IP>/5432' && echo ABIERTO || echo cerrado   # tiene que decir "cerrado"
ssh -o PubkeyAuthentication=no admin@<IP>      # tiene que decir "Permission denied (publickey)"
ssh -i ~/.ssh/kiosco root@<IP>                 # tiene que rechazarlo: root ya no entra
```

En PowerShell, el chequeo de la base es `Test-NetConnection <IP> -Port 5432`, y tiene que dar `TcpTestSucceeded : False`.

### 6. Backups a Google Drive

1. **Configurar rclone, como `kiosco`** (`sudo -iu kiosco`):

   ```bash
   rclone config
   ```

   - `n` (new remote), nombre **`gdrive`**, tipo **`drive`**.
   - `client_id` y `client_secret`: vacíos. Así usa el cliente de rclone, cuyo permiso no vence.
   - `scope`: **`drive.file`**. rclone solo ve los archivos que crea, no el resto del Drive.
   - *Edit advanced config?*: `n`.
   - *Use web browser to automatically authenticate?*: **`n`**. El servidor no tiene navegador.
   - rclone muestra un comando `rclone authorize "drive" "..."`. Correrlo **en la PC** (con [rclone instalado](https://rclone.org/downloads/)), aceptar en el navegador con la cuenta de Google de los backups y pegar en el servidor el token que devuelve.
   - *Configure this as a Shared Drive?*: `n`. *Keep this "gdrive" remote?*: `y`. Después, **`q`** para salir del menú.

   ```bash
   rclone mkdir gdrive:kiosco-backups
   rclone lsd gdrive:            # tiene que aparecer kiosco-backups
   exit
   ```

2. **Activar el timer, como `admin`:**

   ```bash
   sudo cp /opt/kiosco/infra/systemd/kiosco-backup.* /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now kiosco-backup.timer
   systemctl list-timers kiosco-backup     # próxima: 03:00 de Argentina (06:00 UTC)
   ```

3. **Forzar un backup** y ver que llegó a Drive, **como `admin`:**

   ```bash
   sudo systemctl start kiosco-backup.service
   journalctl -u kiosco-backup -n 20      # "Subida a gdrive:kiosco-backups completa"
   sudo -u kiosco rclone ls gdrive:kiosco-backups
   ```

4. **Probar la restauración desde Drive**, obligatorio antes del primer día real. Se apartan las copias del servidor para que `restaurar.sh` tenga que bajar la de hoy de Google Drive. Restaurar la copia recién hecha no cambia nada, pero comprueba todo el camino. **Como `kiosco`:**

   ```bash
   cd /opt/kiosco
   mkdir -p /var/backups/kiosco/apartadas
   mv /var/backups/kiosco/kiosco-*.dump /var/backups/kiosco/apartadas/
   ./infra/restaurar.sh "$(TZ=America/Argentina/Buenos_Aires date +%F)"   # escribir RESTAURAR
   mv /var/backups/kiosco/apartadas/*.dump /var/backups/kiosco/ && rmdir /var/backups/kiosco/apartadas
   exit
   ```

   Tiene que decir que bajó la copia de `gdrive:kiosco-backups` y terminar con `Listo: la app responde sana`. Después, ingresar a la web y ver que están los productos y usuarios cargados.

### Operación

#### Actualizar el sistema

**Como `kiosco`**, dentro de `tmux`: si se corta la conexión, el deploy sigue, y con `tmux attach -t deploy` se vuelve a verlo.

```bash
tmux new -A -s deploy
cd /opt/kiosco
./infra/deploy.sh            # la última versión de main
./infra/deploy.sh <commit>   # una versión puntual
```

- Hacerlo **fuera del horario del kiosco** (antes de las 7 o después de las 19): el build usa el CPU del servidor unos minutos.
- El script copia la base, valida el Caddyfile, actualiza las imágenes base, construye, migra y levanta la versión nueva. Si algo falla, si la versión nueva no queda sana en 60 segundos o si se lo corta con Ctrl+C, vuelve a dejar la versión anterior (código, imagen y contenedor). Al final muestra la ruta de la **copia previa al deploy** (`kiosco-...-predeploy.dump`). Conviene anotarla.
- **Las migraciones no se revierten.** Tienen que ser compatibles con la versión anterior: agregar columnas o tablas antes de quitar las viejas, en deploys distintos.
- **Si una migración salió mal** (la versión nueva quedó andando pero rompió datos):
  1. Volver a la versión anterior: `./infra/deploy.sh <commit anterior>` (ver `git log --oneline`).
  2. Restaurar la copia previa al deploy: `./infra/restaurar.sh /var/backups/kiosco/kiosco-<fecha-hora>-predeploy.dump`. No usar "la última": después de las 03:00, la última es la del timer, que ya tiene la migración aplicada.
  3. Lo vendido desde el deploy se carga como en un corte de luz (ver `docs/requisitos-y-limites.md`).
  4. Corregir la migración en `main` antes de volver a desplegar.

#### Revisión semanal (hasta que lleguen las alertas por WhatsApp)

**Como `admin`:**

```bash
journalctl -u kiosco-backup --since '7 days ago' | grep -E 'Subida|ERROR'
sudo -u kiosco rclone ls gdrive:kiosco-backups | sort -k2 | tail -n 3
df -h /                     # espacio en disco: si pasa del 80 %, revisar
```

Tiene que haber una línea `Subida ... completa` por día y ningún `ERROR`.

#### Restaurar un backup

**Como `kiosco`**, en `/opt/kiosco`:

```bash
./infra/restaurar.sh 2026-10-21                                  # la última copia de ese día
./infra/restaurar.sh /var/backups/kiosco/kiosco-2026-10-21-030000.dump
```

- **Reemplaza todos los datos actuales.** Antes verifica que la copia se lea entera y guarda lo que había en `/var/backups/kiosco/antes-de-restaurar-*.dump`. Si no puede guardarlo, no toca nada.
- Si la copia de esa fecha ya no está en el servidor, la baja de Google Drive.
- Si la copia es de antes de un deploy con migraciones, deja la app detenida y explica cómo seguir: aplicar las migraciones o desplegar la versión de esa copia.
- Lo vendido entre la copia y el momento de restaurar se pierde: cargarlo como en un corte de luz.
- **Si rclone no ve las copias de Drive** (por ejemplo, porque se quitó el acceso de rclone en la cuenta de Google): bajar el `.dump` desde `drive.google.com` (carpeta `kiosco-backups`) a la PC y subirlo al servidor.

  ```bash
  # En la PC (Git Bash):
  scp -i ~/.ssh/kiosco kiosco-2026-10-21-030000.dump admin@<IP>:/tmp/
  # En el servidor, como admin:
  sudo install -o kiosco -g kiosco -m 600 /tmp/kiosco-2026-10-21-030000.dump /var/backups/kiosco/
  # Como kiosco:
  ./infra/restaurar.sh /var/backups/kiosco/kiosco-2026-10-21-030000.dump
  ```

#### Reautorizar Google Drive

Si el journal muestra errores de subida con `invalid_grant` o `token` (por ejemplo, después de cambiar la contraseña de Google), **como `kiosco`**:

```bash
rclone config reconnect gdrive:
```

A *Use web browser to automatically authenticate?* responder **`n`**. Muestra otra vez el comando `rclone authorize ...` para correr en la PC. Después, en `/opt/kiosco`, forzar un backup: `bash infra/backup.sh`. Sube también las copias que quedaron pendientes.

#### Si el servidor no responde

1. **¿Abre `https://<subdominio>.duckdns.org`?** Si no, probar desde el celular con datos para descartar la conexión del kiosco.
2. **¿Entra por SSH?** Si entra, **como `kiosco`**:

   ```bash
   cd /opt/kiosco
   docker compose -f infra/docker-compose.prod.yml ps
   docker compose -f infra/docker-compose.prod.yml logs --tail 100 app
   ```

   Para reiniciar el servidor, **como `admin`**: `sudo reboot`. Los servicios vuelven solos.
3. **No entra por SSH:** en el área de cliente de DonWeb, ver si el Cloud Server está apagado y encenderlo, o reiniciarlo desde ahí. Revisar que DuckDNS apunte a su IPv4. Si nada funciona, abrir un ticket a soporte de DonWeb.
4. **Se perdió el servidor:** en uno nuevo, sin forzar ningún backup antes de restaurar (pisaría la copia buena con una vacía):
   1. En la PC: `ssh-keygen -R <IP>`. El servidor nuevo tiene otra llave y SSH, si no, rechaza la conexión.
   2. Pasos 2 a 4. El servidor nuevo tiene otra IPv4: actualizarla en DuckDNS.
   3. Paso 5 hasta `./infra/deploy.sh` inclusive, **sin crear el admin**: vuelve con la copia.
   4. Paso 6.1 (rclone). Ver la última copia con `rclone ls gdrive:kiosco-backups | sort -k2 | tail -n 3`.
   5. Como `kiosco`, en `/opt/kiosco`: `./infra/restaurar.sh <fecha de esa copia>`.
   6. Pasos 6.2 y 6.3 (timer y primer backup).

Mientras tanto, el kiosco sigue en papel (ver "Corte de internet o de luz" en `docs/requisitos-y-limites.md`).
