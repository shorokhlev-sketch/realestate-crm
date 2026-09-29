import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');   // VPS без IPv6-маршрута: иначе fetch к api.telegram.org падает с 'fetch failed'
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fstatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import path from 'node:path';
import { config } from './config.js';
import { bootstrap, db } from './db.js';
import { principal } from './lib/auth.js';
import { ApiError } from './lib/leads.js';
import { processQueue } from './lib/postbacks.js';
import { pollUpdatesOnce, tgEnabled } from './lib/telegram.js';
import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import agentRoutes from './routes/agent.js';
import systemRoutes from './routes/system.js';

bootstrap();

const app = Fastify({ logger: { level: config.isProd ? 'info' : 'debug' }, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
await app.register(cookie, { secret: config.sessionSecret });
await app.register(cors, {
  origin: (origin, cb) => cb(null, !origin || origin === config.siteOrigin || origin === new URL(config.crmUrl).origin || !config.isProd),
  credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
});
await app.register(rateLimit, { global: false });
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

app.setErrorHandler((err, req, reply) => {
  if (err instanceof ApiError) return reply.code(err.status).send({ error: err.code, message: err.message, ...(err.extra || {}) });
  if (err.validation) return reply.code(400).send({ error: 'validation', message: err.message });
  if (err.statusCode === 429) return reply.code(429).send({ error: 'rate_limited', message: 'Слишком много запросов, подождите минуту' });
  req.log.error(err);
  return reply.code(err.statusCode || 500).send({ error: 'internal', message: config.isProd ? 'Внутренняя ошибка' : err.message });
});
app.setNotFoundHandler((req, reply) => {
  if (req.url.includes('/api/')) return reply.code(404).send({ error: 'not_found', message: 'Нет такого пути' });
  return reply.code(404).type('text/html').send('<!doctype html><meta charset="utf-8"><title>404</title><p style="font-family:sans-serif;padding:40px">Страница не найдена.');
});

// всё живёт под basePath (по умолчанию /crm), чтобы делить один домен с сайтом
await app.register(async (scope) => {
  await scope.register(publicRoutes);
  await scope.register(authRoutes);
  await scope.register(adminRoutes);
  await scope.register(systemRoutes);
  await scope.register(agentRoutes);

  // защита статических кабинетов: /admin/* только админу (кроме login), /agent/* только агенту (кроме expired)
  scope.addHook('onRequest', async (req, reply) => {
    const u = req.url.slice(config.basePath.length).split('?')[0];
    if (u === '/admin' || u === '/agent') return reply.redirect(`${config.basePath}${u}/`, 302);
    if (u.startsWith('/admin/') && u !== '/admin/login.html') { const p = principal(req); if (!p || p.role !== 'admin') return reply.redirect(`${config.basePath}/admin/login.html`, 302); }
    if (u.startsWith('/agent/') && u !== '/agent/expired.html') { const p = principal(req); if (!p || p.role !== 'agent') return reply.redirect(`${config.basePath}/agent/expired.html`, 302); }
    if (u === '/' || u === '') { const p = principal(req); return reply.redirect(`${config.basePath}/${p?.role === 'agent' ? 'agent/' : 'admin/'}`, 302); }
  });
  await scope.register(fstatic, { root: path.join(config.root, 'public'), prefix: '/', decorateReply: false, cacheControl: true, maxAge: config.isProd ? '1m' : 0, index: ['index.html'] });
}, { prefix: config.basePath || undefined });

// фоновые задачи
setInterval(() => { try { processQueue(); } catch (e) { app.log.error(e); } }, 30_000);
setInterval(() => { if (tgEnabled()) pollUpdatesOnce(); }, 15_000);   // токен может появиться из настроек без перезапуска
setInterval(() => { try { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()); } catch { /* пусто */ } }, 3_600_000);

const shutdown = async () => { await app.close(); db.close(); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
app.log.info(`realestate-crm on http://${config.host}:${config.port}${config.basePath} -> site ${config.siteUrl}`);
