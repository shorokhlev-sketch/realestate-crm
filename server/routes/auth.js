import { config } from '../config.js';
import { checkAdminPassword, createSession, destroySession, principal, requireAny, requireAdmin, setPassword, verifyPassword, killSessions } from '../lib/auth.js';
import { db, lostReasons, audit } from '../db.js';

export default async function authRoutes(app) {
  app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { login, password } = req.body || {};
    const a = checkAdminPassword(login, password);
    if (!a) return reply.code(401).send({ error: 'bad_credentials', message: 'Неверный логин или пароль' });
    createSession(reply, 'admin', a.id, req.headers['user-agent']);
    return { admin: { id: a.id, name: a.name || a.login } };
  });
  app.get('/api/channels/names', { preHandler: requireAny }, async () => Object.fromEntries(db.prepare('SELECT id, name FROM channels ORDER BY sort').all().map(c => [c.id, c.name])));
  app.get('/api/meta', { preHandler: requireAny }, async () => ({ channels: Object.fromEntries(db.prepare('SELECT id, name FROM channels ORDER BY sort').all().map(c => [c.id, c.name])), lost_reasons: lostReasons() }));
  app.post('/api/auth/password', { preHandler: requireAdmin }, async (req, reply) => {
    const p = principal(req); const { current, password } = req.body || {};
    if (!verifyPassword(p.id, current)) return reply.code(422).send({ error: 'bad_password', message: 'Текущий пароль неверный' });
    try { setPassword(p.id, password); } catch (e) { return reply.code(e.status || 422).send({ error: e.code || 'validation', message: e.message }); }
    killSessions('admin', p.id, req.cookies?.crm_sid); audit(p.actor, 'auth.password', `admin:${p.id}`);
    return { ok: true };
  });
  app.post('/api/auth/logout-all', { preHandler: requireAdmin }, async (req) => { const p = principal(req); killSessions('admin', p.id, req.cookies?.crm_sid); return { ok: true }; });
  app.post('/api/auth/logout', async (req, reply) => { destroySession(req, reply); return reply.code(204).send(); });
  app.get('/api/auth/me', async (req, reply) => {
    const p = principal(req);
    if (!p) return reply.code(401).send({ error: 'unauthorized', message: 'Нет сессии' });
    if (p.role === 'admin') return { role: 'admin', id: p.id, name: p.name, login: p.login, admin_role: p.admin_role, base: config.basePath };
    const a = p.agent;
    return { role: 'agent', id: a.id, name: a.name, base: config.basePath, agent: { id: a.id, name: a.name, slug: a.slug, phone: a.phone, telegram: a.telegram }, telegram_linked: !!a.telegram_chat_id };
  });
}
