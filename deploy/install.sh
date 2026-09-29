#!/usr/bin/env bash
# Установка realestate-crm на чистый Ubuntu 22.04 / 24.04 одной командой (запускать под root на сервере клиента).
#   curl -fsSL https://raw.githubusercontent.com/<owner>/realestate-crm/main/deploy/install.sh | DOMAIN=crm.example.com SITE_URL=https://example.com/ bash
# или из распакованного архива репозитория: DOMAIN=crm.example.com SITE_URL=https://example.com/ bash deploy/install.sh
# Переменные: DOMAIN (обязательно), SITE_URL (адрес сайта ЖК), BASE_PATH (по умолчанию '' = корень домена), EMAIL (для certbot), SRC (папка с кодом или git-URL).
set -euo pipefail
: "${DOMAIN:?Укажите DOMAIN=crm.example.com}"
SITE_URL="${SITE_URL:-https://example.com/}"
BASE_PATH="${BASE_PATH:-}"
EMAIL="${EMAIL:-admin@$DOMAIN}"
SRC="${SRC:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd || echo '')}"
APP=/opt/realestate-crm; DATA=/var/lib/realestate-crm; PORT=3080
[ "$(id -u)" = 0 ] || { echo "Запустите под root (sudo)"; exit 1; }

echo "-> пакеты"; export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq curl git nginx sqlite3 ca-certificates rsync >/dev/null
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null; fi
if ! command -v certbot >/dev/null; then apt-get install -y -qq certbot python3-certbot-nginx >/dev/null; fi

echo "-> код в $APP"; mkdir -p "$APP" "$DATA/backups"
if [ -n "$SRC" ] && [ -f "$SRC/package.json" ]; then rsync -a --delete --exclude node_modules --exclude data --exclude .env --exclude .git "$SRC/" "$APP/";
elif [ -n "$SRC" ]; then rm -rf "$APP.tmp" && git clone -q "$SRC" "$APP.tmp" && rsync -a --delete --exclude .git "$APP.tmp/" "$APP/" && rm -rf "$APP.tmp";
else echo "Нет исходников: задайте SRC=<папка или git-URL>"; exit 1; fi
cd "$APP" && (npm ci --omit=dev --silent 2>&1 || npm install --omit=dev --silent 2>&1) | tail -1

if [ ! -f "$APP/.env" ]; then
  PW=$(openssl rand -base64 12 | tr -d '/+=')
  cat > "$APP/.env" <<EOF
PORT=$PORT
HOST=127.0.0.1
BASE_PATH=$BASE_PATH
DB_PATH=$DATA/crm.db
BACKUP_DIR=$DATA/backups
SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_LOGIN=admin
ADMIN_PASSWORD=$PW
SITE_URL=$SITE_URL
SITE_ORIGIN=$(node -e "console.log(new URL(process.argv[1]).origin)" "$SITE_URL")
CRM_URL=https://$DOMAIN$BASE_PATH
TG_BOT_TOKEN=
TG_ADMIN_CHAT_ID=
COOKIE_DAYS=90
EOF
  echo "-> создан .env, пароль администратора: $PW"
fi

echo "-> systemd"; sed "s#/opt/realestate-crm#$APP#g; s#/var/lib/realestate-crm#$DATA#g" "$APP/deploy/realestate-crm.service" > /etc/systemd/system/realestate-crm.service
systemctl daemon-reload && systemctl enable realestate-crm >/dev/null 2>&1 && systemctl restart realestate-crm && sleep 2 && systemctl is-active realestate-crm

echo "-> nginx для $DOMAIN"
LOC="${BASE_PATH:-/}"; [ "$LOC" = "/" ] && PROXY="http://127.0.0.1:$PORT/" || PROXY="http://127.0.0.1:$PORT$BASE_PATH/"
cat > /etc/nginx/sites-available/$DOMAIN <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    add_header X-Robots-Tag "noindex, nofollow" always;
    location ^~ ${LOC%/}/ {
        proxy_pass $PROXY;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 50m;
    }
}
EOF
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
nginx -t && systemctl reload nginx
echo "-> сертификат"; certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect >/dev/null 2>&1 && echo "https включён" || echo "certbot не смог выпустить сертификат (проверьте, что A-запись $DOMAIN указывает на этот сервер), повторите: certbot --nginx -d $DOMAIN"

echo "-> ночной бэкап"; ( crontab -l 2>/dev/null | grep -v realestate-crm/tools/backup.sh; echo "0 3 * * * DB_PATH=$DATA/crm.db BACKUP_DIR=$DATA/backups $APP/tools/backup.sh >> /var/log/realestate-crm-backup.log 2>&1" ) | crontab -
curl -s "http://127.0.0.1:$PORT$BASE_PATH/api/health"; echo
echo "Готово: https://$DOMAIN$BASE_PATH/admin/login.html  (логин admin, пароль в $APP/.env)"
echo "Дальше: Настройки -> сниппет на сайт, Telegram-бот, Удалить демо-данные."
