#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-/etc/knock-hunt-br.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

REPO_DIR="${REPO_DIR:-/opt/knock-hunt-br}"
BRANCH="${BRANCH:-main}"
APP_NAME="${APP_NAME:-knock-hunt-br}"
DB_FILE="${DATABASE_FILE:-/var/lib/knock-hunt-br/tibia-idle.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/knock-hunt-br/backups}"
NODE_HEAP_MB="${NODE_HEAP_MB:-1536}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/public-stats}"
APP_PORT="${PORT:-3000}"
APP_HOST="${HOST:-127.0.0.1}"
APP_TRUST_PROXY="${TRUST_PROXY:-true}"

timestamp() { date '+%Y-%m-%d_%H-%M-%S'; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n[ERRO] %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || fail "git não encontrado."
command -v pnpm >/dev/null || fail "pnpm não encontrado."
command -v pm2 >/dev/null || fail "pm2 não encontrado."
command -v curl >/dev/null || fail "curl não encontrado."
command -v sqlite3 >/dev/null || fail "sqlite3 não encontrado. Rode: sudo apt install -y sqlite3"

[ -d "$REPO_DIR/.git" ] || fail "Repositório não encontrado em $REPO_DIR."
[ -f "$DB_FILE" ] || fail "Banco não encontrado em $DB_FILE."

cd "$REPO_DIR"

# A VPS de produção é tratada como imutável: arquivos versionados sempre vêm
# do GitHub. Qualquer alteração local em arquivo versionado é descartada no
# deploy. Arquivos não versionados (como os assets extraídos) são preservados.
PREV_HEAD="$(git rev-parse HEAD)"
STAMP="$(timestamp)"
DIST_DIR="$REPO_DIR/apps/web/dist"
DIST_BACKUP="/tmp/knock-hunt-dist-$STAMP"

restore_frontend() {
  if [ -d "$DIST_BACKUP" ]; then
    rm -rf "$DIST_DIR"
    cp -a "$DIST_BACKUP" "$DIST_DIR"
  fi
}

rollback() {
  log "Falha detectada. Restaurando versão anterior..."
  restore_frontend || true
  git reset --hard "$PREV_HEAD" >/dev/null 2>&1 || true
  DATABASE_FILE="$DB_FILE" PORT="$APP_PORT" HOST="$APP_HOST" TRUST_PROXY="$APP_TRUST_PROXY" \
    pm2 restart "$APP_NAME" --update-env >/dev/null 2>&1 || true
  pm2 save >/dev/null 2>&1 || true
  fail "Deploy revertido para $(git rev-parse --short "$PREV_HEAD")."
}

trap rollback ERR

log "1/6 Backup do banco"
mkdir -p "$BACKUP_DIR"
sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/tibia-idle-$STAMP.db'"
find "$BACKUP_DIR" -type f -name 'tibia-idle-*.db' -mtime +14 -delete || true

log "2/6 Sincronizando código da branch $BRANCH"
git fetch origin "$BRANCH"
git checkout -f "$BRANCH"
git reset --hard "origin/$BRANCH"

log "3/6 Instalando dependências"
pnpm install --frozen-lockfile

log "4/6 Build do frontend"
if [ -d "$DIST_DIR" ]; then
  rm -rf "$DIST_BACKUP"
  cp -a "$DIST_DIR" "$DIST_BACKUP"
fi
NODE_OPTIONS="--max-old-space-size=$NODE_HEAP_MB" pnpm build

log "5/6 Reiniciando servidor"
DATABASE_FILE="$DB_FILE" PORT="$APP_PORT" HOST="$APP_HOST" TRUST_PROXY="$APP_TRUST_PROXY" \
  pm2 restart "$APP_NAME" --update-env
pm2 save

log "6/6 Verificando saúde"
ok=0
for attempt in $(seq 1 20); do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    ok=1
    break
  fi
  sleep 1
done

[ "$ok" -eq 1 ] || false

rm -rf "$DIST_BACKUP"
trap - ERR

log "Deploy concluído com sucesso"
echo "Commit: $(git rev-parse --short HEAD)"
echo "Servidor: $HEALTH_URL"
