import { db, now, allSettings } from '../db.js';
import { config } from '../config.js';
import { requireAgent } from '../lib/auth.js';
import { changeStatus, updateLead, addNote, getLead, createLead, ApiError } from '../lib/leads.js';
import { agentStats } from '../lib/stats.js';
import { leadListQuery, leadCard } from './shared.js';
import { issueLinkCode, tgEnabled } from '../lib/telegram.js';

export default async function agentRoutes(app) {
  app.addHook('preHandler', requireAgent);
  const me = (req) => req._principal.agent;
  const links = (a) => { const s = allSettings().site_url; return { site: `${s}${s.includes('?') ? '&' : '?'}a=${a.slug}`, short: `${config.crmUrl}/a/${a.slug}` }; };

  app.get('/api/agent/me', async (req) => { const a = me(req); return { agent: { id: a.id, name: a.name, slug: a.slug, phone: a.phone, telegram: a.telegram }, links: links(a), telegram_linked: !!a.telegram_chat_id }; });
  app.get('/api/agent/stats', async (req) => agentStats(me(req).id, req.query));
  app.get('/api/agent/leads', async (req) => leadListQuery(req.query, { agentId: me(req).id }));
  app.post('/api/agent/leads', async (req, reply) => {
    const b = req.body || {};
    const r = await createLead({ ...b, unit: b.unit_id || b.unit || b.unit_number, source: 'manual', agent_id: me(req).id, agent_source: 'manual', channel_id: b.channel_id || 'agent', actor: `agent:${me(req).id}` });
    return reply.code(201).send({ lead: r.lead, duplicate: r.duplicate });
  });
  app.get('/api/agent/leads/:id', async (req) => leadCard(Number(req.params.id), { agentId: me(req).id }));
  const own = (req) => { const l = getLead(Number(req.params.id)); if (!l || l.agent_id !== me(req).id) throw new ApiError('not_found', 404, 'Лид не найден'); return l; };
  app.post('/api/agent/leads/:id/status', async (req) => { own(req); return changeStatus(Number(req.params.id), { ...(req.body || {}), actor: `agent:${me(req).id}`, role: 'agent' }); });
  app.post('/api/agent/leads/:id/notes', async (req, reply) => {
    own(req); const text = String(req.body?.text || '').trim(); if (!text) throw new ApiError('validation', 422, 'Пустая заметка');
    db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').run(now(), Number(req.params.id));
    return reply.code(201).send({ note: addNote(Number(req.params.id), `agent:${me(req).id}`, text.slice(0, 4000)) });
  });
  app.patch('/api/agent/leads/:id', async (req) => {
    own(req); const b = req.body || {}; const patch = {};
    for (const k of ['unit_id', 'comment', 'telegram', 'email', 'interest']) if (k in b) patch[k] = b[k];
    return { lead: updateLead(Number(req.params.id), patch, `agent:${me(req).id}`) };
  });
  app.get('/api/agent/telegram-code', async (req) => ({ code: issueLinkCode(`agent:${me(req).id}`), bot_enabled: tgEnabled() }));
}
