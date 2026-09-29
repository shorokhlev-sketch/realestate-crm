/* Карточка лида - общая для админа и агента (роль определяет префикс API и права). */
(async function () {
  const { $, el, api, num, usd, dt, dtFull, ago, area, STATUS, STATUS_ORDER, LOST, CHANNEL, SOURCE, TYPE, toast, modal, field, input, select, textarea, initials, stBadge, channelBadge, badge } = CRM;
  const isAgent = location.pathname.includes('/agent/');
  const me = await CRM.nav(isAgent ? 'agent' : 'admin'); if (!me) return;
  const P = isAgent ? '/agent/leads' : '/leads';
  const id = Number(new URLSearchParams(location.search).get('id'));
  const content = $('#content'), tools = $('#tools'), title = $('#title');
  let agents = isAgent ? [] : await api('/agents');

  async function load() {
    let d; try { d = await api(`${P}/${id}`); } catch (e) { content.innerHTML = ''; content.appendChild(el('div', { class: 'empty', text: e.message })); return; }
    const l = d.lead, u = d.unit;
    document.title = `${l.name} · Sales CRM`;
    title.innerHTML = ''; title.append(el('div', { class: 'crumbs' }, [el('a', { href: 'leads.html', text: 'Лиды' }), el('span', { text: '/' }), el('span', { text: '#' + l.id })]),
      el('h1', {}, [l.name + ' ', stBadge(l.status)]), el('p', { class: 'sub', text: `создан ${dtFull(l.created_at)} · ${SOURCE[l.source] || l.source} · в статусе «${STATUS[l.status]}» ${ago(l.status_since)}` }));
    tools.innerHTML = '';
    if (l.phone) tools.appendChild(el('a', { class: 'btn btn--outlined', href: 'tel:' + l.phone, html: '<svg class="icon" viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>Позвонить' }));
    if (l.telegram) tools.appendChild(el('a', { class: 'btn btn--outlined', href: 'https://t.me/' + l.telegram.replace('@', ''), target: '_blank', rel: 'noopener', html: '<svg class="icon" viewBox="0 0 24 24"><path d="M21 4L3 11l6 2 2 6 3-4 5 3z"/></svg>Telegram' }));
    if (l.phone) tools.appendChild(el('a', { class: 'btn btn--outlined', href: 'https://wa.me/' + l.phone.replace('+', ''), target: '_blank', rel: 'noopener', text: 'WhatsApp' }));
    const nextIdx = STATUS_ORDER.indexOf(l.status) + 1, next = l.status !== 'lost' && nextIdx < 6 ? STATUS_ORDER[nextIdx] : null;
    if (next && !(isAgent && ['contract', 'paid'].includes(next))) tools.appendChild(el('button', { class: 'btn btn--primary', text: STATUS[next], onclick: () => setStatus(l, next) }));

    // степпер
    const stepper = el('div', { class: 'stepper', role: 'group' });
    const cur = STATUS_ORDER.indexOf(l.status);
    STATUS_ORDER.slice(0, 6).forEach((s, i) => {
      const cls = l.status === 'lost' ? '' : i < cur ? 'is-done' : i === cur ? `is-current st--${s}` : i === cur + 1 ? 'is-next' : '';
      const locked = isAgent && ['contract', 'paid'].includes(s);
      stepper.appendChild(el('button', { class: cls, title: locked ? 'Подтверждает администратор' : '', onclick: () => { if (s !== l.status && !locked) setStatus(l, s); } }, [el('span', { class: 'n', text: String(i + 1) }), el('span', { class: 't', text: STATUS[s] })]));
    });
    stepper.appendChild(el('button', { class: 'is-lost' + (l.status === 'lost' ? ' is-current' : ''), style: l.status === 'lost' ? 'background:var(--bg-disabled);color:var(--fg-0)' : '', text: l.status === 'lost' ? `Потерян: ${LOST[l.lost_reason] || ''}` : 'Потерян...', onclick: () => { if (l.status !== 'lost') setStatus(l, 'lost'); } }));

    // контакт
    const dl = (pairs) => el('dl', { class: 'dl' }, pairs.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', {}, v)]));
    const contact = el('section', { class: 'panel' }, [
      el('div', { class: 'panel__head' }, [el('h2', { text: 'Контакт' }), el('div', { class: 'tools' }, el('button', { class: 'btn btn--text', text: 'Изменить', onclick: () => editDialog(l) }))]),
      el('div', { class: 'panel__body' }, dl([
        ['Телефон', l.phone ? el('a', { href: 'tel:' + l.phone, text: l.phone }) : el('span', { class: 'muted', text: '-' })],
        ['Telegram', l.telegram ? el('a', { href: 'https://t.me/' + l.telegram.replace('@', ''), target: '_blank', text: l.telegram }) : el('span', { class: 'muted', text: '-' })],
        ['E-mail', l.email || el('span', { class: 'muted', text: '-' })],
        ['Интерес', l.interest ? (TYPE[l.interest] || l.interest) : el('span', { class: 'muted', text: '-' })],
        ['Агент', l.agent ? [el('span', { class: 'who' }, [el('span', { class: 'avatar', text: initials(l.agent.name) }), l.agent.name]), badge('badge--muted', { cookie: 'по cookie', manual: 'вручную', csv: 'импорт' }[l.agent_source] || '')] : el('span', { class: 'muted', text: 'не назначен' })],
        ['Источник', [SOURCE[l.source] || l.source, l.page ? el('span', { class: 'muted', text: ' · ' + l.page }) : null]],
        ['Комментарий', l.comment || el('span', { class: 'muted', text: '-' })],
      ])),
    ]);
    // квартира
    const unitPanel = el('section', { class: 'panel' }, [
      el('div', { class: 'panel__head' }, [el('h2', { text: 'Квартира' }), el('div', { class: 'tools' }, [u ? badge('badge--unit-' + u.status, { available: 'свободна', reserved: 'бронь', sold: 'продана' }[u.status]) : null, el('button', { class: 'btn btn--text', text: u ? 'Сменить' : 'Указать', onclick: () => unitDialog(l) })])]),
      el('div', { class: 'panel__body' }, u ? [
        el('div', { class: 'unit-card' }, [
          el('div', { class: 'unit-card__plan' }, el('svg', { })),
          el('div', {}, [el('div', { class: 'unit-card__title' }, [badge('badge--id', '# ' + u.number), ' ' + (TYPE[u.type] || u.type) + ' · ' + area(u.total)]),
            el('div', { class: 'unit-card__meta' }, [el('span', { text: `${u.floor} этаж` }), el('span', { text: '|' }), el('span', { text: `жилая ${String(u.living).replace('.', ',')} + балкон ${String(u.balcony).replace('.', ',')}` }), el('span', { text: '|' }), el('span', { text: { city: 'вид на город', sea: 'вид на море', park: 'вид на парк' }[u.view] || u.view || '' })]),
            el('div', { class: 'unit-card__price' }, [usd(u.price), el('span', { class: 'muted', style: 'font:var(--text-price)', text: u.price_per_sqm ? ` · $${num(u.price_per_sqm)} / м²` : '' })])]),
        ]),
        u.state_lead_id && u.state_lead_id !== l.id ? el('div', { class: 'note-box', style: 'margin-top:16px;border-left-color:var(--status-reserved)' }, [`Квартира ${u.status === 'sold' ? 'продана' : 'забронирована'} по другому лиду `, el('a', { href: 'lead.html?id=' + u.state_lead_id, style: 'color:var(--brand)', text: '#' + u.state_lead_id })]) :
        u.state_changed_at && u.state_lead_id === l.id ? el('div', { class: 'note-box', style: 'margin-top:16px', text: `На сайте помечена «${u.status === 'sold' ? 'продана' : 'бронь'}» ${dtFull(u.state_changed_at)} - по статусу этого лида.` }) : null,
      ] : el('div', { class: 'empty', text: 'Квартира не указана. Для брони она обязательна.' })),
    ]);
    if (u) unitPanel.querySelector('.unit-card__plan').innerHTML = '<svg viewBox="0 0 72 56" fill="none" stroke="#182E46" stroke-width="1.4"><rect x="2" y="2" width="68" height="52" fill="#FFFFFF"/><path d="M2 20h30M32 2v30M32 32h38M50 32v22"/><rect x="6" y="6" width="22" height="10" fill="#93B7C9" stroke="none"/><rect x="36" y="6" width="30" height="22" fill="#B9C6CF" stroke="none"/></svg>';
    // сделка
    const dealPanel = el('section', { class: 'panel' }, [
      el('div', { class: 'panel__head' }, [el('h2', { text: 'Сделка' }), isAgent ? null : el('div', { class: 'tools' }, el('button', { class: 'btn btn--text', text: 'Изменить сумму', onclick: () => dealDialog(l) }))]),
      el('div', { class: 'panel__body' }, dl([
        ['Сумма', l.deal_amount ? el('span', { style: 'font:var(--text-kpi)', text: `${num(l.deal_amount)} ${l.deal_currency}${l.deal_currency !== 'USD' ? ' ≈ ' + usd(l.deal_amount_usd) : ''}` }) : el('span', { class: 'muted', text: 'не указана (подставится цена квартиры при брони)' })],
        ['Причина потери', l.status === 'lost' ? [LOST[l.lost_reason] || l.lost_reason, l.lost_note ? el('span', { class: 'muted', text: ' · ' + l.lost_note }) : null] : el('span', { class: 'muted', text: '-' })],
        ...(isAgent ? [] : [['Постбэки', d.postbacks.length ? d.postbacks.map(p => badge('badge--outline', `${{ meta_capi: 'Meta CAPI', google_offline: 'Google', telegram_ads: 'TG Ads' }[p.provider] || p.provider} · ${p.event} · ${{ queued: 'в очереди', sent: 'отправлен', failed: 'ошибка', skipped: 'выключен' }[p.status]}`)) : el('span', { class: 'muted', text: 'нет (лид не из рекламного канала)' })],
          ['Уведомления', d.notifications.length ? d.notifications.map(n => badge(n.status === 'sent' ? 'badge--outline' : 'badge--muted', `${n.recipient === 'admin' ? 'админ' : 'агент'}: ${{ sent: 'отправлено', failed: 'ошибка', no_chat_id: 'чат не привязан' }[n.status]}`)) : el('span', { class: 'muted', text: '-' })]]),
      ])),
    ]);
    // атрибуция
    const a = d.attribution, row = (k, f, s) => el('tr', {}, [el('td', { class: 'dim', text: k }), el('td', {}, f ?? el('span', { class: 'muted', text: '-' })), el('td', {}, s ?? el('span', { class: 'muted', text: '-' }))]);
    const attr = el('section', { class: 'panel' }, [
      el('div', { class: 'panel__head' }, [el('h2', { text: 'Откуда пришёл' }), el('span', { class: 'hint', text: 'первое и последнее касание' })]),
      el('div', { class: 'panel__body panel__body--flush tbl-wrap' }, el('table', { class: 'tbl' }, [
        el('thead', {}, el('tr', {}, [el('th'), el('th', { text: 'Первое' + (a.first ? ' · ' + dt(a.first.ts) : '') }), el('th', { text: 'Последнее' + (a.last ? ' · ' + dt(a.last.ts) : '') })])),
        el('tbody', {}, [
          row('Канал', channelBadge(l.channel_first), channelBadge(l.channel_last)),
          row('Агент', a.first?.agent_slug ? `${a.first.agent_slug} (?a=${a.first.agent_slug})` : null, a.last?.agent_slug || (l.agent_source === 'cookie' ? 'cookie' : null)),
          row('utm_source / medium', a.first?.utm_source ? `${a.first.utm_source} / ${a.first.utm_medium || '-'}` : null, a.last?.utm_source ? `${a.last.utm_source} / ${a.last.utm_medium || '-'}` : null),
          row('utm_campaign', a.first?.utm_campaign, a.last?.utm_campaign), row('utm_content', a.first?.utm_content, a.last?.utm_content), row('click id', a.first?.click_id, a.last?.click_id),
          row('Referrer', a.first?.referrer, a.last?.referrer), row('Страница входа', a.first?.landing_path, a.last?.landing_path),
        ]),
      ])),
    ]);
    // лента
    const items = [];
    for (const h of d.history) items.push({ ts: h.ts, kind: 'status', status: h.to, actor: h.actor_name, text: h.note, sys: h.reason ? `Причина: ${LOST[h.reason] || h.reason}` : null });
    for (const n of d.notes) items.push({ ts: n.ts, kind: n.kind, actor: n.actor_name, text: n.text });
    for (const e of d.events) items.push({ ts: e.ts, kind: 'event', actor: 'посетитель', text: { unit_view: `Просмотр # ${e.unit_number || e.unit_id}`, form_open: 'Открыл форму', favorite: `В избранное # ${e.unit_number}`, pdf: `PDF # ${e.unit_number}` }[e.type] || e.type });
    items.sort((x, y) => y.ts.localeCompare(x.ts));
    const noteT = textarea({ placeholder: 'Заметка: о чём договорились, что прислать...' });
    const feed = el('section', { class: 'panel' }, [
      el('div', { class: 'panel__head' }, [el('h2', { text: 'Лента' }), el('span', { class: 'hint', text: 'статусы, заметки, действия на сайте' })]),
      el('div', { class: 'panel__body' }, [
        el('div', { class: 'field', style: 'margin-bottom:16px' }, [noteT, el('div', { style: 'display:flex;gap:10px;justify-content:flex-end;margin-top:8px' }, el('button', { class: 'btn btn--primary btn--sm', text: 'Добавить', onclick: async () => { if (!noteT.value.trim()) return; try { await api(`${P}/${id}/notes`, { method: 'POST', body: { text: noteT.value } }); load(); } catch (e) { toast(e.message, 'err'); } } }))]),
        el('div', { class: 'timeline' }, items.map(it => el('div', { class: 'tl' + (it.kind === 'status' ? ` st--${it.status}` : '') }, [
          el('div', { class: 'tl__dot' + (it.kind !== 'status' ? ' is-note' : '') }),
          el('div', {}, [el('div', { class: 'tl__head' }, [el('b', { text: it.kind === 'status' ? STATUS[it.status] : it.kind === 'duplicate' ? 'Повторная заявка' : it.kind === 'system' ? 'Система' : it.kind === 'event' ? 'На сайте' : 'Заметка' }), el('span', { class: 'muted', text: it.actor || '' }), el('time', { text: dt(it.ts) })]),
            it.text ? el('div', { class: 'tl__text' + (['system', 'event', 'duplicate'].includes(it.kind) ? ' is-sys' : ''), text: it.text }) : null, it.sys ? el('div', { class: 'tl__text is-sys', text: it.sys }) : null]),
        ]))),
      ]),
    ]);
    content.innerHTML = '';
    content.append(stepper, el('div', { class: 'grid grid--2-3' }, [el('div', { class: 'stack' }, [contact, unitPanel, dealPanel]), el('div', { class: 'stack' }, [attr, feed])]));
  }

  async function setStatus(l, status) {
    const body = { status };
    const fields = [];
    let unitI, amountI, reasonS, noteT = textarea({ placeholder: 'Заметка' });
    if (status === 'lost') { reasonS = select(Object.entries(LOST), Object.keys(LOST)[0]); fields.push(field('Причина', reasonS)); }
    if (['booking', 'contract', 'paid'].includes(status)) { unitI = input({ placeholder: 'номер квартиры', value: l.unit?.number || '' }); amountI = input({ placeholder: 'USD', inputmode: 'decimal', value: l.deal_amount || '' }); fields.push(el('div', { class: 'form-row' }, [field('Квартира', unitI), field('Сумма сделки, USD', amountI)])); }
    fields.push(field('Заметка', noteT));
    const m = modal(`${l.name} -> ${STATUS[status]}`, fields, [el('button', { class: 'btn btn--outlined', text: 'Отмена', onclick: () => m.close() }), el('button', { class: 'btn btn--primary', text: 'Подтвердить', onclick: async () => {
      try {
        if (unitI && unitI.value && unitI.value !== l.unit?.number) await api(`${P}/${id}`, { method: 'PATCH', body: { unit_id: unitI.value } });
        if (reasonS) { body.lost_reason = reasonS.value; body.lost_note = noteT.value; } else body.note = noteT.value;
        if (amountI && amountI.value) { body.deal_amount = amountI.value; body.deal_currency = 'USD'; }
        await api(`${P}/${id}/status`, { method: 'POST', body }); m.close(); toast(`Статус: ${STATUS[status]}`); load();
      } catch (e) { toast(e.message + (e.data?.lead_id ? ` (#${e.data.lead_id})` : ''), 'err'); }
    } })]);
  }
  function editDialog(l) {
    const nameI = input({ value: l.name }), phoneI = input({ value: l.phone || '' }), tgI = input({ value: l.telegram || '' }), emailI = input({ value: l.email || '' }), interestS = select([['', '-'], ...Object.entries(TYPE)], l.interest || ''), commentT = textarea({}); commentT.value = l.comment || '';
    const agentS = isAgent ? null : select([['', 'Не назначен'], ...agents.map(a => [a.id, a.name])], l.agent?.id || '');
    const chS = isAgent ? null : select(Object.entries(CHANNEL), l.channel_first);
    const fields = isAgent ? [field('Telegram', tgI), field('E-mail', emailI), field('Интерес', interestS), field('Комментарий', commentT)]
      : [el('div', { class: 'form-row' }, [field('Имя', nameI), field('Телефон', phoneI)]), el('div', { class: 'form-row' }, [field('Telegram', tgI), field('E-mail', emailI)]), el('div', { class: 'form-row' }, [field('Агент', agentS), field('Канал (первое касание)', chS)]), field('Интерес', interestS), field('Комментарий', commentT)];
    const m = modal('Контакт', fields, [el('button', { class: 'btn btn--outlined', text: 'Отмена', onclick: () => m.close() }), el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: async () => {
      const body = isAgent ? { telegram: tgI.value, email: emailI.value, interest: interestS.value, comment: commentT.value } : { name: nameI.value, phone: phoneI.value, telegram: tgI.value, email: emailI.value, agent_id: agentS.value || null, channel_first_id: chS.value, interest: interestS.value, comment: commentT.value };
      try { await api(`${P}/${id}`, { method: 'PATCH', body }); m.close(); load(); } catch (e) { toast(e.message, 'err'); } } })]);
  }
  function unitDialog(l) {
    const unitI = input({ placeholder: 'номер, например 1003', value: l.unit?.number || '' });
    const m = modal('Квартира', [field('Номер квартиры', unitI), el('p', { class: 'muted', style: 'font:var(--text-caption)', text: 'Номер из подбора на сайте (этаж + позиция, например 1003 = 10 этаж, 3-я квартира). Пустое поле - снять квартиру с лида.' })], [el('button', { class: 'btn btn--outlined', text: 'Отмена', onclick: () => m.close() }), el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: async () => { try { await api(`${P}/${id}`, { method: 'PATCH', body: { unit_id: unitI.value || null } }); m.close(); load(); } catch (e) { toast(e.message, 'err'); } } })]);
  }
  function dealDialog(l) {
    const amountI = input({ value: l.deal_amount || '', inputmode: 'decimal' }), curS = select([['USD', 'USD'], ['GEL', 'GEL'], ['EUR', 'EUR']], l.deal_currency || 'USD');
    const m = modal('Сумма сделки', [el('div', { class: 'form-row' }, [field('Сумма', amountI), field('Валюта', curS)])], [el('button', { class: 'btn btn--outlined', text: 'Отмена', onclick: () => m.close() }), el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: async () => { try { await api(`${P}/${id}`, { method: 'PATCH', body: { deal_amount: amountI.value, deal_currency: curS.value } }); m.close(); load(); } catch (e) { toast(e.message, 'err'); } } })]);
  }
  load();
})();
