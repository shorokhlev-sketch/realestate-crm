# Decisions

Written during the build. Numbers refer to the order in which they were made.

## 1. Custom CRM, not an open-source platform

Evaluated: Twenty (Next.js + Postgres + GraphQL, about 2 GB image), EspoCRM (PHP/MySQL), SuiteCRM (PHP), Monica (personal CRM), Mautic (marketing automation, PHP). None fits the brief: SQLite in one file, a front end with no build step on the existing design tokens, passwordless magic links for agents. Each ships its own theme that would need more rework than writing 6 screens on the tokens, and first/last-touch attribution by agent and channel would still need a plugin. Result: own code on Fastify + better-sqlite3. External code is limited to libraries (bcryptjs, @fastify/cookie, @fastify/static, @fastify/rate-limit, csv-parse, nodemailer).

## 2. Attribution

- A **touch** ("click" in reports) is a visit with new utm / click-id / `a=` parameters, a new visitor, or a gap of more than 30 minutes. Plain page-to-page navigation does not create touches.
- The **agent** is bound to the visitor on the first touch with `a=<slug>` and is not overwritten for 90 days (first touch). Manual reassignment in the CRM is always possible and is written to the history.
- The **channel** is stored twice on each lead: from the first and from the last touch. Dashboards count first touch by default (switch in settings). A touch with `a=` and no utm goes to channel `agent`; with utm it goes to the utm channel and the agent is still credited. This covers the "agent link inside a Meta ad" case.
- **Showings, bookings and deals for a period** are counted by the date of the status transition (`lead_status_history`), not by the lead creation date.
- **Revenue for ROAS** is the sum of `deal_amount_usd` over leads in `contract` and `paid` (setting `revenue_statuses`).

## 3. Unit status

`unit_states` overrides the status from `units.json`. Lead to `booking` sets the unit to `reserved`; `contract` / `paid` set `sold`; `lost` from booking sets `available` (if no other lead holds it). The sales site reads `GET /api/units/status.json` (60 s cache) and applies it on top of its own unit list.

## 4. Lead dedupe

Key: phone normalized to E.164, or Telegram handle. A repeat request with the same key within 30 days does not create a lead. It adds a `duplicate` entry to the existing lead's timeline and notifies the owner.

## 5. Design

- Theme `app` from `tokens.css`, brand color `#0035AA`, same as the unit-selection site.
- Control radius 2px (override `--btn-radius`, `--field-radius`, `--radius-control`); no pills or round badges, the status badge is a rectangle with r2.
- Layout: 220px navigation rail on the left (white, `--shadow-float`), content area on `--bg-1`, white panels with a `--line-2` border.
- Color carries only status (`--status-*`) and one primary action per screen. Funnel charts use one series in the brand color, no categorical palette.

## 6. Out of scope for phase 1

Real postback delivery (Meta CAPI and others): the interface, the queue, payload preview and retry exist; the network call is a stub. Currency rates are set by hand in settings, no external API.

## 7. Domain and path

The CRM runs under `/crm/` on the same domain as the sales site. One origin means the snippet cookie and the CRM share it. On a separate subdomain, CORS in production admits only `SITE_ORIGIN` and the CRM's own origin. Fastify listens on `127.0.0.1:3080` with `BASE_PATH=/crm`; nginx proxies `location ^~ /crm/`. The `^~` modifier is required: without it the static-file regex `\.(js|css|json)$` catches `crm-track.js` and `status.json`.

## 8. Manual lead entry: `POST /api/leads/manual`

The public `POST /api/leads` (from the site) and the admin one cannot share a path in Fastify, so manual entry lives at `/api/leads/manual` and the agent one at `/api/agent/leads`.

## 9. v0.2: the client runs it without the developer

Goal: the client does not depend on whoever deployed it. Added: users and roles (admin / viewer; viewer gets 403 on any non-GET), password change and "log out everywhere", Telegram bot token and SMTP from settings (no restart needed, polling re-reads the token every 15 s), unit prices and statuses (edit, CSV import/export, price history; `units.json` no longer overwrites the price on start), database copies from the UI (VACUUM INTO, download, restore: the file is checked with `integrity_check`, placed as `<db>.restore`, the process exits, systemd restarts it, `db.js` swaps the database on start), full JSON export, diagnostics, editable loss reasons, expense CSV import, e-mail notifications, audit log, `deploy/install.sh` + `docs/INSTALL.md` for installing on the client's server. Restore from the UI relies on systemd (in dev mode the process just exits and has to be restarted by hand).

## 10. Production refuses dev defaults

Dev mode falls back to `admin` / `admin` and a fixed session secret so `npm start` works with no setup. With `NODE_ENV=production` the server exits on start if `ADMIN_PASSWORD` or `SESSION_SECRET` is missing, still a placeholder, or the secret is shorter than 32 characters. `npm test` checks this.
