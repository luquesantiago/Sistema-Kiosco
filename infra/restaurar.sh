#!/usr/bin/env bash
# Restaura una copia de la base (ver "Restaurar un backup" en infra/README.md).
# REEMPLAZA todos los datos actuales por los de la copia:
#
#   ./infra/restaurar.sh /var/backups/kiosco/kiosco-2026-10-21-030000.dump
#   ./infra/restaurar.sh 2026-10-21     la última copia de ese día, del servidor
#                                       o, si no está, del remoto (Google Drive)
#
# Opciones (después de la copia):
#   --si                 no pide escribir RESTAURAR para confirmar
#   --sin-copia-previa   sigue aunque no se pueda guardar lo que hay ahora
#                        (solo si la base actual está rota)
#
# Antes de borrar: verifica que la copia se lea entera y guarda lo que hay en
# BACKUP_DIR/antes-de-restaurar-*.dump. Después de restaurar, no levanta la app
# si la copia no tiene las mismas migraciones que la versión instalada.
set -euo pipefail
umask 077
# Una ruta relativa se toma desde donde se llamó al script, antes del cd.
if [ $# -ge 1 ] && [ -f "$1" ]; then
  set -- "$(realpath -- "$1")" "${@:2}"
fi
cd "$(dirname "$0")/.."
# shellcheck source=infra/lib.sh
source infra/lib.sh

if [ $# -lt 1 ]; then
  echo "Uso: $0 <archivo.dump|AAAA-MM-DD> [--si] [--sin-copia-previa]" >&2
  exit 2
fi
archivo=$1
shift
confirmar=1
copia_previa_obligatoria=1
for opcion in "$@"; do
  case $opcion in
    --si) confirmar=0 ;;
    --sin-copia-previa) copia_previa_obligatoria=0 ;;
    *)
      error "Opción desconocida: $opcion"
      exit 2
      ;;
  esac
done
BACKUP_DIR=${BACKUP_DIR:-$(leer_var BACKUP_DIR)}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/kiosco}
BACKUP_REMOTO=${BACKUP_REMOTO-$(leer_var BACKUP_REMOTO)}

if [ ! -f "$archivo" ]; then
  if [[ ! $archivo =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    error "No existe el archivo $archivo (ni es una fecha AAAA-MM-DD)."
    exit 2
  fi
  fecha=$archivo
  archivo=$(find "$BACKUP_DIR" -maxdepth 1 -name "kiosco-$fecha-*.dump" | sort | tail -n 1)
  if [ -z "$archivo" ] && [ -n "$BACKUP_REMOTO" ]; then
    log "No hay copia del $fecha en el servidor; buscando en $BACKUP_REMOTO"
    descarga=$(mktemp -d)
    trap 'rm -rf -- "$descarga"' EXIT
    rclone copy "$BACKUP_REMOTO" "$descarga" --include "kiosco-$fecha-*.dump"
    archivo=$(find "$descarga" -name "kiosco-$fecha-*.dump" | sort | tail -n 1)
  fi
  if [ -z "$archivo" ]; then
    error "No hay ninguna copia del $fecha."
    exit 1
  fi
fi

"${COMPOSE[@]}" up -d --wait db
log "Verificando que $archivo se pueda leer entera"
if ! "${COMPOSE[@]}" exec -T db pg_restore --file=/dev/null <"$archivo"; then
  error 'La copia está dañada o no es un backup de la base del kiosco. No se tocó nada.'
  exit 1
fi

log "Se va a restaurar $archivo"
log 'Esto REEMPLAZA todos los datos actuales (ventas, stock, cajas, usuarios).'
if [ "$confirmar" = 1 ]; then
  read -r -p 'Escribí RESTAURAR para seguir: ' respuesta
  if [ "$respuesta" != RESTAURAR ]; then
    log 'Cancelado. No se tocó nada.'
    exit 1
  fi
fi

# Lo que hay ahora, por si hay que volver. Sin esa copia no se borra nada.
previo=''
existe=$("${COMPOSE[@]}" exec -T db psql -U kiosco -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = 'kiosco'")
if [ "$existe" = 1 ]; then
  mkdir -p "$BACKUP_DIR"
  previo="$BACKUP_DIR/antes-de-restaurar-$(TZ=America/Argentina/Buenos_Aires date +%F-%H%M%S).dump"
  if "${COMPOSE[@]}" exec -T db pg_dump -U kiosco -d kiosco --format=custom >"$previo.tmp"; then
    mv "$previo.tmp" "$previo"
    log "Lo que había quedó guardado en $previo"
  else
    rm -f "$previo.tmp"
    previo=''
    if [ "$copia_previa_obligatoria" = 1 ]; then
      error 'No se pudo guardar lo que hay ahora, así que no se tocó nada.'
      error 'Si la base actual está rota y se puede perder, repetir con --sin-copia-previa.'
      exit 1
    fi
    log 'AVISO: se sigue sin copia de lo que había (--sin-copia-previa).'
  fi
fi

log 'Deteniendo la app'
"${COMPOSE[@]}" stop app
# Desde acá, cualquier falla deja la base a medias: decir cómo volver.
trap 'error "La restauración falló a mitad: la app está detenida y la base puede estar vacía.";
  [ -z "$previo" ] || error "Para volver a como estaba: ./infra/restaurar.sh $previo --si"' ERR
"${COMPOSE[@]}" exec -T db psql -U kiosco -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE IF EXISTS kiosco WITH (FORCE)' \
  -c 'CREATE DATABASE kiosco OWNER kiosco'
log 'Restaurando'
"${COMPOSE[@]}" exec -T db pg_restore -U kiosco -d kiosco --no-owner --single-transaction \
  --exit-on-error <"$archivo"
trap - ERR

# La app instalada espera exactamente las migraciones de su versión.
log 'Comparando las migraciones de la copia con la versión instalada'
if ! estado=$("${COMPOSE[@]}" run --rm -T migrate pnpm exec prisma migrate status 2>&1); then
  printf '%s\n' "$estado" | grep -iE '^[0-9]{14}_|not yet|not found|failed' >&2 || true
  error 'La copia no tiene las mismas migraciones que la versión instalada, así que la app queda detenida.'
  error '- Si la copia es más vieja que el último deploy: aplicar las migraciones con'
  error '    docker compose -f infra/docker-compose.prod.yml run --rm migrate'
  error '  y levantar la app con: docker compose -f infra/docker-compose.prod.yml up -d app'
  error '- Si es de una versión anterior (por ejemplo, para deshacer una migración mala):'
  error '    ./infra/deploy.sh <commit de esa versión>'
  exit 1
fi

log 'Levantando la app'
"${COMPOSE[@]}" up -d --no-build app
if esperar_app_sana 60; then
  log 'Listo: la app responde sana con los datos restaurados.'
else
  error 'La app no quedó sana después de restaurar. Revisá "docker compose logs app".'
  exit 1
fi
