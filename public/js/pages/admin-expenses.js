(async function () {
  const { $, el, api, num, usd, dLocal, dt, CHANNEL, toast, modal, field, input, select, textarea } = CRM;
  if (!(await CRM.nav('admin'))) return;
  const content = $('#content'), tools = $('#tools');
  const channels = await api('/channels');
  const paid = channels.channels.filter(c => c.is_paid && c.is_active);
  tools.appendChild(el('button', { class: 'btn btn--outlined', text: 'Импорт CSV', onclick: importDialog }));
  tools.appendChild(el('button', { class: 'btn btn--primary', text: 'Добавить расход', onclick: () => dialog() }));
  function importDialog() {
    const fileI = el('input', { type: 'file', accept: '.csv,text/csv', class: 'field__input', style: 'padding-top:10px' }), res = el('div');
    const m = modal('Импорт расходов из CSV', [
      el('p', { style: 'font:var(--text-body-sm);line-height:20px;color:var(--fg-2)', html: 'Колонки: <b>channel</b> (код или название канала), <b>campaign</b>, <b>period_start</b>, <b>period_end</b> (YYYY-MM-DD; либо одна колонка <b>date</b> для дневных выгрузок из рекламного кабинета), <b>amount</b>, <b>currency</b> (USD / GEL / EUR). Разделитель «,» или «;».' }),
      field('Файл', fileI), res,
      el('a', { class: 'btn btn--text', href: 'data:text/csv;charset=utf-8,' + encodeURIComponent('channel,campaign,period_start,period_end,amount,currency\nmeta,sep_sea,2026-09-01,2026-09-30,800,USD\ngoogle,,2026-09-01,2026-09-30,1200,GEL'), download: 'expenses-template.csv', text: 'Скачать шаблон' }),
    ], [el('button', { class: 'btn btn--outlined', text: 'Закрыть', onclick: () => m.close() }), el('button', { class: 'btn btn--primary', text: 'Загрузить', onclick: async () => {
      if (!fileI.files[0]) return toast('Выберите файл', 'err'); const fd = new FormData(); fd.append('file', fileI.files[0]);
      try { const r = await api('/expenses/import', { method: 'POST', body: fd }); res.innerHTML = ''; res.appendChild(el('div', { class: 'note-box', html: `Создано <b>${r.created}</b> из ${r.total}.` + (r.errors.length ? '<br>' + r.errors.slice(0, 10).map(e => `строка ${e.row}: ${e.message}`).join('<br>') : '') })); load(); } catch (e) { toast(e.message, 'err'); } } })]);
  }
  const SYM = { USD: '$', GEL: '₾', EUR: '€' };

  async function load() {
    const rows = await api('/expenses?all=true');
    const total = rows.reduce((s, r) => s + r.amount_usd, 0);
    $('#sub').textContent = `${rows.length} записей · всего ${usd(total)} · расход распределяется по дням периода, отчёт за неделю берёт 7/30 месячной суммы`;
    content.innerHTML = '';
    // сводка по каналам
    const byCh = {}; for (const r of rows) byCh[r.channel_id] = (byCh[r.channel_id] || 0) + r.amount_usd;
    content.appendChild(el('div', { class: 'kpis' }, paid.map(c => el('div', { class: 'kpi' }, [el('div', { class: 'kpi__label', text: c.name }), el('div', { class: 'kpi__value', text: usd(byCh[c.id] || 0) }), el('div', { class: 'kpi__delta', text: 'за всё время' })]))));
    const tb = el('tbody');
    if (!rows.length) tb.appendChild(el('tr', {}, el('td', { colspan: 7, class: 'dim', text: 'Расходов пока нет. Внесите первый: канал, период, сумма.' })));
    for (const e of rows) tb.appendChild(el('tr', { class: e.is_demo ? 'is-demo' : '' }, [
      el('td', { class: 'strong', text: CHANNEL[e.channel_id] || e.channel_name }), el('td', { class: e.campaign ? '' : 'dim', text: e.campaign || '-' }),
      el('td', { text: `${dLocal(e.period_start)} - ${dLocal(e.period_end)} ${e.period_end.slice(0, 4)}` }),
      el('td', { class: 'right', text: `${num(e.amount)} ${SYM[e.currency] || e.currency}` }), el('td', { class: 'right dim', text: e.currency === 'USD' ? '' : `× ${e.fx_to_usd}` }), el('td', { class: 'right strong', text: usd(e.amount_usd) }),
      el('td', { class: 'right' }, [el('button', { class: 'btn btn--text', text: 'изменить', onclick: () => dialog(e) }), ' ', el('button', { class: 'btn btn--text', style: 'margin-left:10px', text: 'удалить', onclick: async () => { if (!confirm('Удалить расход?')) return; await api(`/expenses/${e.id}`, { method: 'DELETE' }); load(); } })]),
    ]));
    content.appendChild(el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Все расходы' })]), el('div', { class: 'panel__body panel__body--flush tbl-wrap' }, el('table', { class: 'tbl' }, [el('thead', {}, el('tr', {}, ['Канал', 'Кампания', 'Период', 'Сумма', 'Курс', 'В USD', ''].map((h, i) => el('th', { class: i >= 3 ? 'right' : '', text: h })))), tb]))]));
  }
  function dialog(e) {
    const today = new Date().toISOString().slice(0, 10), first = today.slice(0, 8) + '01';
    const chS = select(paid.map(c => [c.id, c.name]), e?.channel_id || paid[0]?.id), campI = input({ value: e?.campaign || '', placeholder: 'utm_campaign, необязательно' }), fromI = input({ type: 'date', value: e?.period_start || first }), toI = input({ type: 'date', value: e?.period_end || today }), amountI = input({ inputmode: 'decimal', value: e?.amount ?? '', placeholder: '0' }), curS = select([['USD', 'USD'], ['GEL', 'GEL'], ['EUR', 'EUR']], e?.currency || 'USD'), noteI = input({ value: e?.note || '' });
    const m = modal(e ? 'Расход' : 'Новый расход', [el('div', { class: 'form-row' }, [field('Канал', chS), field('Кампания (utm_campaign)', campI)]), el('div', { class: 'form-row' }, [field('С', fromI), field('По', toI)]), el('div', { class: 'form-row' }, [field('Сумма', amountI), field('Валюта', curS)]), field('Заметка', noteI),
      el('div', { class: 'note-box', text: 'Курс подставится из настроек. Расход распределяется по дням периода равномерно.' })],
      [el('button', { class: 'btn btn--outlined', text: 'Отмена', onclick: () => m.close() }), el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: async () => {
        try { const body = { channel_id: chS.value, campaign: campI.value, period_start: fromI.value, period_end: toI.value, amount: amountI.value, currency: curS.value, note: noteI.value };
          if (e) await api(`/expenses/${e.id}`, { method: 'PATCH', body }); else await api('/expenses', { method: 'POST', body }); m.close(); toast('Сохранено'); load(); } catch (x) { toast(x.message, 'err'); } } })]);
  }
  if (new URLSearchParams(location.search).get('new')) dialog();
  load().catch(e => toast(e.message, 'err'));
})();
