#!/usr/bin/env bash
# Actualiza el sistema en el servidor (ver "Actualizar el sistema" en infra/README.md):
#
#   ./infra/deploy.sh             despliega origin/main
#   ./infra/deploy.sh v1.2        despliega otra rama (de origin), etiqueta o commit
#   ./infra/deploy.sh --sin-git   despliega lo que hay en la carpeta (para probar)
#
# 1. Copia la base (solo en el servidor, para no depender de Google Drive).
# 2. Baja la versión pedida y sigue con el deploy.sh de ESA versión.
# 3. Valida el Caddyfile, construye, migra y levanta la app nueva.
# 4. Si algo falla, o la app no queda sana en ESPERA_SANA segundos (60 por
#    defecto), o se interrumpe con Ctrl+C, vuelve todo a como estaba: el
#    código, la imagen y el contenedor. Las migraciones no se revierten: tienen
#    que ser compatibles con la versión anterior.
#
# Uso interno: `deploy.sh --continuar <commit previo> <copia previa>` es la
# segunda parte, que corre el script de la versión nueva después del checkout.
# Ese contrato no puede cambiar entre versiones.
set -euo pipefail

# Recrea el contenedor de la app con la imagen kiosco-app:actual.
levantar_app() {
  "${COMPOSE[@]}" up -d --no-build --force-recreate app
}

# Primera parte: copia de la base y checkout. Corre con el script de la
# versión que está instalada.
preparar() {
  local ref=${1:-origin/main} commit_previo='' copia='' ruta

  if [ "$ref" != --sin-git ]; then
    if [ -n "$(git status --porcelain)" ]; then
      error 'Hay cambios locales sin commitear (ver git status). Descartalos o guardalos antes de desplegar.'
      return 1
    fi
    git fetch --quiet --tags origin
    # `main` es la rama de origin, no la copia local que quedó del clone.
    if git rev-parse -q --verify "refs/remotes/origin/$ref^{commit}" >/dev/null; then
      ref=origin/$ref
    fi
    git rev-parse -q --verify "$ref^{commit}" >/dev/null || {
      error "No existe la versión $ref."
      return 1
    }
    commit_previo=$(git rev-parse HEAD)
  fi

  # Si la base ya existe (aunque esté detenida), copia antes de tocar nada.
  if docker volume inspect kiosco_db-data >/dev/null 2>&1; then
    log 'Copia de la base antes del deploy'
    "${COMPOSE[@]}" up -d --wait db
    ruta=$(mktemp)
    BACKUP_REMOTO='' BACKUP_SUFIJO=predeploy BACKUP_RUTA="$ruta" bash infra/backup.sh
    copia=$(cat "$ruta")
    rm -f "$ruta"
  else
    log 'Instalación nueva: todavía no hay base que copiar.'
  fi

  if [ "$ref" = --sin-git ]; then
    desplegar '' "$copia"
  else
    git checkout --quiet --detach "$ref"
    # La segunda parte la hace el script de la versión nueva.
    exec bash infra/deploy.sh --continuar "$commit_previo" "$copia"
  fi
}

# Segunda parte: build, migraciones y salida al aire de la versión del
# checkout, con vuelta atrás ante cualquier falla.
desplegar() {
  commit_previo=$1
  copia=$2
  espera=${ESPERA_SANA:-60}
  hay_anterior=0
  app_recreada=0
  log "Versión a desplegar: $(git log -1 --format='%h %s (%cs)')"

  # La app anterior es la que está corriendo, no la última etiqueta `actual`
  # (un deploy cortado pudo dejarla apuntando a una imagen sin verificar).
  local contenedor
  contenedor=$("${COMPOSE[@]}" ps -q app)
  if [ -n "$contenedor" ]; then
    docker tag "$(docker inspect -f '{{.Image}}' "$contenedor")" kiosco-app:anterior
    hay_anterior=1
  elif docker image inspect kiosco-app:actual >/dev/null 2>&1; then
    docker tag kiosco-app:actual kiosco-app:anterior
    hay_anterior=1
  fi

  # Un corte de SSH no frena el deploy; Ctrl+C o un kill vuelven atrás.
  trap '' HUP
  trap 'error "Deploy interrumpido."; volver_atras; exit 1' INT TERM

  log 'Validando el Caddyfile'
  "${COMPOSE[@]}" run --rm --no-deps -T caddy \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null ||
    fallar 'El Caddyfile de esta versión no es válido.'

  log 'Actualizando imágenes base'
  local base
  base=$(awk '/^FROM /{print $2; exit}' Dockerfile)
  if ! { docker pull --quiet "$base" >/dev/null && "${COMPOSE[@]}" pull --quiet caddy db; }; then
    log 'AVISO: no se pudieron actualizar las imágenes base; se usan las que ya están.'
  fi

  log 'Construyendo la imagen'
  "${COMPOSE[@]}" build app migrate || fallar 'No se pudo construir la imagen.'

  log 'Aplicando migraciones'
  "${COMPOSE[@]}" run --rm migrate || fallar 'Fallaron las migraciones.'

  log 'Levantando la versión nueva'
  app_recreada=1
  if levantar_app && esperar_app_sana "$espera"; then
    trap - INT TERM
    # El resto de los servicios toma imágenes nuevas, y Caddy el Caddyfile nuevo.
    "${COMPOSE[@]}" up -d --no-build
    "${COMPOSE[@]}" up -d --no-build --force-recreate caddy
    limpiar_imagenes
    log "Listo: la app responde sana. Versión $(git log -1 --format=%h)."
    [ -z "$copia" ] || log "Copia previa al deploy: $copia"
    return 0
  fi
  "${COMPOSE[@]}" logs --tail 50 app >&2 || true
  fallar "La versión nueva no quedó sana en $espera segundos."
}

# Vuelve el código, la etiqueta de la imagen y (si ya se había tocado) el
# contenedor de la app a como estaban antes del deploy.
volver_atras() {
  trap - INT TERM
  if [ -n "$commit_previo" ]; then
    git checkout --quiet --detach "$commit_previo"
    log "Código de vuelta en $(git log -1 --format=%h)."
  fi
  [ "$hay_anterior" = 1 ] && docker tag kiosco-app:anterior kiosco-app:actual
  if [ "$app_recreada" = 1 ] && [ "$hay_anterior" = 0 ]; then
    error 'Es la primera instalación: no hay versión anterior a la que volver.'
  elif [ "$app_recreada" = 1 ]; then
    log 'Volviendo a la versión anterior'
    if levantar_app && esperar_app_sana "$espera"; then
      "${COMPOSE[@]}" up -d --no-build
      error 'Quedó andando la versión anterior. Revisá el error antes de reintentar.'
    else
      error 'La versión anterior no responde: ver "Si el servidor no responde" en infra/README.md.'
    fi
  else
    log 'La app no se tocó: sigue la versión anterior.'
  fi
  [ -z "$copia" ] || log "Copia previa al deploy: $copia"
  limpiar_imagenes
}

fallar() {
  error "$1"
  volver_atras
  exit 1
}

# Borra las imágenes que quedaron sin etiqueta y la caché de build de más de un mes.
limpiar_imagenes() {
  docker image prune -f >/dev/null || true
  docker builder prune -f --filter until=720h >/dev/null || true
}

main() {
  cd "$(dirname "$0")/.."
  # shellcheck source=infra/lib.sh
  source infra/lib.sh
  trap '' HUP
  if [ "${1:-}" = --continuar ]; then
    desplegar "${2:-}" "${3:-}"
  else
    preparar "$@"
  fi
}

main "$@"
