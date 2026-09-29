(async function () {
  const { $, el, api, num, usd, pct, periodControl, periodLabel, funnel, dayChart, qs, toast, modal, field, input, initials, copy } = CRM;
  if (!(await CRM.nav('admin'))) return;
  const content = $('#content'), tools = $('#tools');
  const url = new URL(location.href);
  const pc = periodControl(load); tools.appendChild(pc.node);
  tools.appendChild(el('button', { class: 'btn btn--primary', text: 'Добавить агента', onclick: () => agentDialog() }));

  async function load() {
    const p = pc.value();
    const [rep, agents] = await Promise.all([api('/stats/agents' + qs(p)), api('/agents')]);
    const byId = Object.fromEntries(agents.map(a => [a.id, a]));
    $('#sub').textContent = `${periodLabel(rep.period)} · ${agents.filter(a => a.is_active).length} активных · рейтинг по сделкам, броням, показам`;
    const m = rep.team_median, mc = rep.team_median_conv;
    content.innerHTML = '';
    const head = el('tr', {}, ['#', 'Агент', 'Клики', 'Лиды', 'CR', 'Показы', '%', 'Брони', '%', 'Сделки', '%', 'Выручка', ''].map((h, i) => el('th', { class: i >= 2 ? 'right' + (['CR', '%'].includes(h) ? ' dim' : '') : '', text: h })));
    const cmp = (v, med) => el('td', { class: 'right pct' + (v === null ? '' : v >= (med || 0) ? ' is-good' : ' is-bad'), text: pct(v, 0) });
    const tb = el('tbody');
    rep.rows.forEach((r, i) => { const a = byId[r.agent.id] || {}; tb.appendChild(el('tr', { class: 'is-clickable' + (a.is_demo ? ' is-demo' : '') + (r.agent.is_active ? '' : ' dim'), onclick: (e) => { if (e.target.closest('button,a')) return; openAgent(r.agent.id); } }, [
      el('td', { class: 'dim', text: String(i + 1) }),
      el('td', {}, el('span', { class: 'who' }, [el('span', { class: 'avatar', text: initials(r.agent.name) }), el('span', {}, [el('a', { class: 'lnk', href: '?id=' + r.agent.id, text: r.agent.name, onclick: (e) => { e.preventDefault(); openAgent(r.agent.id); } }), el('small', { text: (r.agent.is_active ? '' : 'неактивен · ') + '/a/' + r.agent.slug + (a.has_telegram_chat ? ' · TG привязан' : '') })])])),
      el('td', { class: 'right', text: num(r.clicks) }), el('td', { class: 'right strong', text: num(r.leads) }), cmp(r.conv.click_lead, mc.click_lead),
      el('td', { class: 'right', text: num(r.showings) }), cmp(r.conv.lead_showing, mc.lead_showing), el('td', { class: 'right strong', text: num(r.bookings) }), cmp(r.conv.showing_booking, mc.showing_booking),
      el('td', { class: 'right strong', text: num(r.deals) }), cmp(r.conv.booking_deal, mc.booking_deal), el('td', { class: 'right', text: usd(r.revenue_usd) }),
      el('td', { class: 'right' }, el('button', { class: 'btn btn--text', text: 'ссылки', onclick: () => linksDialog(a) })),
    ])); });
    tb.appendChild(el('tr', { class: 'is-total' }, [el('td'), el('td', { text: 'Медиана команды' }), el('td', { class: 'right', text: num(m.clicks) }), el('td', { class: 'right', text: num(m.leads) }), el('td', { class: 'right pct', text: pct(mc.click_lead, 0) }), el('td', { class: 'right', text: num(m.showings) }), el('td', { class: 'right pct', text: pct(mc.lead_showing, 0) }), el('td', { class: 'right', text: num(m.bookings) }), el('td', { class: 'right pct', text: pct(mc.showing_booking, 0) }), el('td', { class: 'right', text: num(m.deals) }), el('td', { class: 'right pct', text: pct(mc.booking_deal, 0) }), el('td'), el('td')]));
    content.appendChild(el('section', { class: 'panel' }, [
      el('div', { class: 'panel__head' }, [el('h2', { text: 'Рейтинг агентов' }), el('span', { class: 'hint', text: 'клики -> лиды -> показы -> брони -> сделки; % - конверсия шага, зелёный ≥ медианы' })]),
      el('div', { class: 'panel__body panel__body--flush tbl-wrap' }, el('table', { class: 'tbl' }, [el('thead', {}, head), tb])),
      rep.unassigned ? el('div', { class: 'pager', text: `Без агента: ${rep.unassigned.leads} лидов, ${rep.unassigned.clicks} кликов за период` }) : null,
    ]));
    const detail = el('div', { id: 'agent-detail' }); content.appendChild(detail);
    const sel = Number(url.searchParams.get('id')); if (sel && byId[sel]) renderAgent(sel, byId[sel], p);
  }
  function openAgent(id) { url.searchParams.set('id', id); history.replaceState(null, '', url); load(); document.getElementById('agent-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  async function renderAgent(id, a, p) {
    const d = await api(`/agents/${id}/stats` + qs(p));
    const host = $('#agent-detail'); host.innerHTML = '';
    const me = d.me || { clicks: 0, leads: 0, showings: 0, bookings: 0, deals: 0, revenue_usd: 0, conv: {} }, m = d.team_median, mc = d.team_median_conv;
    const rows = [{ label: 'Клики', value: me.clicks, cmp: m.clicks }, { label: 'Лиды', value: me.leads, cmp: m.leads, conv: me.conv.click_lead, convCmp: mc.click_lead }, { label: 'Показы', value: me.showings, cmp: m.showings, conv: me.conv.lead_showing, convCmp: mc.lead_showing }, { label: 'Брони', value: me.bookings, cmp: m.bookings, conv: me.conv.showing_booking, convCmp: mc.showing_booking }, { label: 'Сделки', value: me.deals, cmp: m.deals, conv: me.conv.booking_deal, convCmp: mc.booking_deal }];
    host.appendChild(el('section', { class: 'panel' }, [
      el('div', { class: 'panel__head' }, [el('span', { class: 'avatar', text: initials(a.name) }), el('h2', { text: a.name }), el('span', { class: 'hint', text: `${d.rank.position}-е место из ${d.rank.of} · ${a.phone || ''} ${a.telegram || ''}` }),
        el('div', { class: 'tools' }, [el('a', { class: 'btn btn--outlined btn--sm', href: 'leads.html?agent_id=' + id, text: 'Лиды агента' }), el('button', { class: 'btn btn--outlined btn--sm', text: 'Ссылки и вход', onclick: () => linksDialog(a) }), el('button', { class: 'btn btn--outlined btn--sm', text: 'Изменить', onclick: () => agentDialog(a) }), el('button', { class: 'btn btn--icon', 'aria-label': 'Закрыть', html: '<svg class="icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>', onclick: () => { url.searchParams.delete('id'); history.replaceState(null, '', url); host.innerHTML = ''; } })])]),
      el('div', { class: 'panel__body grid grid--2' }, [
        el('div', {}, [el('div', { class: 'legend', style: 'margin-bottom:12px' }, [el('span', { html: '<i></i>агент' }), el('span', { html: '<i class="med"></i>медиана команды' })]), funnel(rows, { compare: true })]),
        el('div', {}, [el('div', { class: 'muted', style: 'font:var(--text-caption);margin-bottom:8px', text: 'Клики по ссылке агента по дням' }), dayChart(d.series, { bars: 'clicks', line: null, barLabel: 'кликов' })]),
      ]),
    ]));
  }
  function agentDialog(a) {
    const nameI = input({ value: a?.name || '', placeholder: 'Имя Фамилия' }), slugI = input({ value: a?.slug || '', placeholder: 'латиницей, пусто = из имени' }), phoneI = input({ value: a?.phone || '' }), tgI = input({ value: a?.telegram || '', placeholder: '@username' }), emailI = input({ value: a?.email || '', placeholder: 'для e-mail уведомлений' });
    const activeC = el('label', { class: 'switch' }, [el('input', { type: 'checkbox', checked: a ? a.is_active : true }), el('span', { text: 'Активен (ссылка работает, лиды назначаются)' })]);
    const m = modal(a ? 'Агент' : 'Новый агент', [el('div', { class: 'form-row' }, [field('Имя', nameI), field('Slug ссылки', slugI)]), el('div', { class: 'form-row' }, [field('Телефон', phoneI), field('Telegram', tgI)]), field('E-mail', emailI), a ? activeC : null],
      [el('button', { class: 'btn btn--outlined', text: 'Отмена', onclick: () => m.close() }), el('button', { class: 'btn btn--primary', text: a ? 'Сохранить' : 'Создать', onclick: async () => {
        try {
          const body = { name: nameI.value, slug: slugI.value, phone: phoneI.value, telegram: tgI.value, email: emailI.value };
          if (a) { body.is_active = activeC.querySelector('input').checked; await api(`/agents/${a.id}`, { method: 'PATCH', body }); m.close(); load(); }
          else { const r = await api('/agents', { method: 'POST', body }); m.close(); toast('Агент создан'); url.searchParams.set('id', r.agent.id); history.replaceState(null, '', url); await load(); linksDialog({ ...r.agent, links: r.links }, r.magic_link); }
        } catch (e) { toast(e.message, 'err'); } } })]);
  }
  async function linksDialog(a, magic) {
    const linkbox = (label, v) => el('div', { class: 'field' }, [el('span', { class: 'field__label', text: label }), el('div', { class: 'linkbox' }, [el('code', { text: v }), el('button', { class: 'btn', text: 'Копировать', onclick: () => copy(v) })])]);
    const magicBox = el('div');
    const renderMagic = (ml) => { magicBox.innerHTML = ''; magicBox.appendChild(linkbox('Ссылка для входа в кабинет (7 дней, без пароля) - отправьте агенту в Telegram', ml.url)); };
    if (magic) renderMagic(magic);
    const tgBox = el('div');
    const m = modal(`${a.name} - ссылки`, [
      linkbox('Короткая ссылка (сообщения, сторис)', a.links.short), linkbox('Ссылка на сайт с меткой агента (для рекламы: добавьте &utm_source=...)', a.links.site),
      magicBox, el('div', { style: 'display:flex;gap:10px' }, [el('button', { class: 'btn btn--outlined btn--sm', text: magic ? 'Выпустить новую ссылку входа' : 'Выпустить ссылку входа', onclick: async () => { try { renderMagic(await api(`/agents/${a.id}/magic-link`, { method: 'POST' })); toast('Старые ссылки входа отозваны'); } catch (e) { toast(e.message, 'err'); } } }),
        el('button', { class: 'btn btn--outlined btn--sm', text: a.has_telegram_chat ? 'Telegram привязан · перепривязать' : 'Привязать Telegram', onclick: async () => { const r = await api(`/agents/${a.id}/telegram-code`); tgBox.innerHTML = ''; tgBox.appendChild(el('div', { class: 'note-box' }, [r.bot_enabled ? `Агент пишет боту CRM в Telegram: /start ${r.code}` : 'Бот не настроен: добавьте TG_BOT_TOKEN в .env на сервере.', el('div', { class: 'code-box', style: 'margin-top:8px', text: r.code })])); } })]),
      tgBox,
    ], [el('button', { class: 'btn btn--primary', text: 'Готово', onclick: () => m.close() })]);
  }
  load().catch(e => toast(e.message, 'err'));
})();
