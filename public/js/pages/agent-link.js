(async function () {
  const { $, el, api, toast, copy } = CRM;
  const me = await CRM.nav('agent'); if (!me) return;
  const content = $('#content');
  const info = await api('/agent/me');
  $('#sub').textContent = 'как делиться ссылкой и получать уведомления о лидах';
  const linkbox = (label, v, hint) => el('div', { class: 'field' }, [el('span', { class: 'field__label', text: label }), el('div', { class: 'linkbox' }, [el('code', { text: v }), el('button', { class: 'btn', text: 'Копировать', onclick: () => copy(v) })]), hint ? el('p', { class: 'muted', style: 'font:var(--text-caption);line-height:18px', text: hint }) : null]);
  const tgBox = el('div');
  content.innerHTML = '';
  content.append(
    el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Моя ссылка' })]), el('div', { class: 'panel__body stack' }, [
      linkbox('Короткая', info.links.short, 'Для сообщений клиентам, сторис, визиток. Ведёт на сайт ЖК и закрепляет посетителя за вами на 90 дней: все его заявки и просмотры квартир попадут в ваш кабинет.'),
      linkbox('Полная (для своей рекламы)', info.links.site, 'Если запускаете рекламу сами - добавьте к ссылке &utm_source=meta&utm_campaign=название, тогда в отчётах будет видно и канал, и вас.'),
      el('div', { class: 'note-box', text: 'Клиент пришёл по вашей ссылке, но заявку оставил через неделю с того же телефона? Он всё равно ваш: метка живёт 90 дней. Если пришёл по чужой ссылке раньше - останется за тем агентом.' }),
    ])]),
    el('section', { class: 'panel' }, [el('div', { class: 'panel__head' }, [el('h2', { text: 'Уведомления в Telegram' }), el('span', { class: 'hint', text: info.telegram_linked ? 'привязано' : 'не привязано' })]), el('div', { class: 'panel__body stack' }, [
      el('p', { style: 'font:var(--text-body-sm);color:var(--fg-2);line-height:20px', text: 'Каждый новый лид, закреплённый за вами, приходит сообщением в Telegram: имя, контакт, квартира, откуда пришёл, ссылка на карточку.' }),
      el('div', {}, el('button', { class: 'btn btn--outlined', text: info.telegram_linked ? 'Перепривязать' : 'Получить код привязки', onclick: async () => { const r = await api('/agent/telegram-code'); tgBox.innerHTML = ''; tgBox.appendChild(el('div', { class: 'code-box', text: r.code })); tgBox.appendChild(el('p', { class: 'muted', style: 'font:var(--text-caption);margin-top:8px', text: r.bot_enabled ? `Откройте бота CRM в Telegram и отправьте: /start ${r.code}` : 'Бот пока не настроен администратором.' })); } })), tgBox,
    ])]),
  );
})();
