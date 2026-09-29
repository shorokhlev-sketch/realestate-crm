import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, now } from '../db.js';
import { config } from '../config.js';

const COOKIE = 'crm_sid';
const addDays = (d) => new Date(Date.now() + d * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function cookieOptions(days) {
  return { path: config.basePath || '/', httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: days * 86400 };
}

export function createSession(reply, type, id, ua) {
  const sid = crypto.randomBytes(32).toString('base64url');
  const days = type === 'admin' ? config.sessionDaysAdmin : config.sessionDaysAgent;
  db.prepare('INSERT INTO sessions(id, principal_type, principal_id, expires_at, created_at, user_agent) VALUES(?,?,?,?,?,?)')
    .run(sid, type, id, addDays(days), now(), ua || null);
  reply.setCookie(COOKIE, sid, cookieOptions(days));
  return sid;
}

export function destroySession(req, reply) {
  const sid = req.cookies?.[COOKIE];
  if (sid) db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
  reply.clearCookie(COOKIE, { path: config.basePath || '/' });
}

export function principal(req) {
  if (req._principal !== undefined) return req._principal;
  const sid = req.cookies?.[COOKIE];
  let p = null;
  if (sid) {
    const s = db.prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?').get(sid, now());
    if (s) {
      if (s.principal_type === 'admin') {
        const a = db.prepare('SELECT id, login, name, role, is_active FROM admins WHERE id = ?').get(s.principal_id);
        if (a && a.is_active) p = { role: 'admin', id: a.id, name: a.name || a.login, login: a.login, admin_role: a.role || 'admin', actor: `admin:${a.id}` };
      } else {
        const a = db.prepare('SELECT * FROM agents WHERE id = ? AND is_active = 1').get(s.principal_id);
        if (a) p = { role: 'agent', id: a.id, name: a.name, agent: a, actor: `agent:${a.id}` };
      }
    }
  }
  req._principal = p;
  return p;
}

const VIEWER_WRITE_OK = ['/api/auth/password', '/api/auth/logout', '/api/auth/logout-all'];
export async function requireAdmin(req, reply) {
  const p = principal(req);
  if (!p || p.role !== 'admin') return reply.code(401).send({ error: 'unauthorized', message: 'Нужен вход администратора' });
  if (p.admin_role === 'viewer' && req.method !== 'GET' && !VIEWER_WRITE_OK.some(x => req.url.includes(x))) return reply.code(403).send({ error: 'read_only', message: 'У вас доступ только для просмотра' });
}
export async function requireOwner(req, reply) {
  const p = principal(req);
  if (!p || p.role !== 'admin' || p.admin_role !== 'admin') return reply.code(403).send({ error: 'admin_only', message: 'Только для администратора' });
}
export async function requireAgent(req, reply) {
  const p = principal(req);
  if (!p || p.role !== 'agent') return reply.code(401).send({ error: 'unauthorized', message: 'Ссылка для входа устарела' });
}
export async function requireAny(req, reply) {
  const p = principal(req);
  if (!p) return reply.code(401).send({ error: 'unauthorized', message: 'Нужен вход' });
}

export function checkAdminPassword(login, password) {
  const a = db.prepare('SELECT * FROM admins WHERE login = ? AND is_active = 1').get(String(login || '').trim().toLowerCase());
  if (!a) return null;
  return bcrypt.compareSync(String(password || ''), a.password_hash) ? a : null;
}

export function issueMagicLink(agentId) {
  const raw = crypto.randomBytes(24).toString('base64url');
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare('UPDATE magic_links SET expires_at = ? WHERE agent_id = ? AND used_at IS NULL').run(ts, agentId); // отзываем старые
    db.prepare('INSERT INTO magic_links(agent_id, token_hash, expires_at, created_at) VALUES(?,?,?,?)').run(agentId, sha256(raw), addDays(config.magicLinkDays), ts);
  });
  tx();
  return { token: raw, url: `${config.crmUrl}/m/${raw}`, expires_at: addDays(config.magicLinkDays) };
}

export function consumeMagicLink(raw) {
  const ml = db.prepare('SELECT * FROM magic_links WHERE token_hash = ? AND expires_at > ?').get(sha256(String(raw || '')), now());
  if (!ml) return null;
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND is_active = 1').get(ml.agent_id);
  if (!agent) return null;
  db.prepare('UPDATE magic_links SET used_at = COALESCE(used_at, ?) WHERE id = ?').run(now(), ml.id);
  return agent;
}

export function setPassword(adminId, password) {
  if (String(password || '').length < 8) throw Object.assign(new Error('Пароль не короче 8 символов'), { status: 422, code: 'validation' });
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 10), adminId);
}
export function hashPassword(password) { return bcrypt.hashSync(String(password), 10); }
export function verifyPassword(adminId, password) { const a = db.prepare('SELECT password_hash FROM admins WHERE id = ?').get(adminId); return !!a && bcrypt.compareSync(String(password || ''), a.password_hash); }
export function killSessions(type, id, exceptSid = null) { db.prepare('DELETE FROM sessions WHERE principal_type = ? AND principal_id = ? AND id != ?').run(type, id, exceptSid || ''); }
