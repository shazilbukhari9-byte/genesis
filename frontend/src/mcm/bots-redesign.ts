/* ============================================================
   MCM Cloud CX — Bot Connectors Backend Wiring (Edit)
   NOT a redesign — reproduces the existing page markup exactly
   (same classes, same columns). Add/Delete were already real
   (scripts.ts's own addBotFx/delBotFx POST/DELETE to
   /api/bot-connectors) — the only gap was Read/Update: rows had
   no click handler at all, so an existing connector's platform
   or webhook URL could never be viewed or changed, even though
   the backend's generic PUT /api/bot-connectors/<id> (resources.py
   REGISTRY "bot-connectors": name/platform/status/webhook_url/
   notes) already supports it.
   window.renderBotsFx is a plain top-level assignment in
   scripts.ts (not captured by any DYN* dispatch table), so a
   direct reassignment here is picked up correctly — no
   window.openPage wrapping needed, unlike prompts/emergency.
   ============================================================ */

export const BOTS_SCRIPT: string = `
(function() {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function botsApiFetch(path, init) {
    var token = window.__authToken;
    var base = window.SUBS_API_BASE || '';
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(base + path, Object.assign({ headers: headers }, init || {})).then(function(res) {
      if (!res.ok) {
        return res.json().catch(function() { return {}; }).then(function(body) {
          throw new Error(body.error || ('Request failed: ' + res.status));
        });
      }
      return res.json();
    });
  }

  var PLATFORMS = ['Custom', 'Dialogflow', 'Amazon Lex', 'Microsoft Bot Framework'];

  function platformOptions(selected) {
    return PLATFORMS.map(function(p) {
      return '<option value="' + p + '"' + (selected === p ? ' selected' : '') + '>' + p + '</option>';
    }).join('');
  }

  window.editBotFx = function(id) {
    var b = (window.DB.botConnectors || []).filter(function(x) { return x.id === id; })[0];
    if (!b) return;
    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw"><div class="dh"><h2>Edit Bot Connector</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db">' +
        '<div id="boterr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
        '<div class="fld"><label>Name *</label><input id="bot_ename" value="' + escapeHtml(b.name) + '"></div>' +
        '<div class="fld"><label>Platform</label><select id="bot_eplatform">' + platformOptions(b.platform) + '</select></div>' +
        '<div class="fld"><label>Webhook URL</label><input id="bot_ewebhook" value="' + escapeHtml(b.webhookUrl || '') + '"></div>' +
        '<div class="fld"><label>Status</label><div style="font-size:12.5px;color:#33425c;padding:6px 0">' + escapeHtml(b.status) + '</div></div>' +
        '<button class="btn gh" onclick="closeDrawer();delBotFx(\\'' + b.id + '\\')">Delete</button>' +
      '</div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.saveBotEditFx(\\'' + b.id + '\\')">Save</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.saveBotEditFx = function(id) {
    var b = (window.DB.botConnectors || []).filter(function(x) { return x.id === id; })[0];
    if (!b) return;
    var name = document.getElementById('bot_ename').value.trim();
    if (name.length < 2) {
      var box = document.getElementById('boterr');
      box.style.display = '';
      box.innerHTML = 'A connector name is required.';
      return;
    }
    var platform = document.getElementById('bot_eplatform').value;
    var webhook = document.getElementById('bot_ewebhook').value.trim();
    b.name = name; b.platform = platform; b.webhookUrl = webhook;

    var persist = (b.dbId && window.__authToken)
      ? botsApiFetch('/api/bot-connectors/' + b.dbId, { method: 'PUT', body: JSON.stringify({ name: name, platform: platform, webhook_url: webhook }) })
      : Promise.resolve();

    persist.then(function() {
      window.closeDrawer();
      if (window.renderBotsFx) window.renderBotsFx();
      if (window.toast) window.toast('\\u2713 Saved <b>' + escapeHtml(name) + '</b>');
    }).catch(function(err) {
      var box = document.getElementById('boterr');
      if (box) {
        box.style.display = '';
        box.innerHTML = escapeHtml((err && err.message) || 'Save failed \\u2014 please try again.');
      }
    });
  };

  /* Same table markup as the original renderBotsFx — only the row now
     has a click handler (opens the new edit drawer) so an existing
     connector can actually be viewed/changed, not just deleted. */
  window.renderBotsFx = function() {
    var cnt = document.getElementById('cnt');
    if (!cnt) return;
    window.DB.botConnectors = window.DB.botConnectors || [];
    var rows = window.DB.botConnectors.map(function(b) {
      return '<tr style="cursor:pointer" onclick="editBotFx(\\'' + b.id + '\\')"><td><b>' + escapeHtml(b.name) + '</b></td><td>' + escapeHtml(b.platform) + '</td><td>' + escapeHtml(b.status) + '</td>' +
        '<td style="width:70px"><a style="color:#c9401a;cursor:pointer;font-size:12px" onclick="event.stopPropagation();delBotFx(\\'' + b.id + '\\')">Delete</a></td></tr>';
    }).join('') || '<tr><td colspan="4" style="color:#8794a8;text-align:center;padding:24px">No bot connectors yet.</td></tr>';
    cnt.innerHTML = '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \u203A Integrations</div>' +
      '<div class="tt"><h1>Bot Connectors</h1><div class="rt"><button class="btn" onclick="addBotFx()">+ Add Connector</button></div></div>' +
      '<div class="tabs"><div class="tb on">Connectors (' + window.DB.botConnectors.length + ')</div></div></div>' +
      '<div class="pbody"><div class="tblw"><table class="dt"><thead><tr><th>Name</th><th>Platform</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  };

})();
`;
