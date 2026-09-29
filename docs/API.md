# API

Base: `https://example.com/crm` (`BASE_PATH=/crm`). JSON, UTF-8. Dates are ISO-8601 UTC. Errors: `{ "error": "code", "message": "human-readable text" }` with 400 / 401 / 403 / 404 / 409 / 422 / 429.

Three access zones:

| Zone | Who | How |
|---|---|---|
| Public | the sales site (snippet, forms), link clicks | no auth, CORS only for `SITE_ORIGIN`, rate limit per IP |
| Admin | the developer's sales office | cookie `crm_sid` after `POST /api/auth/login` |
| Agent | an agent | cookie `crm_sid` after opening `/m/<token>` |

Periods everywhere: `?from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive, local Batumi time, Asia/Tbilisi). Default: the last 30 days.

---

## Public

### `GET /a/:slug`
Agent short link. Writes `link_hits`, responds `302 -> {site_url}/?a={slug}` and forwards the other query parameters (utm_* are kept). Inactive or unknown slug: redirect to the site without `a`.

### `GET /m/:token`
Agent magic link. A valid, unexpired token creates an agent session (cookie `crm_sid`, 30 days), sets `used_at`, `302 -> /agent/`. Otherwise `-> /agent/expired.html`.

### `POST /api/track`
Called by the `crm-track.js` snippet on page load and on events. Body:

```json
{
  "vid": "8c1f...-uuid",                   // visitor id from cookie/localStorage; empty = the server issues one
  "type": "touch",                         // "touch" | "unit_view" | "form_open" | "favorite" | "pdf"
  "url": "https://example.com/?a=nino&utm_source=meta&utm_campaign=sep_sea",
  "referrer": "https://l.instagram.com/",
  "path": "/",
  "unit_id": "10-3",                       // for unit_view / favorite / pdf
  "ts": "2026-09-06T14:03:11Z"
}
```

Response `200 { "vid": "...", "touch_id": 123, "agent": "nino", "channel": "meta" }`. For `type: "touch"` the server decides whether to create a new touch (30-minute rule or new parameters) and computes the channel from `channel_rules`. The `crm_vid` cookie is also set on the CRM domain in case localStorage is blocked.

### `POST /api/leads` (public)
Landing form and the "Request a call" modal on the unit-selection page.

```json
{
  "name": "Nino",
  "phone": "+995 555 000 012",             // phone or telegram is required
  "telegram": "@nino_demo",
  "email": "",
  "unit_id": "10-3",                       // from the unit modal
  "interest": "2br",                       // landing select: studio|1br|2br|3br|""
  "comment": "",
  "vid": "8c1f...",                        // for attribution, optional
  "source": "site_form",                   // "site_form" | "site_modal" | "site_unit_page" | "site_popup" | "site_card"
  "page": "/select-c.html#/own/10-3",
  "hp": ""                                 // honeypot, must be empty
}
```

`201 { "id": 61, "status": "new", "duplicate": false }`. A repeat with the same dedupe key within 30 days returns `200 { "id": 41, "duplicate": true }` (timeline note, notification to the owner). Limit: 5 requests per minute per IP.

### `GET /api/units/status.json`
For the unit-selection site. `Cache-Control: public, max-age=60`.

```json
{ "updated_at": "2026-09-06T14:03:11Z", "statuses": { "10-3": "reserved", "26-12": "sold" } }
```
Only units with an overridden status; the rest keep the status from `units.json`.

### `GET /crm-track.js`
The snippet (see below). One line on the site: `<script src="https://example.com/crm/crm-track.js" async></script>`.

---

## Auth (admin)

| Method | Path | Body / response |
|---|---|---|
| POST | `/api/auth/login` | `{login, password}` -> `200 {admin:{id,name}}` + cookie; 401 on error; 5 attempts per minute |
| POST | `/api/auth/logout` | -> `204` |
| GET | `/api/auth/me` | -> `{ "role": "admin", "id": 1, "name": "..." }` or `{ "role": "agent", "agent": {...} }` |

---

## Admin: leads

### `GET /api/leads`
Query: `status` (comma-separated), `agent_id`, `channel` (first touch), `campaign`, `unit_id`, `q` (name / phone / telegram), `from`, `to` (by created_at), `sort` (default `-updated_at`), `page`, `per_page` (max 100), `view=list|board`.

```json
{
  "total": 60,
  "page": 1,
  "items": [{
    "id": 41, "name": "...", "phone": "+995...", "telegram": null,
    "unit": { "id": "10-3", "number": "1003", "type": "2br", "total": 59.6 },
    "status": "showing", "status_since": "2026-09-04T10:00:00Z",
    "agent": { "id": 3, "name": "...", "slug": "nino" },
    "channel_first": "meta", "campaign_first": "sep_sea",
    "channel_last": "direct",
    "source": "site_form", "created_at": "...", "updated_at": "...",
    "deal_amount_usd": null, "is_demo": true
  }],
  "counts_by_status": { "new": 12, "contact": 9, "showing": 6, "booking": 3, "contract": 2, "paid": 1, "lost": 27 }
}
```
`view=board` returns the same grouped by status: `{ "columns": { "new": [...], ... } }`.

### `POST /api/leads/manual` (admin, manual entry)
Same body as the public one plus `agent_id`, `channel_id` (default `direct`), `status`, `comment`. `source` is set to `manual`. -> `201 {lead}`.

### `GET /api/leads/:id`
Full card:

```json
{
  "lead": { "...": "as in the list", "email": "", "interest": "", "comment": "", "lost_reason": null, "lost_note": null, "deal_amount": null, "deal_currency": null, "deal_amount_usd": null, "agent_source": "cookie" },
  "attribution": {
    "first": { "ts": "...", "channel": "meta", "utm_source": "meta", "utm_medium": "cpc", "utm_campaign": "sep_sea", "utm_content": "video_1", "fbclid": "IwAR...", "referrer": "...", "landing_path": "/", "agent_slug": "nino" },
    "last":  { "...": "same shape" }
  },
  "history": [ { "ts": "...", "from": "contact", "to": "showing", "actor": "agent:3", "actor_name": "...", "note": "..." } ],
  "notes":   [ { "id": 7, "ts": "...", "actor": "agent:3", "actor_name": "...", "kind": "note", "text": "..." } ],
  "events":  [ { "ts": "...", "type": "unit_view", "unit_id": "10-3", "unit_number": "1003" } ],
  "postbacks": [ { "id": 3, "provider": "meta_capi", "event": "Lead", "status": "skipped", "created_at": "..." } ]
}
```

### `PATCH /api/leads/:id`
Any of: `name, phone, telegram, email, unit_id, interest, comment, agent_id, channel_first_id, deal_amount, deal_currency`. -> `200 {lead}`. Changing the agent writes a system note.

### `POST /api/leads/:id/status`
```json
{ "status": "booking", "note": "deposit received", "deal_amount": 61200, "deal_currency": "USD", "lost_reason": null }
```
Rules: `lost` requires `lost_reason`; `booking` / `contract` / `paid` require a `unit_id` on the lead (otherwise 422 `unit_required`) and update `unit_states`; if the unit is already `reserved` by another lead: 409 `unit_taken` with `{ "lead_id": 12 }`. Writes a history row and queues a postback. -> `200 {lead, unit_state}`.

### `POST /api/leads/:id/notes` -> `201 {note}`; `DELETE /api/leads/:id/notes/:noteId` -> `204`.

### `POST /api/leads/import` (multipart, CSV file)
Columns (header required, any order): `name, phone, telegram, email, unit_number, interest, status, agent_slug, channel, campaign, comment, created_at`. Separator `,` or `;`, UTF-8. Response `200 { "import_id": 7, "created": 38, "skipped": 4, "errors": [{ "row": 12, "message": "unit_number 9999 not found" }] }`. `DELETE /api/imports/:id` rolls the import back.

### `GET /api/leads/export.csv`
Same filters as the list.

---

## Admin: agents

| Method | Path | Description |
|---|---|---|
| GET | `/api/agents` | `[{ id, slug, name, phone, telegram, is_active, has_telegram_chat, links: { site, short }, stats_30d: { clicks, leads, bookings } }]` |
| POST | `/api/agents` | `{ name, slug?, phone, telegram }`; the slug is transliterated from the name if empty; -> `201 {agent, links}` |
| PATCH | `/api/agents/:id` | any field + `is_active` |
| POST | `/api/agents/:id/magic-link` | -> `201 { "url": "https://example.com/crm/m/...", "expires_at": "..." }` (valid 7 days; older links are revoked) |
| GET | `/api/agents/:id/stats?from&to` | same as `/api/agent/stats`, for any agent |
| GET | `/api/agents/:id/telegram-code` | one-time code to link a chat: the agent sends `/start <code>` to the bot |

### `GET /api/stats/agents?from&to`
Ranking for the period:

```json
{
  "period": { "from": "...", "to": "..." },
  "team_median": { "clicks": 84, "leads": 7, "showings": 3, "bookings": 1, "deals": 0 },
  "rows": [{
    "agent": { "id": 3, "name": "...", "slug": "nino" },
    "clicks": 212, "leads": 15, "showings": 7, "bookings": 3, "deals": 1,
    "revenue_usd": 61200,
    "conv": { "click_lead": 0.071, "lead_showing": 0.467, "showing_booking": 0.429, "booking_deal": 0.333 }
  }]
}
```

---

## Admin: channels, campaigns, expenses

`POST /api/channels` `{ name, id?, is_paid?, utm_sources? }` -> `201 {channel}`: creates the channel and the rule `utm_source in (id, aliases)`. `PATCH /api/channels/:id` `{ name?, is_paid?, is_active?, sort? }`: the system channels `agent / organic / direct` cannot be disabled. `GET /api/channels/names` (admin and agent) -> `{ id: name }`.

`GET /api/channels` -> taxonomy + `rules`. `PUT /api/channels/rules` replaces the whole rule list (body as in `config/channels.json`). `POST /api/channels/reclassify?from&to` recomputes the channel of touches in the period with the new rules (leads keep their frozen channel; `include_leads=true` recomputes them too).

`POST /api/channels/test` `{ url, referrer }` -> `{ parsed, channel }`: the parsed entry parameters and the channel the current rules resolve to.

### `GET /api/stats/channels?from&to&attribution=first|last&group=channel|campaign`

```json
{
  "period": { "from": "2026-08-07", "to": "2026-09-06" },
  "attribution": "first",
  "totals": { "clicks": 1840, "leads": 60, "showings": 23, "bookings": 8, "deals": 3, "spend_usd": 2140, "revenue_usd": 183600 },
  "rows": [{
    "channel": "meta", "campaign": null,
    "clicks": 910, "leads": 31, "showings": 12, "bookings": 5, "deals": 2,
    "conv": { "click_lead": 0.034, "lead_showing": 0.387, "showing_booking": 0.417, "booking_deal": 0.4 },
    "spend_usd": 1400,
    "cpl": 45.2, "cost_per_showing": 116.7, "cac": 700, "roas": 87.4
  }],
  "unattributed": { "leads": 2 }
}
```
`cpl = spend / leads`, `cost_per_showing = spend / showings`, `cac = spend / deals`, `roas = revenue / spend`. Free channels return `null` spend and `null` cost metrics. `group=campaign` splits rows by `utm_campaign` inside each channel (an empty campaign comes back as `campaign: null`; the UI labels it "no campaign").

### `GET /api/stats/overview?from&to`
Dashboard header: funnel for the period, comparison with the previous period of equal length `{ current: {...}, previous: {...}, delta: {...} }`, and a daily series `series: [{ date, clicks, leads }]`.

### `GET /api/stats/series?from&to&channel&agent_id`
Per-day clicks and leads for a period: `[{ date, clicks, leads }]`. `channel` and `agent_id` narrow it to one channel or one agent.

### Expenses

| Method | Path | Body |
|---|---|---|
| GET | `/api/expenses?from&to&channel` | `[{ id, channel, campaign, period_start, period_end, amount, currency, fx_to_usd, amount_usd, note, created_by, created_at }]` |
| POST | `/api/expenses` | `{ channel_id, campaign?, period_start, period_end, amount, currency, fx_to_usd? }`; the rate comes from settings if not given; -> `201` |
| PATCH | `/api/expenses/:id` | any field |
| DELETE | `/api/expenses/:id` | -> `204` |

Spend is spread evenly over the days of its period, so a report for any range takes a proportional share.

---

## Admin: units, postbacks, settings

| Method | Path | Description |
|---|---|---|
| GET | `/api/units?status&type&floor&q` | units with current status, the holding lead, and views over 30 days |
| PATCH | `/api/units/:id/status` | `{ status, note }` manual override (for example, sold in the office without a lead) |
| GET | `/api/postbacks?status&provider` | queue |
| POST | `/api/postbacks/:id/retry` | back to `queued` |
| GET | `/api/notifications` | last 100 Telegram / e-mail notifications with status and lead name |
| GET | `/api/settings` | `{ site_url, attribution, revenue_statuses, cookie_days, fx: { GEL: 0.37, EUR: 1.08 }, tg_admin_chat_id, providers: { meta_capi: { enabled:false } } }` |
| PUT | `/api/settings` | partial update |
| GET | `/api/settings/telegram-code` | one-time code to link the admin chat: send `/start <code>` to the bot |
| POST | `/api/demo/clear` | delete every row with `is_demo=1` -> `{ deleted: {...} }` |
| GET | `/api/health` | `{ ok: true, version: "..." }` (no auth, for monitoring) |

---

## Agent (cabinet, own data only)

| Method | Path | Description |
|---|---|---|
| GET | `/api/agent/me` | `{ agent: { id, name, slug, phone, telegram }, links: { site, short }, telegram_linked: true }` |
| GET | `/api/agent/telegram-code` | one-time code for the signed-in agent to link a chat |
| GET | `/api/agent/stats?from&to` | `{ period, me: { clicks, leads, showings, bookings, deals, revenue_usd, conv:{...} }, team_median: {...}, series: [{ date, clicks, leads }], rank: { position: 2, of: 5 } }` |
| GET | `/api/agent/leads?status&q&page` | leads where `agent_id` = me; same format as admin, without other agents' fields |
| GET | `/api/agent/leads/:id` | card (404 if not mine) |
| POST | `/api/agent/leads/:id/status` | same rules as admin; `contract` / `paid` are admin only (403 `admin_only`) |
| POST | `/api/agent/leads/:id/notes` | note |
| PATCH | `/api/agent/leads/:id` | only `unit_id`, `comment`, `telegram`, `email` |

An agent never sees other agents' leads, expenses, channel rules, or other agents' magic links.

---

## Snippet `crm-track.js`

- One `async` line on every site page, about 5 KB (2.2 KB gzipped), no dependencies.
- On load: reads `vid` from cookie `crm_vid`, then localStorage, else creates a uuid; parses `location.search` (`utm_*`, `fbclid`, `gclid`, `ttclid`, `yclid`, `a`) and `document.referrer`; sends `POST /api/track {type:"touch"}` with `fetch(..., {keepalive:true})`. Sets cookies `crm_vid` and `crm_a` (agent slug) for 90 days on the site domain.
- Listens to `hashchange` on the unit-selection page: `#/own/<id>` becomes `unit_view`. The site creates leads itself via `POST /api/leads`; the snippet only adds `vid`.
- Public interface: `window.crmTrack.vid()`, `window.crmTrack.agent()`, `window.crmTrack.lead(payload)` (wrapper over `POST /api/leads` that adds `vid`, `source`, `page`), `window.crmTrack.units(cb)` (unit statuses).
- Site integration: the forms call `window.crmTrack.lead({...})` instead of only showing the thank-you state; on a network error the same thank-you screen is shown and the payload is kept in localStorage for a retry. The unit list applies `units/status.json` on start.

---

## Telegram notifications

One bot (`TG_BOT_TOKEN` in `.env` or the token in settings). The admin links a chat with a code from settings, an agent with a code from their card (`/start <code>`). New lead: a message to the agent (if assigned) and to the admin with name, contact, unit, channel / campaign and a link to the card. Errors are written to `notifications`.

---

## v0.2: client self-service (admin)

| Method | Path | Description |
|---|---|---|
| GET / POST / PATCH | `/api/admins`, `/api/admins/:id` | users: `{ login, name, email, password, role: admin\|viewer, is_active }`; viewer gets 403 on any non-GET request |
| POST | `/api/auth/password` `{ current, password }` | change own password, other sessions are ended |
| POST | `/api/auth/logout-all` | end other sessions |
| GET | `/api/meta` (admin and agent) | `{ channels: {id: name}, lost_reasons: [{id, label}] }` |
| GET / PUT | `/api/settings/telegram` `{ token }` | bot from settings, checked with getMe; `POST /api/settings/telegram/test` |
| GET / PUT | `/api/settings/email` | SMTP + `notify_emails`; `POST /api/settings/email/test` |
| GET / PUT | `/api/settings/lost-reasons` `{ reasons: [{id?, label}] }` | loss reasons |
| PATCH | `/api/units/:id` `{ price }` | price with history; `GET /api/units/:id/history` |
| POST | `/api/units/import` (multipart CSV: number, price, status) | price list in bulk; `GET /api/units/export.csv` |
| GET / POST | `/api/backups` | list / create; `GET /api/backups/:name` download; `DELETE` remove |
| POST | `/api/backups/restore` (`{ name }` or multipart file) | `integrity_check`, then `.restore` next to the database, then service restart |
| GET | `/api/export/all.json` | all tables (tokens and passwords masked) |
| GET | `/api/diag` | snippet on the site, last click / lead / copy, Telegram / e-mail, disk, failed notifications |
| POST | `/api/expenses/import` (multipart CSV) | expenses in bulk |
| GET | `/api/audit` | admin action log |
