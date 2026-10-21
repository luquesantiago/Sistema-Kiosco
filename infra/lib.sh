# Funciones comunes de deploy.sh, backup.sh y restaurar.sh. Se carga con
# `source`; los scripts ya hicieron `cd` a la raíz del repositorio.
# shellcheck shell=bash

COMPOSE=(docker compose -f infra/docker-compose.prod.yml)

log() {
  printf '[%s %s] %s\n' "$(basename "$0" .sh)" "$(TZ=America/Argentina/Buenos_Aires date '+%F %T')" "$*"
}

error() {
  log "ERROR: $*" >&2
}

# Valor de una variable de infra/.env sin ejecutar el archivo (puede tener
# espacios sin comillas, como NOMBRE_KIOSCO), interpretado como lo hace Docker
# Compose: sin comillas alrededor ni comentario " # ..." al final. Vacío si no está.
leer_var() {
  [ -f infra/.env ] || return 0
  local valor
  valor=$(grep -E "^[[:space:]]*$1[[:space:]]*=" infra/.env | tail -n 1 | cut -d= -f2- | tr -d '\r') || true
  valor=${valor#"${valor%%[![:space:]]*}"}
  if [[ $valor =~ ^\"(.*)\"[[:space:]]*(#.*)?$ ]] || [[ $valor =~ ^\'(.*)\'[[:space:]]*(#.*)?$ ]]; then
    valor=${BASH_REMATCH[1]}
  else
    valor=${valor%%[[:space:]]#*}
    valor=${valor%"${valor##*[![:space:]]}"}
  fi
  printf '%s' "$valor"
}

# Espera hasta $1 segundos a que el healthcheck de la app (/api/health) dé sano.
esperar_app_sana() {
  local fin=$((SECONDS + $1)) contenedor estado
  while ((SECONDS < fin)); do
    contenedor=$("${COMPOSE[@]}" ps -q app)
    if [ -n "$contenedor" ]; then
      estado=$(docker inspect -f '{{.State.Health.Status}}' "$contenedor" 2>/dev/null || true)
      [ "$estado" = healthy ] && return 0
    fi
    sleep 2
  done
  return 1
}
