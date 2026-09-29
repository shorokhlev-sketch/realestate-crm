// Воронка и метрики. Клики - из touches, лиды - по created_at, показы/брони/сделки - по lead_status_history.
import { db, getSetting } from '../db.js';
import { config } from '../config.js';

const DAY = 86400000;
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
export const todayLocal = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);

export function period(q = {}) {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : todayLocal();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : new Date(new Date(to + 'T00:00:00Z') - 29 * DAY).toISOString().slice(0, 10);
  const startUtc = iso(new Date(`${from}T00:00:00${config.tzOffset}`));
  const endUtc = iso(new Date(`${to}T23:59:59.999${config.tzOffset}`));
  const days = Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / DAY) + 1;
  const prevTo = new Date(new Date(from + 'T00:00:00Z') - DAY).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(prevTo + 'T00:00:00Z') - (days - 1) * DAY).toISOString().slice(0, 10);
  return { from, to, startUtc, endUtc, days, prev: { from: prevFrom, to: prevTo } };
}

const conv = (a, b) => (a > 0 ? Math.round((b / a) * 1000) / 1000 : null);
export function convs(r) {
  return { click_lead: conv(r.clicks, r.leads), lead_showing: conv(r.leads, r.showings), showing_booking: conv(r.showings, r.bookings), booking_deal: conv(r.bookings, r.deals) };
}
const revenueStatuses = () => (getSetting('revenue_statuses') || 'contract,paid').split(',').map(s => s.trim()).filter(Boolean);

// Возвращает Map(key -> {clicks, leads, showings, bookings, deals, revenue_usd}) по измерению dim: 'channel' | 'campaign' | 'agent'
export function funnel(p, { dim, attribution = 'first', agentId = null } = {}) {
  const chCol = attribution === 'last' ? 'channel_last_id' : 'channel_first_id';
  const campCol = attribution === 'last' ? 'campaign_last' : 'campaign_first';
  const rows = new Map();
  const row = (k) => { if (!rows.has(k)) rows.set(k, { key: k, clicks: 0, leads: 0, showings: 0, bookings: 0, deals: 0, revenue_usd: 0 }); return rows.get(k); };
  const keyOfLead = (l) => dim === 'agent' ? (l.agent_id ?? null) : dim === 'campaign' ? `${l[chCol]}|${l[campCol] || ''}` : l[chCol];
  const keyOfTouch = (t) => dim === 'agent' ? (t.agent_id ?? null) : dim === 'campaign' ? `${t.channel_id}|${t.utm_campaign || ''}` : t.channel_id;
  const agentFilter = agentId ? ' AND agent_id = ' + Number(agentId) : '';

  for (const t of db.prepare(`SELECT channel_id, utm_campaign, agent_id FROM touches WHERE ts BETWEEN ? AND ?${agentFilter}`).all(p.startUtc, p.endUtc)) row(keyOfTouch(t)).clicks++;
  for (const l of db.prepare(`SELECT id, ${chCol}, ${campCol}, agent_id FROM leads WHERE created_at BETWEEN ? AND ?${agentFilter}`).all(p.startUtc, p.endUtc)) row(keyOfLead(l)).leads++;
  const hist = db.prepare(`SELECT h.to_status, l.${chCol} AS ch, l.${campCol} AS camp, l.agent_id, l.id AS lead_id, l.deal_amount_usd, l.status
    FROM lead_status_history h JOIN leads l ON l.id = h.lead_id
    WHERE h.ts BETWEEN ? AND ?${agentFilter.replace('agent_id', 'l.agent_id')} AND h.to_status IN ('showing','booking','contract','paid')
    GROUP BY h.lead_id, h.to_status`).all(p.startUtc, p.endUtc);
  const dealCounted = new Set();
  const rs = revenueStatuses();
  for (const h of hist) {
    const k = dim === 'agent' ? (h.agent_id ?? null) : dim === 'campaign' ? `${h.ch}|${h.camp || ''}` : h.ch;
    const r = row(k);
    if (h.to_status === 'showing') r.showings++;
    else if (h.to_status === 'booking') r.bookings++;
    else if (!dealCounted.has(h.lead_id)) { dealCounted.add(h.lead_id); r.deals++; if (rs.includes(h.status) && h.deal_amount_usd) r.revenue_usd += h.deal_amount_usd; }
  }
  return rows;
}

// Расходы за период с распределением по дням; Map(channel|campaign -> usd)
export function spend(p, byCampaign = false) {
  const out = new Map();
  const rows = db.prepare('SELECT * FROM expenses WHERE period_start <= ? AND period_end >= ?').all(p.to, p.from);
  for (const e of rows) {
    const s = new Date(e.period_start + 'T00:00:00Z'), en = new Date(e.period_end + 'T00:00:00Z');
    const total = Math.round((en - s) / DAY) + 1;
    const os = Math.max(s, new Date(p.from + 'T00:00:00Z')), oe = Math.min(en, new Date(p.to + 'T00:00:00Z'));
    const overlap = Math.round((oe - os) / DAY) + 1;
    if (overlap <= 0 || total <= 0) continue;
    const share = e.amount_usd * overlap / total;
    const k = byCampaign ? `${e.channel_id}|${e.campaign || ''}` : e.channel_id;
    out.set(k, (out.get(k) || 0) + share);
  }
  return out;
}

const money = (v) => v === null || v === undefined ? null : Math.round(v * 10) / 10;
function costMetrics(r, spendUsd, isPaid) {
  if (!isPaid || spendUsd === null || spendUsd === undefined) return { spend_usd: isPaid ? 0 : null, cpl: null, cost_per_showing: null, cac: null, roas: null };
  return {
    spend_usd: Math.round(spendUsd), cpl: r.leads ? money(spendUsd / r.leads) : null, cost_per_showing: r.showings ? money(spendUsd / r.showings) : null,
    cac: r.deals ? money(spendUsd / r.deals) : null, roas: spendUsd > 0 ? money(r.revenue_usd / spendUsd) : null,
  };
}

export function channelsReport(q) {
  const p = period(q);
  const attribution = q.attribution === 'last' ? 'last' : (getSetting('attribution') === 'last' ? 'last' : 'first');
  const byCampaign = q.group === 'campaign';
  const channels = db.prepare('SELECT * FROM channels ORDER BY sort').all();
  const chMap = Object.fromEntries(channels.map(c => [c.id, c]));
  const f = funnel(p, { dim: byCampaign ? 'campaign' : 'channel', attribution });
  const sp = spend(p, byCampaign);
  const keys = new Set([...f.keys(), ...sp.keys()]);
  const rows = [];
  for (const k of keys) {
    if (k === null) continue;
    const [ch, camp] = byCampaign ? String(k).split('|') : [k, null];
    const r = f.get(k) || { clicks: 0, leads: 0, showings: 0, bookings: 0, deals: 0, revenue_usd: 0 };
    const c = chMap[ch]; if (!c) continue;
    rows.push({ channel: ch, channel_name: c.name, is_paid: !!c.is_paid, campaign: byCampaign ? (camp || null) : null, ...r, conv: convs(r), ...costMetrics(r, sp.get(k) ?? (c.is_paid ? 0 : null), c.is_paid) });
  }
  rows.sort((a, b) => (chMap[a.channel].sort - chMap[b.channel].sort) || (b.leads - a.leads));
  const totals = rows.reduce((t, r) => { for (const k of ['clicks', 'leads', 'showings', 'bookings', 'deals', 'revenue_usd']) t[k] += r[k]; t.spend_usd += r.spend_usd || 0; return t; }, { clicks: 0, leads: 0, showings: 0, bookings: 0, deals: 0, revenue_usd: 0, spend_usd: 0 });
  totals.conv = convs(totals);
  Object.assign(totals, costMetrics(totals, totals.spend_usd, true), { spend_usd: Math.round(totals.spend_usd) });
  const unattributed = f.get(null) || null;
  return { period: { from: p.from, to: p.to, days: p.days }, attribution, group: byCampaign ? 'campaign' : 'channel', totals, rows, unattributed: unattributed ? { leads: unattributed.leads } : null };
}

function median(arr) { const a = arr.slice().sort((x, y) => x - y); if (!a.length) return 0; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : Math.round(((a[m - 1] + a[m]) / 2) * 10) / 10; }

export function agentsReport(q) {
  const p = period(q);
  const agents = db.prepare('SELECT id, name, slug, is_active FROM agents ORDER BY name').all();
  const f = funnel(p, { dim: 'agent' });
  const rows = agents.map(a => { const r = f.get(a.id) || { clicks: 0, leads: 0, showings: 0, bookings: 0, deals: 0, revenue_usd: 0 }; return { agent: a, ...r, conv: convs(r) }; });
  rows.sort((a, b) => (b.deals - a.deals) || (b.bookings - a.bookings) || (b.showings - a.showings) || (b.leads - a.leads) || (b.clicks - a.clicks));
  const active = rows.filter(r => r.agent.is_active);
  const team_median = Object.fromEntries(['clicks', 'leads', 'showings', 'bookings', 'deals'].map(k => [k, median(active.map(r => r[k]))]));
  const medConv = { click_lead: conv(team_median.clicks, team_median.leads), lead_showing: conv(team_median.leads, team_median.showings), showing_booking: conv(team_median.showings, team_median.bookings), booking_deal: conv(team_median.bookings, team_median.deals) };
  const none = f.get(null);
  return { period: { from: p.from, to: p.to, days: p.days }, team_median, team_median_conv: medConv, rows, unassigned: none ? { leads: none.leads, clicks: none.clicks } : null };
}

export function agentStats(agentId, q) {
  const rep = agentsReport(q);
  const p = period(q);
  const idx = rep.rows.findIndex(r => r.agent.id === agentId);
  const me = idx >= 0 ? rep.rows[idx] : null;
  const series = daySeries(p, { agentId });
  return { period: rep.period, me: me ? { clicks: me.clicks, leads: me.leads, showings: me.showings, bookings: me.bookings, deals: me.deals, revenue_usd: me.revenue_usd, conv: me.conv } : null,
    team_median: rep.team_median, team_median_conv: rep.team_median_conv, rank: { position: idx + 1, of: rep.rows.filter(r => r.agent.is_active).length }, series };
}

export function daySeries(p, { agentId = null, channel = null } = {}) {
  const days = {};
  for (let i = 0; i < p.days; i++) days[new Date(new Date(p.from + 'T00:00:00Z').getTime() + i * DAY).toISOString().slice(0, 10)] = { clicks: 0, leads: 0 };
  const local = (ts) => new Date(new Date(ts).getTime() + 4 * 3600000).toISOString().slice(0, 10);
  const af = agentId ? ` AND agent_id = ${Number(agentId)}` : '';
  const cf = channel ? ` AND channel_id = '${String(channel).replace(/'/g, '')}'` : '';
  for (const t of db.prepare(`SELECT ts FROM touches WHERE ts BETWEEN ? AND ?${af}${cf}`).all(p.startUtc, p.endUtc)) { const d = days[local(t.ts)]; if (d) d.clicks++; }
  for (const l of db.prepare(`SELECT created_at FROM leads WHERE created_at BETWEEN ? AND ?${af}${cf.replace('channel_id', 'channel_first_id')}`).all(p.startUtc, p.endUtc)) { const d = days[local(l.created_at)]; if (d) d.leads++; }
  return Object.entries(days).map(([date, v]) => ({ date, ...v }));
}

export function overview(q) {
  const p = period(q);
  const cur = channelsReport({ from: p.from, to: p.to });
  const prev = channelsReport(p.prev);
  const keys = ['clicks', 'leads', 'showings', 'bookings', 'deals', 'spend_usd', 'revenue_usd'];
  const delta = Object.fromEntries(keys.map(k => [k, cur.totals[k] - prev.totals[k]]));
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) c FROM leads GROUP BY status').all().map(r => [r.status, r.c]));
  return { period: cur.period, current: cur.totals, previous: prev.totals, delta, series: daySeries(p), counts_by_status: counts,
    top_channels: cur.rows.slice().sort((a, b) => b.leads - a.leads).slice(0, 5), agents: agentsReport(q).rows.slice(0, 5) };
}
