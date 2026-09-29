#!/usr/bin/env bash
# npm test: boots the server on a throwaway SQLite file, seeds demo data, runs tools/e2e.sh against it,
# then checks that NODE_ENV=production refuses to start without ADMIN_PASSWORD and SESSION_SECRET.
# No network calls: TG_BOT_TOKEN and SMTP stay empty, so Telegram and e-mail are never contacted.
set -euo pipefail
cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"; PORT="${TEST_PORT:-3099}"; PID=""
cleanup() { [ -n "$PID" ] && kill "$PID" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT
export DOTENV_CONFIG_PATH="$TMP/no.env" DB_PATH="$TMP/crm.db" PORT BASE_PATH=/crm TG_BOT_TOKEN= NODE_ENV=test ADMIN_PASSWORD=admin SESSION_SECRET=test-secret

echo "== seed demo data"
node seed/demo.js > "$TMP/seed.log"
tail -1 "$TMP/seed.log"

echo "== start server on :$PORT"
node server/index.js > "$TMP/server.log" 2>&1 & PID=$!
for i in $(seq 1 50); do curl -sf "http://127.0.0.1:$PORT/crm/api/health" >/dev/null && break; sleep 0.2; done
curl -sf "http://127.0.0.1:$PORT/crm/api/health" >/dev/null || { echo "server did not start"; cat "$TMP/server.log"; exit 1; }

echo "== e2e"
BASE_URL="http://127.0.0.1:$PORT/crm" ADMIN_PASSWORD=admin tools/e2e.sh

echo "== duplicate lead within 30 days is merged"
DUP=$(curl -sf -X POST "http://127.0.0.1:$PORT/crm/api/leads" -H 'content-type: application/json' \
  -d '{"name":"Dup Test","phone":"+995 555 000 077","source":"site_form"}' >/dev/null && \
  curl -sf -X POST "http://127.0.0.1:$PORT/crm/api/leads" -H 'content-type: application/json' \
  -d '{"name":"Dup Test","phone":"995555000077","source":"site_form"}')
echo "$DUP" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['duplicate'] is True, d; print('   duplicate merged into lead', d['id'])"

echo "== production refuses dev fallbacks"
if env -u ADMIN_PASSWORD -u SESSION_SECRET NODE_ENV=production DB_PATH="$TMP/prod.db" node server/index.js > "$TMP/prod.log" 2>&1; then
  echo "FAIL: production started without secrets"; exit 1
fi
grep -q "refusing to start" "$TMP/prod.log" && echo "   ok: $(head -1 "$TMP/prod.log" | cut -c1-90)..."

echo "ALL PASSED"
