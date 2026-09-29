// Очередь серверных постбэков конверсий. Фаза 1: накопление + просмотр; отправка - заглушка (skipped, если провайдер выключен).
import crypto from 'node:crypto';
import { db, now, getSetting } from '../db.js';

const EVENT_BY_STATUS = { new: 'Lead', showing: 'Schedule', booking: 'InitiateCheckout', contract: 'Purchase', paid: 'Purchase' };
const sha = (s) => s ? crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex') : null;

export function enqueueForStatus(lead, status) {
  const event = EVENT_BY_STATUS[status];
  if (!event) return;
  const first = lead.first_touch_id ? db.prepare('SELECT * FROM touches WHERE id = ?').get(lead.first_touch_id) : null;
  const providers = [];
  if (first?.fbclid || lead.channel_first_id === 'meta') providers.push('meta_capi');
  if (first?.gclid || lead.channel_first_id === 'google') providers.push('google_offline');
  if (lead.channel_first_id === 'telegram') providers.push('telegram_ads');
  const ins = db.prepare('INSERT INTO postback_queue(provider, event, lead_id, payload, status, created_at) VALUES(?,?,?,?,?,?)');
  for (const p of providers) {
    const payload = {
      event_name: event, event_time: Math.floor(Date.now() / 1000), lead_id: lead.id,
      click_id: first?.fbclid || first?.gclid || first?.yclid || first?.ttclid || null,
      user_data: { ph: sha(lead.phone), em: sha(lead.email) },
      value: lead.deal_amount_usd || null, currency: 'USD',
      utm: first ? { source: first.utm_source, campaign: first.utm_campaign, content: first.utm_content } : null,
    };
    ins.run(p, event, lead.id, JSON.stringify(payload), 'queued', now());
  }
}

// Воркер: провайдер выключен -> skipped; включён -> в фазе 2 здесь появится реальный вызов API.
export function processQueue() {
  const rows = db.prepare("SELECT * FROM postback_queue WHERE status = 'queued' ORDER BY id LIMIT 50").all();
  for (const r of rows) {
    const enabled = getSetting(`provider.${r.provider}.enabled`) === '1';
    if (!enabled) { db.prepare("UPDATE postback_queue SET status = 'skipped', attempts = attempts + 1, last_error = 'provider disabled' WHERE id = ?").run(r.id); continue; }
    db.prepare("UPDATE postback_queue SET status = 'failed', attempts = attempts + 1, last_error = 'sender not implemented (phase 2)' WHERE id = ?").run(r.id);
  }
}
