import crypto from 'node:crypto';
import { db, now, getSetting } from '../db.js';
import { config } from '../config.js';
import { recordTouch, recordEvent } from '../lib/attribution.js';
import { createLead, ApiError, SITE_SOURCES } from '../lib/leads.js';
import { consumeMagicLink, createSession } from '../lib/auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const siteUrl = () => getSetting('site_url') || config.siteUrl;

export default async function publicRoutes(app) {
  // короткая ссылка агента -> сайт с ?a=<slug> (+ проброс остальных параметров)
  app.get('/a/:slug', async (req, reply) => {
    const slug = String(req.params.slug || '').toLowerCase();
    const agent = db.prepare('SELECT id FROM agents WHERE slug = ? AND is_active = 1').get(slug);
    const url = new URL(siteUrl());
    for (const [k, v] of Object.entries(req.query || {})) if (k !== 'a') url.searchParams.set(k, String(v));
    if (agent) {
      url.searchParams.set('a', slug);
      const ipHash = crypto.createHash('sha256').update((req.ip || '') + config.sessionSecret).digest('hex').slice(0, 16);
      db.prepare('INSERT INTO link_hits(agent_id, ts, referrer, user_agent, ip_hash) VALUES(?,?,?,?,?)').run(agent.id, now(), req.headers.referer || null, (req.headers['user-agent'] || '').slice(0, 300), ipHash);
    }
    return reply.redirect(url.toString(), 302);
  });

  // magic-link агента -> сессия -> кабинет
  app.get('/m/:token', async (req, reply) => {
    const agent = consumeMagicLink(req.params.token);
    if (!agent) return reply.redirect(`${config.basePath}/agent/expired.html`, 302);
    createSession(reply, 'agent', agent.id, req.headers['user-agent']);
    return reply.redirect(`${config.basePath}/agent/`, 302);
  });

  // трекинг со сниппета
  app.post('/api/track', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = req.body || {};
    let vid = UUID.test(b.vid || '') ? b.vid.toLowerCase() : crypto.randomUUID();
    const type = b.type || 'touch';
    const ua = (req.headers['user-agent'] || '').slice(0, 300);
    if (type === 'touch') {
      const r = recordTouch({ vid, url: String(b.url || '').slice(0, 2000), referrer: String(b.referrer || '').slice(0, 1000), ua });
      const agent = r.visitor.agent_id ? db.prepare('SELECT slug FROM agents WHERE id = ?').get(r.visitor.agent_id) : null;
      reply.setCookie('crm_vid', vid, { path: '/', sameSite: 'lax', secure: config.isProd, maxAge: config.cookieDays * 86400 });
      return { vid, touch_id: r.touch?.id || null, new_touch: r.created, agent: agent?.slug || null, channel: r.touch?.channel_id || null };
    }
    const ok = recordEvent({ vid, type, unitId: b.unit_id, path: b.path, meta: b.meta });
    return { vid, ok: !!ok };
  });

  // лид с сайта
  app.post('/api/leads', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = req.body || {};
    if (b.hp) return reply.code(201).send({ id: 0, status: 'new', duplicate: false }); // honeypot: делаем вид, что приняли
    const r = await createLead({
      name: b.name, phone: b.phone, telegram: b.telegram, email: b.email, unit: b.unit_id || b.unit || b.unit_number,
      interest: b.interest, comment: b.comment, vid: UUID.test(b.vid || '') ? b.vid.toLowerCase() : null,
      source: SITE_SOURCES.includes(b.source) ? b.source : 'site_form', page: String(b.page || '').slice(0, 500), actor: 'site',
    });
    return reply.code(r.duplicate ? 200 : 201).send({ id: r.lead.id, status: r.lead.status, duplicate: r.duplicate });
  });

  // статусы квартир для сайта (только переопределённые)
  app.get('/api/units/status.json', async (req, reply) => {
    const rows = db.prepare('SELECT unit_id, status, changed_at FROM unit_states').all();
    const statuses = Object.fromEntries(rows.map(r => [r.unit_id, r.status]));
    const updated = rows.reduce((m, r) => (r.changed_at > m ? r.changed_at : m), '');
    reply.header('cache-control', 'public, max-age=60');
    return { updated_at: updated || null, statuses };
  });

  app.get('/api/health', async () => ({ ok: true, version: config.version, time: now() }));
}

export { ApiError };
