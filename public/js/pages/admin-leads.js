(async function () {
  const { $, el, api, num, dt, ago, qs, stDot, channelBadge, unitBadge, STATUS, STATUS_ORDER, CHANNEL, SOURCE, TYPE, toast, modal, field, input, select, textarea, initials } = CRM;
  if (!(await CRM.nav('admin'))) return;
  const content = $('#content'), tools = $('#tools');
  const url = new URL(location.href);
  const f = { status: url.searchParams.get('status') || '', agent_id: url.searchParams.get('agent_id') || '', channel: url.searchParams.get('channel') || '', q: url.searchParams.get('q') || '', source: '', from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '', page: 1 };
  const [agents, channels] = await Promise.all([api('/agents'), api('/channels')]);
  tools.appendChild(el('button', { class: 'btn btn--outlined', text: 'Импорт CSV', onclick: importDialog }));
  tools.appendChild(el('a', { class: 'btn btn--outlined', href: CRM.BASE + '/api/leads/export.csv' + qs(f), text: 'Экспорт CSV' }));
  tools.appendChild(el('button', { class: 'btn btn--primary', text: 'Добавить лид', onclick: () => newLeadDialog() }));

  const panel = el('section', { class: 'panel' });
  const filters = el('div', { class: 'filters' });
  const statusSel = select([['', 'Все статусы'], ['active', 'Активные'], ...STATUS_ORDER.map(s => [s, STATUS[s]])], f.status);
  const agentSel = select([['', 'Все агенты'], ['none', 'Без агента'], ...agents.map(a => [a.id, a.name])], f.agent_id);
  const chSel = select([['', 'Все каналы'], ...channels.channels.map(c => [c.id, c.name])], f.channel);
  const srcSel = select([['', 'Все источники'], ...Object.entries(SOURCE)], f.source);
  const qI = input({ placeholder: 'Имя, телефон, telegram, № квартиры', value: f.q });
  for (const [s, k] of [[statusSel, 'status'], [agentSel, 'agent_id'], [chSel, 'channel'], [srcSel, 'source']]) s.addEventListener('change', () => { f[k] = s.value; f.page = 1; load(); });
  let qt; qI.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { f.q = qI.value.trim(); f.page = 1; load(); }, 300); });
  filters.append(field('Статус', statusSel), field('Агент', agentSel), field('Канал', chSel), field('Источник', srcSel), (() => { const w = field('Поиск', qI); w.classList.add('field--q'); return w; })());
  const body = el('div', { class: 'panel__body panel__body--flush tbl-wrap' }), pager = el('div', { class: 'pager' });
  panel.append(filters, body, pager); content.innerHTML = ''; content.appendChild(panel);

  async function load() {
    const q = { ...f }; if (q.status === 'active') { q.active = 'true'; delete q.status; } if (q.agent_id === 'none') { delete q.agent_id; }
    const d = await api('/leads' + qs(q));
    let items = d.items; if (f.agent_id === 'none') items = items.filter(l => !l.agent);
    $('#sub').textContent = `${num(d.total)} лидов · ` + STATUS_ORDER.map(s => `${STATUS[s].toLowerCase()} ${d.counts_by_status[s] || 0}`).join(' · ');
    const tb = el('tbody');
    for (const l of items) tb.appendChild(el('tr', { class: 'is-clickable' + (l.is_demo ? ' is-demo' : ''), onclick: () => location.href = 'lead.html?id=' + l.id }, [
      el('td', {}, el('a', { class: 'lnk', href: 'lead.html?id=' + l.id, text: l.name })),
      el('td', { class: 'dim', text: l.phone || l.telegram || l.email || '-' }),
      el('td', {}, unitBadge(l.unit) ), el('td', {}, stDot(l.status)),
      el('td', {}, l.agent ? el('span', { class: 'who' }, [el('span', { class: 'avatar', text: initials(l.agent.name) }), l.agent.name]) : el('span', { class: 'muted', text: '-' })),
      el('td', {}, channelBadge(l.channel_first, l.campaign_first)), el('td', { class: 'dim', text: SOURCE[l.source] || l.source }),
      el('td', { class: 'right dim', text: dt(l.created_at, false) }), el('td', { class: 'right dim', text: ago(l.updated_at) }),
    ]));
    body.innerHTML = '';
    if (!items.length) body.appendChild(el('div', { class: 'empty', text: 'Лидов по этим фильтрам нет' }));
    else body.appendChild(el('table', { class: 'tbl' }, [el('thead', {}, el('tr', {}, ['Лид', 'Контакт', 'Квартира', 'Статус', 'Агент', 'Канал', 'Источник', 'Создан', 'Обновлён'].map((h, i) => el('th', { class: i >= 7 ? 'right' : '', text: h })))), tb]));
    pager.innerHTML = ''; const pages = Math.ceil(d.total / d.per_page);
    pager.append(el('span', { text: `Страница ${d.page} из ${pages || 1}` }), el('div', { style: 'display:flex;gap:8px' }, [el('button', { class: 'btn btn--outlined btn--sm', text: 'Назад', disabled: d.page <= 1, onclick: () => { f.page--; load(); } }), el('button', { class: 'btn btn--outlined btn--sm', text: 'Дальше', disabled: d.page >= pages, onclick: () => { f.page++; load(); } })]));
  }

  function newLeadDialog() {
    const nameI = input({ placeholder: 'Имя', required: true }), phoneI = input({ placeholder: '+995 5xx xx xx xx', inputmode: 'tel' }), tgI = input({ placeholder: '@username' }), unitI = input({ placeholder: 'номер, например 1003' });
    const agentS = select([['', 'Не назначен'], ...agents.filter(a => a.is_active).map(a => [a.id, a.name])], ''), chS = select(channels.channels.map(c => [c.id, c.name]), 'direct'), interestS = select([['', '-'], ...Object.entries(TYPE)], ''), commentT = textarea({ placeholder: 'Комментарий' });
    const m = modal('Новый лид', [el('div', { class: 'form-row' }, [field('Имя', nameI), field('Телефон', phoneI)]), el('div', { class: 'form-row' }, [field('Telegram', tgI), field('Квартира', unitI)]), el('div', { class: 'form-row' }, [field('Агент', agentS), field('Канал', chS)]), field('Интерес', interestS), field('Комментарий', commentT)],
      [el('button', { class: 'btn btn--outlined', text: 'Отмена', onclick: () => m.close() }), el('button', { class: 'btn btn--primary', text: 'Создать', onclick: async () => {
        try { const r = await api('/leads/manual', { method: 'POST', body: { name: nameI.value, phone: phoneI.value, telegram: tgI.value, unit_id: unitI.value, agent_id: agentS.value || null, channel_id: chS.value, interest: interestS.value, comment: commentT.value } });
          if (r.duplicate) toast('Такой контакт уже есть - открываю его'); location.href = 'lead.html?id=' + r.lead.id; } catch (e) { toast(e.message, 'err'); } } })]);
  }
  function importDialog() {
    const fileI = el('input', { type: 'file', accept: '.csv,text/csv', class: 'field__input', style: 'padding-top:10px' });
    const res = el('div');
    const m = modal('Импорт лидов из CSV', [
      el('p', { style: 'font:var(--text-body-sm);line-height:20px;color:var(--fg-2)', html: 'Первая строка - заголовки. Колонки (любой порядок): <b>name, phone, telegram, email, unit_number, interest, status, agent_slug, channel, campaign, comment, created_at</b>. Разделитель «,» или «;», кодировка UTF-8. Повторы по телефону за 30 дней пропускаются.' }),
      field('Файл', fileI), res,
      el('a', { class: 'btn btn--text', href: 'data:text/csv;charset=utf-8,' + encodeURIComponent('name,phone,telegram,unit_number,status,agent_slug,channel,campaign,comment,created_at\nИван И.,+995555000099,,1003,contact,nino,meta,sep_sea,пример строки,2026-09-01'), download: 'leads-template.csv', text: 'Скачать шаблон' }),
    ], [el('button', { class: 'btn btn--outlined', text: 'Закрыть', onclick: () => m.close() }), el('button', { class: 'btn btn--primary', text: 'Загрузить', onclick: async () => {
      if (!fileI.files[0]) return toast('Выберите файл', 'err'); const fd = new FormData(); fd.append('file', fileI.files[0]);
      try { const r = await api('/leads/import', { method: 'POST', body: fd }); res.innerHTML = ''; res.appendChild(el('div', { class: 'note-box', html: `Создано <b>${r.created}</b>, пропущено ${r.skipped} из ${r.total}.` + (r.errors.length ? '<br>' + r.errors.slice(0, 10).map(e => `строка ${e.row}: ${e.message}`).join('<br>') : '') })); load(); } catch (e) { toast(e.message, 'err'); } } })]);
  }
  if (url.searchParams.get('new')) newLeadDialog();
  load().catch(e => toast(e.message, 'err'));
})();
