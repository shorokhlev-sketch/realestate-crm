// Демо-сид: 5 агентов, 4 платных канала + агент/органика/прямой, 60 лидов за 45 дней, касания, события, расходы.
// Все строки помечены is_demo = 1. Имена вымышленные, телефоны синтетические (+995 555 000 0xx), не проверены на незанятость.
import crypto from 'node:crypto';
import { db, bootstrap, now } from '../server/db.js';
import { recordTouch, recordEvent } from '../server/lib/attribution.js';
import { createLead, changeStatus } from '../server/lib/leads.js';

bootstrap();
const already = db.prepare('SELECT COUNT(*) c FROM leads WHERE is_demo = 1').get().c;
if (already && !process.argv.includes('--force')) { console.log(`demo already seeded (${already} leads); use --force to add more`); process.exit(0); }

let seedRnd = 20260906;
const rnd = () => { seedRnd = (seedRnd * 1103515245 + 12345) & 0x7fffffff; return seedRnd / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
const daysAgo = (n, h = between(9, 21)) => iso(Date.now() - n * DAY - (24 - h) * 3600000 + between(0, 3599) * 1000);

const SITE = 'https://example.com/';
const ts = now();

// агенты (вымышленные)
const agentsIn = [
  { slug: 'nino', name: 'Нино К.', telegram: '@nino_demo', phone: '+995 555 000 001' },
  { slug: 'giorgi', name: 'Гиорги М.', telegram: '@giorgi_demo', phone: '+995 555 000 002' },
  { slug: 'tamar', name: 'Тамар Б.', telegram: '@tamar_demo', phone: '+995 555 000 003' },
  { slug: 'levan', name: 'Леван Ш.', telegram: '@levan_demo', phone: '+995 555 000 004' },
  { slug: 'ana', name: 'Ана Ц.', telegram: '@ana_demo', phone: '+995 555 000 005' },
];
const agents = agentsIn.map(a => {
  const ex = db.prepare('SELECT * FROM agents WHERE slug = ?').get(a.slug);
  if (ex) return ex;
  const r = db.prepare('INSERT INTO agents(slug, name, phone, telegram, is_active, is_demo, created_at, updated_at) VALUES(?,?,?,?,1,1,?,?)').run(a.slug, a.name, a.phone, a.telegram, ts, ts);
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(r.lastInsertRowid);
});

// расходы: 4 канала
const exp = [
  ['meta', 'sep_sea', '2026-09-01', '2026-09-30', 800, 'USD', 1],
  ['meta', 'aug_studio', '2026-08-01', '2026-08-31', 1350, 'GEL', 0.37],
  ['meta', 'jul_launch', '2026-07-20', '2026-07-31', 300, 'USD', 1],
  ['google', null, '2026-08-01', '2026-09-30', 900, 'USD', 1],
  ['telegram', 'tg_batumi_ru', '2026-08-15', '2026-09-30', 300, 'EUR', 1.08],
  ['yandex', null, '2026-08-01', '2026-09-30', 260, 'USD', 1],
];
for (const [ch, camp, s, e, amount, cur, fx] of exp) db.prepare('INSERT INTO expenses(channel_id, campaign, period_start, period_end, amount, currency, fx_to_usd, amount_usd, note, created_by, created_at, is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)')
  .run(ch, camp, s, e, amount, cur, fx, Math.round(amount * fx * 100) / 100, 'demo', 'system', ts);

// источники трафика: вес -> доля кликов
const sources = [
  { w: 45, url: (a) => `${SITE}?utm_source=meta&utm_medium=cpc&utm_campaign=${pick(['sep_sea', 'aug_studio', 'jul_launch'])}&utm_content=${pick(['video_1', 'carousel', 'static_2'])}&fbclid=IwAR${crypto.randomBytes(6).toString('hex')}${a ? '&a=' + a : ''}`, ref: 'https://l.instagram.com/' },
  { w: 20, url: () => `${SITE}?utm_source=google&utm_medium=cpc&utm_campaign=${pick(['brand', 'batumi_apartments'])}&gclid=${crypto.randomBytes(8).toString('hex')}`, ref: 'https://www.google.com/' },
  { w: 12, url: (a) => `${SITE}?utm_source=telegram&utm_medium=post&utm_campaign=tg_batumi_ru${a ? '&a=' + a : ''}`, ref: 'https://t.me/' },
  { w: 4, url: () => `${SITE}?utm_source=yandex&utm_medium=cpc&utm_campaign=ya_search&yclid=${between(1e9, 9e9)}`, ref: 'https://yandex.ru/' },
  { w: 10, url: (a) => `${SITE}?a=${a || pick(agents).slug}`, ref: pick(['https://instagram.com/', 'https://t.me/', '']) },
  { w: 6, url: () => SITE, ref: 'https://www.google.com/' },
  { w: 3, url: () => SITE, ref: '' },
];
const totalW = sources.reduce((s, x) => s + x.w, 0);
const pickSource = () => { let r = rnd() * totalW; for (const s of sources) { r -= s.w; if (r <= 0) return s; } return sources[0]; };

const units = db.prepare("SELECT * FROM units WHERE source_status = 'available' ORDER BY floor").all();
const uaList = ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/605.1.15', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0', 'Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/17.5'];

// ~1 800 касаний за 45 дней, на 60 из них - лиды
const NAMES = ['Мариам', 'Давид', 'Софо', 'Ираклий', 'Нато', 'Зураб', 'Кетеван', 'Лаша', 'Элене', 'Гела', 'Тинатин', 'Бека', 'Анна', 'Олег', 'Мария', 'Игорь', 'Елена', 'Артём', 'Наталья', 'Сергей', 'Оксана', 'Дмитрий', 'Юлия', 'Андрей', 'Алина', 'Виктор', 'Лия', 'Ника', 'Саба', 'Рати'];
const INITIALS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШ';
const usedNames = new Set();
const uniqName = () => { let n; do { n = `${pick(NAMES)} ${pick(INITIALS)}.`; } while (usedNames.has(n)); usedNames.add(n); return n; };

const leadSlots = new Set(); while (leadSlots.size < 60) leadSlots.add(between(0, 1799));
let leadN = 0; const leads = [];
for (let i = 0; i < 1800; i++) {
  const day = 45 - Math.floor(i / 40);            // ~40 касаний в день, ровно
  const dayJitter = Math.min(45, Math.max(0, day + between(-1, 1)));
  const withAgent = rnd() < 0.6 ? pick(agents).slug : null;
  const src = pickSource();
  const vid = crypto.randomUUID();
  const t = daysAgo(dayJitter);
  recordTouch({ vid, url: src.url(withAgent), referrer: src.ref, ua: pick(uaList), ts: t, isDemo: 1 });
  const viewed = rnd() < 0.35 ? pick(units) : null;
  if (viewed) recordEvent({ vid, type: 'unit_view', unitId: viewed.id, path: '/select-c.html#/own/' + viewed.id, ts: iso(new Date(t).getTime() + between(60, 900) * 1000), isDemo: 1 });
  if (leadSlots.has(i) && leadN < 60) {
    leadN++;
    const idx = leadN;
    const phone = `+9955550000${String(idx).padStart(2, '0')}`;
    const useTg = rnd() < 0.25;
    const unit = viewed || (rnd() < 0.5 ? pick(units) : null);
    const created = iso(new Date(t).getTime() + between(120, 1800) * 1000);
    const r = await createLead({ name: uniqName(), phone: useTg ? '' : phone, telegram: useTg ? `@demo_user_${idx}` : '', unit: unit?.id, interest: unit ? null : pick(['studio', '1br', '2br', '3br']),
      comment: pick(['', '', 'Интересует рассрочка', 'Хотят вид на море', 'Смотрят для инвестиций', 'Приедут в сентябре', 'Просили планировки в WhatsApp']),
      vid, source: rnd() < 0.7 ? 'site_form' : 'site_modal', page: unit ? '/select-c.html#/own/' + unit.id : '/', created_at: created, is_demo: 1, notify: false, actor: 'site' });
    leads.push({ lead: r.lead, created });
  }
}

// воронка: прогоняем лиды по статусам с реалистичным отсевом
const ACTORS = (l) => l.agent_id ? `agent:${l.agent_id}` : 'admin:1';
const step = (l, status, at, extra = {}) => { try { return changeStatus(l.id, { status, actor: ACTORS(l), ts: at, ...extra }); } catch (e) { return null; } };
let n = { contact: 0, showing: 0, booking: 0, contract: 0, paid: 0, lost: 0 };
for (const { lead, created } of leads) {
  let l = lead; let at = new Date(created).getTime();
  const ageDays = (Date.now() - at) / DAY;
  const lost = (reason, note) => { step(l, 'lost', iso(at + between(1, 3) * DAY), { lost_reason: reason, lost_note: note }); n.lost++; };
  if (ageDays < 2) continue;                                  // свежие остаются «новый»
  if (rnd() < 0.10) { if (ageDays > 5) lost('no_answer', 'не берёт трубку'); continue; }
  at += between(2, 30) * 3600000; step(l, 'contact', iso(at), { note: pick(['дозвонились', 'ответили в Telegram', 'перезвонили сами']) }); n.contact++;
  if (ageDays < 3) continue;
  if (rnd() < 0.35) { if (ageDays > 7 && rnd() < 0.6) lost(pick(['price', 'postponed', 'bought_elsewhere']), pick(['дорого', 'отложили до весны', 'взяли в другом ЖК'])); continue; }
  at += between(1, 6) * DAY; if (at > Date.now()) continue;
  step(l, 'showing', iso(at), { note: pick(['показ на объекте', 'онлайн-показ', 'смотрели 10 и 12 этаж']) }); n.showing++;
  if (rnd() < 0.45) { if (ageDays > 14 && rnd() < 0.5) lost(pick(['price', 'postponed']), 'после показа думают'); continue; }
  at += between(1, 5) * DAY; if (at > Date.now()) continue;
  l = db.prepare('SELECT * FROM leads WHERE id = ?').get(l.id);
  if (!l.unit_id) { const u = pick(units.filter(x => !db.prepare('SELECT 1 FROM unit_states WHERE unit_id = ? AND status != ?').get(x.id, 'available'))); db.prepare('UPDATE leads SET unit_id = ? WHERE id = ?').run(u.id, l.id); l.unit_id = u.id; }
  const b = step(l, 'booking', iso(at), { note: 'задаток внесён' }); if (!b) continue; n.booking++;
  if (rnd() < 0.6) continue;
  at += between(4, 10) * DAY; if (at > Date.now()) continue;
  step(l, 'contract', iso(at), { note: 'договор подписан' }); n.contract++;
  if (rnd() < 0.5) continue;
  at += between(3, 12) * DAY; if (at > Date.now()) continue;
  step(l, 'paid', iso(at), { note: 'оплата получена' }); n.paid++;
}
// постбэки очереди в демо помечаем skipped, чтобы не висели
db.prepare("UPDATE postback_queue SET status = 'skipped', last_error = 'provider disabled' WHERE status = 'queued'").run();
console.log(`seeded: ${agents.length} agents, ${leads.length} leads, funnel ${JSON.stringify(n)}, touches=${db.prepare('SELECT COUNT(*) c FROM touches WHERE is_demo=1').get().c}`);
