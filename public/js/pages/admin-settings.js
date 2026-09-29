(async function () {
  const { $, el, api, toast, modal, field, input, select, copy, CHANNEL, dt, num } = CRM;
  const me = await CRM.nav('admin'); if (!me) return;
  const isOwner = me.admin_role !== 'viewer';
  const content = $('#content');
  const [s, ch] = await Promise.all([api('/settings'), api('/channels')]);
  $('#sub').textContent = 'пользователи, сайт, уведомления, каналы, прайс, копии, диагностика';
  content.innerHTML = '';
  const panel = (id, title, hint, tools, body) => el('section', { class: 'panel', id }, [el('div', { class: 'panel__head' }, [el('h2', { text: title }), hint ? el('span', { class: 'hint', text: hint }) : null, tools ? el('div', { class: 'tools' }, tools) : null]), body]);
  const sw = (checked, label, onchange) => el('label', { class: 'switch' }, [el('input', { type: 'checkbox', checked, onchange }), el('span', { text: label })]);
  const dlg = (title, body, onOk, okText = 'Сохранить') => { const m = modal(title, body, [el('button', { class: 'btn btn--outlined', text: 'Отмена', onclick: () => m.close() }), el('button', { class: 'btn btn--primary', text: okText, onclick: async () => { try { await onOk(); m.close(); } catch (e) { toast(e.message, 'err'); } } })]); return m; };

  content.appendChild(el('div', { class: 'anchors' }, [['users', 'Пользователи'], ['general', 'Общие'], ['telegram', 'Telegram'], ['email', 'E-mail'], ['channels', 'Каналы'], ['rules', 'Правила меток'], ['lost', 'Причины потери'], ['backups', 'Копии базы'], ['diag', 'Диагностика'], ['demo', 'Демо']].map(([id, t]) => el('a', { href: '#' + id, text: t }))));

  /* ---------- пользователи ---------- */
  const usersBody = el('tbody');
  async function loadUsers() {
    const list = await api('/admins'); usersBody.innerHTML = '';
    for (const a of list) usersBody.appendChild(el('tr', { class: a.is_active ? '' : 'dim' }, [
      el('td', { class: 'strong', text: a.name + (a.id === me.id ? ' (вы)' : '') }), el('td', { class: 'dim', text: a.login }), el('td', { class: 'dim', text: a.email || '-' }),
      el('td', {}, CRM.badge(a.role === 'admin' ? 'badge--id' : 'badge--outline', a.role === 'admin' ? 'администратор' : 'только просмотр')),
      el('td', { text: a.is_active ? 'активен' : 'отключён' }),
      el('td', { class: 'right' }, isOwner ? el('button', { class: 'btn btn--text', text: 'изменить', onclick: () => userDialog(a) }) : null),
    ]));
  }
  function userDialog(a) {
    const loginI = input({ value: a?.login || '', placeholder: 'латиницей', disabled: !!a }), nameI = input({ value: a?.name || '' }), emailI = input({ value: a?.email || '', placeholder: 'необязательно' }), passI = input({ type: 'password', placeholder: a ? 'оставьте пустым, чтобы не менять' : 'не короче 8 символов', autocomplete: 'new-password' });
    const roleS = select([['admin', 'Администратор - всё'], ['viewer', 'Только просмотр - отчёты и лиды без правок']], a?.role || 'admin');
    const activeC = a && a.id !== me.id ? sw(a.is_active, 'Активен (может входить)') : null;
    dlg(a ? 'Пользователь' : 'Новый пользователь', [el('div', { class: 'form-row' }, [field('Логин', loginI), field('Имя', nameI)]), el('div', { class: 'form-row' }, [field('E-mail', emailI), field('Пароль', passI)]), field('Роль', roleS), activeC], async () => {
      const body = { name: nameI.value, email: emailI.value, role: roleS.value }; if (passI.value) body.password = passI.value; if (activeC) body.is_active = activeC.querySelector('input').checked;
      if (a) await api(`/admins/${a.id}`, { method: 'PATCH', body }); else await api('/admins', { method: 'POST', body: { ...body, login: loginI.value } });
      toast('Сохранено'); loadUsers();
    }, a ? 'Сохранить' : 'Создать');
  }
  function passwordDialog() {
    const curI = input({ type: 'password', autocomplete: 'current-password' }), newI = input({ type: 'password', autocomplete: 'new-password', placeholder: 'не короче 8 символов' }), new2 = input({ type: 'password', autocomplete: 'new-password' });
    dlg('Сменить пароль', [field('Текущий пароль', curI), el('div', { class: 'form-row' }, [field('Новый пароль', newI), field('Ещё раз', new2)]), el('p', { class: 'muted', style: 'font:var(--text-caption)', text: 'После смены все другие сессии этого пользователя завершатся.' })], async () => {
      if (newI.value !== new2.value) throw new Error('Пароли не совпадают');
      await api('/auth/password', { method: 'POST', body: { current: curI.value, password: newI.value } }); toast('Пароль изменён');
    });
  }
  content.appendChild(panel('users', 'Пользователи', 'администратор - всё; «только просмотр» - отчёты и карточки без правок', [
    el('button', { class: 'btn btn--outlined btn--sm', text: 'Сменить мой пароль', onclick: passwordDialog }),
    el('button', { class: 'btn btn--outlined btn--sm', text: 'Выйти на всех устройствах', onclick: async () => { await api('/auth/logout-all', { method: 'POST' }); toast('Другие сессии завершены'); } }),
    isOwner ? el('button', { class: 'btn btn--primary btn--sm', text: 'Добавить пользователя', onclick: () => userDialog() }) : null,
  ], el('div', { class: 'panel__body panel__body--flush tbl-wrap' }, el('table', { class: 'tbl' }, [el('thead', {}, el('tr', {}, ['Имя', 'Логин', 'E-mail', 'Роль', 'Статус', ''].map(h => el('th', { text: h })))), usersBody]))));
  loadUsers();

  /* ---------- общие ---------- */
  const siteI = input({ value: s.site_url }), attrS = select([['first', 'Первое касание'], ['last', 'Последнее касание']], s.attribution), revS = select([['contract,paid', 'Договор + оплачен'], ['paid', 'Только оплачен'], ['booking,contract,paid', 'Бронь + договор + оплачен']], s.revenue_statuses), cookieI = input({ type: 'number', value: s.cookie_days }), gelI = input({ inputmode: 'decimal', value: s.fx.GEL }), eurI = input({ inputmode: 'decimal', value: s.fx.EUR });
  content.appendChild(panel('general', 'Общие', null, null, el('div', { class: 'panel__body stack' }, [
    field('Адрес сайта (куда ведут ссылки агентов)', siteI), el('div', { class: 'form-row' }, [field('Атрибуция в отчётах по умолчанию', attrS), field('Выручка для ROAS считается по статусам', revS)]),
    el('div', { class: 'form-row' }, [field('Срок закрепления агента за посетителем, дней', cookieI), el('div', { class: 'form-row' }, [field('1 GEL в USD', gelI), field('1 EUR в USD', eurI)])]),
    el('div', {}, el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: async () => { try { await api('/settings', { method: 'PUT', body: { site_url: siteI.value, attribution: attrS.value, revenue_statuses: revS.value, cookie_days: cookieI.value, fx: { GEL: gelI.value, EUR: eurI.value } } }); toast('Сохранено'); } catch (e) { toast(e.message, 'err'); } } })),
    el('div', { class: 'snippet', text: s.snippet }), el('div', {}, [el('button', { class: 'btn btn--outlined btn--sm', text: 'Копировать сниппет', onclick: () => copy(s.snippet) }), el('span', { class: 'muted', style: 'font:var(--text-caption);margin-left:10px', text: 'одна строка перед </body> на каждой странице сайта' })]),
  ])));

  /* ---------- telegram ---------- */
  const tgState = el('div'), tokenI = input({ type: 'password', placeholder: '123456789:AAF...', autocomplete: 'off' }), tgCode = el('div');
  async function loadTg() {
    const t = await api('/settings/telegram'); tgState.innerHTML = '';
    tgState.appendChild(el('div', { class: 'note-box', style: t.configured && t.bot ? '' : 'border-left-color:var(--status-reserved)', html: t.configured ? (t.bot ? `Бот <b>@${t.bot.username}</b> подключён (токен ${t.token_masked}). Чат администратора: ${t.admin_chat ? '<b>привязан</b>' : '<b>не привязан</b> - получите код ниже'}.` : `Токен сохранён, но Telegram его не принимает: ${t.error}`) : 'Бот не подключён. Создайте бота у @BotFather в Telegram (команда /newbot), скопируйте токен и вставьте сюда.' }));
  }
  content.appendChild(panel('telegram', 'Telegram-уведомления', 'новые лиды приходят администратору и ответственному агенту', null, el('div', { class: 'panel__body stack' }, [
    tgState,
    isOwner ? el('div', { class: 'form-row' }, [field('Токен бота от @BotFather', tokenI), el('div', { style: 'display:flex;gap:8px;align-items:flex-end' }, [
      el('button', { class: 'btn btn--primary', text: 'Подключить', onclick: async () => { try { const r = await api('/settings/telegram', { method: 'PUT', body: { token: tokenI.value } }); toast(r.bot ? `Бот @${r.bot.username} подключён` : 'Бот отключён'); tokenI.value = ''; loadTg(); } catch (e) { toast(e.message, 'err'); } } }),
      el('button', { class: 'btn btn--outlined', text: 'Отключить', onclick: async () => { if (!confirm('Отключить бота? Уведомления перестанут приходить.')) return; await api('/settings/telegram', { method: 'PUT', body: { token: '' } }); loadTg(); } })])]) : null,
    el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
      el('button', { class: 'btn btn--outlined btn--sm', text: 'Код привязки моего чата', onclick: async () => { const r = await api('/settings/telegram-code'); tgCode.innerHTML = ''; tgCode.appendChild(el('div', { class: 'code-box', text: r.code })); tgCode.appendChild(el('p', { class: 'muted', style: 'font:var(--text-caption);margin-top:8px', text: r.bot_enabled ? `Откройте бота в Telegram и отправьте: /start ${r.code}. Через 15 секунд бот ответит «Чат привязан».` : 'Сначала подключите бота.' })); } }),
      el('button', { class: 'btn btn--outlined btn--sm', text: 'Отправить тестовое сообщение', onclick: async () => { try { await api('/settings/telegram/test', { method: 'POST' }); toast('Отправлено, проверьте Telegram'); } catch (e) { toast(e.message, 'err'); } } }),
    ]), tgCode,
  ])));
  loadTg();

  /* ---------- e-mail ---------- */
  const em = await api('/settings/email');
  const hostI = input({ value: em.host, placeholder: 'smtp.gmail.com' }), portI = input({ value: em.port, placeholder: '587' }), userI = input({ value: em.user, placeholder: 'логин SMTP' }), passI = input({ type: 'password', value: em.pass, autocomplete: 'off' }), fromI = input({ value: em.from, placeholder: 'crm@example.com' }), toI = input({ value: em.notify_emails, placeholder: 'sales@example.com, director@example.com' });
  const secureC = sw(em.secure, 'SSL (порт 465). Для 587 выключено, STARTTLS включится сам');
  content.appendChild(panel('email', 'E-mail уведомления', em.configured ? 'настроено' : 'не настроено - дублирует Telegram, для тех, кто не в мессенджере', null, el('div', { class: 'panel__body stack' }, [
    el('div', { class: 'form-row' }, [field('SMTP-сервер', hostI), field('Порт', portI)]), el('div', { class: 'form-row' }, [field('Логин', userI), field('Пароль', passI)]), el('div', { class: 'form-row' }, [field('От кого', fromI), field('Кому слать новые лиды (через запятую)', toI)]), secureC,
    el('div', { style: 'display:flex;gap:10px' }, [isOwner ? el('button', { class: 'btn btn--primary', text: 'Сохранить', onclick: async () => { try { await api('/settings/email', { method: 'PUT', body: { host: hostI.value, port: portI.value, user: userI.value, pass: passI.value, from: fromI.value, secure: secureC.querySelector('input').checked, notify_emails: toI.value } }); toast('Сохранено'); } catch (e) { toast(e.message, 'err'); } } }) : null,
      el('button', { class: 'btn btn--outlined', text: 'Проверить и отправить тест', onclick: async () => { try { const r = await api('/settings/email/test', { method: 'POST' }); toast('Письмо ушло на ' + r.to); } catch (e) { toast(e.message, 'err'); } } })]),
    el('p', { class: 'muted', style: 'font:var(--text-caption);line-height:18px', text: 'Агентам письма уходят на e-mail из их карточки. Для Gmail нужен «пароль приложения», не обычный пароль.' }),
  ])));

  /* ---------- каналы ---------- */
  const chBody = el('tbody');
  const renderChannels = (list) => {
    chBody.innerHTML = '';
    for (const c of list) chBody.appendChild(el('tr', { class: c.is_active ? '' : 'dim' }, [
      el('td', { class: 'strong', text: c.name }), el('td', { class: 'dim', text: c.id }),
      el('td', {}, sw(c.is_paid, c.is_paid ? 'платный' : 'бесплатный', async (e) => { try { await api(`/channels/${c.id}`, { method: 'PATCH', body: { is_paid: e.target.checked } }); toast('Сохранено'); } catch (x) { toast(x.message, 'err'); e.target.checked = !e.target.checked; } })),
      el('td', {}, sw(c.is_active, c.is_active ? 'активен' : 'выключен', async (e) => { try { await api(`/channels/${c.id}`, { method: 'PATCH', body: { is_active: e.target.checked } }); toast('Сохранено'); reloadChannels(); } catch (x) { toast(x.message, 'err'); e.target.checked = !e.target.checked; } })),
      el('td', { class: 'right' }, el('button', { class: 'btn btn--text', text: 'переименовать', onclick: () => channelDialog(c) })),
    ]));
  };
  async function reloadChannels() { const r = await api('/channels'); ch.channels = r.channels; ch.rules = r.rules; renderChannels(r.channels); Object.assign(CHANNEL, Object.fromEntries(r.channels.map(c => [c.id, c.name]))); }
  function channelDialog(c) {
    const nameI = input({ value: c?.name || '', placeholder: 'Например, YouTube' }), idI = input({ value: c?.id || '', placeholder: 'латиницей: youtube', disabled: !!c }), srcI = input({ placeholder: 'yt, youtube_ads' });
    const paidC = sw(c ? c.is_paid : true, 'Платный (вносятся расходы, считаются CPL / CAC / ROAS)');
    dlg(c ? 'Канал' : 'Новый канал', [el('div', { class: 'form-row' }, [field('Название', nameI), field('Код (utm_source)', idI)]), c ? null : field('Синонимы utm_source через запятую (необязательно)', srcI), paidC,
      c ? null : el('p', { class: 'muted', style: 'font:var(--text-caption);line-height:18px', text: 'Правило «utm_source = код» создастся автоматически: ссылка ?utm_source=<код> сразу попадёт в этот канал. Другие условия (referrer, click id) добавляются в таблице правил ниже.' })],
      async () => { if (c) await api(`/channels/${c.id}`, { method: 'PATCH', body: { name: nameI.value, is_paid: paidC.querySelector('input').checked } }); else await api('/channels', { method: 'POST', body: { name: nameI.value, id: idI.value, is_paid: paidC.querySelector('input').checked, utm_sources: srcI.value } }); toast(c ? 'Сохранено' : 'Канал добавлен'); location.reload(); }, c ? 'Сохранить' : 'Создать');
  }
  renderChannels(ch.channels);
  content.appendChild(panel('channels', 'Каналы рекламы', 'код канала = utm_source в ссылках; системные «Агенты», «Органика», «Прямой» выключить нельзя', el('button', { class: 'btn btn--primary btn--sm', text: 'Добавить канал', onclick: () => channelDialog() }),
    el('div', { class: 'panel__body panel__body--flush tbl-wrap' }, el('table', { class: 'tbl' }, [el('thead', {}, el('tr', {}, ['Канал', 'Код', 'Расходы', 'Статус', ''].map(h => el('th', { text: h })))), chBody]))));

  /* ---------- правила ---------- */
  const rulesBody = el('tbody');
  const fields = [['utm_source', 'utm_source'], ['utm_medium', 'utm_medium'], ['utm_campaign', 'utm_campaign'], ['referrer_host', 'referrer (хост)'], ['click_id', 'click id'], ['has_agent', 'есть a= агента']];
  const ops = [['eq', 'равно'], ['in', 'один из (через запятую)'], ['contains', 'содержит'], ['regex', 'regex'], ['exists', 'есть']];
  const rowEl = (r = {}) => el('tr', {}, [el('td', {}, input({ type: 'number', value: r.priority ?? 100, style: 'width:70px' })), el('td', {}, select(fields, r.field || 'utm_source')), el('td', {}, select(ops, r.op || 'in')), el('td', {}, input({ value: r.pattern || '', placeholder: 'meta,fb,instagram' })), el('td', {}, select(ch.channels.map(c => [c.id, c.name]), r.channel_id || 'meta')), el('td', { class: 'right' }, el('button', { class: 'btn btn--text', text: 'удалить', onclick: (e) => e.target.closest('tr').remove() }))]);
  ch.rules.forEach(r => rulesBody.appendChild(rowEl(r)));
  const testUrl = input({ placeholder: 'https://сайт/?utm_source=fb&fbclid=...' }), testRef = input({ placeholder: 'https://l.instagram.com/' }), testOut = el('span', { class: 'strong' });
  content.appendChild(panel('rules', 'Правила «метка -> канал»', 'по приоритету (меньше - раньше), первое совпадение побеждает; без совпадений: есть referrer -> органика, нет -> прямой', el('button', { class: 'btn btn--outlined btn--sm', text: 'Добавить правило', onclick: () => rulesBody.appendChild(rowEl()) }), el('div', {}, [
    el('div', { class: 'panel__body panel__body--flush tbl-wrap' }, el('table', { class: 'tbl rules-table' }, [el('thead', {}, el('tr', {}, ['Приоритет', 'Поле', 'Условие', 'Значение', 'Канал', ''].map(h => el('th', { text: h })))), rulesBody])),
    el('div', { class: 'panel__body stack' }, [
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [el('button', { class: 'btn btn--primary', text: 'Сохранить правила', onclick: async () => { const rules = CRM.$$('tr', rulesBody).map(tr => { const [p, f, o, v, c] = CRM.$$('input, select', tr); return { priority: Number(p.value), field: f.value, op: o.value, pattern: v.value, channel: c.value }; }); try { await api('/channels/rules', { method: 'PUT', body: { rules } }); toast('Правила сохранены'); } catch (e) { toast(e.message, 'err'); } } }),
        el('button', { class: 'btn btn--outlined', text: 'Пересчитать каналы кликов за 90 дней', onclick: async () => { const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10); const r = await api(`/channels/reclassify?from=${from}&to=${to}`, { method: 'POST' }); toast(`Проверено ${r.touches_checked}, изменено ${r.touches_changed}`); } })]),
      el('div', { class: 'form-row' }, [field('Проверить URL', testUrl), field('Referrer', testRef)]), el('div', {}, [el('button', { class: 'btn btn--outlined btn--sm', text: 'Определить канал', onclick: async () => { const r = await api('/channels/test', { method: 'POST', body: { url: testUrl.value, referrer: testRef.value } }); testOut.textContent = ` -> ${CHANNEL[r.channel] || r.channel}`; } }), testOut]),
    ])])));

  /* ---------- причины потери ---------- */
  const lostList = el('div', { class: 'list-edit' });
  const lostRow = (r = {}) => el('div', { class: 'list-edit__row' }, [input({ value: r.label || '', placeholder: 'Например: Не подошёл этаж', 'data-id': r.id || '' }), el('button', { class: 'btn btn--text', text: 'удалить', onclick: (e) => e.target.closest('.list-edit__row').remove() })]);
  (await api('/settings/lost-reasons')).reasons.forEach(r => lostList.appendChild(lostRow(r)));
  content.appendChild(panel('lost', 'Причины потери лида', 'обязательны при статусе «Потерян»; попадают в отчёты', el('button', { class: 'btn btn--outlined btn--sm', text: 'Добавить причину', onclick: () => lostList.appendChild(lostRow()) }), el('div', { class: 'panel__body stack' }, [lostList,
    el('div', {}, el('button', { class: 'btn btn--primary', text: 'Сохранить причины', onclick: async () => { const reasons = CRM.$$('input', lostList).map(i => ({ id: i.dataset.id, label: i.value })); try { const r = await api('/settings/lost-reasons', { method: 'PUT', body: { reasons } }); toast(`Сохранено: ${r.reasons.length}`); } catch (e) { toast(e.message, 'err'); } } }))])));

  /* ---------- бэкапы ---------- */
  const bkBody = el('tbody'), bkInfo = el('span', { class: 'hint' });
  async function loadBackups() {
    const b = await api('/backups'); bkBody.innerHTML = ''; bkInfo.textContent = `база ${(b.db_size / 1048576).toFixed(1)} МБ · ночная копия в 03:00 · хранится 30 копий`;
    if (!b.items.length) bkBody.appendChild(el('tr', {}, el('td', { colspan: 4, class: 'dim', text: 'Копий пока нет' })));
    for (const f of b.items) bkBody.appendChild(el('tr', {}, [el('td', { class: 'strong', text: f.name }), el('td', { class: 'dim', text: dt(f.mtime) }), el('td', { class: 'right', text: (f.size / 1048576).toFixed(1) + ' МБ' }), el('td', { class: 'right' }, [
      el('a', { class: 'btn btn--text', href: `${CRM.BASE}/api/backups/${encodeURIComponent(f.name)}`, text: 'скачать' }),
      isOwner ? el('button', { class: 'btn btn--text', style: 'margin-left:10px', text: 'восстановить', onclick: () => restore({ name: f.name }) }) : null,
      isOwner ? el('button', { class: 'btn btn--text', style: 'margin-left:10px', text: 'удалить', onclick: async () => { if (!confirm(`Удалить копию ${f.name}?`)) return; await api(`/backups/${encodeURIComponent(f.name)}`, { method: 'DELETE' }); loadBackups(); } }) : null])]));
  }
  async function restore(opts) {
    if (!confirm('Восстановить базу из копии? Текущие данные будут заменены (перед этим сохранится копия «pre-restore»). Сервис перезапустится.')) return;
    try { const r = opts.file ? await api('/backups/restore', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', opts.file); return fd; })() }) : await api('/backups/restore', { method: 'POST', body: { name: opts.name } }); toast(r.message); setTimeout(() => location.reload(), 10000); } catch (e) { toast(e.message, 'err'); }
  }
  const restoreFile = el('input', { type: 'file', accept: '.db,.gz', hidden: true, onchange: (e) => { if (e.target.files[0]) restore({ file: e.target.files[0] }); } });
  content.appendChild(panel('backups', 'Копии базы', null, [bkInfo, el('button', { class: 'btn btn--outlined btn--sm', text: 'Сделать копию сейчас', onclick: async () => { await api('/backups', { method: 'POST' }); toast('Копия создана'); loadBackups(); } }), isOwner ? el('button', { class: 'btn btn--outlined btn--sm', text: 'Восстановить из файла', onclick: () => restoreFile.click() }) : null, el('a', { class: 'btn btn--outlined btn--sm', href: CRM.BASE + '/api/export/all.json', text: 'Полный экспорт JSON' })],
    el('div', { class: 'panel__body panel__body--flush tbl-wrap' }, [el('table', { class: 'tbl' }, [el('thead', {}, el('tr', {}, ['Файл', 'Создана', 'Размер', ''].map((h, i) => el('th', { class: i >= 2 ? 'right' : '', text: h })))), bkBody]), restoreFile])));
  loadBackups();

  /* ---------- диагностика ---------- */
  const diagBox = el('div', { class: 'panel__body stack' }, el('div', { class: 'empty', text: 'Проверяю...' }));
  async function loadDiag() {
    const d = await api('/diag'); diagBox.innerHTML = '';
    const item = (label, value, ok) => el('div', { class: 'diag__item' + (ok === true ? ' is-good' : ok === false ? ' is-bad' : '') }, [el('div', { class: 'diag__label', text: label }), el('b', { text: value })]);
    diagBox.appendChild(el('div', { class: 'diag' }, [
      item('Сниппет на сайте', d.snippet.ok ? 'установлен' : 'не найден: ' + (d.snippet.error || d.snippet.status), d.snippet.ok),
      item('Последний клик с сайта', d.last_touch ? dt(d.last_touch) : 'ещё не было', d.last_touch ? (Date.now() - new Date(d.last_touch) < 3 * 86400000) : false),
      item('Последний лид', d.last_lead ? dt(d.last_lead) : 'ещё не было', null),
      item('Telegram', d.telegram.configured ? (d.telegram.admin_chat ? 'бот и чат админа подключены' : 'бот есть, чат админа не привязан') : 'не подключён', d.telegram.configured && d.telegram.admin_chat),
      item('E-mail', d.email.configured ? 'настроен' : 'не настроен', d.email.configured ? true : null),
      item('Последняя копия базы', d.last_backup ? dt(d.last_backup.mtime) : 'нет', d.last_backup ? (Date.now() - new Date(d.last_backup.mtime) < 2 * 86400000) : false),
      item('База', `${(d.db_size / 1048576).toFixed(1)} МБ · ${num(d.counts.leads)} лидов · ${num(d.counts.touches_24h)} кликов за сутки`, null),
      item('Диск на сервере', d.disk ? `свободно ${num(d.disk.free_mb)} МБ из ${num(d.disk.total_mb)}` : '-', d.disk ? d.disk.free_mb > 1024 : null),
      item('Сервис', `v${d.version} · работает ${Math.round(d.uptime_s / 3600)} ч · ${d.node}`, true),
    ]));
    if (d.notification_errors.length) diagBox.appendChild(el('div', {}, [el('div', { class: 'muted', style: 'font:var(--text-caption);margin:8px 0', text: 'Уведомления, которые не ушли' }), el('table', { class: 'tbl' }, [el('thead', {}, el('tr', {}, ['Когда', 'Кому', 'Лид', 'Причина'].map(h => el('th', { text: h })))), el('tbody', {}, d.notification_errors.map(n => el('tr', {}, [el('td', { class: 'dim', text: dt(n.ts) }), el('td', { text: n.recipient }), el('td', {}, n.lead_id ? el('a', { class: 'lnk', href: 'lead.html?id=' + n.lead_id, text: n.lead_name }) : '-'), el('td', { class: 'dim', text: { no_chat_id: 'чат не привязан', failed: n.error || 'ошибка' }[n.status] || n.error || n.status })])))])]));
    diagBox.appendChild(el('div', {}, [el('div', { class: 'muted', style: 'font:var(--text-caption);margin:8px 0', text: 'Последние клики с сайта' }), el('table', { class: 'tbl' }, [el('thead', {}, el('tr', {}, ['Когда', 'Канал', 'Кампания', 'Агент', 'Страница', 'Откуда'].map(h => el('th', { text: h })))), el('tbody', {}, d.recent_touches.map(t => el('tr', {}, [el('td', { class: 'dim', text: dt(t.ts) }), el('td', { text: CHANNEL[t.channel_id] || t.channel_id }), el('td', { class: 'dim', text: t.utm_campaign || '-' }), el('td', { class: 'dim', text: t.agent_slug || '-' }), el('td', { class: 'dim', text: t.landing_path || '-' }), el('td', { class: 'dim', text: t.referrer_host || '-' })])))])]));
  }
  content.appendChild(panel('diag', 'Диагностика', 'всё ли подключено и работает', el('button', { class: 'btn btn--outlined btn--sm', text: 'Обновить', onclick: loadDiag }), diagBox));
  loadDiag();

  /* ---------- постбэки ---------- */
  content.appendChild(panel('postbacks', 'Серверные постбэки конверсий', 'фаза 2: очередь копится, отправка появится после настройки провайдеров', null, el('div', { class: 'panel__body stack' }, [
    ...[['meta_capi', 'Meta Conversions API'], ['google_offline', 'Google offline conversions'], ['telegram_ads', 'Telegram Ads']].map(([k, t]) => sw(s.providers[k].enabled, t, async (e) => { await api('/settings', { method: 'PUT', body: { providers: { [k]: { enabled: e.target.checked } } } }); toast(e.target.checked ? `${t}: включён (отправка в фазе 2)` : `${t}: выключен`); })),
  ])));

  /* ---------- демо ---------- */
  content.appendChild(panel('demo', 'Демо-данные', `${s.demo_rows.leads} лидов и ${s.demo_rows.agents} агентов помечены demo`, null, el('div', { class: 'panel__body stack' }, [
    el('p', { style: 'font:var(--text-body-sm);color:var(--fg-2)', text: 'Перед запуском в работу удалите демо: агентов, лиды, клики, расходы, помеченные demo. Реальные записи не затрагиваются.' }),
    el('div', {}, el('button', { class: 'btn btn--outlined btn--danger', text: 'Удалить все демо-данные', onclick: async () => { if (!confirm('Удалить все демо-данные? Это необратимо.')) return; const r = await api('/demo/clear', { method: 'POST' }); toast(`Удалено: лидов ${r.deleted.leads}, агентов ${r.deleted.agents}, кликов ${r.deleted.touches}`); setTimeout(() => location.reload(), 1200); } })),
  ])));
})();
