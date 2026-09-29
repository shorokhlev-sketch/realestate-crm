// Админ-роуты «самостоятельности клиента»: пользователи, бот, прайс, бэкапы, диагностика, импорт расходов, полный экспорт.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parse as csvParse } from 'csv-parse/sync';
import Database from 'better-sqlite3';
import { db, now, allSettings, setSetting, audit, backupDir, makeBackup, listBackups, fxToUsd, lostReasons } from '../db.js';
import { config } from '../config.js';
import { requireAdmin, requireOwner, principal, hashPassword, setPassword, killSessions } from '../lib/auth.js';
import { ApiError, unitByRef } from '../lib/leads.js';
import { botInfo, sendMessage, tgEnabled } from '../lib/telegram.js';
import { verifySmtp, sendMail, smtpConfigured } from '../lib/email.js';

const parseCsv = (buf) => {
  const text = buf.toString('utf8').replace(/^﻿/, '');
  const head = text.split('\n')[0];
  const delimiter = (head.match(/;/g) || []).length > (head.match(/,/g) || []).length ? ';' : ',';
  return csvParse(text, { columns: h => h.map(c => c.trim().toLowerCase().replace(/\s+/g, '_')), delimiter, skip_empty_lines: true, trim: true, relax_column_count: true });
};
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

export default async function systemRoutes(app) {
  app.addHook('preHandler', requireAdmin);

  /* ---------- пользователи (только полный админ) ---------- */
  app.get('/api/admins', async () => db.prepare('SELECT id, login, name, email, role, is_active, created_at FROM admins ORDER BY id').all().map(a => ({ ...a, is_active: !!a.is_active })));
  app.post('/api/admins', { preHandler: requireOwner }, async (req, reply) => {
    const b = req.body || {};
    const login = String(b.login || '').trim().toLowerCase(); if (!/^[a-z0-9._@-]{3,40}$/.test(login)) throw new ApiError('validation', 422, 'Логин: латиница, цифры, точка, 3-40 символов');
    if (db.prepare('SELECT 1 FROM admins WHERE login = ?').get(login)) throw new ApiError('conflict', 409, 'Такой логин уже есть');
    if (String(b.password || '').length < 8) throw new ApiError('validation', 422, 'Пароль не короче 8 символов');
    const role = b.role === 'viewer' ? 'viewer' : 'admin';
    const r = db.prepare('INSERT INTO admins(login, password_hash, name, email, role, is_active, created_at) VALUES(?,?,?,?,?,1,?)').run(login, hashPassword(b.password), String(b.name || '').trim() || login, b.email || null, role, now());
    audit(principal(req).actor, 'admin.create', `admin:${r.lastInsertRowid}`, { login, role });
    return reply.code(201).send({ admin: db.prepare('SELECT id, login, name, email, role, is_active FROM admins WHERE id = ?').get(r.lastInsertRowid) });
  });
  app.patch('/api/admins/:id', { preHandler: requireOwner }, async (req) => {
    const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(Number(req.params.id)); if (!a) throw new ApiError('not_found', 404, 'Пользователь не найден');
    const me = principal(req); const b = req.body || {}; const out = {};
    if ('name' in b) out.name = String(b.name).trim() || a.login;
    if ('email' in b) out.email = b.email || null;
    if ('role' in b) { if (a.id === me.id && b.role !== 'admin') throw new ApiError('validation', 422, 'Нельзя понизить самого себя'); out.role = b.role === 'viewer' ? 'viewer' : 'admin'; }
    if ('is_active' in b) {
      if (a.id === me.id && !b.is_active) throw new ApiError('validation', 422, 'Нельзя отключить самого себя');
      const admins = db.prepare("SELECT COUNT(*) c FROM admins WHERE role = 'admin' AND is_active = 1 AND id != ?").get(a.id).c;
      if (!b.is_active && a.role === 'admin' && admins === 0) throw new ApiError('validation', 422, 'Должен остаться хотя бы один активный администратор');
      out.is_active = b.is_active ? 1 : 0;
    }
    if (Object.keys(out).length) db.prepare(`UPDATE admins SET ${Object.keys(out).map(k => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...out, id: a.id });
    if (b.password) { setPassword(a.id, b.password); killSessions('admin', a.id); }
    if (out.is_active === 0) killSessions('admin', a.id);
    audit(me.actor, 'admin.update', `admin:${a.id}`, { ...out, password: b.password ? 'changed' : undefined });
    return { admin: db.prepare('SELECT id, login, name, email, role, is_active FROM admins WHERE id = ?').get(a.id) };
  });
  app.get('/api/audit', async () => db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all());

  /* ---------- Telegram и e-mail из настроек ---------- */
  app.put('/api/settings/telegram', { preHandler: requireOwner }, async (req) => {
    const token = String(req.body?.token || '').trim();
    if (token) { const info = await botInfo(token); if (!info.ok) throw new ApiError('validation', 422, `Токен не принят: ${info.error}`); setSetting('tg_bot_token', token); audit(principal(req).actor, 'settings.telegram', null, { bot: info.username }); return { ok: true, bot: info }; }
    setSetting('tg_bot_token', ''); audit(principal(req).actor, 'settings.telegram', null, { bot: null }); return { ok: true, bot: null };
  });
  app.get('/api/settings/telegram', async () => { const t = allSettings().tg_bot_token || config.tgBotToken || ''; const info = t ? await botInfo(t) : { ok: false }; return { configured: !!t, token_masked: t ? t.slice(0, 6) + '...' + t.slice(-4) : '', bot: info.ok ? info : null, error: t && !info.ok ? info.error : null, admin_chat: allSettings().tg_admin_chat_id || '' }; });
  app.post('/api/settings/telegram/test', async () => { const chat = allSettings().tg_admin_chat_id || config.tgAdminChatId; if (!chat) throw new ApiError('validation', 422, 'Чат администратора не привязан'); const r = await sendMessage(chat, 'Тест: уведомления CRM работают'); if (!r.ok) throw new ApiError('send_failed', 502, r.error); return { ok: true }; });
  app.put('/api/settings/email', { preHandler: requireOwner }, async (req) => {
    const b = req.body || {};
    for (const k of ['host', 'port', 'user', 'from']) if (k in b) setSetting(`smtp.${k}`, String(b[k] || '').trim());
    if ('pass' in b && b.pass !== '••••••••') setSetting('smtp.pass', String(b.pass || ''));
    if ('secure' in b) setSetting('smtp.secure', b.secure ? '1' : '0');
    if ('notify_emails' in b) setSetting('notify_emails', String(b.notify_emails || '').split(/[,;\s]+/).filter(Boolean).join(','));
    audit(principal(req).actor, 'settings.email', null, { host: b.host });
    return { ok: true };
  });
  app.get('/api/settings/email', async () => { const s = allSettings(); return { host: s['smtp.host'], port: s['smtp.port'], user: s['smtp.user'], pass: s['smtp.pass'] ? '••••••••' : '', from: s['smtp.from'], secure: s['smtp.secure'] === '1', notify_emails: s.notify_emails, configured: smtpConfigured() }; });
  app.post('/api/settings/email/test', async () => { const v = await verifySmtp(); if (!v.ok) throw new ApiError('smtp', 502, v.error); const to = allSettings().notify_emails; if (!to) throw new ApiError('validation', 422, 'Укажите адреса для уведомлений'); const r = await sendMail(to, 'Тест CRM', 'Уведомления по e-mail работают.'); if (!r.ok) throw new ApiError('smtp', 502, r.error); return { ok: true, to }; });

  /* ---------- причины потери ---------- */
  app.get('/api/settings/lost-reasons', async () => ({ reasons: lostReasons() }));
  app.put('/api/settings/lost-reasons', async (req) => {
    const list = Array.isArray(req.body?.reasons) ? req.body.reasons : null; if (!list || !list.length) throw new ApiError('validation', 422, 'Нужен список причин');
    const out = []; const seen = new Set();
    for (const r of list) { const label = String(r.label || '').trim().slice(0, 60); let id = String(r.id || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30); if (!label) continue; if (!id) id = 'r' + (out.length + 1); if (seen.has(id)) continue; seen.add(id); out.push({ id, label }); }
    if (!out.length) throw new ApiError('validation', 422, 'Нужна хотя бы одна причина');
    setSetting('lost_reasons', JSON.stringify(out)); audit(principal(req).actor, 'settings.lost_reasons', null, { count: out.length });
    return { reasons: out };
  });

  /* ---------- прайс и квартиры ---------- */
  app.patch('/api/units/:id', async (req) => {
    const u = unitByRef(req.params.id); if (!u) throw new ApiError('not_found', 404, 'Квартира не найдена');
    const b = req.body || {}; const me = principal(req);
    if ('price' in b) {
      const price = num(b.price); if (price === null || price < 0) throw new ApiError('validation', 422, 'Цена должна быть числом');
      db.prepare('INSERT INTO unit_price_history(unit_id, ts, old_price, new_price, actor, source) VALUES(?,?,?,?,?,?)').run(u.id, now(), u.price, price, me.actor, 'manual');
      db.prepare('UPDATE units SET price = ?, price_per_sqm = ?, price_updated_at = ? WHERE id = ?').run(price, u.total ? Math.round(price / u.total) : null, now(), u.id);
      audit(me.actor, 'unit.price', u.id, { old: u.price, new: price });
    }
    return { unit: db.prepare('SELECT * FROM units WHERE id = ?').get(u.id), history: db.prepare('SELECT * FROM unit_price_history WHERE unit_id = ? ORDER BY id DESC LIMIT 10').all(u.id) };
  });
  app.get('/api/units/:id/history', async (req) => db.prepare('SELECT * FROM unit_price_history WHERE unit_id = ? ORDER BY id DESC LIMIT 50').all(req.params.id));
  app.get('/api/units/export.csv', async (req, reply) => {
    const rows = db.prepare('SELECT u.*, COALESCE(s.status, u.source_status) status FROM units u LEFT JOIN unit_states s ON s.unit_id = u.id ORDER BY u.floor, u.slot').all();
    const lines = ['number,floor,type,total,price,status'].concat(rows.map(u => [u.number, u.floor, u.type, u.total, u.price ?? '', u.status].join(',')));
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="units.csv"');
    return '﻿' + lines.join('\n');
  });
  // импорт прайса: колонки number (обязательно), price, status (available|reserved|sold, необязательно)
  app.post('/api/units/import', async (req) => {
    const file = await req.file(); if (!file) throw new ApiError('validation', 400, 'Нужен CSV-файл');
    const rows = parseCsv(await file.toBuffer()); const me = principal(req);
    if (!rows.length || !('number' in rows[0])) throw new ApiError('validation', 422, 'В файле нужна колонка number (номер квартиры)');
    let updated = 0, statuses = 0; const errors = [];
    const tx = db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]; const u = unitByRef(r.number);
        if (!u) { errors.push({ row: i + 2, message: `квартира ${r.number} не найдена` }); continue; }
        const price = num(r.price);
        if (price !== null && price !== u.price) { db.prepare('INSERT INTO unit_price_history(unit_id, ts, old_price, new_price, actor, source) VALUES(?,?,?,?,?,?)').run(u.id, now(), u.price, price, me.actor, 'import'); db.prepare('UPDATE units SET price = ?, price_per_sqm = ?, price_updated_at = ? WHERE id = ?').run(price, u.total ? Math.round(price / u.total) : null, now(), u.id); updated++; }
        const st = String(r.status || '').trim().toLowerCase();
        if (['available', 'reserved', 'sold'].includes(st)) {
          const cur = db.prepare('SELECT * FROM unit_states WHERE unit_id = ?').get(u.id);
          if (cur?.lead_id && cur.status !== st) { errors.push({ row: i + 2, message: `# ${u.number}: статус занят лидом #${cur.lead_id}, пропущено` }); }
          else if ((cur?.status || u.source_status) !== st) { db.prepare('INSERT INTO unit_states(unit_id, status, lead_id, changed_at, changed_by, note) VALUES(?,?,NULL,?,?,?) ON CONFLICT(unit_id) DO UPDATE SET status = excluded.status, changed_at = excluded.changed_at, changed_by = excluded.changed_by, note = excluded.note').run(u.id, st, now(), me.actor, 'импорт прайса'); statuses++; }
        }
      }
    });
    tx();
    audit(me.actor, 'units.import', null, { rows: rows.length, updated, statuses, errors: errors.length });
    return { total: rows.length, prices_updated: updated, statuses_updated: statuses, errors };
  });

  /* ---------- бэкапы ---------- */
  app.get('/api/backups', async () => ({ dir: backupDir, items: listBackups().slice(0, 30), db_size: fs.existsSync(config.dbPath) ? fs.statSync(config.dbPath).size : 0 }));
  app.post('/api/backups', async (req, reply) => { const name = makeBackup('manual'); audit(principal(req).actor, 'backup.create', name); return reply.code(201).send({ name }); });
  app.get('/api/backups/:name', async (req, reply) => {
    const name = path.basename(req.params.name); const file = path.join(backupDir, name);
    if (!/^crm-.*\.db(\.gz)?$/.test(name) || !fs.existsSync(file)) throw new ApiError('not_found', 404, 'Файл не найден');
    reply.header('content-type', 'application/octet-stream').header('content-disposition', `attachment; filename="${name}"`);
    return reply.send(fs.createReadStream(file));
  });
  app.delete('/api/backups/:name', { preHandler: requireOwner }, async (req, reply) => { const name = path.basename(req.params.name); const file = path.join(backupDir, name); if (/^crm-.*\.db(\.gz)?$/.test(name) && fs.existsSync(file)) fs.unlinkSync(file); return reply.code(204).send(); });
  // восстановление: файл проверяется как SQLite (integrity_check), кладётся рядом как <db>.restore, сервис перезапускается (systemd поднимет)
  app.post('/api/backups/restore', { preHandler: requireOwner }, async (req) => {
    let name = null, buf = null;
    if ((req.headers['content-type'] || '').includes('multipart')) { const file = await req.file(); if (!file) throw new ApiError('validation', 400, 'Нужен файл .db или .db.gz'); buf = await file.toBuffer(); name = file.filename; }
    else { name = path.basename(String(req.body?.name || '')); const file = path.join(backupDir, name); if (!fs.existsSync(file)) throw new ApiError('not_found', 404, 'Копия не найдена'); buf = fs.readFileSync(file); }
    if (name.endsWith('.gz')) buf = zlib.gunzipSync(buf);
    if (buf.subarray(0, 16).toString('latin1') !== 'SQLite format 3\0') throw new ApiError('validation', 422, 'Это не файл базы SQLite');
    const tmp = config.dbPath + '.restore';
    fs.writeFileSync(tmp, buf);
    try { const t = new Database(tmp, { readonly: true }); const ok = t.pragma('integrity_check')[0]?.integrity_check === 'ok'; const leads = t.prepare('SELECT COUNT(*) c FROM leads').get().c; t.close(); if (!ok) throw new Error('integrity_check failed'); audit(principal(req).actor, 'backup.restore', name, { leads }); }
    catch (e) { fs.unlinkSync(tmp); throw new ApiError('validation', 422, 'Файл повреждён или не является базой CRM: ' + e.message); }
    makeBackup('pre-restore');
    setTimeout(() => process.exit(0), 800); // systemd перезапустит; при старте db.js подхватит .restore
    return { ok: true, message: 'База будет заменена, сервис перезапускается. Обновите страницу через 10 секунд.' };
  });

  /* ---------- полный экспорт ---------- */
  app.get('/api/export/all.json', async (req, reply) => {
    const tables = ['agents', 'channels', 'channel_rules', 'units', 'unit_states', 'unit_price_history', 'leads', 'lead_status_history', 'lead_notes', 'visitors', 'touches', 'events', 'link_hits', 'expenses', 'notifications', 'postback_queue', 'settings', 'audit_log'];
    const out = { exported_at: now(), version: config.version };
    for (const t of tables) out[t] = db.prepare(`SELECT * FROM ${t}`).all().map(r => { if (t === 'settings' && /token|pass/.test(r.key)) r.value = '***'; if (t === 'agents') delete r.telegram_chat_id; return r; });
    reply.header('content-type', 'application/json; charset=utf-8').header('content-disposition', `attachment; filename="realestate-crm-export-${now().slice(0, 10)}.json"`);
    return out;
  });

  /* ---------- диагностика ---------- */
  app.get('/api/diag', async () => {
    const site = allSettings().site_url; let snippet = { ok: false, error: null };
    try { const r = await fetch(site, { signal: AbortSignal.timeout(6000) }); const html = await r.text(); snippet = { ok: html.includes('crm-track.js'), status: r.status, error: html.includes('crm-track.js') ? null : 'на странице нет строки сниппета' }; } catch (e) { snippet = { ok: false, error: e.message }; }
    let disk = null; try { const st = fs.statfsSync(path.dirname(config.dbPath)); disk = { free_mb: Math.round(st.bavail * st.bsize / 1048576), total_mb: Math.round(st.blocks * st.bsize / 1048576) }; } catch { /* нет statfs */ }
    const last = (sql) => db.prepare(sql).get()?.v || null;
    return {
      version: config.version, uptime_s: Math.round(process.uptime()), node: process.version, db_path: config.dbPath, db_size: fs.existsSync(config.dbPath) ? fs.statSync(config.dbPath).size : 0, disk,
      site_url: site, snippet, telegram: { configured: tgEnabled(), admin_chat: !!allSettings().tg_admin_chat_id }, email: { configured: smtpConfigured() },
      last_touch: last('SELECT MAX(ts) v FROM touches'), last_lead: last('SELECT MAX(created_at) v FROM leads'), last_backup: listBackups()[0] || null,
      counts: { leads: last('SELECT COUNT(*) v FROM leads'), touches_24h: db.prepare("SELECT COUNT(*) v FROM touches WHERE ts > datetime('now', '-1 day')").get().v, agents: last('SELECT COUNT(*) v FROM agents WHERE is_active = 1') },
      recent_touches: db.prepare('SELECT ts, channel_id, utm_campaign, agent_slug, landing_path, referrer_host FROM touches ORDER BY id DESC LIMIT 10').all(),
      notification_errors: db.prepare("SELECT n.ts, n.recipient, n.status, n.error, l.name lead_name, l.id lead_id FROM notifications n LEFT JOIN leads l ON l.id = n.lead_id WHERE n.status != 'sent' ORDER BY n.id DESC LIMIT 10").all(),
    };
  });

  /* ---------- импорт расходов CSV ---------- */
  app.post('/api/expenses/import', async (req) => {
    const file = await req.file(); if (!file) throw new ApiError('validation', 400, 'Нужен CSV-файл');
    const rows = parseCsv(await file.toBuffer()); const me = principal(req);
    const chans = db.prepare('SELECT id, name FROM channels').all(); const chId = (v) => { const s = String(v || '').trim().toLowerCase(); return chans.find(c => c.id === s || c.name.toLowerCase() === s)?.id || null; };
    let created = 0; const errors = [];
    const ins = db.prepare('INSERT INTO expenses(channel_id, campaign, period_start, period_end, amount, currency, fx_to_usd, amount_usd, note, created_by, created_at, is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,0)');
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const ch = chId(r.channel); if (!ch) throw new Error(`канал «${r.channel}» не найден`);
        const ps = String(r.period_start || r.from || r.date || '').slice(0, 10), pe = String(r.period_end || r.to || r.date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ps) || !/^\d{4}-\d{2}-\d{2}$/.test(pe) || pe < ps) throw new Error('период: даты YYYY-MM-DD');
        const amount = num(r.amount); if (amount === null || amount < 0) throw new Error('сумма не число');
        const cur = ['USD', 'GEL', 'EUR'].includes(String(r.currency || 'USD').toUpperCase()) ? String(r.currency || 'USD').toUpperCase() : 'USD';
        const fx = num(r.fx_to_usd) || fxToUsd(cur);
        ins.run(ch, r.campaign || null, ps, pe, amount, cur, fx, Math.round(amount * fx * 100) / 100, r.note || 'импорт CSV', me.actor, now()); created++;
      } catch (e) { errors.push({ row: i + 2, message: e.message }); }
    }
    audit(me.actor, 'expenses.import', null, { rows: rows.length, created });
    return { total: rows.length, created, errors };
  });
}
