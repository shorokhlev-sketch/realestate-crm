import { db, now, getSetting, fxToUsd, lostReasons } from '../db.js';
import { sendMail, smtpConfigured } from './email.js';
import { config } from '../config.js';
import { notifyNewLead } from './telegram.js';
import { enqueueForStatus } from './postbacks.js';

export const STATUSES = ['new', 'contact', 'showing', 'booking', 'contract', 'paid', 'lost'];
export const STATUS_RU = { new: 'Новый', contact: 'Контакт', showing: 'Показ', booking: 'Бронь', contract: 'Договор', paid: 'Оплачен', lost: 'Потерян' };
export const LOST_REASONS = () => lostReasons().map(r => r.id);
export const SOURCES = ['site_form', 'site_modal', 'site_unit_page', 'site_popup', 'site_card', 'manual', 'csv', 'api'];
// источники с сайта подбора : страница квартиры / попап на плане этажа / карточка списка
export const SITE_SOURCES = ['site_form', 'site_modal', 'site_unit_page', 'site_popup', 'site_card'];

export class ApiError extends Error { constructor(code, status, message, extra) { super(message); this.code = code; this.status = status; this.extra = extra; } }

export function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (!d.startsWith('+')) {
    const digits = d.replace(/\D/g, '');
    if (digits.length === 9) d = '+995' + digits;            // грузинский мобильный без кода
    else if (digits.length === 12 && digits.startsWith('995')) d = '+' + digits;
    else if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) d = '+7' + digits.slice(1);
    else d = '+' + digits;
  }
  const digits = d.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15 ? '+' + digits : null;
}
export function normalizeTelegram(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '');
  return /^[a-z0-9_]{4,32}$/i.test(s) ? '@' + s : null;
}
const dedupeKey = (phone, telegram) => phone || (telegram ? telegram.toLowerCase() : null);

export function unitByRef(ref) {
  if (!ref) return null;
  const r = String(ref).trim();
  return db.prepare('SELECT * FROM units WHERE id = ? OR number = ?').get(r, r) || null;
}

export function getLead(id) { return db.prepare('SELECT * FROM leads WHERE id = ?').get(id); }

export function addNote(leadId, actor, text, kind = 'note') {
  const r = db.prepare('INSERT INTO lead_notes(lead_id, ts, actor, kind, text) VALUES(?,?,?,?,?)').run(leadId, now(), actor, kind, text);
  return db.prepare('SELECT * FROM lead_notes WHERE id = ?').get(r.lastInsertRowid);
}

// Создание лида. input: { name, phone, telegram, email, unit (id|number), interest, comment, source, vid, page, agent_id, channel_id, status, created_at, is_demo, actor, notify }
export async function createLead(input) {
  const name = String(input.name || '').trim().slice(0, 120);
  if (!name) throw new ApiError('validation', 422, 'Имя обязательно');
  const phone = normalizePhone(input.phone);
  const telegram = normalizeTelegram(input.telegram);
  if (!phone && !telegram) throw new ApiError('validation', 422, 'Нужен телефон или telegram');
  const email = input.email ? String(input.email).trim().slice(0, 120) : null;
  const unit = unitByRef(input.unit || input.unit_id || input.unit_number);
  if ((input.unit || input.unit_id || input.unit_number) && !unit) throw new ApiError('unit_not_found', 422, `Квартира ${input.unit || input.unit_id || input.unit_number} не найдена`);
  const source = SOURCES.includes(input.source) ? input.source : 'api';
  const ts = input.created_at || now();
  const key = dedupeKey(phone, telegram);

  // дубль за dedupeDays -> заметка в существующем лиде
  if (key && !input.skip_dedupe) {
    const since = new Date(new Date(ts) - config.dedupeDays * 86400000).toISOString();
    const dup = db.prepare("SELECT * FROM leads WHERE dedupe_key = ? AND created_at > ? AND status != 'lost' ORDER BY id DESC LIMIT 1").get(key, since);
    if (dup) {
      addNote(dup.id, 'system', `Повторная заявка (${source})${unit ? ' · # ' + unit.number : ''}${input.comment ? ': ' + input.comment : ''}`, 'duplicate');
      db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').run(now(), dup.id);
      if (input.notify !== false) {
        const agent = dup.agent_id ? db.prepare('SELECT * FROM agents WHERE id = ?').get(dup.agent_id) : null;
        await notifyNewLead({ ...dup, comment: input.comment }, { unit, agent, channel: dup.channel_first_id, duplicate: true });
      }
      return { lead: dup, duplicate: true };
    }
  }

  // атрибуция по посетителю
  let visitor = input.vid ? db.prepare('SELECT * FROM visitors WHERE id = ?').get(input.vid) : null;
  const first = visitor?.first_touch_id ? db.prepare('SELECT * FROM touches WHERE id = ?').get(visitor.first_touch_id) : null;
  const last = visitor?.last_touch_id ? db.prepare('SELECT * FROM touches WHERE id = ?').get(visitor.last_touch_id) : null;
  let agentId = input.agent_id ?? null, agentSource = input.agent_id ? (input.agent_source || 'manual') : null;
  if (!agentId && visitor?.agent_id) {
    const days = Number(getSetting('cookie_days', '90')) || 90;
    if (!visitor.agent_set_at || (new Date(ts) - new Date(visitor.agent_set_at)) <= days * 86400000) { agentId = visitor.agent_id; agentSource = 'cookie'; }
  }
  const channelFirst = input.channel_id || first?.channel_id || 'direct';
  const channelLast = input.channel_id || last?.channel_id || channelFirst;
  const status = STATUSES.includes(input.status) ? input.status : 'new';
  const isDemo = input.is_demo ? 1 : 0;

  const r = db.prepare(`INSERT INTO leads(created_at, updated_at, name, phone, telegram, email, unit_id, interest, source, visitor_id,
      first_touch_id, last_touch_id, channel_first_id, channel_last_id, campaign_first, campaign_last, agent_id, agent_source, status, comment, utm_snapshot, dedupe_key, is_demo)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(ts, ts, name, phone, telegram, email, unit?.id || null, input.interest ? String(input.interest).slice(0, 200) : null, source, visitor?.id || null,
      first?.id || null, last?.id || null, channelFirst, channelLast, input.campaign || first?.utm_campaign || null, last?.utm_campaign || null,
      agentId, agentSource, status, input.comment ? String(input.comment).slice(0, 2000) : null,
      JSON.stringify({ first, last, page: input.page || null }), key, isDemo);
  const lead = getLead(r.lastInsertRowid);
  db.prepare('INSERT INTO lead_status_history(lead_id, ts, from_status, to_status, actor, note) VALUES(?,?,?,?,?,?)').run(lead.id, ts, null, status, input.actor || 'system', source);
  if (agentSource === 'cookie') addNote(lead.id, 'system', `Агент назначен по cookie (?a=${first?.agent_slug || last?.agent_slug || ''})`, 'system');
  enqueueForStatus(lead, 'new');
  if (input.notify !== false) {
    const agent = agentId ? db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) : null;
    await notifyNewLead(lead, { unit, agent, channel: channelFirst });
    if (smtpConfigured()) {
      const to = [getSetting('notify_emails') || '', agent?.email || ''].filter(Boolean).join(',');
      const text = [`Новый лид #${lead.id}: ${lead.name}`, lead.phone ? `Телефон: ${lead.phone}` : null, lead.telegram ? `Telegram: ${lead.telegram}` : null, unit ? `Квартира: # ${unit.number}` : null, `Канал: ${channelFirst}${lead.campaign_first ? ' · ' + lead.campaign_first : ''}`, agent ? `Агент: ${agent.name}` : 'Агент не назначен', lead.comment ? `Комментарий: ${lead.comment}` : null, `${config.crmUrl}/admin/lead.html?id=${lead.id}`].filter(Boolean).join('\n');
      const r = await sendMail(to, `Новый лид: ${lead.name}`, text);
      db.prepare('INSERT INTO notifications(lead_id, recipient, chat_id, status, error, ts) VALUES(?,?,?,?,?,?)').run(lead.id, 'email', to || null, r.ok ? 'sent' : 'failed', r.ok ? null : r.error, now());
    }
  }
  return { lead, duplicate: false };
}

// Смена статуса с правилами: lost -> причина; booking/contract/paid -> квартира; обновление unit_states; история; постбэк.
export function changeStatus(leadId, { status, note, lost_reason, lost_note, deal_amount, deal_currency, actor, ts, role }) {
  if (!STATUSES.includes(status)) throw new ApiError('validation', 422, 'Неизвестный статус');
  if (role === 'agent' && (status === 'contract' || status === 'paid')) throw new ApiError('admin_only', 403, 'Договор и оплату подтверждает администратор');
  const time = ts || now();
  const tx = db.transaction(() => {
    const lead = getLead(leadId);
    if (!lead) throw new ApiError('not_found', 404, 'Лид не найден');
    if (status === 'lost' && !LOST_REASONS().includes(lost_reason)) throw new ApiError('lost_reason_required', 422, 'Укажите причину потери');
    const needsUnit = ['booking', 'contract', 'paid'].includes(status);
    if (needsUnit && !lead.unit_id) throw new ApiError('unit_required', 422, 'Сначала укажите квартиру в карточке лида');
    const patch = { status, updated_at: time };
    if (status === 'lost') { patch.lost_reason = lost_reason; patch.lost_note = lost_note || null; }
    if (deal_amount !== undefined && deal_amount !== null && deal_amount !== '') {
      const cur = ['USD', 'GEL', 'EUR'].includes(deal_currency) ? deal_currency : 'USD';
      patch.deal_amount = Number(deal_amount); patch.deal_currency = cur; patch.deal_amount_usd = Math.round(Number(deal_amount) * fxToUsd(cur));
    } else if (needsUnit && !lead.deal_amount) {
      const u = db.prepare('SELECT price FROM units WHERE id = ?').get(lead.unit_id);
      if (u?.price) { patch.deal_amount = u.price; patch.deal_currency = 'USD'; patch.deal_amount_usd = u.price; }
    }
    // квартира
    let unitState = null;
    if (needsUnit) {
      const cur = db.prepare('SELECT * FROM unit_states WHERE unit_id = ?').get(lead.unit_id);
      if (cur && cur.lead_id && cur.lead_id !== lead.id && cur.status !== 'available') {
        throw new ApiError('unit_taken', 409, `Квартира уже ${cur.status === 'sold' ? 'продана' : 'забронирована'} по другому лиду`, { lead_id: cur.lead_id });
      }
      const st = status === 'booking' ? 'reserved' : 'sold';
      db.prepare(`INSERT INTO unit_states(unit_id, status, lead_id, changed_at, changed_by, note) VALUES(?,?,?,?,?,?)
        ON CONFLICT(unit_id) DO UPDATE SET status = excluded.status, lead_id = excluded.lead_id, changed_at = excluded.changed_at, changed_by = excluded.changed_by, note = excluded.note`)
        .run(lead.unit_id, st, lead.id, time, actor || 'system', `лид #${lead.id} -> ${STATUS_RU[status]}`);
      unitState = { unit_id: lead.unit_id, status: st };
    }
    if (status === 'lost' && lead.status === 'booking' && lead.unit_id) {
      const cur = db.prepare('SELECT * FROM unit_states WHERE unit_id = ?').get(lead.unit_id);
      if (cur && cur.lead_id === lead.id) {
        db.prepare("UPDATE unit_states SET status = 'available', changed_at = ?, changed_by = ?, note = ? WHERE unit_id = ?").run(time, actor || 'system', `бронь снята: лид #${lead.id} потерян`, lead.unit_id);
        unitState = { unit_id: lead.unit_id, status: 'available' };
      }
    }
    const sets = Object.keys(patch).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE leads SET ${sets} WHERE id = @id`).run({ ...patch, id: lead.id });
    db.prepare('INSERT INTO lead_status_history(lead_id, ts, from_status, to_status, actor, reason, note) VALUES(?,?,?,?,?,?,?)')
      .run(lead.id, time, lead.status, status, actor || 'system', status === 'lost' ? lost_reason : null, note || null);
    if (unitState) addNote(lead.id, 'system', `Квартира # ${db.prepare('SELECT number FROM units WHERE id = ?').get(lead.unit_id).number} -> ${unitState.status === 'reserved' ? 'бронь' : unitState.status === 'sold' ? 'продана' : 'свободна'} на сайте`, 'system');
    const updated = getLead(lead.id);
    enqueueForStatus(updated, status);
    return { lead: updated, unit_state: unitState };
  });
  return tx();
}

export function updateLead(leadId, patch, actor) {
  const lead = getLead(leadId);
  if (!lead) throw new ApiError('not_found', 404, 'Лид не найден');
  const allowed = ['name', 'phone', 'telegram', 'email', 'unit_id', 'interest', 'comment', 'agent_id', 'channel_first_id', 'deal_amount', 'deal_currency'];
  const out = {};
  for (const k of allowed) if (k in patch) out[k] = patch[k];
  if ('phone' in out) { out.phone = normalizePhone(out.phone); if (patch.phone && !out.phone) throw new ApiError('validation', 422, 'Телефон не распознан'); }
  if ('telegram' in out) out.telegram = normalizeTelegram(out.telegram);
  if ('unit_id' in out && out.unit_id) { const u = unitByRef(out.unit_id); if (!u) throw new ApiError('unit_not_found', 422, 'Квартира не найдена'); out.unit_id = u.id; }
  if ('unit_id' in out && !out.unit_id) out.unit_id = null;
  if ('agent_id' in out) { out.agent_id = out.agent_id ? Number(out.agent_id) : null; if (out.agent_id !== lead.agent_id) { out.agent_source = 'manual'; } }
  if ('channel_first_id' in out && !db.prepare('SELECT 1 FROM channels WHERE id = ?').get(out.channel_first_id)) throw new ApiError('validation', 422, 'Неизвестный канал');
  if ('deal_amount' in out) {
    const cur = ['USD', 'GEL', 'EUR'].includes(out.deal_currency || lead.deal_currency) ? (out.deal_currency || lead.deal_currency) : 'USD';
    out.deal_currency = cur;
    out.deal_amount = out.deal_amount === null || out.deal_amount === '' ? null : Number(out.deal_amount);
    out.deal_amount_usd = out.deal_amount === null ? null : Math.round(out.deal_amount * fxToUsd(cur));
  }
  if ('phone' in out || 'telegram' in out) out.dedupe_key = dedupeKey(out.phone ?? lead.phone, out.telegram ?? lead.telegram);
  out.updated_at = now();
  const sets = Object.keys(out).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE leads SET ${sets} WHERE id = @id`).run({ ...out, id: leadId });
  if ('agent_id' in out && out.agent_id !== lead.agent_id) {
    const a = out.agent_id ? db.prepare('SELECT name FROM agents WHERE id = ?').get(out.agent_id) : null;
    addNote(leadId, actor || 'system', `Агент изменён: ${a ? a.name : 'не назначен'}`, 'system');
  }
  return getLead(leadId);
}
