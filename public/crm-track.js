/* crm-track.js - сниппет CRM. Одна строка на сайте:
   <script src="https://example.com/crm/crm-track.js" async></script>
   Ловит utm_*, fbclid/gclid/ttclid/yclid, referrer, страницу входа, параметр a=<slug агента>;
   хранит id посетителя 90 дней; шлёт просмотры квартир из подбора (#/own/<id>); даёт window.crmTrack.lead(payload). */
(function () {
  if (window.crmTrack) return;
  var s = document.currentScript, base = (s && s.src ? s.src.replace(/\/crm-track\.js.*$/, '') : '') || (location.origin + '/crm');
  var DAYS = 90, VID = 'crm_vid', AKEY = 'crm_a';
  function cookie(k, v) {
    if (v === undefined) { var m = document.cookie.match('(?:^|; )' + k + '=([^;]*)'); return m ? decodeURIComponent(m[1]) : null; }
    document.cookie = k + '=' + encodeURIComponent(v) + '; max-age=' + (DAYS * 86400) + '; path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
  }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  var vid = cookie(VID) || ls(VID) || uuid();
  cookie(VID, vid); ls(VID, vid);
  var qa = new URLSearchParams(location.search).get('a');
  if (qa && /^[a-z0-9-]{2,32}$/i.test(qa) && !cookie(AKEY)) { cookie(AKEY, qa.toLowerCase()); ls(AKEY, qa.toLowerCase()); }
  var agent = cookie(AKEY) || ls(AKEY) || null;

  function post(path, body, cb) {
    try {
      fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true, credentials: 'omit' })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { cb && cb(r.ok, j, r.status); }); })
        .catch(function () { cb && cb(false, {}, 0); });
    } catch (e) { cb && cb(false, {}, 0); }
  }
  function track(type, extra) {
    var b = { vid: vid, type: type, url: location.href, referrer: document.referrer, path: location.pathname + location.hash };
    for (var k in (extra || {})) b[k] = extra[k];
    post('/api/track', b, function (ok, j) { if (ok && j.vid) { vid = j.vid; cookie(VID, vid); ls(VID, vid); } if (ok && j.agent && !agent) { agent = j.agent; cookie(AKEY, agent); ls(AKEY, agent); } });
  }
  // касание при загрузке
  track('touch');
  // просмотры квартир в подборе: #/own/<id>
  var lastUnit = null;
  function unitFromHash() { var m = location.hash.match(/^#\/own\/([^?&]+)/); return m ? decodeURIComponent(m[1]) : null; }
  function checkUnit() { var u = unitFromHash(); if (u && u !== lastUnit) { lastUnit = u; track('unit_view', { unit_id: u }); } }
  window.addEventListener('hashchange', checkUnit); checkUnit();

  // отложенные лиды (сеть упала) - досылаем при следующей загрузке
  var PENDING = 'crm_pending_leads';
  function flush() { var q; try { q = JSON.parse(ls(PENDING) || '[]'); } catch (e) { q = []; } if (!q.length) return; ls(PENDING, '[]'); q.forEach(function (p) { post('/api/leads', p, function (ok) { if (!ok) queue(p); }); }); }
  function queue(p) { var q; try { q = JSON.parse(ls(PENDING) || '[]'); } catch (e) { q = []; } q.push(p); ls(PENDING, JSON.stringify(q.slice(-5))); }
  setTimeout(flush, 1500);

  window.crmTrack = {
    vid: function () { return vid; },
    agent: function () { return agent; },
    base: base,
    track: track,
    /* lead({name, phone, telegram, email, unit_id, interest, comment, source}) -> Promise<{id, duplicate}>; при сбое сети ставит в очередь и резолвит {queued:true} */
    lead: function (p) {
      var body = { name: p.name, phone: p.phone || '', telegram: p.telegram || '', email: p.email || '', unit_id: p.unit_id || '', interest: p.interest || '', comment: p.comment || '',
        vid: vid, source: p.source || 'site_form', page: location.pathname + location.hash, hp: p.hp || '' };
      return new Promise(function (resolve) {
        post('/api/leads', body, function (ok, j, status) {
          if (ok) resolve(j);
          else if (status === 0) { queue(body); resolve({ queued: true }); }
          else resolve({ error: (j && j.message) || 'error', status: status });
        });
      });
    },
    /* статусы квартир с CRM: units(cb) -> cb({ '10-3': 'reserved', ... }) */
    units: function (cb) {
      fetch(base + '/api/units/status.json', { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (j) { cb(j.statuses || {}); }).catch(function () { cb({}); });
    }
  };
})();
