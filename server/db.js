import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

export const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const backupDir = config.backupDir;
fs.mkdirSync(backupDir, { recursive: true });
// восстановление из интерфейса: файл <db>.restore подменяет базу при старте (текущая уходит в бэкапы)
const pending = config.dbPath + '.restore';
if (fs.existsSync(pending)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (fs.existsSync(config.dbPath)) fs.renameSync(config.dbPath, path.join(backupDir, `crm-pre-restore-${stamp}.db`));
  for (const suf of ['-wal', '-shm']) if (fs.existsSync(config.dbPath + suf)) fs.unlinkSync(config.dbPath + suf);
  fs.renameSync(pending, config.dbPath);
}
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// схема - идемпотентна (CREATE IF NOT EXISTS)
db.exec(fs.readFileSync(path.join(config.root, 'db/schema.sql'), 'utf8'));
// миграции колонок (ALTER TABLE ADD COLUMN, если нет)
function addColumn(table, col, def) { const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name); if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); }
addColumn('admins', 'role', "TEXT NOT NULL DEFAULT 'admin'");      // 'admin' | 'viewer'
addColumn('admins', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
addColumn('admins', 'email', 'TEXT');
addColumn('agents', 'email', 'TEXT');
addColumn('units', 'price_updated_at', 'TEXT');

const DEFAULT_SETTINGS = {
  site_url: config.siteUrl,
  attribution: 'first',
  revenue_statuses: 'contract,paid',
  cookie_days: String(config.cookieDays),
  'fx.USD': '1',
  'fx.GEL': '0.37',
  'fx.EUR': '1.08',
  tg_admin_chat_id: config.tgAdminChatId,
  'provider.meta_capi.enabled': '0',
  'provider.google_offline.enabled': '0',
  'provider.telegram_ads.enabled': '0',
  tg_bot_token: '',
  lost_reasons: JSON.stringify([{ id: 'price', label: 'Дорого' }, { id: 'no_answer', label: 'Не отвечает' }, { id: 'bought_elsewhere', label: 'Купил в другом месте' }, { id: 'postponed', label: 'Отложил' }, { id: 'other', label: 'Другое' }]),
  'smtp.host': '', 'smtp.port': '587', 'smtp.user': '', 'smtp.pass': '', 'smtp.from': '', 'smtp.secure': '0',
  notify_emails: '',
};

export function getSetting(key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : (fallback ?? DEFAULT_SETTINGS[key] ?? null);
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(key, String(value), now());
}
export function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

export function bootstrap() {
  const ts = now();
  // настройки по умолчанию
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    db.prepare('INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES(?,?,?)').run(k, v, ts);
  }
  // каналы и правила из config/channels.json (только если таблицы пусты)
  const cfg = JSON.parse(fs.readFileSync(path.join(config.root, 'config/channels.json'), 'utf8'));
  const chCount = db.prepare('SELECT COUNT(*) c FROM channels').get().c;
  if (!chCount) {
    const ins = db.prepare('INSERT INTO channels(id, name, sort, is_paid, is_active) VALUES(?,?,?,?,1)');
    for (const c of cfg.channels) ins.run(c.id, c.name, c.sort, c.is_paid);
  }
  const ruleCount = db.prepare('SELECT COUNT(*) c FROM channel_rules').get().c;
  if (!ruleCount) replaceRules(cfg.rules);
  // квартиры из units.json - upsert, статус источника обновляется, unit_states не трогаем
  const units = JSON.parse(fs.readFileSync(path.join(config.root, 'config/units.json'), 'utf8')).units;
  const up = db.prepare(`INSERT INTO units(id, number, floor, slot, type, living, balcony, total, price, price_per_sqm, view, source_status)
    VALUES(@id, @number, @floor, @slot, @type, @living, @balcony, @total, @price, @pricePerSqm, @view, @status)
    ON CONFLICT(id) DO UPDATE SET number = excluded.number, floor = excluded.floor, slot = excluded.slot, type = excluded.type,
      living = excluded.living, balcony = excluded.balcony, total = excluded.total,
      price = COALESCE(units.price, excluded.price), price_per_sqm = COALESCE(units.price_per_sqm, excluded.price_per_sqm),
      view = excluded.view, source_status = excluded.source_status`);
  const tx = db.transaction(() => { for (const u of units) up.run({ ...u, price: u.price ?? null, pricePerSqm: u.pricePerSqm ?? null, view: u.view ?? null, status: u.status ?? 'available' }); });
  tx();
  // админ из .env, если нет ни одного
  const admins = db.prepare('SELECT COUNT(*) c FROM admins').get().c;
  if (!admins) {
    db.prepare('INSERT INTO admins(login, password_hash, name, created_at) VALUES(?,?,?,?)')
      .run(config.adminLogin, bcrypt.hashSync(config.adminPassword, 10), 'Администратор', ts);
  }
  // чистим просроченные сессии
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(ts);
}

export function replaceRules(rules) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM channel_rules').run();
    const ins = db.prepare('INSERT INTO channel_rules(channel_id, priority, field, op, pattern, note) VALUES(?,?,?,?,?,?)');
    for (const r of rules) ins.run(r.channel ?? r.channel_id, r.priority ?? 100, r.field, r.op ?? 'eq', r.pattern ?? '', r.note ?? null);
  });
  tx();
}

export function fxToUsd(currency) {
  const v = Number(getSetting(`fx.${currency}`, currency === 'USD' ? '1' : null));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export function clearDemo() {
  const tables = ['expenses', 'events', 'touches', 'link_hits', 'leads', 'visitors', 'agents'];
  const out = {};
  const tx = db.transaction(() => {
    // лиды демо тянут за собой историю/заметки/постбэки (ON DELETE CASCADE); unit_states демо-лидов -> снимаем
    db.prepare('DELETE FROM unit_states WHERE lead_id IN (SELECT id FROM leads WHERE is_demo = 1)').run();
    for (const t of tables) out[t] = db.prepare(`DELETE FROM ${t} WHERE is_demo = 1`).run().changes;
  });
  tx();
  return out;
}

export function audit(actor, action, target, details) {
  db.prepare('INSERT INTO audit_log(ts, actor, action, target, details) VALUES(?,?,?,?,?)').run(now(), actor, action, target ?? null, details ? JSON.stringify(details) : null);
}

export function lostReasons() {
  try { const a = JSON.parse(getSetting('lost_reasons') || '[]'); return Array.isArray(a) && a.length ? a : JSON.parse(DEFAULT_SETTINGS.lost_reasons); } catch { return JSON.parse(DEFAULT_SETTINGS.lost_reasons); }
}

// Бэкап: VACUUM INTO - консистентная копия при WAL
export function makeBackup(label = 'manual') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(backupDir, `crm-${stamp}-${label}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return path.basename(file);
}
export function listBackups() {
  return fs.readdirSync(backupDir).filter(f => /^crm-.*\.db(\.gz)?$/.test(f)).map(f => { const st = fs.statSync(path.join(backupDir, f)); return { name: f, size: st.size, mtime: st.mtime.toISOString() }; }).sort((a, b) => b.mtime.localeCompare(a.mtime));
}
