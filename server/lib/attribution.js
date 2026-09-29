// Разбор входа посетителя -> касание -> канал. Правила берутся из channel_rules (конфиг, не код).
import { db, now, getSetting } from '../db.js';
import { config } from '../config.js';

export function parseEntry(url, referrer) {
  const out = { landing_url: url || null, landing_path: null, referrer: referrer || null, referrer_host: null,
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
    fbclid: null, gclid: null, ttclid: null, yclid: null, agent_slug: null };
  try {
    const u = new URL(url);
    out.landing_path = u.pathname + (u.hash && u.hash.startsWith('#/') ? u.hash : '');
    const p = u.searchParams;
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid', 'yclid']) {
      const v = p.get(k); if (v) out[k] = v.slice(0, 200);
    }
    const a = p.get('a'); if (a && /^[a-z0-9-]{2,32}$/i.test(a)) out.agent_slug = a.toLowerCase();
  } catch { /* url не разобрался - оставляем как есть */ }
  try { if (referrer) out.referrer_host = new URL(referrer).hostname.toLowerCase(); } catch { /* пусто */ }
  return out;
}

export function hasEntryParams(t) {
  return !!(t.utm_source || t.utm_medium || t.utm_campaign || t.fbclid || t.gclid || t.ttclid || t.yclid || t.agent_slug);
}

let rulesCache = null;
export function invalidateRules() { rulesCache = null; }
function rules() {
  if (!rulesCache) rulesCache = db.prepare('SELECT * FROM channel_rules ORDER BY priority ASC, id ASC').all();
  return rulesCache;
}

function fieldValue(t, field) {
  switch (field) {
    case 'utm_source': return (t.utm_source || '').toLowerCase();
    case 'utm_medium': return (t.utm_medium || '').toLowerCase();
    case 'utm_campaign': return (t.utm_campaign || '').toLowerCase();
    case 'referrer_host': return t.referrer_host || '';
    case 'click_id': return ['fbclid', 'gclid', 'ttclid', 'yclid'].filter(k => t[k]).join(',');
    case 'has_agent': return t.agent_slug ? 'yes' : '';
    default: return '';
  }
}

function matches(rule, value) {
  if (!value) return false;
  const pat = rule.pattern || '';
  switch (rule.op) {
    case 'exists': return true;
    case 'eq': return rule.field === 'click_id' ? value.split(',').includes(pat) : value === pat.toLowerCase();
    case 'in': return pat.toLowerCase().split(',').map(s => s.trim()).filter(Boolean).includes(value);
    case 'contains': return value.includes(pat.toLowerCase());
    case 'regex': try { return new RegExp(pat, 'i').test(value); } catch { return false; }
    default: return false;
  }
}

export function resolveChannel(t) {
  for (const r of rules()) if (matches(r, fieldValue(t, r.field))) return r.channel_id;
  return t.referrer_host ? 'organic' : 'direct';
}

export function testRules(sample) {
  const t = parseEntry(sample.url || '', sample.referrer || '');
  return { parsed: t, channel: resolveChannel(t) };
}

// Регистрирует заход. Возвращает { visitor, touch (новое или последнее), created }
export function recordTouch({ vid, url, referrer, ua, ts, isDemo = 0 }) {
  const t = parseEntry(url, referrer);
  const time = ts || now();
  const agent = t.agent_slug ? db.prepare('SELECT id FROM agents WHERE slug = ? AND is_active = 1').get(t.agent_slug) : null;
  const tx = db.transaction(() => {
    let visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(vid);
    let created = false;
    if (!visitor) {
      db.prepare('INSERT INTO visitors(id, first_seen_at, last_seen_at, user_agent, is_demo) VALUES(?,?,?,?,?)').run(vid, time, time, ua || null, isDemo);
      visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(vid);
      created = true;
    }
    const gapMs = config.touchGapMinutes * 60 * 1000;
    const stale = !created && (new Date(time) - new Date(visitor.last_seen_at)) > gapMs;
    let touch = visitor.last_touch_id ? db.prepare('SELECT * FROM touches WHERE id = ?').get(visitor.last_touch_id) : null;
    const needNew = created || stale || hasEntryParams(t) || !touch;
    if (needNew) {
      const channel = resolveChannel(t);
      const r = db.prepare(`INSERT INTO touches(visitor_id, ts, landing_url, landing_path, referrer, referrer_host,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, ttclid, yclid, agent_slug, agent_id, channel_id, is_demo)
        VALUES(@visitor_id, @ts, @landing_url, @landing_path, @referrer, @referrer_host, @utm_source, @utm_medium, @utm_campaign, @utm_content, @utm_term,
        @fbclid, @gclid, @ttclid, @yclid, @agent_slug, @agent_id, @channel_id, @is_demo)`)
        .run({ ...t, visitor_id: vid, ts: time, agent_id: agent ? agent.id : null, channel_id: channel, is_demo: isDemo });
      touch = db.prepare('SELECT * FROM touches WHERE id = ?').get(r.lastInsertRowid);
      db.prepare('UPDATE visitors SET last_touch_id = ?, first_touch_id = COALESCE(first_touch_id, ?) WHERE id = ?').run(touch.id, touch.id, vid);
    }
    // агент: first-touch, замораживается на cookie_days
    if (agent) {
      const days = Number(getSetting('cookie_days', '90')) || 90;
      const expired = visitor.agent_set_at && (new Date(time) - new Date(visitor.agent_set_at)) > days * 86400000;
      if (!visitor.agent_id || expired) db.prepare('UPDATE visitors SET agent_id = ?, agent_set_at = ? WHERE id = ?').run(agent.id, time, vid);
    }
    db.prepare('UPDATE visitors SET last_seen_at = ?, user_agent = COALESCE(user_agent, ?) WHERE id = ?').run(time, ua || null, vid);
    return { visitor: db.prepare('SELECT * FROM visitors WHERE id = ?').get(vid), touch, created: needNew };
  });
  return tx();
}

export function recordEvent({ vid, type, unitId, path, meta, ts, isDemo = 0 }) {
  const visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(vid);
  if (!visitor) return null;
  const allowed = ['unit_view', 'form_open', 'form_submit', 'favorite', 'pdf'];
  if (!allowed.includes(type)) return null;
  const unit = unitId ? db.prepare('SELECT id FROM units WHERE id = ?').get(unitId) : null;
  const time = ts || now();
  db.prepare('INSERT INTO events(visitor_id, touch_id, ts, type, unit_id, path, meta, is_demo) VALUES(?,?,?,?,?,?,?,?)')
    .run(vid, visitor.last_touch_id, time, type, unit ? unit.id : null, path || null, meta ? JSON.stringify(meta) : null, isDemo);
  db.prepare('UPDATE visitors SET last_seen_at = ? WHERE id = ?').run(time, vid);
  return true;
}
