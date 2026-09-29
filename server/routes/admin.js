import { parse as csvParse } from 'csv-parse/sync';
import { db, now, allSettings, setSetting, replaceRules, clearDemo, fxToUsd } from '../db.js';
import { config } from '../config.js';
import { requireAdmin, issueMagicLink } from '../lib/auth.js';
import { createLead, changeStatus, updateLead, addNote, getLead, ApiError, STATUSES, unitByRef } from '../lib/leads.js';
import { channelsReport, agentsReport, agentStats, overview, period, daySeries } from '../lib/stats.js';
import { invalidateRules, testRules, resolveChannel } from '../lib/attribution.js';
import { issueLinkCode, tgEnabled } from '../lib/telegram.js';
import { leadListQuery, leadCard } from './shared.js';

const slugify = (s) => String(s || '').toLowerCase()
  .replace(/[а-яё]/g, c => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }[c] || ''))
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

const agentLinks = (a) => ({ site: `${allSettings().site_url}${allSettings().site_url.includes('?') ? '&' : '?'}a=${a.slug}`, short: `${config.crmUrl}/a/${a.slug}` });

export default async function adminRoutes(app) {
  app.addHook('preHandler', requireAdmin);

  /* ---------- лиды ---------- */
  app.get('/api/leads', async (req) => leadListQuery(req.query, {}));
  app.post('/api/leads/manual', async (req, reply) => {
    const b = req.body || {};
    const r = await createLead({ ...b, unit: b.unit_id || b.unit || b.unit_number, source: 'manual', actor: `admin:${req._principal.id}`, agent_source: 'manual', notify: b.notify !== false });
    return reply.code(201).send({ lead: r.lead, duplicate: r.duplicate });
  });
  app.get('/api/leads/export.csv', async (req, reply) => {
    const { items } = leadListQuery({ ...req.query, per_page: 5000, page: 1 }, {});
    const cols = ['id', 'created_at', 'name', 'phone', 'telegram', 'email', 'unit_number', 'interest', 'status', 'agent', 'channel_first', 'campaign_first', 'channel_last', 'source', 'deal_amount_usd', 'lost_reason', 'comment'];
    const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [cols.join(',')].concat(items.map(l => cols.map(c => esc(c === 'unit_number' ? l.unit?.number : c === 'agent' ? l.agent?.name : l[c])).join(',')));
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="leads.csv"');
    return '﻿' + lines.join('\n');
  });
  app.post('/api/leads/import', async (req, reply) => {
    const file = await req.file();
    if (!file) throw new ApiError('validation', 400, 'Нужен CSV-файл');
    const buf = await file.toBuffer();
    let text = buf.toString('utf8').replace(/^﻿/, '');
    const delimiter = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    let rows;
    try { rows = csvParse(text, { columns: h => h.map(c => c.trim().toLowerCase()), delimiter, skip_empty_lines: true, trim: true, relax_column_count: true }); }
    catch (e) { throw new ApiError('csv_parse', 422, 'CSV не разобран: ' + e.message); }
    const errors = []; let created = 0, skipped = 0;
    const agentsBySlug = Object.fromEntries(db.prepare('SELECT id, slug FROM agents').all().map(a => [a.slug, a.id]));
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const agentId = r.agent_slug ? agentsBySlug[r.agent_slug.toLowerCase()] : null;
        if (r.agent_slug && !agentId) throw new Error(`агент ${r.agent_slug} не найден`);
        const channel = r.channel ? (db.prepare('SELECT id FROM channels WHERE id = ? OR lower(name) = lower(?)').get(r.channel, r.channel)?.id) : null;
        if (r.channel && !channel) throw new Error(`канал ${r.channel} не найден`);
        const status = r.status && STATUSES.includes(r.status) ? r.status : 'new';
        const created_at = r.created_at && !isNaN(Date.parse(r.created_at)) ? new Date(r.created_at).toISOString().replace(/\.\d{3}Z$/, 'Z') : undefined;
        const res = await createLead({ name: r.name, phone: r.phone, telegram: r.telegram, email: r.email, unit: r.unit_number || r.unit_id, interest: r.interest, comment: r.comment,
          agent_id: agentId, agent_source: 'csv', channel_id: channel, campaign: r.campaign, status, created_at, source: 'csv', actor: `admin:${req._principal.id}`, notify: false });
        if (res.duplicate) skipped++; else created++;
      } catch (e) { errors.push({ row: i + 2, message: e.message }); skipped++; }
    }
    const imp = db.prepare('INSERT INTO imports(filename, rows_total, rows_created, rows_skipped, errors, created_by, created_at) VALUES(?,?,?,?,?,?,?)')
      .run(file.filename, rows.length, created, skipped, JSON.stringify(errors), `admin:${req._principal.id}`, now());
    return { import_id: imp.lastInsertRowid, total: rows.length, created, skipped, errors };
  });
  app.delete('/api/imports/:id', async (req, reply) => {
    const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(Number(req.params.id)); if (!imp) throw new ApiError('not_found', 404, 'Импорт не найден');
    const r = db.prepare("DELETE FROM leads WHERE source = 'csv' AND created_at >= ? AND id IN (SELECT lead_id FROM lead_status_history WHERE note = 'csv' AND ts >= ?)").run(imp.created_at.slice(0, 16), imp.created_at.slice(0, 16));
    return reply.send({ deleted: r.changes });
  });
  app.get('/api/leads/:id', async (req) => leadCard(Number(req.params.id), {}));
  app.patch('/api/leads/:id', async (req) => ({ lead: updateLead(Number(req.params.id), req.body || {}, `admin:${req._principal.id}`) }));
  app.post('/api/leads/:id/status', async (req) => changeStatus(Number(req.params.id), { ...(req.body || {}), actor: `admin:${req._principal.id}`, role: 'admin' }));
  app.post('/api/leads/:id/notes', async (req, reply) => {
    const text = String(req.body?.text || '').trim(); if (!text) throw new ApiError('validation', 422, 'Пустая заметка');
    if (!getLead(Number(req.params.id))) throw new ApiError('not_found', 404, 'Лид не найден');
    db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').run(now(), Number(req.params.id));
    return reply.code(201).send({ note: addNote(Number(req.params.id), `admin:${req._principal.id}`, text.slice(0, 4000)) });
  });
  app.delete('/api/leads/:id/notes/:noteId', async (req, reply) => { db.prepare("DELETE FROM lead_notes WHERE id = ? AND lead_id = ? AND kind = 'note'").run(Number(req.params.noteId), Number(req.params.id)); return reply.code(204).send(); });
  app.delete('/api/leads/:id', async (req, reply) => {
    const lead = getLead(Number(req.params.id)); if (!lead) throw new ApiError('not_found', 404, 'Лид не найден');
    db.prepare("UPDATE unit_states SET status = 'available', lead_id = NULL, changed_at = ?, changed_by = ?, note = 'лид удалён' WHERE lead_id = ?").run(now(), `admin:${req._principal.id}`, lead.id);
    db.prepare('DELETE FROM leads WHERE id = ?').run(lead.id);
    return reply.code(204).send();
  });

  /* ---------- агенты ---------- */
  app.get('/api/agents', async () => {
    const p = period({});
    const rep = agentsReport({});
    const stats = Object.fromEntries(rep.rows.map(r => [r.agent.id, r]));
    return db.prepare('SELECT * FROM agents ORDER BY is_active DESC, name').all().map(a => ({
      id: a.id, slug: a.slug, name: a.name, phone: a.phone, telegram: a.telegram, email: a.email, is_active: !!a.is_active, is_demo: !!a.is_demo, has_telegram_chat: !!a.telegram_chat_id,
      links: agentLinks(a), stats_30d: stats[a.id] ? { clicks: stats[a.id].clicks, leads: stats[a.id].leads, showings: stats[a.id].showings, bookings: stats[a.id].bookings, deals: stats[a.id].deals } : null,
      period: p,
    }));
  });
  app.post('/api/agents', async (req, reply) => {
    const b = req.body || {};
    const name = String(b.name || '').trim(); if (!name) throw new ApiError('validation', 422, 'Имя обязательно');
    let slug = slugify(b.slug || name); if (!slug || slug.length < 2) throw new ApiError('validation', 422, 'Slug должен быть латиницей, 2-32 символа');
    if (db.prepare('SELECT 1 FROM agents WHERE slug = ?').get(slug)) { let i = 2; while (db.prepare('SELECT 1 FROM agents WHERE slug = ?').get(`${slug}-${i}`)) i++; slug = `${slug}-${i}`; }
    const ts = now();
    const r = db.prepare('INSERT INTO agents(slug, name, phone, telegram, email, is_active, is_demo, created_at, updated_at) VALUES(?,?,?,?,?,1,0,?,?)').run(slug, name, b.phone || null, b.telegram || null, b.email || null, ts, ts);
    const a = db.prepare('SELECT * FROM agents WHERE id = ?').get(r.lastInsertRowid);
    const ml = issueMagicLink(a.id);
    return reply.code(201).send({ agent: a, links: agentLinks(a), magic_link: ml });
  });
  app.patch('/api/agents/:id', async (req) => {
    const a = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(req.params.id)); if (!a) throw new ApiError('not_found', 404, 'Агент не найден');
    const b = req.body || {}; const out = {};
    if ('name' in b) out.name = String(b.name).trim();
    if ('phone' in b) out.phone = b.phone || null;
    if ('telegram' in b) out.telegram = b.telegram || null;
    if ('email' in b) out.email = b.email || null;
    if ('is_active' in b) out.is_active = b.is_active ? 1 : 0;
    if ('slug' in b) { const s = slugify(b.slug); if (!s) throw new ApiError('validation', 422, 'Плохой slug'); if (db.prepare('SELECT 1 FROM agents WHERE slug = ? AND id != ?').get(s, a.id)) throw new ApiError('conflict', 409, 'Slug занят'); out.slug = s; }
    out.updated_at = now();
    db.prepare(`UPDATE agents SET ${Object.keys(out).map(k => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...out, id: a.id });
    const u = db.prepare('SELECT * FROM agents WHERE id = ?').get(a.id);
    return { agent: u, links: agentLinks(u) };
  });
  app.post('/api/agents/:id/magic-link', async (req, reply) => {
    if (!db.prepare('SELECT 1 FROM agents WHERE id = ?').get(Number(req.params.id))) throw new ApiError('not_found', 404, 'Агент не найден');
    return reply.code(201).send(issueMagicLink(Number(req.params.id)));
  });
  app.get('/api/agents/:id/stats', async (req) => agentStats(Number(req.params.id), req.query));
  app.get('/api/agents/:id/telegram-code', async (req) => ({ code: issueLinkCode(`agent:${Number(req.params.id)}`), bot_enabled: tgEnabled() }));
  app.get('/api/stats/agents', async (req) => agentsReport(req.query));

  /* ---------- каналы / статистика / расходы ---------- */
  const CH_ID = /^[a-z0-9][a-z0-9_-]{1,23}$/;
  app.post('/api/channels', async (req, reply) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 40); if (!name) throw new ApiError('validation', 422, 'Название обязательно');
    let id = String(b.id || slugify(name)).toLowerCase().replace(/-+/g, '_'); if (!CH_ID.test(id)) throw new ApiError('validation', 422, 'Код канала: латиница, цифры, _ (2-24 символа)');
    if (db.prepare('SELECT 1 FROM channels WHERE id = ?').get(id)) throw new ApiError('conflict', 409, `Канал с кодом ${id} уже есть`);
    const sort = (db.prepare('SELECT MAX(sort) m FROM channels WHERE is_paid = 1').get().m || 50) + 1;
    db.prepare('INSERT INTO channels(id, name, sort, is_paid, is_active) VALUES(?,?,?,?,1)').run(id, name, sort, b.is_paid === false ? 0 : 1);
    // правило по умолчанию: utm_source = код канала (+ синонимы), чтобы метка сразу ловилась
    const syn = [id, ...String(b.utm_sources || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean)];
    db.prepare('INSERT INTO channel_rules(channel_id, priority, field, op, pattern, note) VALUES(?,?,?,?,?,?)').run(id, 25, 'utm_source', 'in', [...new Set(syn)].join(','), 'создано при добавлении канала');
    invalidateRules();
    return reply.code(201).send({ channel: db.prepare('SELECT * FROM channels WHERE id = ?').get(id) });
  });
  app.patch('/api/channels/:id', async (req) => {
    const c = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id); if (!c) throw new ApiError('not_found', 404, 'Канал не найден');
    const b = req.body || {}; const out = {};
    if ('name' in b) { out.name = String(b.name).trim().slice(0, 40); if (!out.name) throw new ApiError('validation', 422, 'Название обязательно'); }
    if ('is_paid' in b) out.is_paid = b.is_paid ? 1 : 0;
    if ('is_active' in b) { if (['direct', 'organic', 'agent'].includes(c.id) && !b.is_active) throw new ApiError('validation', 422, 'Системный канал нельзя выключить'); out.is_active = b.is_active ? 1 : 0; }
    if ('sort' in b) out.sort = Number(b.sort) || c.sort;
    if (Object.keys(out).length) db.prepare(`UPDATE channels SET ${Object.keys(out).map(k => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...out, id: c.id });
    return { channel: db.prepare('SELECT * FROM channels WHERE id = ?').get(c.id) };
  });
  app.get('/api/channels', async () => ({
    channels: db.prepare('SELECT * FROM channels ORDER BY sort').all().map(c => ({ ...c, is_paid: !!c.is_paid, is_active: !!c.is_active })),
    rules: db.prepare('SELECT * FROM channel_rules ORDER BY priority, id').all(),
  }));
  app.put('/api/channels/rules', async (req) => {
    const rules = Array.isArray(req.body?.rules) ? req.body.rules : null; if (!rules) throw new ApiError('validation', 422, 'Ожидается { rules: [...] }');
    const ids = new Set(db.prepare('SELECT id FROM channels').all().map(c => c.id));
    for (const r of rules) { if (!ids.has(r.channel ?? r.channel_id)) throw new ApiError('validation', 422, `Канал ${r.channel ?? r.channel_id} не найден`); if (r.op === 'regex') { try { new RegExp(r.pattern); } catch { throw new ApiError('validation', 422, `Плохой regex: ${r.pattern}`); } } }
    replaceRules(rules); invalidateRules();
    return { rules: db.prepare('SELECT * FROM channel_rules ORDER BY priority, id').all() };
  });
  app.post('/api/channels/test', async (req) => testRules(req.body || {}));
  app.post('/api/channels/reclassify', async (req) => {
    const p = period(req.query);
    const rows = db.prepare('SELECT * FROM touches WHERE ts BETWEEN ? AND ?').all(p.startUtc, p.endUtc);
    const upd = db.prepare('UPDATE touches SET channel_id = ? WHERE id = ?');
    let changed = 0;
    const tx = db.transaction(() => { for (const t of rows) { const c = resolveChannel(t); if (c !== t.channel_id) { upd.run(c, t.id); changed++; } } });
    tx();
    let leads = 0;
    if (req.query.include_leads === 'true') {
      const ls = db.prepare('SELECT l.id, f.channel_id fc, l2.channel_id lc FROM leads l LEFT JOIN touches f ON f.id = l.first_touch_id LEFT JOIN touches l2 ON l2.id = l.last_touch_id WHERE l.created_at BETWEEN ? AND ?').all(p.startUtc, p.endUtc);
      const u = db.prepare('UPDATE leads SET channel_first_id = COALESCE(?, channel_first_id), channel_last_id = COALESCE(?, channel_last_id) WHERE id = ?');
      for (const l of ls) { u.run(l.fc, l.lc, l.id); leads++; }
    }
    return { touches_checked: rows.length, touches_changed: changed, leads_updated: leads };
  });
  app.get('/api/stats/channels', async (req) => channelsReport(req.query));
  app.get('/api/stats/overview', async (req) => overview(req.query));
  app.get('/api/stats/series', async (req) => daySeries(period(req.query), { channel: req.query.channel, agentId: req.query.agent_id }));

  app.get('/api/expenses', async (req) => {
    const p = period({ from: req.query.from, to: req.query.to });
    const where = ['period_start <= ? AND period_end >= ?']; const args = [p.to, p.from];
    if (req.query.channel) { where.push('channel_id = ?'); args.push(req.query.channel); }
    if (req.query.all === 'true') { where.length = 0; args.length = 0; }
    return db.prepare(`SELECT e.*, c.name channel_name FROM expenses e JOIN channels c ON c.id = e.channel_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY period_start DESC, id DESC`).all(...args);
  });
  const expenseInput = (b, existing = {}) => {
    const channel_id = b.channel_id ?? existing.channel_id; if (!db.prepare('SELECT 1 FROM channels WHERE id = ?').get(channel_id)) throw new ApiError('validation', 422, 'Канал не найден');
    const period_start = b.period_start ?? existing.period_start, period_end = b.period_end ?? existing.period_end;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period_start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(period_end || '') || period_end < period_start) throw new ApiError('validation', 422, 'Период: даты YYYY-MM-DD, конец не раньше начала');
    const amount = Number(b.amount ?? existing.amount); if (!(amount >= 0)) throw new ApiError('validation', 422, 'Сумма должна быть числом');
    const currency = ['USD', 'GEL', 'EUR'].includes(b.currency ?? existing.currency) ? (b.currency ?? existing.currency) : 'USD';
    const fx = b.fx_to_usd ? Number(b.fx_to_usd) : (b.currency && b.currency !== existing.currency ? fxToUsd(currency) : (existing.fx_to_usd ?? fxToUsd(currency)));
    return { channel_id, campaign: (b.campaign ?? existing.campaign) || null, period_start, period_end, amount, currency, fx_to_usd: fx, amount_usd: Math.round(amount * fx * 100) / 100, note: (b.note ?? existing.note) || null };
  };
  app.post('/api/expenses', async (req, reply) => {
    const e = expenseInput(req.body || {});
    const r = db.prepare('INSERT INTO expenses(channel_id, campaign, period_start, period_end, amount, currency, fx_to_usd, amount_usd, note, created_by, created_at, is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,0)')
      .run(e.channel_id, e.campaign, e.period_start, e.period_end, e.amount, e.currency, e.fx_to_usd, e.amount_usd, e.note, `admin:${req._principal.id}`, now());
    return reply.code(201).send(db.prepare('SELECT * FROM expenses WHERE id = ?').get(r.lastInsertRowid));
  });
  app.patch('/api/expenses/:id', async (req) => {
    const ex = db.prepare('SELECT * FROM expenses WHERE id = ?').get(Number(req.params.id)); if (!ex) throw new ApiError('not_found', 404, 'Расход не найден');
    const e = expenseInput(req.body || {}, ex);
    db.prepare('UPDATE expenses SET channel_id = ?, campaign = ?, period_start = ?, period_end = ?, amount = ?, currency = ?, fx_to_usd = ?, amount_usd = ?, note = ? WHERE id = ?')
      .run(e.channel_id, e.campaign, e.period_start, e.period_end, e.amount, e.currency, e.fx_to_usd, e.amount_usd, e.note, ex.id);
    return db.prepare('SELECT * FROM expenses WHERE id = ?').get(ex.id);
  });
  app.delete('/api/expenses/:id', async (req, reply) => { db.prepare('DELETE FROM expenses WHERE id = ?').run(Number(req.params.id)); return reply.code(204).send(); });

  /* ---------- квартиры, постбэки, настройки ---------- */
  app.get('/api/units', async (req) => {
    const q = req.query; const where = []; const args = [];
    if (q.type) { where.push('u.type = ?'); args.push(q.type); }
    if (q.floor) { where.push('u.floor = ?'); args.push(Number(q.floor)); }
    if (q.q) { where.push('u.number LIKE ?'); args.push(`${q.q}%`); }
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const rows = db.prepare(`SELECT u.*, COALESCE(s.status, u.source_status) status, s.lead_id, s.changed_at, l.name lead_name,
        (SELECT COUNT(*) FROM events e WHERE e.unit_id = u.id AND e.type = 'unit_view' AND e.ts > ?) views_30d,
        (SELECT COUNT(*) FROM leads x WHERE x.unit_id = u.id AND x.status != 'lost') leads_active
      FROM units u LEFT JOIN unit_states s ON s.unit_id = u.id LEFT JOIN leads l ON l.id = s.lead_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.floor, u.slot`).all(since, ...args);
    return q.status ? rows.filter(r => r.status === q.status) : rows;
  });
  app.patch('/api/units/:id/status', async (req) => {
    const u = unitByRef(req.params.id); if (!u) throw new ApiError('not_found', 404, 'Квартира не найдена');
    const st = req.body?.status; if (!['available', 'reserved', 'sold'].includes(st)) throw new ApiError('validation', 422, 'Статус: available | reserved | sold');
    db.prepare(`INSERT INTO unit_states(unit_id, status, lead_id, changed_at, changed_by, note) VALUES(?,?,NULL,?,?,?)
      ON CONFLICT(unit_id) DO UPDATE SET status = excluded.status, lead_id = NULL, changed_at = excluded.changed_at, changed_by = excluded.changed_by, note = excluded.note`)
      .run(u.id, st, now(), `admin:${req._principal.id}`, req.body?.note || 'вручную');
    return { unit_id: u.id, status: st };
  });
  app.get('/api/postbacks', async (req) => {
    const where = []; const args = [];
    if (req.query.status) { where.push('q.status = ?'); args.push(req.query.status); }
    if (req.query.provider) { where.push('q.provider = ?'); args.push(req.query.provider); }
    return db.prepare(`SELECT q.*, l.name lead_name FROM postback_queue q JOIN leads l ON l.id = q.lead_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.id DESC LIMIT 200`).all(...args);
  });
  app.post('/api/postbacks/:id/retry', async (req) => { db.prepare("UPDATE postback_queue SET status = 'queued', last_error = NULL WHERE id = ?").run(Number(req.params.id)); return { ok: true }; });
  app.get('/api/notifications', async () => db.prepare('SELECT n.*, l.name lead_name FROM notifications n LEFT JOIN leads l ON l.id = n.lead_id ORDER BY n.id DESC LIMIT 100').all());
  app.get('/api/imports', async () => db.prepare('SELECT * FROM imports ORDER BY id DESC LIMIT 50').all());

  app.get('/api/settings', async () => {
    const s = allSettings();
    return { site_url: s.site_url, crm_url: config.crmUrl, attribution: s.attribution, revenue_statuses: s.revenue_statuses, cookie_days: Number(s.cookie_days),
      fx: { USD: 1, GEL: Number(s['fx.GEL']), EUR: Number(s['fx.EUR']) }, tg_admin_chat_id: s.tg_admin_chat_id || '', tg_bot_enabled: tgEnabled(),
      providers: { meta_capi: { enabled: s['provider.meta_capi.enabled'] === '1' }, google_offline: { enabled: s['provider.google_offline.enabled'] === '1' }, telegram_ads: { enabled: s['provider.telegram_ads.enabled'] === '1' } },
      demo_rows: db.prepare('SELECT (SELECT COUNT(*) FROM leads WHERE is_demo = 1) leads, (SELECT COUNT(*) FROM agents WHERE is_demo = 1) agents').get(),
      snippet: `<script src="${config.crmUrl}/crm-track.js" async></script>` };
  });
  app.put('/api/settings', async (req) => {
    const b = req.body || {};
    if (b.site_url) setSetting('site_url', String(b.site_url).trim());
    if (b.attribution) setSetting('attribution', b.attribution === 'last' ? 'last' : 'first');
    if (b.revenue_statuses) setSetting('revenue_statuses', String(b.revenue_statuses));
    if (b.cookie_days) setSetting('cookie_days', String(Math.max(1, Math.min(365, Number(b.cookie_days) || 90))));
    if (b.fx) for (const k of ['GEL', 'EUR']) if (b.fx[k]) setSetting(`fx.${k}`, String(Number(b.fx[k])));
    if ('tg_admin_chat_id' in b) setSetting('tg_admin_chat_id', String(b.tg_admin_chat_id || ''));
    if (b.providers) for (const k of ['meta_capi', 'google_offline', 'telegram_ads']) if (b.providers[k]) setSetting(`provider.${k}.enabled`, b.providers[k].enabled ? '1' : '0');
    return { ok: true };
  });
  app.get('/api/settings/telegram-code', async () => ({ code: issueLinkCode('admin'), bot_enabled: tgEnabled() }));
  app.post('/api/demo/clear', async () => ({ deleted: clearDemo() }));
}
