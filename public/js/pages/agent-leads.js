(async function () {
  const { $, el, api, num, dt, ago, qs, stDot, channelBadge, unitBadge, STATUS, STATUS_ORDER, TYPE, toast, modal, field, input, select, textarea } = CRM;
  const me = await CRM.nav('agent'); if (!me) return;
  const content = $('#content'), tools = $('#tools');
  const f = { status: 'active', q: '', page: 1 };
  tools.appendChild(el('button', { class: 'btn btn--primary', text: 'Добавить лид', onclick: newLeadDialog }));
  const seg = el('div', { class: 'seg' }, [['active', 'Активные'], ['', 'Все'], ['lost', 'Потерянные']].map(([v, t]) => el('button', { class: f.status === v ? 'is-active' : '', text: t, onclick: () => { f.status = v; f.page = 1; CRM.$$('button', seg).forEach((b, i) => b.classList.toggle('is-active', ['active', '', 'lost'][i] === v)); load(); } })));
  const qI = input({ placeholder: 'Имя, телефон, № квартиры' }); let qt; qI.oninput = () => { clearTimeout(qt); qt = setTimeout(() => { f.q = qI.value.trim(); f.page = 1; load(); }, 300); };
  const panel = el('section', { class: 'panel' }, [el('div', { class: 'filters' }, [seg, (() => { const w = field('Поиск', qI); w.classList.add('field--q'); return w; })()])]);
  const body = el('div', { class: 'panel__body panel__body--flush tbl-wrap' }), pager = el('div', { class: 'pager' }); panel.append(body, pager); content.innerHTML = ''; content.appendChild(panel);

  async function load() {
    const q = { q: f.q, page: f.page }; if (f.status === 'active') q.active = 'true'; else if (f.status) q.status = f.status;
    const d = await api('/agent/leads' + qs(q));
    $('#sub').textContent = `${d.total} лидов · ` + STATUS_ORDER.map(s => `${STATUS[s].toLowerCase()} ${d.counts_by_status[s] || 0}`).join(' · ');
    const tb = el('tbody');
    for (const l of d.items) tb.appendChild(el('tr', { class: 'is-clickable', onclick: () => location.href = 'lead.html?id=' + l.id }, [el('td', {}, el('a', { class: 'lnk', href: 'lead.html?id=' + l.id, text: l.name })), el('td', { class: 'dim', text: l.phone || l.telegram || '-' }), el('td', {}, unitBadge(l.unit)), el('td', {}, stDot(l.status)), el('td', {}, channelBadge(l.channel_first, l.campaign_first)), el('td', { class: 'right dim', text: dt(l.created_at, false) }), el('td', { class: 'right dim', text: ago(l.updated_at) })]));
    body.innerHTML = ''; body.appendChild(d.items.length ? el('table', { class: 'tbl' }, [el('thead', {}, el('tr', {}, ['Лид', 'Контакт', 'Квартира', 'Статус', 'Канал', 'Создан', 'Обновлён'].map((h, i) => el('th', { class: i >= 5 ? 'right' : '', text: h })))), tb]) : el('div', { class: 'empty', text: 'Лидов нет' }));
    const pages = Math.ceil(d.total / d.per_page); pager.innerHTML = ''; pager.append(el('span', { text: `Страница ${d.page} из ${pages || 1}` }), el('div', { style: 'display:flex;gap:8px' }, [el('button', { class: 'btn btn--outlined btn--sm', text: 'Назад', disabled: d.page <= 1, onclick: () => { f.page--; load(); } }), el('button', { class: 'btn btn--outlined btn--sm', text: 'Дальше', disabled: d.page >= pages, onclick: () => { f.page++; load(); } })]));
  }
  function newLeadDialog() {
    const nameI = input({ placeholder: 'Имя' }), phoneI = input({ placeholder: '+995 5xx xx xx xx', inputmode: 'tel' }), tgI = input({ placeholder: '@username' }), unitI = input({ placeholder: 'номер квартиры' }), interestS = select([['', '-'], ...Object.entries(TYPE)], ''), commentT = textarea({ placeholder: 'Комментарий' });
    const m = modal('Новый лид', [el('div', { class: 'form-row' }, [field('Имя', nameI), field('Телефон', phoneI)]), el('div', { class: 'form-row' }, [field('Telegram', tgI), field('Квартира', unitI)]), field('Интерес', interestS), field('Комментарий', commentT), el('p', { class: 'muted', style: 'font:var(--text-caption)', text: 'Лид будет закреплён за вами, канал - «Агенты».' })],
      [el('button', { class: 'btn btn--outlined', text: 'Отмена', onclick: () => m.close() }), el('button', { class: 'btn btn--primary', text: 'Создать', onclick: async () => { try { const r = await api('/agent/leads', { method: 'POST', body: { name: nameI.value, phone: phoneI.value, telegram: tgI.value, unit_id: unitI.value, interest: interestS.value, comment: commentT.value } }); if (r.duplicate) toast('Такой контакт уже есть'); location.href = 'lead.html?id=' + r.lead.id; } catch (e) { toast(e.message, 'err'); } } })]);
  }
  if (new URLSearchParams(location.search).get('new')) newLeadDialog();
  load().catch(e => toast(e.message, 'err'));
})();
