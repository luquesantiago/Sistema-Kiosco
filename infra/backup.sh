#!/usr/bin/env bash
# Copia de la base (ver infra/README.md). La corre todos los días a las 03:00
# el timer kiosco-backup, y deploy.sh antes de tocar nada:
#
#   1. pg_dump comprimido a BACKUP_DIR (por defecto /var/backups/kiosco).
#   2. Sube a BACKUP_REMOTO con rclone todas las copias que falten allá.
#   3. Solo si la subida terminó bien, borra las copias de más de 30 días en
#      el remoto y de más de 7 días en el servidor.
#
# Si algo falla, termina con error sin borrar ni reemplazar copias anteriores.
#
# Variables opcionales (las usa deploy.sh):
#   BACKUP_REMOTO=''           no sube (la copia queda solo en el servidor)
#   BACKUP_SUFIJO=predeploy    agrega el sufijo al nombre del archivo
#   BACKUP_RUTA=<archivo>      escribe ahí la ruta de la copia creada
set -euo pipefail
# Las copias tienen todos los datos del negocio: solo las lee el usuario kiosco.
umask 077
cd "$(dirname "$0")/.."
# shellcheck source=infra/lib.sh
source infra/lib.sh

BACKUP_DIR=${BACKUP_DIR:-$(leer_var BACKUP_DIR)}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/kiosco}
BACKUP_REMOTO=${BACKUP_REMOTO-$(leer_var BACKUP_REMOTO)}
DIAS_SERVIDOR=7
DIAS_REMOTO=30

# Al arrancar el servidor (el timer recupera la corrida perdida) Postgres
# puede estar todavía iniciando: se le dan hasta 2 minutos.
for ((intento = 0; intento < 60; intento++)); do
  "${COMPOSE[@]}" exec -T db pg_isready -q -h 127.0.0.1 -U kiosco -d kiosco 2>/dev/null && break
  sleep 2
done

mkdir -p "$BACKUP_DIR"
nombre="kiosco-$(TZ=America/Argentina/Buenos_Aires date +%F-%H%M%S)${BACKUP_SUFIJO:+-$BACKUP_SUFIJO}.dump"
temporal="$BACKUP_DIR/.$nombre.tmp"
trap 'rm -f "$temporal"' EXIT

# Primero a un temporal: un dump cortado nunca queda con el nombre final.
if ! "${COMPOSE[@]}" exec -T db pg_dump -U kiosco -d kiosco --format=custom >"$temporal"; then
  error 'Falló pg_dump. No se tocó ninguna copia anterior.'
  exit 1
fi
mv "$temporal" "$BACKUP_DIR/$nombre"
log "Copia local: $BACKUP_DIR/$nombre ($(du -h "$BACKUP_DIR/$nombre" | cut -f1))"
[ -z "${BACKUP_RUTA:-}" ] || printf '%s\n' "$BACKUP_DIR/$nombre" >"$BACKUP_RUTA"

if [ -z "$BACKUP_REMOTO" ]; then
  log 'La copia queda solo en el servidor (sin BACKUP_REMOTO); la sube la próxima corrida del timer.'
  exit 0
fi

# `copy` sube solo lo que falta: también las copias de días en que falló.
if ! rclone copy "$BACKUP_DIR" "$BACKUP_REMOTO" --include 'kiosco-*.dump'; then
  error "No se pudo subir a $BACKUP_REMOTO. Las copias quedan en el servidor y se reintenta en la próxima corrida."
  exit 1
fi
log "Subida a $BACKUP_REMOTO completa"

rclone delete "$BACKUP_REMOTO" --include 'kiosco-*.dump' --min-age "${DIAS_REMOTO}d"
find "$BACKUP_DIR" -maxdepth 1 -name 'kiosco-*.dump' -mtime +$((DIAS_SERVIDOR - 1)) -delete
log "Retención aplicada: $DIAS_SERVIDOR días en el servidor y $DIAS_REMOTO en $BACKUP_REMOTO"
