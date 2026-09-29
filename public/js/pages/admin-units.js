(async function () {
  const { $, el, api, num, usd, area, TYPE, toast, modal, field, select, input, badge } = CRM;
  if (!(await CRM.nav('admin'))) return;
  const content = $('#content'), tools = $('#tools');
  let view = 'chess', f = { status: '', type: '', q: '' };
  const seg = el('div', { class: 'seg' }, [['chess', 'Шахматка'], ['list', 'Список']].map(([v, t]) => el('button', { class: view === v ? 'is-active' : '', text: t, onclick: () => { view = v; CRM.$$('button', seg).forEach((b, i) => b.classList.toggle('is-active', ['chess', 'list'][i] === v)); load(); } })));
  const stS = select([['', 'Все статусы'], ['available', 'Свободна'], ['reserved', 'Бронь'], ['sold', 'Продана']], ''), tyS = select([['', 'Все типы'], ...Object.entries(TYPE)], ''), qI = input({ placeholder: '№' , style: 'width:100px' });
  stS.onchange = () => { f.status = stS.value; load(); }; tyS.onchange = () => { f.type = tyS.value; load(); }; qI.oninput = () => { f.q = qI.value.trim(); load(); };
  tools.append(seg, field('Статус', stS), field('Тип', tyS), field('Номер', qI));
  tools.appendChild(el('button', { class: 'btn btn--outlined', text: 'Импорт прайса', onclick: importDialog }));
  tools.appendChild(el('a', { class: 'btn btn--outlined', href: CRM.BASE + '/api/units/export.csv', text: 'Экспорт CSV' }));
  const LBL = { available: 'свободна', reserved: 'бронь', sold: 'продана' };

  async function load() {
    const rows = await api('/units' + CRM.qs(f));
    const counts = { available: 0, reserved: 0, sold: 0 }; for (const u of rows) counts[u.status]++;
    $('#sub').textContent = `${rows.length} квартир · свободно ${counts.available} · бронь ${counts.reserved} · продано ${counts.sold} · статусы отдаются сайту подбора`;
    content.innerHTML = '';
    if (view === 'chess') {
      const floors = [...new Set(rows.map(u => u.floor))].sort((a, b) => b - a);
      const grid = el('div', { class: 'chess' });
      for (const fl of floors) {
        grid.appendChild(el('div', { class: 'fl', text: fl }));
        for (let slot = 1; slot <= 12; slot++) { const u = rows.find(x => x.floor === fl && x.slot === slot); grid.appendChild(u ? el('button', { class: 'cell', 'data-status': u.status, text: u.number, title: `# ${u.number} · ${TYPE[u.type]} · ${area(u.total)} · ${LBL[u.status]}${u.lead_name ? ' · ' + u.lead_name : ''}`, onclick: () => unitDialog(u) }) : el('div', { class: 'cell is-empty' })); }
      }
      content.appendChild(el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Шахматка' }), el('div', { class: 'tools legend' }, [el('span', { html: '<i style="background:var(--status-available)"></i>свободна' }), el('span', { html: '<i class="res"></i>бронь' }), el('span', { html: '<i class="sold"></i>продана' })])]), el('div', { class: 'panel__body tbl-wrap' }, grid)]));
    } else {
      const tb = el('tbody');
      for (const u of rows) tb.appendChild(el('tr', { class: 'is-clickable', onclick: () => unitDialog(u) }, [el('td', {}, badge('badge--id', '# ' + u.number)), el('td', { text: String(u.floor) }), el('td', { text: TYPE[u.type] || u.type }), el('td', { class: 'right', text: area(u.total) }), el('td', { class: 'right', text: usd(u.price) }), el('td', {}, badge('badge--unit-' + u.status, LBL[u.status])), el('td', {}, u.lead_id ? el('a', { class: 'lnk', href: 'lead.html?id=' + u.lead_id, text: u.lead_name || '#' + u.lead_id, onclick: (e) => e.stopPropagation() }) : el('span', { class: 'dim', text: '-' })), el('td', { class: 'right', text: num(u.views_30d) }), el('td', { class: 'right', text: num(u.leads_active) })]));
      content.appendChild(el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Квартиры' })]), el('div', { class: 'panel__body panel__body--flush tbl-wrap' }, el('table', { class: 'tbl' }, [el('thead', {}, el('tr', {}, ['№', 'Этаж', 'Тип', 'Площадь', 'Цена', 'Статус', 'Лид', 'Просмотры 30 дн', 'Активных лидов'].map((h, i) => el('th', { class: [3, 4, 7, 8].includes(i) ? 'right' : '', text: h })))), tb]))]));
    }
  }
  function unitDialog(u) {
    const stS = select(Object.entries(LBL), u.status);
    const priceI = input({ inputmode: 'decimal', value: u.price ?? '' });
    const m = modal(`# ${u.number} · ${TYPE[u.type]} · ${area(u.total)}`, [
      el('div', { class: 'form-row' }, [field('Цена, USD', priceI), el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'За м²' }), el('div', { class: 'field__input', style: 'display:flex;align-items:center;background:var(--bg-3)', text: u.price_per_sqm ? '$' + num(u.price_per_sqm) : '-' })])]),
      el('dl', { class: 'dl' }, [el('dt', { text: 'Этаж' }), el('dd', { text: String(u.floor) }), el('dt', { text: 'Цена' }), el('dd', { text: usd(u.price) }), el('dt', { text: 'Держатель' }), el('dd', {}, u.lead_id ? el('a', { class: 'lnk', href: 'lead.html?id=' + u.lead_id, text: u.lead_name || '#' + u.lead_id }) : '-'), el('dt', { text: 'Просмотры' }), el('dd', { text: `${u.views_30d} за 30 дн · ${u.leads_active} активных лидов` })]),
      field('Статус вручную (без лида)', stS), el('p', { class: 'muted', style: 'font:var(--text-caption)', text: 'Обычно статус меняется сам из карточки лида (бронь -> договор). Ручное изменение отвязывает квартиру от лида.' }),
    ], [el('button', { class: 'btn btn--outlined', text: 'Отмена', onclick: () => m.close() }), el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: async () => { try {
      if (String(priceI.value) !== String(u.price ?? '')) await api(`/units/${u.id}`, { method: 'PATCH', body: { price: priceI.value } });
      if (stS.value !== u.status) await api(`/units/${u.id}/status`, { method: 'PATCH', body: { status: stS.value } });
      m.close(); toast('Сохранено'); load(); } catch (e) { toast(e.message, 'err'); } } })]);
  }
  function importDialog() {
    const fileI = el('input', { type: 'file', accept: '.csv,text/csv', class: 'field__input', style: 'padding-top:10px' }), res = el('div');
    const m = modal('Импорт прайса', [
      el('p', { style: 'font:var(--text-body-sm);line-height:20px;color:var(--fg-2)', html: 'CSV с колонками <b>number</b> (номер квартиры, обязательно), <b>price</b> (цена USD), <b>status</b> (available / reserved / sold, необязательно). Разделитель «,» или «;». Проще всего: «Экспорт CSV» -> поправить цены в Excel -> загрузить обратно. Квартиры, занятые лидом, статус из файла не меняет.' }),
      field('Файл', fileI), res,
    ], [el('button', { class: 'btn btn--outlined', text: 'Закрыть', onclick: () => m.close() }), el('button', { class: 'btn btn--primary', text: 'Загрузить', onclick: async () => {
      if (!fileI.files[0]) return toast('Выберите файл', 'err'); const fd = new FormData(); fd.append('file', fileI.files[0]);
      try { const r = await api('/units/import', { method: 'POST', body: fd }); res.innerHTML = ''; res.appendChild(el('div', { class: 'note-box', html: `Строк ${r.total}: цен обновлено <b>${r.prices_updated}</b>, статусов <b>${r.statuses_updated}</b>.` + (r.errors.length ? '<br>' + r.errors.slice(0, 10).map(e => `строка ${e.row}: ${e.message}`).join('<br>') : '') })); load(); } catch (e) { toast(e.message, 'err'); } } })]);
  }
  load().catch(e => toast(e.message, 'err'));
})();
