(async function () {
  const { $, el, api, num, usd, pct, periodControl, periodLabel, funnel, dayChart, qs, toast, copy, stDot, channelBadge, unitBadge, ago } = CRM;
  const me = await CRM.nav('agent'); if (!me) return;
  const content = $('#content'), tools = $('#tools');
  $('#title h1').textContent = me.agent.name;
  const pc = periodControl(load); tools.appendChild(pc.node);
  tools.appendChild(el('a', { class: 'btn btn--primary', href: 'leads.html?new=1', text: 'Добавить лид' }));

  async function load() {
    const p = pc.value();
    const [d, info, leads] = await Promise.all([api('/agent/stats' + qs(p)), api('/agent/me'), api('/agent/leads?active=true&per_page=8')]);
    const m = d.me || { clicks: 0, leads: 0, showings: 0, bookings: 0, deals: 0, revenue_usd: 0, conv: {} }, md = d.team_median, mc = d.team_median_conv;
    $('#sub').textContent = `${periodLabel(d.period)} · ${d.rank.position}-е место из ${d.rank.of}`;
    content.innerHTML = '';
    const linkbox = (label, v) => el('div', { class: 'field' }, [el('span', { class: 'field__label', text: label }), el('div', { class: 'linkbox' }, [el('code', { text: v }), el('button', { class: 'btn', text: 'Копировать', onclick: () => copy(v) })])]);
    content.appendChild(el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Моя ссылка' }), el('span', { class: 'hint', text: 'все, кто зайдёт по ней, 90 дней считаются вашими' }), el('div', { class: 'tools' }, info.telegram_linked ? CRM.badge('badge--outline', 'Telegram привязан') : el('a', { class: 'btn btn--text', href: 'link.html', text: 'Привязать Telegram' }))]),
      el('div', { class: 'panel__body grid grid--2' }, [linkbox('Короткая - для сообщений и сторис', info.links.short), linkbox('Полная - для рекламы (добавьте &utm_source=...)', info.links.site)])]));
    const cmpTxt = (v, mv) => v === null || v === undefined ? '' : `${pct(v, 0)} · команда ${pct(mv, 0)}`;
    const kpi = (label, value, sub, good) => el('div', { class: 'kpi' }, [el('div', { class: 'kpi__label', text: label }), el('div', { class: 'kpi__value', text: value }), el('div', { class: 'kpi__delta' + (good === true ? ' is-up' : good === false ? ' is-down' : ''), text: sub })]);
    content.appendChild(el('div', { class: 'kpis' }, [kpi('Клики', num(m.clicks), `медиана команды ${num(md.clicks)}`, m.clicks >= md.clicks), kpi('Лиды', num(m.leads), cmpTxt(m.conv.click_lead, mc.click_lead), m.conv.click_lead >= (mc.click_lead || 0)), kpi('Показы', num(m.showings), cmpTxt(m.conv.lead_showing, mc.lead_showing), m.conv.lead_showing >= (mc.lead_showing || 0)), kpi('Брони', num(m.bookings), cmpTxt(m.conv.showing_booking, mc.showing_booking), m.conv.showing_booking >= (mc.showing_booking || 0)), kpi('Сделки', num(m.deals), usd(m.revenue_usd))]));
    const rows = [{ label: 'Клики', value: m.clicks, cmp: md.clicks }, { label: 'Лиды', value: m.leads, cmp: md.leads, conv: m.conv.click_lead, convCmp: mc.click_lead }, { label: 'Показы', value: m.showings, cmp: md.showings, conv: m.conv.lead_showing, convCmp: mc.lead_showing }, { label: 'Брони', value: m.bookings, cmp: md.bookings, conv: m.conv.showing_booking, convCmp: mc.showing_booking }, { label: 'Сделки', value: m.deals, cmp: md.deals, conv: m.conv.booking_deal, convCmp: mc.booking_deal }];
    content.appendChild(el('div', { class: 'grid grid--2-3' }, [
      el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Я и команда' }), el('div', { class: 'tools legend' }, [el('span', { html: '<i></i>я' }), el('span', { html: '<i class="med"></i>медиана' })])]), el('div', { class: 'panel__body' }, [funnel(rows, { compare: true }), el('p', { class: 'muted', style: 'font:var(--text-caption);margin-top:14px', text: 'Справа - ваша конверсия шага и медианная по команде.' })])]),
      el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Клики по дням' }), el('span', { class: 'hint', text: 'переходы по вашей ссылке' })]), el('div', { class: 'panel__body' }, [dayChart(d.series, { bars: 'clicks', line: null, barLabel: 'кликов' })])]),
    ]));
    const tb = el('tbody');
    for (const l of leads.items) tb.appendChild(el('tr', { class: 'is-clickable', onclick: () => location.href = 'lead.html?id=' + l.id }, [el('td', {}, el('a', { class: 'lnk', href: 'lead.html?id=' + l.id, text: l.name })), el('td', { class: 'dim', text: l.phone || l.telegram || '-' }), el('td', {}, unitBadge(l.unit)), el('td', {}, stDot(l.status)), el('td', {}, channelBadge(l.channel_first, l.campaign_first)), el('td', { class: 'right dim', text: ago(l.updated_at) })]));
    content.appendChild(el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Мои активные лиды' }), el('span', { class: 'hint', text: `${leads.total} в работе` }), el('div', { class: 'tools' }, el('a', { class: 'btn btn--outlined btn--sm', href: 'leads.html', text: 'Все мои лиды' }))]),
      el('div', { class: 'panel__body panel__body--flush tbl-wrap' }, leads.items.length ? el('table', { class: 'tbl' }, [el('thead', {}, el('tr', {}, ['Лид', 'Контакт', 'Квартира', 'Статус', 'Канал', 'Обновлён'].map((h, i) => el('th', { class: i === 5 ? 'right' : '', text: h })))), tb]) : el('div', { class: 'empty', text: 'Активных лидов нет' }))]));
  }
  load().catch(e => toast(e.message, 'err'));
})();
