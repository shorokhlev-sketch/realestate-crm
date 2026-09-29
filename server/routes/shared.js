// Общие выборки лидов для админа и агента. scope = { agentId } ограничивает выдачу.
import { db } from '../db.js';
import { ApiError, STATUSES } from '../lib/leads.js';

const SELECT = `SELECT l.*, u.number unit_number, u.type unit_type, u.total unit_total, u.floor unit_floor,
  a.name agent_name, a.slug agent_slug,
  (SELECT MAX(ts) FROM lead_status_history h WHERE h.lead_id = l.id AND h.to_status = l.status) status_since
  FROM leads l LEFT JOIN units u ON u.id = l.unit_id LEFT JOIN agents a ON a.id = l.agent_id`;

export function shapeLead(l) {
  return {
    id: l.id, name: l.name, phone: l.phone, telegram: l.telegram, email: l.email,
    unit: l.unit_id ? { id: l.unit_id, number: l.unit_number, type: l.unit_type, total: l.unit_total, floor: l.unit_floor } : null,
    interest: l.interest, status: l.status, status_since: l.status_since, lost_reason: l.lost_reason, lost_note: l.lost_note,
    agent: l.agent_id ? { id: l.agent_id, name: l.agent_name, slug: l.agent_slug } : null, agent_source: l.agent_source,
    channel_first: l.channel_first_id, campaign_first: l.campaign_first, channel_last: l.channel_last_id, campaign_last: l.campaign_last,
    source: l.source, created_at: l.created_at, updated_at: l.updated_at, comment: l.comment,
    deal_amount: l.deal_amount, deal_currency: l.deal_currency, deal_amount_usd: l.deal_amount_usd, is_demo: !!l.is_demo,
  };
}

export function leadListQuery(q = {}, scope = {}) {
  const where = []; const args = [];
  if (scope.agentId) { where.push('l.agent_id = ?'); args.push(scope.agentId); }
  if (q.status) { const st = String(q.status).split(',').filter(s => STATUSES.includes(s)); if (st.length) { where.push(`l.status IN (${st.map(() => '?').join(',')})`); args.push(...st); } }
  if (q.active === 'true') { where.push("l.status NOT IN ('lost','paid')"); }
  if (q.agent_id && !scope.agentId) { where.push('l.agent_id = ?'); args.push(Number(q.agent_id)); }
  if (q.channel) { where.push('l.channel_first_id = ?'); args.push(q.channel); }
  if (q.campaign) { where.push('l.campaign_first = ?'); args.push(q.campaign); }
  if (q.unit_id) { where.push('(l.unit_id = ? OR u.number = ?)'); args.push(q.unit_id, q.unit_id); }
  if (q.source) { where.push('l.source = ?'); args.push(q.source); }
  if (q.q) { where.push('(l.name LIKE ? OR l.phone LIKE ? OR l.telegram LIKE ? OR u.number LIKE ?)'); const s = `%${q.q}%`; args.push(s, s, s, s); }
  if (q.from) { where.push('l.created_at >= ?'); args.push(q.from + 'T00:00:00Z'); }
  if (q.to) { where.push('l.created_at <= ?'); args.push(q.to + 'T23:59:59Z'); }
  const sortMap = { updated_at: 'l.updated_at', created_at: 'l.created_at', name: 'l.name', status: 'l.status' };
  const s = String(q.sort || '-updated_at'); const desc = s.startsWith('-'); const col = sortMap[s.replace(/^-/, '')] || 'l.updated_at';
  const per = Math.min(100, Math.max(1, Number(q.per_page) || 50)); const page = Math.max(1, Number(q.page) || 1);
  const wh = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM leads l LEFT JOIN units u ON u.id = l.unit_id ${wh}`).get(...args).c;
  const items = db.prepare(`${SELECT} ${wh} ORDER BY ${col} ${desc ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per).map(shapeLead);
  const cWhere = scope.agentId ? 'WHERE agent_id = ?' : '';
  const counts = Object.fromEntries(db.prepare(`SELECT status, COUNT(*) c FROM leads ${cWhere} GROUP BY status`).all(...(scope.agentId ? [scope.agentId] : [])).map(r => [r.status, r.c]));
  if (q.view === 'board') {
    const all = db.prepare(`${SELECT} ${wh} ORDER BY l.updated_at DESC LIMIT 500`).all(...args).map(shapeLead);
    const columns = Object.fromEntries(STATUSES.map(s => [s, []]));
    for (const l of all) columns[l.status].push(l);
    return { total, columns, counts_by_status: counts };
  }
  return { total, page, per_page: per, items, counts_by_status: counts };
}

export function leadCard(id, scope = {}) {
  const l = db.prepare(`${SELECT} WHERE l.id = ?`).get(id);
  if (!l || (scope.agentId && l.agent_id !== scope.agentId)) throw new ApiError('not_found', 404, 'Лид не найден');
  const touch = (tid) => tid ? db.prepare('SELECT * FROM touches WHERE id = ?').get(tid) : null;
  const snap = l.utm_snapshot ? JSON.parse(l.utm_snapshot) : {};
  const first = touch(l.first_touch_id) || snap.first || null, last = touch(l.last_touch_id) || snap.last || null;
  const shapeTouch = (t) => t ? { ts: t.ts, channel: t.channel_id, utm_source: t.utm_source, utm_medium: t.utm_medium, utm_campaign: t.utm_campaign, utm_content: t.utm_content, utm_term: t.utm_term,
    click_id: t.fbclid ? `fbclid ${t.fbclid.slice(0, 8)}...` : t.gclid ? `gclid ${t.gclid.slice(0, 8)}...` : t.ttclid ? `ttclid ${t.ttclid.slice(0, 8)}...` : t.yclid ? `yclid ${t.yclid.slice(0, 8)}...` : null,
    referrer: t.referrer_host || t.referrer, landing_path: t.landing_path, agent_slug: t.agent_slug } : null;
  const names = Object.fromEntries(db.prepare('SELECT id, name FROM agents').all().map(a => [`agent:${a.id}`, a.name]));
  const adminNames = Object.fromEntries(db.prepare('SELECT id, name, login FROM admins').all().map(a => [`admin:${a.id}`, a.name || a.login]));
  const actorName = (a) => names[a] || adminNames[a] || (a === 'site' ? 'сайт' : a === 'system' ? 'система' : a);
  const unit = l.unit_id ? db.prepare('SELECT u.*, COALESCE(s.status, u.source_status) status, s.lead_id state_lead_id, s.changed_at state_changed_at FROM units u LEFT JOIN unit_states s ON s.unit_id = u.id WHERE u.id = ?').get(l.unit_id) : null;
  return {
    lead: { ...shapeLead(l), page: snap.page || null },
    unit,
    attribution: { first: shapeTouch(first), last: shapeTouch(last) },
    history: db.prepare('SELECT * FROM lead_status_history WHERE lead_id = ? ORDER BY ts DESC, id DESC').all(id).map(h => ({ ts: h.ts, from: h.from_status, to: h.to_status, actor: h.actor, actor_name: actorName(h.actor), reason: h.reason, note: h.note })),
    notes: db.prepare('SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY ts DESC, id DESC').all(id).map(n => ({ ...n, actor_name: actorName(n.actor) })),
    events: l.visitor_id ? db.prepare('SELECT e.ts, e.type, e.unit_id, u.number unit_number, e.path FROM events e LEFT JOIN units u ON u.id = e.unit_id WHERE e.visitor_id = ? ORDER BY e.ts DESC LIMIT 50').all(l.visitor_id) : [],
    postbacks: scope.agentId ? [] : db.prepare('SELECT id, provider, event, status, attempts, last_error, created_at, sent_at, payload FROM postback_queue WHERE lead_id = ? ORDER BY id DESC').all(id),
    notifications: scope.agentId ? [] : db.prepare('SELECT recipient, status, error, ts FROM notifications WHERE lead_id = ? ORDER BY id DESC').all(id),
  };
}
