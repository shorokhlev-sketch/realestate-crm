#!/usr/bin/env bash
# Update an existing install over SSH: rsync code -> npm ci -> systemd restart -> health check.
# First install on a clean server: deploy/install.sh (creates .env, systemd unit, nginx, backups).
# Every SSH step is wrapped in retries for flaky links.
#
#   DEPLOY_HOST=user@server DEPLOY_PATH=/opt/realestate-crm ./deploy/deploy.sh
#
# Variables:
#   DEPLOY_HOST   (required) ssh target, e.g. root@203.0.113.10 or an alias from ~/.ssh/config
#   DEPLOY_PATH   code directory on the server (default /opt/realestate-crm)
#   SERVICE       systemd unit name (default realestate-crm)
#   HEALTH_URL    checked on the server after restart (default http://127.0.0.1:3080/crm/api/health)
set -uo pipefail
HOST="${DEPLOY_HOST:?Set DEPLOY_HOST=user@server}"
REMOTE="${DEPLOY_PATH:-/opt/realestate-crm}"
SERVICE="${SERVICE:-realestate-crm}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3080/crm/api/health}"
cd "$(dirname "$0")/.."
retry() { local n=0; until "$@"; do n=$((n+1)); [ $n -ge 6 ] && { echo "FAILED after $n: $*"; return 1; }; echo "retry $n..."; sleep $((n*3)); done; }

echo "-> rsync to $HOST:$REMOTE"
retry ssh -o ConnectTimeout=15 "$HOST" "mkdir -p '$REMOTE'"
retry rsync -az --delete -e "ssh -o ConnectTimeout=15" --exclude node_modules --exclude data --exclude .env --exclude .git --exclude mockups ./ "$HOST:$REMOTE/"

echo "-> npm ci + restart"
retry ssh -o ConnectTimeout=15 "$HOST" "set -e; cd '$REMOTE'; test -f .env || { echo 'no .env on the server: run deploy/install.sh first'; exit 1; }; (npm ci --omit=dev --silent 2>&1 || npm install --omit=dev --silent 2>&1) | tail -2; systemctl restart '$SERVICE'; sleep 2; systemctl is-active '$SERVICE'; curl -s '$HEALTH_URL'; echo"
