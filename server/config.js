import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const isProd = env('NODE_ENV', 'development') === 'production';

// Production must never start with the dev fallbacks (admin/admin, a known session secret).
if (isProd) {
  const PLACEHOLDERS = new Set(['change-me', 'change-me-32-bytes-random', 'dev-secret-change-me', 'admin']);
  const problems = [];
  for (const k of ['ADMIN_PASSWORD', 'SESSION_SECRET']) {
    const v = process.env[k];
    if (!v) problems.push(`${k} is not set`);
    else if (PLACEHOLDERS.has(v)) problems.push(`${k} still has a placeholder value`);
  }
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');
  if (problems.length) {
    console.error(`[config] refusing to start with NODE_ENV=production: ${problems.join('; ')}. Set them in .env or the environment (e.g. SESSION_SECRET=$(openssl rand -hex 32)).`);
    process.exit(1);
  }
}

export const config = {
  root,
  port: Number(env('PORT', 3080)),
  host: env('HOST', '127.0.0.1'),
  basePath: env('BASE_PATH', '/crm').replace(/\/+$/, ''),        // '' = корень домена
  dbPath: path.resolve(root, env('DB_PATH', './data/crm.db')),
  backupDir: path.resolve(root, env('BACKUP_DIR', path.join(path.dirname(path.resolve(root, env('DB_PATH', './data/crm.db'))), 'backups'))),
  version: '0.2.0',
  sessionSecret: isProd ? process.env.SESSION_SECRET : env('SESSION_SECRET', 'dev-secret-change-me'), // dev fallback only outside production
  adminLogin: env('ADMIN_LOGIN', 'admin'),
  adminPassword: isProd ? process.env.ADMIN_PASSWORD : env('ADMIN_PASSWORD', 'admin'),     // dev fallback only outside production
  siteUrl: env('SITE_URL', 'https://example.com/'),
  siteOrigin: env('SITE_ORIGIN', 'https://example.com'),
  crmUrl: env('CRM_URL', 'http://127.0.0.1:3080/crm'),
  tgBotToken: env('TG_BOT_TOKEN', ''),
  tgAdminChatId: env('TG_ADMIN_CHAT_ID', ''),
  cookieDays: Number(env('COOKIE_DAYS', 90)),
  sessionDaysAdmin: 14,
  sessionDaysAgent: 30,
  magicLinkDays: 7,
  touchGapMinutes: 30,
  dedupeDays: 30,
  tz: 'Asia/Tbilisi',
  tzOffset: '+04:00',
  isProd,
};
