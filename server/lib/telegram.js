import { db, now, getSetting } from '../db.js';
import { config } from '../config.js';

export const botToken = () => (getSetting('tg_bot_token') || config.tgBotToken || '').trim();
export const tgEnabled = () => !!botToken();

export async function sendMessage(chatId, text) {
  if (!tgEnabled() || !chatId) return { ok: false, error: 'no_token_or_chat' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken()}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    return j.ok ? { ok: true } : { ok: false, error: j.description || `http ${r.status}` };
  } catch (e) { return { ok: false, error: e.message }; }
}

const esc = (s) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

export function leadMessage(lead, { unit, agent, channel, duplicate } = {}) {
  const lines = [
    duplicate ? '<b>Повторная заявка</b>' : '<b>Новый лид</b>',
    `<b>${esc(lead.name)}</b>`,
    lead.phone ? `Телефон: ${esc(lead.phone)}` : null,
    lead.telegram ? `Telegram: ${esc(lead.telegram)}` : null,
    unit ? `Квартира # ${esc(unit.number)} · ${esc(unit.type)} · ${unit.total} м²` : (lead.interest ? `Интерес: ${esc(lead.interest)}` : null),
    channel ? `Канал: ${esc(channel)}${lead.campaign_first ? ' · ' + esc(lead.campaign_first) : ''}` : null,
    agent ? `Агент: ${esc(agent.name)}` : 'Агент не назначен',
    lead.comment ? `Комментарий: ${esc(lead.comment)}` : null,
    `${config.crmUrl}/admin/lead.html?id=${lead.id}`,
  ];
  return lines.filter(Boolean).join('\n');
}

// Уведомление агенту и админу; результат пишется в notifications. Не бросает исключений.
export async function notifyNewLead(lead, ctx) {
  const text = leadMessage(lead, ctx);
  const targets = [];
  if (ctx.agent) targets.push({ recipient: `agent:${ctx.agent.id}`, chat: ctx.agent.telegram_chat_id });
  targets.push({ recipient: 'admin', chat: getSetting('tg_admin_chat_id') || config.tgAdminChatId });
  for (const t of targets) {
    let status = 'no_chat_id', error = null;
    if (t.chat) {
      const r = await sendMessage(t.chat, text);
      status = r.ok ? 'sent' : 'failed'; error = r.ok ? null : r.error;
    }
    db.prepare('INSERT INTO notifications(lead_id, recipient, chat_id, status, error, ts) VALUES(?,?,?,?,?,?)').run(lead.id, t.recipient, t.chat || null, status, error, now());
  }
}

// Привязка чатов: агент/админ шлёт боту "/start <code>". Коды живут в settings как link_code.<code> = agent:<id> | admin.
export function issueLinkCode(target) {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  db.prepare('INSERT OR REPLACE INTO settings(key, value, updated_at) VALUES(?,?,?)').run(`link_code.${code}`, target, now());
  return code;
}

let offset = 0;
export async function pollUpdatesOnce() {
  if (!tgEnabled()) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken()}/getUpdates?timeout=0&offset=${offset}`);
    const j = await r.json();
    if (!j.ok) return;
    for (const u of j.result) {
      offset = u.update_id + 1;
      const msg = u.message; if (!msg || !msg.text) continue;
      const m = msg.text.match(/^\/start\s+([A-Z0-9]{6})/i);
      if (!m) continue;
      const key = `link_code.${m[1].toUpperCase()}`;
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      if (!row) { await sendMessage(msg.chat.id, 'Код не найден. Возьмите новый код в CRM.'); continue; }
      if (row.value === 'admin') db.prepare("INSERT OR REPLACE INTO settings(key, value, updated_at) VALUES('tg_admin_chat_id', ?, ?)").run(String(msg.chat.id), now());
      else { const id = Number(row.value.split(':')[1]); db.prepare('UPDATE agents SET telegram_chat_id = ?, updated_at = ? WHERE id = ?').run(String(msg.chat.id), now(), id); }
      db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      await sendMessage(msg.chat.id, 'Чат привязан. Сюда будут приходить новые лиды.');
    }
  } catch { /* сеть - молча, попробуем в следующий тик */ }
}

export async function botInfo(token = botToken()) {
  if (!token) return { ok: false, error: 'Токен не задан' };
  try { const r = await fetch(`https://api.telegram.org/bot${token}/getMe`); const j = await r.json(); return j.ok ? { ok: true, username: j.result.username, name: j.result.first_name } : { ok: false, error: j.description || 'Telegram отклонил токен' }; }
  catch (e) { return { ok: false, error: e.message }; }
}
