/* Общий слой фронта CRM: api(), форматирование, навигация, воронка/график, тосты. Без сборки, без фреймворков. */
(function () {
  const BASE = location.pathname.replace(/\/(admin|agent)\/.*$/, '');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  };

  async function api(path, opts = {}) {
    const o = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body instanceof FormData) o.body = opts.body; else if (opts.body !== undefined) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
    const r = await fetch(BASE + '/api' + path, o);
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.message || ('Ошибка ' + r.status)); e.code = j.error; e.status = r.status; e.data = j; throw e; }
    return j;
  }

  /* ---------- форматирование ---------- */
  const STATUS = { new: 'Новый', contact: 'Контакт', showing: 'Показ', booking: 'Бронь', contract: 'Договор', paid: 'Оплачен', lost: 'Потерян' };
  const STATUS_ORDER = ['new', 'contact', 'showing', 'booking', 'contract', 'paid', 'lost'];
  const LOST = { price: 'Дорого', no_answer: 'Не отвечает', bought_elsewhere: 'Купил в другом месте', postponed: 'Отложил', other: 'Другое' };
  const CHANNEL = { meta: 'Meta', google: 'Google', telegram: 'Telegram', yandex: 'Яндекс', tiktok: 'TikTok', agent: 'Агенты', organic: 'Органика', direct: 'Прямой' };
  const SOURCE = { site_form: 'форма лендинга', site_modal: 'заявка в подборе', site_unit_page: 'страница квартиры', site_popup: 'попап на плане этажа', site_card: 'карточка в списке', manual: 'вручную', csv: 'импорт CSV', api: 'API' };
  const TYPE = { studio: 'Студия', '1br': '1-комн.', '2br': '2-комн.', '3br': '3-комн.' };
  const nf = new Intl.NumberFormat('ru-RU');
  const num = (v) => (v === null || v === undefined ? '-' : nf.format(Math.round(v)));
  const usd = (v) => (v === null || v === undefined ? '-' : '$' + nf.format(Math.round(v)));
  const pct = (v, d = 1) => (v === null || v === undefined ? '-' : (v * 100).toFixed(d).replace('.', ',') + ' %');
  const x = (v) => (v === null || v === undefined ? '-' : (Math.round(v * 10) / 10).toString().replace('.', ',') + '×');
  const area = (v) => (v === null || v === undefined ? '-' : String(v).replace('.', ',') + ' м²');
  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сент', 'окт', 'нояб', 'дек'];
  const dt = (iso, withTime = true) => { if (!iso) return '-'; const d = new Date(iso); const s = `${d.getDate()} ${MONTHS[d.getMonth()]}`; return withTime ? `${s}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : s; };
  const dtFull = (iso) => { if (!iso) return '-'; const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const ago = (iso) => { if (!iso) return ''; const m = (Date.now() - new Date(iso)) / 60000; if (m < 60) return `${Math.max(1, Math.round(m))} мин`; if (m < 1440) return `${Math.round(m / 60)} ч`; const d = Math.round(m / 1440); return d < 30 ? `${d} дн` : dt(iso, false); };
  const dLocal = (s) => { const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
  const periodLabel = (p) => `${dLocal(p.from)} - ${dLocal(p.to)} ${p.to.slice(0, 4)}`;
  const initials = (name) => (name || '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const unitLabel = (u) => u ? `${TYPE[u.type] || u.type} · ${area(u.total)}` : '';

  /* ---------- UI-компоненты ---------- */
  const badge = (cls, text) => el('span', { class: 'badge ' + cls, text });
  const stBadge = (s) => el('span', { class: `st-badge st--${s}`, text: STATUS[s] || s });
  const stDot = (s) => el('span', { class: `st st--${s}`, text: STATUS[s] || s });
  const channelBadge = (ch, camp) => el('span', { class: 'badge badge--channel', text: (CHANNEL[ch] || ch || '-') + (camp ? ' · ' + camp : '') });
  const unitBadge = (u) => u ? el('span', { class: 'unit-ref' }, [badge('badge--id', '# ' + u.number), el('span', { class: 'muted', text: ' ' + unitLabel(u) })]) : el('span', { class: 'muted', text: '-' });

  function toast(text, kind = 'ok') {
    let host = $('#toasts'); if (!host) { host = el('div', { id: 'toasts', class: 'toasts' }); document.body.appendChild(host); }
    const t = el('div', { class: 'toast toast--' + kind, text }); host.appendChild(t);
    setTimeout(() => t.classList.add('is-on'), 10); setTimeout(() => { t.classList.remove('is-on'); setTimeout(() => t.remove(), 300); }, 3500);
  }

  // период: ?from&to в URL; сегментед 7/30/90/период
  function periodFromUrl() { const p = new URLSearchParams(location.search); return { from: p.get('from') || '', to: p.get('to') || '' }; }
  function periodControl(onChange) {
    const cur = periodFromUrl();
    const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
    const ago = (n) => new Date(new Date(today + 'T00:00:00Z') - (n - 1) * 86400000).toISOString().slice(0, 10);
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Период' });
    const days = cur.from && cur.to ? Math.round((new Date(cur.to) - new Date(cur.from)) / 86400000) + 1 : 30;
    const isPreset = !cur.from || (cur.to === today && [7, 30, 90].includes(days));
    for (const n of [7, 30, 90]) seg.appendChild(el('button', { class: isPreset && days === n ? 'is-active' : '', text: `${n} дн`, onclick: () => set(ago(n), today) }));
    const custom = el('button', { class: !isPreset ? 'is-active' : '', text: 'Период...', onclick: () => { picker.hidden = !picker.hidden; } });
    seg.appendChild(custom);
    const fromI = el('input', { class: 'field__input', type: 'date', value: cur.from || ago(30) }), toI = el('input', { class: 'field__input', type: 'date', value: cur.to || today });
    const picker = el('div', { class: 'period-picker', hidden: true }, [fromI, el('span', { text: '-' }), toI, el('button', { class: 'btn btn--primary btn--sm', text: 'Применить', onclick: () => set(fromI.value, toI.value) })]);
    function set(f, t) { const u = new URL(location.href); u.searchParams.set('from', f); u.searchParams.set('to', t); history.replaceState(null, '', u); onChange({ from: f, to: t }); render(); }
    function render() { const c = periodFromUrl(); const d = c.from && c.to ? Math.round((new Date(c.to) - new Date(c.from)) / 86400000) + 1 : 30; const pre = !c.from || (c.to === today && [7, 30, 90].includes(d)); $$('button', seg).forEach((b, i) => b.classList.toggle('is-active', i < 3 ? pre && d === [7, 30, 90][i] : !pre)); picker.hidden = true; }
    return { node: el('div', { class: 'period' }, [seg, picker]), value: () => { const c = periodFromUrl(); return { from: c.from || ago(30), to: c.to || today }; } };
  }
  const qs = (obj) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(obj)) if (v !== '' && v !== null && v !== undefined) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };

  // воронка: одна серия (бренд); опционально сравнение (медиана)
  function funnel(rows, { compare = false, scaleFrom = 1 } = {}) {
    // rows: [{label, value, cmp?, conv?, convCmp?}]; шкала: первая строка = 100 %, начиная с scaleFrom - своя шкала
    const wrap = el('div', { class: 'funnel' + (compare ? ' funnel--cmp' : '') });
    const max0 = Math.max(rows[0].value, rows[0].cmp || 0, 1);
    const max1 = Math.max(rows[scaleFrom]?.value || 0, rows[scaleFrom]?.cmp || 0, 1);
    rows.forEach((r, i) => {
      const max = i < scaleFrom ? max0 : max1;
      const w = Math.min(100, r.value / max * 100), wc = compare ? Math.min(100, (r.cmp || 0) / max * 100) : 0;
      const bar = el('div', { class: 'funnel__bar' });
      bar.appendChild(el('i', { class: compare ? 'me' : '', style: `width:${w}%` }));
      if (compare) bar.appendChild(el('i', { class: 'med', style: `width:${wc}%` }));
      const lbl = el('b', { text: num(r.value) }); if (w < 14) { lbl.classList.add('is-out'); lbl.style.left = `calc(${w}% + 6px)`; } bar.appendChild(lbl);
      wrap.appendChild(el('div', { class: 'funnel__label', text: r.label }));
      wrap.appendChild(bar);
      const conv = el('div', { class: 'funnel__conv' });
      if (r.conv !== undefined) { conv.appendChild(el('b', { text: r.conv === null ? '-' : pct(r.conv, 0) })); if (compare) conv.appendChild(el('span', { text: ' · ' + (r.convCmp === null || r.convCmp === undefined ? '-' : pct(r.convCmp, 0)) })); }
      else if (compare && r.cmp !== undefined) conv.appendChild(el('span', { html: `медиана <b>${num(r.cmp)}</b>` }));
      wrap.appendChild(conv);
    });
    return wrap;
  }

  // столбики по дням: series [{date, clicks, leads}], key - что столбиками, line - что линией (делится на lineDiv)
  function dayChart(series, { bars = 'leads', line = 'clicks', lineDiv = 10, barLabel = 'лиды', lineLabel = 'клики' } = {}) {
    const W = 640, H = 160, L = 40, T = 12, B = 20, n = series.length || 1;
    const maxB = Math.max(1, ...series.map(s => s[bars] || 0), ...(line ? series.map(s => (s[line] || 0) / lineDiv) : []));
    const top = Math.ceil(maxB / 3) * 3 || 3;
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const bw = Math.max(3, Math.min(14, (W - L) / n * 0.6)), step = (W - L) / n;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-label', 'по дням');
    const g = (cls) => { const e = document.createElementNS('http://www.w3.org/2000/svg', 'g'); e.setAttribute('class', cls); svg.appendChild(e); return e; };
    const grid = g('grid'), axis = g('axis'), barsG = g('bars');
    for (let i = 0; i <= 3; i++) { const v = top / 3 * i; const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line'); ln.setAttribute('x1', L); ln.setAttribute('x2', W); ln.setAttribute('y1', y(v)); ln.setAttribute('y2', y(v)); grid.appendChild(ln); const tx = document.createElementNS('http://www.w3.org/2000/svg', 'text'); tx.setAttribute('x', 0); tx.setAttribute('y', y(v) + 4); tx.textContent = Math.round(v); axis.appendChild(tx); }
    const wrap = el('div', { class: 'chart' });
    const tip = el('div', { class: 'tooltip', hidden: true });
    series.forEach((s, i) => {
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const v = s[bars] || 0; const x0 = L + step * i + (step - bw) / 2;
      r.setAttribute('class', 'bar' + (i === n - 1 ? ' is-dim' : '')); r.setAttribute('x', x0); r.setAttribute('y', y(v)); r.setAttribute('width', bw); r.setAttribute('height', Math.max(0, y(0) - y(v)));
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); hit.setAttribute('x', L + step * i); hit.setAttribute('y', T); hit.setAttribute('width', step); hit.setAttribute('height', H - T - B); hit.setAttribute('fill', 'transparent');
      hit.addEventListener('mouseenter', () => { tip.textContent = `${dLocal(s.date)} · ${s[bars] || 0} ${barLabel}${line ? ` · ${s[line] || 0} ${lineLabel}` : ''}`; tip.hidden = false; tip.style.left = `${Math.min(80, (L + step * i) / W * 100)}%`; });
      hit.addEventListener('mouseleave', () => { tip.hidden = true; });
      barsG.appendChild(r); barsG.appendChild(hit);
    });
    if (line) { const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); pl.setAttribute('class', 'line'); pl.setAttribute('points', series.map((s, i) => `${L + step * i + step / 2},${y((s[line] || 0) / lineDiv)}`).join(' ')); svg.appendChild(pl); }
    wrap.appendChild(svg); wrap.appendChild(tip);
    const ax = el('div', { class: 'chart__x' }, [el('span', { text: series[0] ? dLocal(series[0].date) : '' }), el('span', { text: series[Math.floor(n / 2)] ? dLocal(series[Math.floor(n / 2)].date) : '' }), el('span', { text: series[n - 1] ? dLocal(series[n - 1].date) : '' })]);
    return el('div', {}, [wrap, ax]);
  }

  // модалка
  function modal(title, body, actions = []) {
    const close = () => host.remove();
    const host = el('div', { class: 'modal', onclick: (e) => { if (e.target === host) close(); } }, [
      el('div', { class: 'modal__box' }, [
        el('div', { class: 'modal__head' }, [el('h2', { text: title }), el('button', { class: 'btn btn--icon', 'aria-label': 'Закрыть', html: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>', onclick: close })]),
        el('div', { class: 'modal__body' }, body),
        actions.length ? el('div', { class: 'modal__foot' }, actions) : null,
      ]),
    ]);
    document.body.appendChild(host);
    const f = host.querySelector('input, select, textarea'); if (f) f.focus();
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    return { close, host };
  }
  function field(label, input, extra) { const w = el('label', { class: 'field' + (input.tagName === 'SELECT' ? ' field--select' : '') }, [el('span', { class: 'field__label', text: label }), input]); if (input.tagName === 'SELECT') w.appendChild(el('svg', { class: 'caret' })), (w.lastChild.outerHTML = '<svg class="caret" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>'); if (extra) w.appendChild(extra); return w; }
  const input = (attrs = {}) => el('input', { class: 'field__input', ...attrs });
  const select = (options, value, attrs = {}) => { const s = el('select', attrs); for (const [v, t] of options) s.appendChild(el('option', { value: v, text: t, selected: String(v) === String(value) })); return s; };
  const textarea = (attrs = {}) => el('textarea', attrs);

  // навигация: активный пункт + счётчики
  async function nav(role) {
    const me = await api('/auth/me').catch(() => null);
    if (!me) { location.href = BASE + (role === 'agent' ? '/agent/expired.html' : '/admin/login.html'); return null; }
    if (me.role !== role) { location.href = BASE + (me.role === 'agent' ? '/agent/' : '/admin/'); return null; }
    try { const meta = await api('/meta'); Object.assign(CHANNEL, meta.channels); for (const k of Object.keys(LOST)) delete LOST[k]; for (const r of meta.lost_reasons) LOST[r.id] = r.label; } catch { /* останутся значения по умолчанию */ }
    CRM.me = me;
    if (me.admin_role === 'viewer') document.body.classList.add('is-viewer');
    const here = location.pathname.split('/').pop() || 'index.html';
    $$('.rail__nav a').forEach(a => a.classList.toggle('is-active', (a.getAttribute('href') || '').split('?')[0] === here || (here === 'lead.html' && a.getAttribute('href') === 'leads.html')));
    const foot = $('.rail__foot'); if (foot) { foot.innerHTML = ''; foot.appendChild(el('b', { text: me.name + (me.admin_role === 'viewer' ? ' · просмотр' : '') })); foot.appendChild(el('a', { href: '#', text: 'выйти', onclick: async (e) => { e.preventDefault(); await api('/auth/logout', { method: 'POST' }); location.href = BASE + (role === 'agent' ? '/agent/expired.html' : '/admin/login.html'); } })); }
    return me;
  }
  function copy(text) { navigator.clipboard?.writeText(text).then(() => toast('Скопировано')).catch(() => toast('Не удалось скопировать', 'err')); }

  window.CRM = { BASE, $, $$, el, api, STATUS, STATUS_ORDER, LOST, CHANNEL, SOURCE, TYPE, num, usd, pct, x, area, dt, dtFull, ago, dLocal, periodLabel, initials, unitLabel,
    badge, stBadge, stDot, channelBadge, unitBadge, toast, periodControl, qs, funnel, dayChart, modal, field, input, select, textarea, nav, copy };
})();
