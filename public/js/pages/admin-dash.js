(async function () {
  const { $, el, api, num, usd, pct, x, periodControl, periodLabel, funnel, dayChart, CHANNEL, stDot, STATUS_ORDER, initials } = CRM;
  if (!(await CRM.nav('admin'))) return;
  const content = $('#content'), tools = $('#tools');
  const pc = periodControl(load); tools.appendChild(pc.node);
  tools.appendChild(el('a', { class: 'btn btn--primary', href: 'leads.html?new=1', text: 'Добавить лид' }));

  async function load() {
    const p = pc.value();
    const d = await api('/stats/overview' + CRM.qs(p));
    $('#sub').textContent = `${periodLabel(d.period)} · сравнение с предыдущими ${d.period.days} дн`;
    const c = d.current, pr = d.previous, dl = d.delta;
    const delta = (k, fmt = num) => { const v = dl[k]; if (!v) return el('div', { class: 'kpi__delta', text: 'без изменений' }); return el('div', { class: 'kpi__delta ' + (v > 0 ? 'is-up' : 'is-down'), text: `${v > 0 ? '+' : '-'}${fmt(Math.abs(v))} к пред. периоду` }); };
    const kpi = (label, value, sub, cls = '') => el('div', { class: 'kpi ' + cls }, [el('div', { class: 'kpi__label', text: label }), el('div', { class: 'kpi__value', text: value }), sub]);
    content.innerHTML = '';
    content.appendChild(el('div', { class: 'kpis' }, [
      kpi('Клики', num(c.clicks), delta('clicks')), kpi('Лиды', num(c.leads), delta('leads')), kpi('Показы', num(c.showings), delta('showings')),
      kpi('Брони', num(c.bookings), delta('bookings')), kpi('Сделки', num(c.deals), el('div', { class: 'kpi__delta', text: usd(c.revenue_usd) })),
      kpi('Расход', usd(c.spend_usd), delta('spend_usd', usd)), kpi('CPL', usd(c.cpl), el('div', { class: 'kpi__delta', text: pr.cpl ? `было ${usd(pr.cpl)}` : '' })), kpi('ROAS', x(c.roas), el('div', { class: 'kpi__delta', text: 'выручка / расход' }), 'kpi--accent'),
    ]));
    const rows = [
      { label: 'Клики', value: c.clicks }, { label: 'Лиды', value: c.leads, conv: c.conv.click_lead }, { label: 'Показы', value: c.showings, conv: c.conv.lead_showing },
      { label: 'Брони', value: c.bookings, conv: c.conv.showing_booking }, { label: 'Сделки', value: c.deals, conv: c.conv.booking_deal },
    ];
    content.appendChild(el('div', { class: 'grid grid--2-3' }, [
      el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Воронка' }), el('span', { class: 'hint', text: 'все каналы' })]), el('div', { class: 'panel__body' }, [funnel(rows), el('p', { class: 'muted', style: 'font:var(--text-caption);margin-top:14px', text: 'Клики - в своём масштабе, шаги от лидов - в масштабе лидов. Справа - конверсия из предыдущего шага.' })])]),
      el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Лиды по дням' }), el('span', { class: 'hint', text: 'столбики - лиды, линия - клики ÷ 10' })]), el('div', { class: 'panel__body' }, [dayChart(d.series)])]),
    ]));
    // топ каналов и агентов + статусы
    const chT = el('table', { class: 'tbl' }, [el('thead', {}, el('tr', {}, [el('th', { text: 'Канал' }), el('th', { class: 'right', text: 'Клики' }), el('th', { class: 'right', text: 'Лиды' }), el('th', { class: 'right', text: 'Брони' }), el('th', { class: 'right', text: 'CPL' }), el('th', { class: 'right', text: 'ROAS' })])),
      el('tbody', {}, d.top_channels.map(r => el('tr', {}, [el('td', { class: 'strong' }, el('a', { class: 'lnk', href: 'channels.html' + CRM.qs(p), text: CHANNEL[r.channel] || r.channel })), el('td', { class: 'right', text: num(r.clicks) }), el('td', { class: 'right strong', text: num(r.leads) }), el('td', { class: 'right', text: num(r.bookings) }), el('td', { class: 'right', text: usd(r.cpl) }), el('td', { class: 'right', text: x(r.roas) })])))]);
    const agT = el('table', { class: 'tbl' }, [el('thead', {}, el('tr', {}, [el('th', { text: 'Агент' }), el('th', { class: 'right', text: 'Клики' }), el('th', { class: 'right', text: 'Лиды' }), el('th', { class: 'right', text: 'Показы' }), el('th', { class: 'right', text: 'Брони' }), el('th', { class: 'right', text: 'Сделки' })])),
      el('tbody', {}, d.agents.map(r => el('tr', {}, [el('td', {}, el('span', { class: 'who' }, [el('span', { class: 'avatar', text: initials(r.agent.name) }), el('a', { class: 'lnk', href: 'agents.html?id=' + r.agent.id, text: r.agent.name })])), el('td', { class: 'right', text: num(r.clicks) }), el('td', { class: 'right', text: num(r.leads) }), el('td', { class: 'right', text: num(r.showings) }), el('td', { class: 'right strong', text: num(r.bookings) }), el('td', { class: 'right', text: num(r.deals) })])))]);
    const statusRow = el('div', { class: 'kpis' }, STATUS_ORDER.map(s => el('a', { class: 'kpi', href: 'leads.html?status=' + s, style: 'text-decoration:none' }, [el('div', { class: 'kpi__label' }, stDot(s)), el('div', { class: 'kpi__value', text: num(d.counts_by_status[s] || 0) })])));
    content.appendChild(el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Лиды сейчас' }), el('span', { class: 'hint', text: 'все лиды по статусам, без учёта периода' })]), el('div', { class: 'panel__body' }, statusRow)]));
    content.appendChild(el('div', { class: 'grid grid--2' }, [
      el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Каналы' }), el('div', { class: 'tools' }, el('a', { class: 'btn btn--text', href: 'channels.html' + CRM.qs(p), text: 'Все каналы' }))]), el('div', { class: 'panel__body panel__body--flush tbl-wrap' }, chT)]),
      el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Агенты' }), el('div', { class: 'tools' }, el('a', { class: 'btn btn--text', href: 'agents.html', text: 'Рейтинг' }))]), el('div', { class: 'panel__body panel__body--flush tbl-wrap' }, agT)]),
    ]));
  }
  load().catch(e => { content.innerHTML = ''; content.appendChild(el('div', { class: 'empty', text: e.message })); });
})();
