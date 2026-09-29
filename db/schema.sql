-- realestate-crm - схема SQLite (одна база-файл data/crm.db)
-- Все даты - ISO-8601 UTC текстом ('2026-09-06T14:03:11Z'). Деньги - REAL в валюте строки + amount_usd для сводок.
-- is_demo = 1 у всего, что создал сид; «Очистить демо» удаляет строки с is_demo = 1.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Справочники
-- ---------------------------------------------------------------------------

-- Каналы: фиксированная таксономия. Правила маппинга utm -> канал лежат в channel_rules,
-- сидируются из config/channels.json и редактируются в настройках (не в коде).
CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,              -- 'meta' | 'google' | 'telegram' | 'yandex' | 'tiktok' | 'agent' | 'organic' | 'direct'
  name        TEXT NOT NULL,                 -- «Meta», «Google», ...
  sort        INTEGER NOT NULL DEFAULT 0,
  is_paid     INTEGER NOT NULL DEFAULT 1,    -- 0 у agent/organic/direct: расходы не вносятся, CPL не считается
  is_active   INTEGER NOT NULL DEFAULT 1
);

-- Правило: если поле touch (utm_source / utm_medium / referrer_host / click_id / has_agent) матчит pattern - канал = channel_id.
-- Проверяются по priority ASC, первое совпадение побеждает. Нет совпадений -> 'direct' (без referrer) или 'organic' (с referrer).
CREATE TABLE IF NOT EXISTS channel_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  TEXT NOT NULL REFERENCES channels(id),
  priority    INTEGER NOT NULL DEFAULT 100,
  field       TEXT NOT NULL,                 -- 'utm_source' | 'utm_medium' | 'referrer_host' | 'click_id' | 'has_agent'
  op          TEXT NOT NULL DEFAULT 'eq',    -- 'eq' | 'in' | 'contains' | 'regex' | 'exists'
  pattern     TEXT NOT NULL,                 -- 'fb,facebook,instagram,ig' для in; 'gclid' для click_id
  note        TEXT
);

-- Квартиры: зеркало config/units.json (единственный источник номеров). Заполняется при старте (upsert по id).
-- Продажный статус живёт в unit_states; здесь - статус из units.json как «исходный».
CREATE TABLE IF NOT EXISTS units (
  id            TEXT PRIMARY KEY,            -- '10-3'
  number        TEXT NOT NULL UNIQUE,        -- '1003'
  floor         INTEGER NOT NULL,
  slot          INTEGER NOT NULL,
  type          TEXT NOT NULL,               -- studio | 1br | 2br | 3br
  living        REAL, balcony REAL, total REAL,
  price         REAL, price_per_sqm REAL,    -- USD (плейсхолдер до прайса застройщика)
  view          TEXT,
  source_status TEXT NOT NULL DEFAULT 'available'
);

-- Текущий статус квартиры для сайта. Меняется из сделки (лид -> бронь/договор/оплачен) или вручную.
CREATE TABLE IF NOT EXISTS unit_states (
  unit_id     TEXT PRIMARY KEY REFERENCES units(id),
  status      TEXT NOT NULL CHECK (status IN ('available','reserved','sold')),
  lead_id     INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  changed_at  TEXT NOT NULL,
  changed_by  TEXT NOT NULL,                 -- 'admin:1' | 'agent:3' | 'system'
  note        TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,              -- 'site_url', 'attribution' (first|last), 'revenue_statuses', 'fx.GEL', 'fx.EUR', 'cookie_days', 'tg_admin_chat_id'
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Люди и доступ
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  login         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,               -- bcrypt
  name          TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT NOT NULL UNIQUE,     -- [a-z0-9-]{2,32}; часть личной ссылки ?a=<slug>
  name             TEXT NOT NULL,
  phone            TEXT,
  telegram         TEXT,                     -- @username для карточки
  telegram_chat_id TEXT,                     -- chat_id для уведомлений; появляется после /start у бота с кодом агента
  is_active        INTEGER NOT NULL DEFAULT 1,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- Magic-link агента: /m/<token>. Токен хранится хэшем (sha256), в URL - сырой. Одноразовый по умолчанию (used_at),
-- ставит сессионную cookie на agent_session_days. Админ выпускает новый в карточке агента.
CREATE TABLE IF NOT EXISTS magic_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);

-- Сессии админа и агента (cookie crm_sid, httpOnly, SameSite=Lax).
CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,           -- 32 байта random, base64url
  principal_type TEXT NOT NULL CHECK (principal_type IN ('admin','agent')),
  principal_id   INTEGER NOT NULL,
  expires_at     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  user_agent     TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_exp ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Трекинг: посетители -> касания -> события
-- ---------------------------------------------------------------------------

-- Посетитель = браузер. id генерирует сниппет (uuid v4) и хранит в cookie crm_vid (90 дней) + localStorage.
CREATE TABLE IF NOT EXISTS visitors (
  id             TEXT PRIMARY KEY,
  first_seen_at  TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  first_touch_id INTEGER,                    -- денормализация: первое касание (FK ставится логикой, не схемой - циклическая ссылка)
  last_touch_id  INTEGER,
  agent_id       INTEGER REFERENCES agents(id) ON DELETE SET NULL,  -- first-touch агент, замораживается на 90 дней
  agent_set_at   TEXT,
  user_agent     TEXT,
  is_demo        INTEGER NOT NULL DEFAULT 0
);

-- Касание = «клик» в отчётах. Создаётся сниппетом при заходе, если: новых visitor, ИЛИ в URL есть utm/click-id/a,
-- ИЛИ прошло > 30 мин с last_seen_at (новая сессия). Иначе заход = pageview-событие без нового касания.
CREATE TABLE IF NOT EXISTS touches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id    TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  ts            TEXT NOT NULL,
  landing_url   TEXT,
  landing_path  TEXT,                        -- '/', '/select-c.html'
  referrer      TEXT,
  referrer_host TEXT,
  utm_source    TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT,
  fbclid        TEXT, gclid TEXT, ttclid TEXT, yclid TEXT,
  agent_slug    TEXT,                        -- параметр a=
  agent_id      INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  channel_id    TEXT NOT NULL REFERENCES channels(id),  -- результат channel_rules на момент касания
  is_demo       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_touches_visitor ON touches(visitor_id, ts);
CREATE INDEX IF NOT EXISTS ix_touches_ts      ON touches(ts);
CREATE INDEX IF NOT EXISTS ix_touches_channel ON touches(channel_id, ts);
CREATE INDEX IF NOT EXISTS ix_touches_agent   ON touches(agent_id, ts);

-- События на сайте: просмотр квартиры, открытие формы, отправка. pageview не хранится (только касания), чтобы база не пухла.
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id  TEXT NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  touch_id    INTEGER REFERENCES touches(id) ON DELETE SET NULL,
  ts          TEXT NOT NULL,
  type        TEXT NOT NULL,                 -- 'unit_view' | 'form_open' | 'form_submit' | 'favorite' | 'pdf'
  unit_id     TEXT REFERENCES units(id),
  path        TEXT,
  meta        TEXT,                          -- JSON
  is_demo     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_events_visitor ON events(visitor_id, ts);
CREATE INDEX IF NOT EXISTS ix_events_unit    ON events(unit_id, ts);

-- Переходы по короткой ссылке /a/<slug> (до сайта, cookie ещё нет). Для сверки «сколько раз агент показал ссылку».
CREATE TABLE IF NOT EXISTS link_hits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  ts          TEXT NOT NULL,
  referrer    TEXT,
  user_agent  TEXT,
  ip_hash     TEXT
);

-- ---------------------------------------------------------------------------
-- Лиды и воронка
-- ---------------------------------------------------------------------------

-- Статусы: new -> contact -> showing -> booking -> contract -> paid; lost - из любого (lost_reason обязателен).
CREATE TABLE IF NOT EXISTS leads (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  name             TEXT NOT NULL,
  phone            TEXT,                     -- E.164 после нормализации ('+995...'); хотя бы одно из phone/telegram обязательно
  telegram         TEXT,
  email            TEXT,
  unit_id          TEXT REFERENCES units(id),          -- интерес к квартире (номер из units.json), опционально
  interest         TEXT,                     -- свободный интерес из формы лендинга: 'studio' | '1br' | '2br' | '3br' | текст
  source           TEXT NOT NULL,            -- 'site_form' | 'site_modal' | 'manual' | 'csv' | 'api'
  visitor_id       TEXT REFERENCES visitors(id) ON DELETE SET NULL,
  first_touch_id   INTEGER REFERENCES touches(id) ON DELETE SET NULL,
  last_touch_id    INTEGER REFERENCES touches(id) ON DELETE SET NULL,
  channel_first_id TEXT REFERENCES channels(id),       -- замораживается при создании лида
  channel_last_id  TEXT REFERENCES channels(id),
  campaign_first   TEXT,                     -- utm_campaign первого касания (для отчёта по кампаниям)
  campaign_last    TEXT,
  agent_id         INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  agent_source     TEXT,                     -- 'cookie' | 'manual' | 'csv' | 'round_robin'
  status           TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new','contact','showing','booking','contract','paid','lost')),
  lost_reason      TEXT,                     -- обязателен при status='lost': 'price' | 'no_answer' | 'bought_elsewhere' | 'postponed' | 'other'
  lost_note        TEXT,
  deal_amount      REAL,                     -- сумма сделки в deal_currency; заполняется на booking/contract/paid
  deal_currency    TEXT DEFAULT 'USD',
  deal_amount_usd  REAL,                     -- по курсу settings.fx.* на момент ввода
  comment          TEXT,
  utm_snapshot     TEXT,                     -- JSON: все параметры first/last-touch на момент создания (на случай удаления касаний)
  dedupe_key       TEXT,                     -- нормализованный телефон или telegram: повторная заявка -> не новый лид, а заметка
  is_demo          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_leads_status  ON leads(status, updated_at);
CREATE INDEX IF NOT EXISTS ix_leads_agent   ON leads(agent_id, created_at);
CREATE INDEX IF NOT EXISTS ix_leads_channel ON leads(channel_first_id, created_at);
CREATE INDEX IF NOT EXISTS ix_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS ix_leads_dedupe  ON leads(dedupe_key);

-- История статусов: источник правды для «показов/броней/сделок за период» (считаем по ts перехода, не по created_at лида).
CREATE TABLE IF NOT EXISTS lead_status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  ts          TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor       TEXT NOT NULL,                 -- 'admin:1' | 'agent:3' | 'system'
  reason      TEXT,                          -- lost_reason
  note        TEXT
);
CREATE INDEX IF NOT EXISTS ix_lsh_lead ON lead_status_history(lead_id, ts);
CREATE INDEX IF NOT EXISTS ix_lsh_to   ON lead_status_history(to_status, ts);

-- Заметки и системные записи в ленте лида (звонок, письмо, «уведомление отправлено», «квартира 1003 -> бронь»).
CREATE TABLE IF NOT EXISTS lead_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  ts          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'note',  -- 'note' | 'system' | 'duplicate' (повторная заявка с сайта)
  text        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notes_lead ON lead_notes(lead_id, ts);

-- ---------------------------------------------------------------------------
-- Расходы и интеграции
-- ---------------------------------------------------------------------------

-- Расход по каналу за период. campaign - опционально (совпадает с utm_campaign для отчёта по кампаниям).
CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id   TEXT NOT NULL REFERENCES channels(id),
  campaign     TEXT,
  period_start TEXT NOT NULL,                -- 'YYYY-MM-DD'
  period_end   TEXT NOT NULL,                -- включительно
  amount       REAL NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',  -- USD | GEL | EUR
  fx_to_usd    REAL NOT NULL DEFAULT 1,      -- курс на момент ввода (из settings, можно поправить руками)
  amount_usd   REAL NOT NULL,
  note         TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  is_demo      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_expenses_period ON expenses(channel_id, period_start, period_end);

-- Очередь серверных постбэков конверсий. Фаза 1: строки создаются при смене статуса, воркер помечает 'skipped'
-- пока провайдер не сконфигурирован. Фаза 2: реальная отправка (Meta CAPI, Google offline conversions, Telegram Ads).
CREATE TABLE IF NOT EXISTS postback_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider    TEXT NOT NULL,                 -- 'meta_capi' | 'google_offline' | 'telegram_ads'
  event       TEXT NOT NULL,                 -- 'Lead' | 'Schedule' (показ) | 'InitiateCheckout' (бронь) | 'Purchase' (договор/оплата)
  lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  payload     TEXT NOT NULL,                 -- JSON: click_id, hashed phone/email, event_time, value/currency
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  sent_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_postbacks_status ON postback_queue(status, created_at);

-- Лог уведомлений в Telegram (новый лид -> агент + админ). Для отладки «почему не пришло».
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  recipient   TEXT NOT NULL,                 -- 'agent:3' | 'admin'
  chat_id     TEXT,
  status      TEXT NOT NULL,                 -- 'sent' | 'failed' | 'no_chat_id'
  error       TEXT,
  ts          TEXT NOT NULL
);

-- Импорт CSV: журнал загрузок для отката («удалить всё из импорта #7»).
CREATE TABLE IF NOT EXISTS imports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT,
  rows_total  INTEGER, rows_created INTEGER, rows_skipped INTEGER,
  errors      TEXT,                          -- JSON [{row, message}]
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- v0.2: самостоятельность клиента
-- ---------------------------------------------------------------------------

-- История цен квартир (правка в интерфейсе или импорт прайса)
CREATE TABLE IF NOT EXISTS unit_price_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id     TEXT NOT NULL REFERENCES units(id),
  ts          TEXT NOT NULL,
  old_price   REAL,
  new_price   REAL,
  actor       TEXT NOT NULL,
  source      TEXT NOT NULL                 -- 'manual' | 'import'
);
CREATE INDEX IF NOT EXISTS ix_uph_unit ON unit_price_history(unit_id, ts);

-- Журнал действий администраторов (кто что менял в настройках/пользователях/прайсе)
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,                -- 'settings.update' | 'admin.create' | 'unit.price' | 'backup.restore' | ...
  target      TEXT,
  details     TEXT                          -- JSON
);
