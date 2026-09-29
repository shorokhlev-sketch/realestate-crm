# Install on your own server

For the client's sysadmin. The CRM is not tied to any particular host: code in this repository, the database in one file, install with one command.

## Requirements

- A VPS with Ubuntu 22.04 or 24.04. 1 vCPU, 1 GB RAM and 10 GB disk are enough.
- A domain for the CRM (for example `crm.example.com`) with an A record pointing to the server.
- Root SSH access.

## Install

```bash
# on the server, as root
git clone <repository url> /root/realestate-crm
DOMAIN=crm.example.com SITE_URL=https://example.com/ EMAIL=admin@example.com bash /root/realestate-crm/deploy/install.sh
```

The script installs Node.js 22, nginx and certbot; copies the code to `$APP` (default `/opt/realestate-crm`), puts the database in `$DATA/crm.db` (default `/var/lib/realestate-crm`), writes `.env` with a random admin password (printed once) and a random 64-character session secret, installs the systemd unit `realestate-crm`, an nginx server block with HTTPS, and a nightly backup at 03:00.

Variables:

| Variable | Required | Meaning |
|---|---|---|
| `DOMAIN` | yes | CRM domain |
| `SITE_URL` | no | sales site address; agent links redirect there |
| `EMAIL` | no | for the certificate |
| `BASE_PATH` | no | empty = domain root; `/crm` when the CRM shares a domain with the site |
| `SRC` | no | source folder or git URL, defaults to the folder the script is in |

After install:

1. Open `https://<domain>/admin/login.html`, log in as `admin` with the password from the script output, change it in Settings.
2. Settings > snippet: add one line to the sales site.
3. Settings > Telegram: bot token from @BotFather, link the admin chat.
4. Settings > Demo data > Delete.

## Environment

| Variable | Default (dev) | Production |
|---|---|---|
| `NODE_ENV` | `development` | `production` (set by the systemd unit) |
| `ADMIN_PASSWORD` | `admin` | required, the server refuses to start without it |
| `SESSION_SECRET` | fixed dev value | required, at least 32 characters |
| `ADMIN_LOGIN` | `admin` | |
| `PORT`, `HOST` | `3080`, `127.0.0.1` | |
| `BASE_PATH` | `/crm` | |
| `DB_PATH`, `BACKUP_DIR` | `./data/crm.db`, `<db dir>/backups` | |
| `SITE_URL`, `SITE_ORIGIN` | `https://example.com/` | the sales site; `SITE_ORIGIN` is the only allowed CORS origin |
| `CRM_URL` | `http://127.0.0.1:3080/crm` | public CRM URL, used in magic links and notifications |
| `TG_BOT_TOKEN`, `TG_ADMIN_CHAT_ID` | empty | optional, can also be set in the UI |
| `COOKIE_DAYS` | `90` | attribution window |

## Moving from another server

1. In the old CRM: Settings > Database copies > "Make a copy now" > "download".
2. On the new server after install: Settings > Database copies > "Restore from file" > pick the downloaded `.db`. The service restarts with the data in place.
3. Point the snippet line on the site to the new domain.
4. Agent links change to `https://<new domain>/a/<slug>`; the old ones stop working. Hand out new ones.

## Update

From a workstation:

```bash
DEPLOY_HOST=root@203.0.113.10 DEPLOY_PATH=/opt/realestate-crm ./deploy/deploy.sh
```

Or on the server:

```bash
cd /root/realestate-crm && git pull
rsync -a --delete --exclude node_modules --exclude data --exclude .env --exclude .git ./ /opt/realestate-crm/
cd /opt/realestate-crm && npm ci --omit=dev && systemctl restart realestate-crm
```

The schema migrates itself on start (migrations are idempotent).

## Where things are

| What | Where |
|---|---|
| Code | `$APP` |
| Environment | `$APP/.env` |
| Database | `$DATA/crm.db` |
| Database copies | `$DATA/backups/` |
| Service logs | `journalctl -u realestate-crm -f` |
| nginx | `/etc/nginx/sites-enabled/<domain>` |
| Backup cron | `crontab -l` |

## Manual restore (if the UI is down)

```bash
systemctl stop realestate-crm
gunzip -c $DATA/backups/crm-<date>.db.gz > $DATA/crm.db
rm -f $DATA/crm.db-wal $DATA/crm.db-shm
systemctl start realestate-crm
```

## Reset the admin password

```bash
cd $APP && set -a && . ./.env && set +a
node -e "import('./server/lib/auth.js').then(async m=>{const {db}=await import('./server/db.js');const a=db.prepare('SELECT id FROM admins WHERE login=?').get('admin');m.setPassword(a.id,'NewPassword123');console.log('ok')})"
```
