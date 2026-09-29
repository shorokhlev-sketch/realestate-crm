(async function () {
  const { $, el, api, ago, qs, STATUS, STATUS_ORDER, LOST, CHANNEL, toast, modal, field, select, textarea, input, initials, unitLabel } = CRM;
  if (!(await CRM.nav('admin'))) return;
  const content = $('#content'), tools = $('#tools');
  const url = new URL(location.href);
  const f = { agent_id: url.searchParams.get('agent_id') || '', channel: url.searchParams.get('channel') || '', q: '' };
  const [agents, channels] = await Promise.all([api('/agents'), api('/channels')]);
  const agentSel = CRM.select([['', 'Все агенты'], ...agents.map(a => [a.id, a.name])], f.agent_id), chSel = CRM.select([['', 'Все каналы'], ...channels.channels.map(c => [c.id, c.name])], f.channel), qI = input({ placeholder: 'Поиск' });
  agentSel.addEventListener('change', () => { f.agent_id = agentSel.value; load(); }); chSel.addEventListener('change', () => { f.channel = chSel.value; load(); });
  let qt; qI.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { f.q = qI.value.trim(); load(); }, 300); });
  tools.append(field('Агент', agentSel), field('Канал', chSel), field('Поиск', qI));
  tools.appendChild(el('a', { class: 'btn btn--primary', href: 'leads.html?new=1', text: 'Добавить лид' }));

  async function load() {
    const d = await api('/leads' + qs({ ...f, view: 'board' }));
    $('#sub').textContent = `${d.total} лидов · перетащите карточку, чтобы сменить статус`;
    const board = el('div', { class: 'board' });
    for (const s of STATUS_ORDER) {
      const col = el('div', { class: 'col', 'data-status': s });
      col.appendChild(el('div', { class: 'col__head' }, [el('span', { class: `st st--${s}`, text: STATUS[s] }), el('span', { class: 'n', text: d.columns[s].length })]));
      const bodyEl = el('div', { class: 'col__body' });
      for (const l of d.columns[s]) {
        const card = el('div', { class: 'card', draggable: 'true', 'data-id': l.id }, [
          el('div', { class: 'card__name' }, [el('a', { class: 'lnk', href: 'lead.html?id=' + l.id, text: l.name }), el('span', { class: 'card__tools' }, [el('small', { text: ago(l.status_since || l.updated_at) }), el('button', { class: 'card__move', type: 'button', title: 'Сменить статус', 'aria-label': 'Сменить статус', html: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>', onclick: (e) => { e.stopPropagation(); moveMenu(l); } })])]),
          l.unit ? el('div', { class: 'card__unit' }, [CRM.badge('badge--id', '# ' + l.unit.number), el('span', { class: 'muted', style: 'font:var(--text-caption-meta);margin-left:6px', text: unitLabel(l.unit) })]) : null,
          el('div', { class: 'card__meta' }, [l.agent ? el('span', { class: 'who' }, [el('span', { class: 'avatar', style: 'width:20px;height:20px;font-size:9px', text: initials(l.agent.name) }), l.agent.name]) : el('span', { text: 'без агента' }), el('span', { text: '·' }), el('span', { text: CHANNEL[l.channel_first] || l.channel_first }), l.deal_amount_usd ? el('span', { class: 'strong', text: '· $' + CRM.num(l.deal_amount_usd) }) : null]),
        ]);
        card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(l.id)); e.dataTransfer.effectAllowed = 'move'; card.classList.add('is-dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
        bodyEl.appendChild(card);
      }
      col.appendChild(bodyEl);
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('is-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('is-over'));
      col.addEventListener('drop', async (e) => { e.preventDefault(); col.classList.remove('is-over'); const id = Number(e.dataTransfer.getData('text/plain')); const lead = Object.values(d.columns).flat().find(x => x.id === id); if (!lead || lead.status === s) return; await move(lead, s); });
      board.appendChild(col);
    }
    content.innerHTML = ''; content.appendChild(board);
  }
  function moveMenu(lead) {
    const opts = STATUS_ORDER.filter(s => s !== lead.status).map(s => el('button', { class: 'menu__item', onclick: () => { m.close(); move(lead, s); } }, [el('span', { class: `st st--${s}`, text: STATUS[s] })]));
    const m = modal(`${lead.name} -> ...`, [el('div', { class: 'menu' }, opts)]);
  }
  async function move(lead, status) {
    const body = { status };
    if (status === 'lost') {
      const reasonS = select(Object.entries(LOST), Object.keys(LOST)[0]), noteT = textarea({ placeholder: 'Что сказал клиент' });
      await new Promise(res => { const m = modal(`${lead.name} -> Потерян`, [field('Причина', reasonS), field('Комментарий', noteT)], [el('button', { class: 'btn btn--outlined', text: 'Отмена', onclick: () => { m.close(); res(false); } }), el('button', { class: 'btn btn--primary', text: 'Подтвердить', onclick: () => { body.lost_reason = reasonS.value; body.lost_note = noteT.value; m.close(); res(true); } })]); }).then(ok => { if (!ok) throw new Error('cancel'); }).catch(() => { load(); });
      if (!body.lost_reason) return;
    } else if (['booking', 'contract', 'paid'].includes(status)) {
      const unitI = input({ placeholder: 'номер квартиры', value: lead.unit?.number || '' }), amountI = input({ placeholder: 'сумма сделки, USD', inputmode: 'decimal', value: lead.deal_amount_usd || '' }), noteT = textarea({ placeholder: 'Заметка' });
      const ok = await new Promise(res => { const m = modal(`${lead.name} -> ${STATUS[status]}`, [el('div', { class: 'form-row' }, [field('Квартира', unitI), field('Сумма, USD', amountI)]), field('Заметка', noteT)], [el('button', { class: 'btn btn--outlined', text: 'Отмена', onclick: () => { m.close(); res(false); } }), el('button', { class: 'btn btn--primary', text: 'Подтвердить', onclick: () => { body.unit = unitI.value; body.deal_amount = amountI.value; body.note = noteT.value; m.close(); res(true); } })]); });
      if (!ok) return load();
      if (body.unit && body.unit !== lead.unit?.number) { try { await api(`/leads/${lead.id}`, { method: 'PATCH', body: { unit_id: body.unit } }); } catch (e) { toast(e.message, 'err'); return load(); } }
    }
    try { await api(`/leads/${lead.id}/status`, { method: 'POST', body }); toast(`${lead.name}: ${STATUS[status]}`); } catch (e) { toast(e.message, 'err'); }
    load();
  }
  load().catch(e => toast(e.message, 'err'));
})();
