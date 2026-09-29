(async function () {
  const { $, el, api, num, usd, pct, x, periodControl, periodLabel, funnel, dayChart, CHANNEL, qs, toast, dLocal } = CRM;
  if (!(await CRM.nav('admin'))) return;
  const content = $('#content'), tools = $('#tools');
  const url = new URL(location.href);
  let attribution = url.searchParams.get('attribution') || 'first', group = url.searchParams.get('group') || 'channel';
  const pc = periodControl(load); tools.appendChild(pc.node);
  const attrSeg = el('div', { class: 'seg', role: 'group' }, [['first', 'Первое касание'], ['last', 'Последнее']].map(([v, t]) => el('button', { class: attribution === v ? 'is-active' : '', text: t, onclick: () => { attribution = v; url.searchParams.set('attribution', v); history.replaceState(null, '', url); load(); } })));
  tools.appendChild(attrSeg);
  tools.appendChild(el('a', { class: 'btn btn--primary', href: 'expenses.html?new=1', text: 'Добавить расход' }));

  const cost = (v) => el('td', { class: 'right' + (v === null ? ' dim' : ''), text: usd(v) });
  async function load() {
    const p = pc.value();
    CRM.$$('button', attrSeg).forEach((b, i) => b.classList.toggle('is-active', ['first', 'last'][i] === attribution));
    const [d, series, expenses] = await Promise.all([api('/stats/channels' + qs({ ...p, attribution, group })), api('/stats/series' + qs(p)), api('/expenses' + qs(p))]);
    $('#sub').textContent = `${periodLabel(d.period)} · атрибуция по ${attribution === 'first' ? 'первому' : 'последнему'} касанию`;
    const t = d.totals;
    const kpi = (label, value, sub, cls = '') => el('div', { class: 'kpi ' + cls }, [el('div', { class: 'kpi__label', text: label }), el('div', { class: 'kpi__value', text: value }), el('div', { class: 'kpi__delta', text: sub })]);
    content.innerHTML = '';
    content.appendChild(el('div', { class: 'kpis' }, [
      kpi('Клики', num(t.clicks), ''), kpi('Лиды', num(t.leads), 'CR ' + pct(t.conv.click_lead)), kpi('Показы', num(t.showings), pct(t.conv.lead_showing, 0) + ' от лидов'), kpi('Брони', num(t.bookings), pct(t.conv.showing_booking, 0) + ' от показов'),
      kpi('Сделки', num(t.deals), usd(t.revenue_usd)), kpi('Расход', usd(t.spend_usd), `${d.rows.filter(r => r.is_paid && r.spend_usd).length} платных канала`), kpi('CPL', usd(t.cpl), 'расход / лиды'), kpi('ROAS', x(t.roas), 'выручка / расход', 'kpi--accent'),
    ]));
    const rows = [{ label: 'Клики', value: t.clicks }, { label: 'Лиды', value: t.leads, conv: t.conv.click_lead }, { label: 'Показы', value: t.showings, conv: t.conv.lead_showing }, { label: 'Брони', value: t.bookings, conv: t.conv.showing_booking }, { label: 'Сделки', value: t.deals, conv: t.conv.booking_deal }];
    content.appendChild(el('div', { class: 'grid grid--2-3' }, [
      el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Воронка' }), el('span', { class: 'hint', text: 'все каналы' })]), el('div', { class: 'panel__body' }, [funnel(rows), el('p', { class: 'muted', style: 'font:var(--text-caption);margin-top:14px', text: 'Клики - в своём масштабе, шаги от лидов - в масштабе лидов. Справа - конверсия из предыдущего шага.' })])]),
      el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Лиды по дням' }), el('span', { class: 'hint', text: 'столбики - лиды, линия - клики ÷ 10' })]), el('div', { class: 'panel__body' }, [dayChart(series)])]),
    ]));

    // таблица по каналам / кампаниям
    const maxLeads = Math.max(1, ...d.rows.map(r => r.leads));
    const head = el('tr', {}, ['Канал', 'Клики', 'Лиды', 'CR', 'Показы', 'Брони', 'Сделки', 'Расход', 'CPL', 'Показ', 'CAC', 'ROAS'].map((h, i) => el('th', { class: i ? 'right' + (h === 'CR' ? ' dim' : '') : '', text: h })));
    const tb = el('tbody');
    const paid = d.rows.filter(r => r.is_paid), free = d.rows.filter(r => !r.is_paid);
    const rowEl = (r, sub = false) => el('tr', { class: sub ? 'is-sub' : '' }, [
      el('td', { class: sub ? (r.campaign ? '' : 'dim') : 'strong' }, sub ? (r.campaign || '(без кампании)') : el('a', { class: 'lnk', href: 'leads.html' + qs({ channel: r.channel, ...p }), text: CHANNEL[r.channel] || r.channel_name })),
      el('td', { class: 'right', text: num(r.clicks) }),
      el('td', { class: 'right' }, el('div', { class: 'cell-meter', style: 'justify-content:flex-end' }, [sub ? null : el('span', { class: 'meter' }, el('i', { style: `width:${r.leads / maxLeads * 100}%` })), el('span', { class: 'num strong', text: num(r.leads) })])),
      el('td', { class: 'right pct' + (r.conv.click_lead !== null && r.conv.click_lead >= (t.conv.click_lead || 0) ? ' is-good' : ''), text: pct(r.conv.click_lead) }),
      el('td', { class: 'right', text: num(r.showings) }), el('td', { class: 'right', text: num(r.bookings) }), el('td', { class: 'right', text: num(r.deals) }),
      cost(r.spend_usd), cost(r.cpl), cost(r.cost_per_showing), cost(r.cac),
      el('td', { class: 'right' + (r.roas === null ? ' dim' : r.roas > 1 ? ' strong' : ' pct is-bad'), text: x(r.roas) }),
    ]);
    const addGroup = (list) => {
      if (group === 'campaign') {
        const byCh = new Map(); for (const r of list) { if (!byCh.has(r.channel)) byCh.set(r.channel, []); byCh.get(r.channel).push(r); }
        for (const [ch, rs] of byCh) {
          const sum = rs.reduce((a, r) => { for (const k of ['clicks', 'leads', 'showings', 'bookings', 'deals', 'revenue_usd']) a[k] += r[k]; a.spend_usd = (a.spend_usd || 0) + (r.spend_usd || 0); return a; }, { channel: ch, channel_name: rs[0].channel_name, is_paid: rs[0].is_paid, clicks: 0, leads: 0, showings: 0, bookings: 0, deals: 0, revenue_usd: 0, spend_usd: 0 });
          const c = (a, b) => a ? b / a : null; sum.conv = { click_lead: c(sum.clicks, sum.leads) }; const s = sum.is_paid ? sum.spend_usd : null;
          Object.assign(sum, { spend_usd: s, cpl: s && sum.leads ? s / sum.leads : null, cost_per_showing: s && sum.showings ? s / sum.showings : null, cac: s && sum.deals ? s / sum.deals : null, roas: s ? sum.revenue_usd / s : null });
          tb.appendChild(rowEl(sum)); rs.sort((a, b) => b.leads - a.leads).forEach(r => tb.appendChild(rowEl(r, true)));
        }
      } else list.forEach(r => tb.appendChild(rowEl(r)));
    };
    addGroup(paid);
    if (free.length) { tb.appendChild(el('tr', { class: 'grp' }, el('td', { colspan: 12, text: 'Бесплатные' }))); addGroup(free); }
    tb.appendChild(el('tr', { class: 'is-total' }, [el('td', { text: 'Итого' }), el('td', { class: 'right', text: num(t.clicks) }), el('td', { class: 'right', text: num(t.leads) }), el('td', { class: 'right pct', text: pct(t.conv.click_lead) }), el('td', { class: 'right', text: num(t.showings) }), el('td', { class: 'right', text: num(t.bookings) }), el('td', { class: 'right', text: num(t.deals) }), cost(t.spend_usd), cost(t.cpl), cost(t.cost_per_showing), cost(t.cac), el('td', { class: 'right', text: x(t.roas) })]));
    const groupSeg = el('div', { class: 'seg seg--sm' }, [['channel', 'Каналы'], ['campaign', 'Кампании']].map(([v, tt]) => el('button', { class: group === v ? 'is-active' : '', text: tt, onclick: () => { group = v; url.searchParams.set('group', v); history.replaceState(null, '', url); load(); } })));
    content.appendChild(el('section', { class: 'panel' }, [
      el('div', { class: 'panel__head' }, [el('h2', { text: group === 'campaign' ? 'По кампаниям' : 'По каналам' }), el('span', { class: 'hint', text: 'расход распределён по дням периода' }), el('div', { class: 'tools' }, [groupSeg, el('a', { class: 'btn btn--text', href: CRM.BASE + '/api/leads/export.csv' + qs(p), text: 'Экспорт лидов CSV' })])]),
      el('div', { class: 'panel__body panel__body--flush tbl-wrap' }, el('table', { class: 'tbl' }, [el('thead', {}, head), tb])),
      d.unattributed ? el('div', { class: 'pager', text: `Без атрибуции: ${d.unattributed.leads} лидов (ручной ввод без канала)` }) : null,
    ]));
    // расходы периода
    const exT = el('table', { class: 'tbl' }, [el('thead', {}, el('tr', {}, [el('th', { text: 'Канал' }), el('th', { text: 'Кампания' }), el('th', { text: 'Период' }), el('th', { class: 'right', text: 'Сумма' }), el('th', { class: 'right', text: 'В USD' })])),
      el('tbody', {}, expenses.length ? expenses.map(e => el('tr', {}, [el('td', { class: 'strong', text: CHANNEL[e.channel_id] || e.channel_name }), el('td', { class: e.campaign ? '' : 'dim', text: e.campaign || '-' }), el('td', { text: `${dLocal(e.period_start)} - ${dLocal(e.period_end)}` }), el('td', { class: 'right', text: `${num(e.amount)} ${{ USD: '$', GEL: '₾', EUR: '€' }[e.currency] || e.currency}` }), el('td', { class: 'right', text: usd(e.amount_usd) })])) : el('tr', {}, el('td', { colspan: 5, class: 'dim', text: 'Расходов за период нет' })))]);
    content.appendChild(el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Расходы за период' }), el('div', { class: 'tools' }, el('a', { class: 'btn btn--outlined btn--sm', href: 'expenses.html', text: 'Все расходы' }))]), el('div', { class: 'panel__body panel__body--flush tbl-wrap' }, exT)]));
  }
  load().catch(e => { content.innerHTML = ''; content.appendChild(el('div', { class: 'empty', text: e.message })); });
})();
