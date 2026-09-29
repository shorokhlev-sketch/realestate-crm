#!/usr/bin/env bash
# Сквозной прогон: ссылка агента из meta -> касание -> просмотр -> лид с сайта -> контакт -> показ -> бронь -> квартира на сайте -> дашборды.
# Usage: BASE_URL=http://127.0.0.1:3080/crm ADMIN_PASSWORD=admin tools/e2e.sh
#   BASE_URL defaults to the local dev server; ADMIN_PASSWORD defaults to the dev fallback "admin".
#   Positional args [BASE_URL] [ADMIN_PASSWORD] still work. Exits non-zero on the first failed step.
set -euo pipefail
B="${1:-${BASE_URL:-http://127.0.0.1:3080/crm}}"; PW="${2:-${ADMIN_PASSWORD:-admin}}"; AGENT="${AGENT:-nino}"; UNIT="${UNIT:-10-3}"
req() { local n=0; local out; until out=$(curl -s -m 25 "$@") && [ -n "$out" ]; do n=$((n+1)); [ $n -ge 5 ] && { echo "REQUEST FAILED: $*" >&2; return 1; }; sleep 2; done; printf '%s' "$out"; }
j() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }
VID=$(python3 -c "import uuid;print(uuid.uuid4())")
SITE=$(req -o /dev/null -w '%{redirect_url}' "$B/a/$AGENT?utm_source=meta&utm_medium=cpc&utm_campaign=sep_sea&utm_content=e2e&fbclid=IwARe2e$RANDOM")
echo "1. клик по короткой ссылке агента -> $SITE"
req -X POST "$B/api/track" -H 'content-type: application/json' -d "{\"vid\":\"$VID\",\"type\":\"touch\",\"url\":\"$SITE\",\"referrer\":\"https://l.instagram.com/\"}" | j "print('2. касание: agent=',d['agent'],'channel=',d['channel'],'touch_id=',d['touch_id'])"
req -X POST "$B/api/track" -H 'content-type: application/json' -d "{\"vid\":\"$VID\",\"type\":\"unit_view\",\"unit_id\":\"$UNIT\",\"path\":\"/select-c.html#/own/$UNIT\"}" | j "print('   просмотр квартиры $UNIT:', d['ok'])"
LEAD=$(req -X POST "$B/api/leads" -H 'content-type: application/json' -d "{\"name\":\"E2E Тест $RANDOM\",\"phone\":\"+995 555 00$(printf '%04d' $((RANDOM % 10000)))\",\"unit_id\":\"$UNIT\",\"comment\":\"сквозной прогон\",\"vid\":\"$VID\",\"source\":\"site_modal\",\"page\":\"/select-c.html#/own/$UNIT\"}")
LID=$(printf '%s' "$LEAD" | j "print(d['id'])"); echo "3. лид с сайта: id=$LID duplicate=$(printf '%s' "$LEAD" | j "print(d['duplicate'])")"
CJ=$(mktemp); req -c "$CJ" -X POST "$B/api/auth/login" -H 'content-type: application/json' -d "{\"login\":\"admin\",\"password\":\"$PW\"}" >/dev/null
req -b "$CJ" "$B/api/leads/$LID" | j "l=d['lead']; print('   в CRM: agent=',l['agent'] and l['agent']['slug'],'| channel=',l['channel_first'],l['campaign_first'],'| unit=',l['unit'] and l['unit']['number'],'| events=',[e['type'] for e in d['events']])"
for st in contact showing booking; do req -b "$CJ" -X POST "$B/api/leads/$LID/status" -H 'content-type: application/json' -d "{\"status\":\"$st\",\"note\":\"e2e\"}" | j "print('4. статус ->', d['lead']['status'], '| квартира:', d.get('unit_state'), '| сделка USD:', d['lead']['deal_amount_usd'])"; done
req "$B/api/units/status.json" | j "print('5. сайт получает статус $UNIT =', d['statuses'].get('$UNIT'))"
T=$(TZ=Asia/Tbilisi date +%Y-%m-%d)
req -b "$CJ" "$B/api/stats/channels?from=$T&to=$T" | j "r=[x for x in d['rows'] if x['channel']=='meta'][0]; print('6. дашборд каналов (сегодня): meta clicks',r['clicks'],'leads',r['leads'],'showings',r['showings'],'bookings',r['bookings'])"
req -b "$CJ" "$B/api/stats/agents?from=$T&to=$T" | j "r=[x for x in d['rows'] if x['agent']['slug']=='$AGENT'][0]; print('   дашборд агентов (сегодня): $AGENT clicks',r['clicks'],'leads',r['leads'],'showings',r['showings'],'bookings',r['bookings'])"
echo "LEAD_ID=$LID"
