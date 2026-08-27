/* ============================================================
   MCM Cloud CX — Scripts + Script Editor Redesign Module
   Backend-ready Scripts list (Admin > Contact Center > Scripts) and a real
   per-script visual editor (Admin > Contact Center > Script Editor).

   scripts.ts ships both pages as static/demo-only:
   - DB.scriptsList is a hardcoded 3-item array; Create/Publish/Delete only
     mutate that in-memory array (a later inline IIFE in scripts.ts *does*
     wire Create/Publish/Delete to /api/scripts, but "Open editor" still
     always calls openPage('scripteditor') with no id — it can't, since
     scripts.ts's row markup never passes which script was clicked).
   - window.SCR is a single hardcoded object (one fixed demo script's pages/
     components/variables) — window.scriptView() always renders that same
     object no matter which script's "Open editor" you clicked, and its
     Save/Publish/Preview/+Page buttons are all `toast(...)`-only, wired to
     nothing (see database/schema.sql's comment on the `scripts` table).

   This module replaces both pages with real ones: the list always reflects
   backend state and "Open editor" opens the SPECIFIC script clicked, loading
   its own persisted canvas (scripts.content, a jsonb column shaped like
   window.SCR) — and Save/Publish/Preview/+Page/add-component/delete-component
   actually persist via /api/scripts.
   ============================================================ */

export const SCRIPTS_SCRIPT: string = `
(function() {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ─── REST helper — same contract as canned-redesign.ts's cannedApiFetch ─── */
  function scriptsApiFetch(path, init) {
    if (typeof window.apiFetch === 'function') return window.apiFetch(path, init);
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

  function safeAudit(action, detail) {
    if (typeof window.audit === 'function') { try { window.audit(action, detail); } catch (e) { /* noop */ } }
  }
  function safeToast(msg) {
    if (typeof window.toast === 'function') window.toast(msg);
  }

  /* ================= Scripts list ================= */

  var scriptsCache = [];
  var scriptsFilter = '';
  var queuesCache = [];

  /* Real queues (Admin > Contact Center > Queues), fetched alongside the
     scripts list purely to compute "Default on queues" per row and back
     the assignment picker — queues has no dedicated script column (see
     database/schema.sql); the assignment lives at queue.config.script,
     written via PUT /api/queues/<id>/script (a targeted jsonb_set so the
     rest of a queue's config round-trips untouched). */
  function fetchQueues() {
    return scriptsApiFetch('/api/queues?limit=500').then(function(rows) {
      queuesCache = Array.isArray(rows) ? rows : [];
      return queuesCache;
    }).catch(function() { return queuesCache; });
  }

  function queuesAssignedTo(scriptId) {
    return queuesCache.filter(function(q) { return q.config && String(q.config.script) === String(scriptId); });
  }

  function normalizeScriptRow(row) {
    return { id: row.id, name: row.name, type: row.type || '', published: !!row.published, content: row.content || {} };
  }

  var ScriptsService = {
    getAll: function() { return scriptsCache; },
    getById: function(id) { return scriptsCache.filter(function(s) { return String(s.id) === String(id); })[0] || null; },
    refresh: function() {
      return scriptsApiFetch('/api/scripts?limit=500').then(function(rows) {
        scriptsCache = (Array.isArray(rows) ? rows : []).map(normalizeScriptRow);
        return scriptsCache;
      }).catch(function() { return scriptsCache; });
    },
    create: function(name, type) {
      return scriptsApiFetch('/api/scripts', { method: 'POST', body: JSON.stringify({ name: name, type: type, published: false, content: {} }) })
        .then(normalizeScriptRow);
    },
    rename: function(id, name, type) {
      return scriptsApiFetch('/api/scripts/' + id, { method: 'PUT', body: JSON.stringify({ name: name, type: type }) }).then(normalizeScriptRow);
    },
    setPublished: function(id, published) {
      return scriptsApiFetch('/api/scripts/' + id, { method: 'PUT', body: JSON.stringify({ published: published }) }).then(normalizeScriptRow);
    },
    saveContent: function(id, content) {
      return scriptsApiFetch('/api/scripts/' + id, { method: 'PUT', body: JSON.stringify({ content: content }) }).then(normalizeScriptRow);
    },
    remove: function(id) {
      return scriptsApiFetch('/api/scripts/' + id, { method: 'DELETE' });
    },
    /* Full row including content — the list cache omits nothing today, but
       fetching fresh means a duplicate always copies the latest saved
       canvas even if scriptsCache is stale. */
    fetchFull: function(id) {
      return scriptsApiFetch('/api/scripts/' + id).then(normalizeScriptRow);
    },
    duplicate: function(id) {
      return ScriptsService.fetchFull(id).then(function(source) {
        var copyName = source.name + ' (Copy)';
        var n = 2;
        while (scriptsCache.some(function(s) { return s.name.toLowerCase() === copyName.toLowerCase(); })) {
          copyName = source.name + ' (Copy ' + n + ')';
          n++;
        }
        return scriptsApiFetch('/api/scripts', {
          method: 'POST',
          body: JSON.stringify({ name: copyName, type: source.type, published: false, content: source.content })
        }).then(normalizeScriptRow);
      });
    }
  };
  window.ScriptsService = ScriptsService;

  function scriptsCountLabel() {
    return 'All Scripts (' + scriptsCache.length + ')';
  }

  function filteredScripts() {
    var q = scriptsFilter.trim().toLowerCase();
    if (!q) return scriptsCache;
    return scriptsCache.filter(function(s) { return s.name.toLowerCase().indexOf(q) > -1 || (s.type || '').toLowerCase().indexOf(q) > -1; });
  }

  function renderScriptRow(s) {
    var assigned = queuesAssignedTo(s.id);
    var assignedHtml = assigned.length
      ? assigned.map(function(q) { return '<span class="tag">' + escapeHtml(q.name) + '</span>'; }).join(' ')
      : '<span class="lnk" style="font-size:11.5px">+ Assign</span>';
    return '<tr>' +
      '<td><b class="lnk" onclick="window.openScriptEditor(' + s.id + ')">' + escapeHtml(s.name) + '</b></td>' +
      '<td>' + escapeHtml(s.type || '\\u2014') + '</td>' +
      '<td>' + (s.published ? '<span class="st ok"><span class="d"></span>Published</span>' : '<span class="st wn"><span class="d"></span>Draft</span>') + '</td>' +
      '<td onclick="window.scriptsAssignQueues(' + s.id + ')" style="cursor:pointer">' + assignedHtml + '</td>' +
      '<td style="width:330px;white-space:nowrap">' +
        '<button class="rowbtn primary" onclick="window.openScriptEditor(' + s.id + ')">Open editor</button>' +
        '<button class="rowbtn" onclick="window.scriptsEditFx(' + s.id + ')">Edit</button>' +
        '<button class="rowbtn" onclick="window.scriptsDuplicateFx(' + s.id + ')">Duplicate</button>' +
        '<button class="rowbtn" onclick="window.scriptsTogglePublish(' + s.id + ')">' + (s.published ? 'Unpublish' : 'Publish') + '</button>' +
        '<button class="rowbtn danger" onclick="window.scriptsDelete(' + s.id + ')">Delete</button>' +
      '</td></tr>';
  }

  function renderScriptsTable() {
    var list = filteredScripts();
    var rows = list.length ? list.map(renderScriptRow).join('')
      : '<tr><td colspan="5" style="text-align:center;color:#8794a8;padding:28px 0">No scripts yet \\u2014 create one to get started.</td></tr>';
    return '<div class="tblw"><table class="dt"><thead><tr><th>Script</th><th>Type</th><th>Status</th><th>Default on queues</th><th></th></tr></thead><tbody id="scripts_tbody">' + rows + '</tbody></table></div>';
  }

  function refreshScriptsTable() {
    var wrap = document.getElementById('scripts_tablewrap');
    if (!wrap) { renderScriptsPage(); return; }
    wrap.innerHTML = renderScriptsTable();
    var countEl = document.getElementById('scripts_count');
    if (countEl) countEl.textContent = scriptsCountLabel();
  }

  function renderScriptsPage() {
    document.getElementById('cnt').innerHTML =
      '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A Contact Center</div>' +
      '<div class="tt"><h1>Scripts</h1><div class="rt"><button class="btn" onclick="window.scriptsAddFx()">+ Create Script</button></div></div>' +
      '<div class="tabs"><div class="tb on" id="scripts_count">' + scriptsCountLabel() + '</div></div></div>' +
      '<div class="pbody"><div class="tbar">' +
        '<input class="s" placeholder="Search scripts" oninput="window.scriptsSearch(this.value)">' +
        '<div class="sp"></div><div class="chip" onclick="window.scriptsReload()">\\u21BB Refresh</div>' +
      '</div><div id="scripts_tablewrap">' + renderScriptsTable() + '</div></div>' +
      (window.renderHelp ? window.renderHelp('scripts') : '');
  }

  window.scriptsSearch = function(v) { scriptsFilter = v || ''; refreshScriptsTable(); };
  window.scriptsReload = function() {
    Promise.all([ScriptsService.refresh(), fetchQueues()]).then(function() { renderScriptsPage(); safeToast('Scripts refreshed'); });
  };

  window.scriptsAddFx = function() {
    window.closeDrawer();
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw" style="height:auto;top:25%;bottom:auto;border-radius:8px 0 0 8px">' +
      '<div class="dh"><h2>Create Script</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div id="scerr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
      '<div class="fld"><label>Name *</label><input id="sc_name"></div>' +
      '<div class="fld"><label>Features</label><select id="sc_type"><option>Inbound</option><option>Outbound</option><option>Inbound + Outbound</option><option>Chat/Message</option></select></div></div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.scriptsSaveNew()">Create &amp; open editor</button></div></div>';
    document.body.appendChild(wrap.firstChild);
    setTimeout(function() { var el = document.getElementById('sc_name'); if (el) el.focus(); }, 0);
  };

  window.scriptsSaveNew = function() {
    var nameEl = document.getElementById('sc_name');
    var name = (nameEl.value || '').trim();
    var type = document.getElementById('sc_type').value;
    if (name.length < 2 || scriptsCache.some(function(s) { return s.name.toLowerCase() === name.toLowerCase(); })) {
      var box = document.getElementById('scerr');
      box.style.display = '';
      box.innerHTML = 'A unique script name is required.';
      return;
    }
    ScriptsService.create(name, type).then(function(created) {
      scriptsCache.push(created);
      safeAudit('Create script', name);
      window.closeDrawer();
      safeToast('Script created \\u2014 opening the editor');
      window.openScriptEditor(created.id);
    }).catch(function(err) {
      var box = document.getElementById('scerr');
      box.style.display = '';
      box.innerHTML = escapeHtml((err && err.message) || 'Could not create script \\u2014 please try again.');
    });
  };

  window.scriptsEditFx = function(id) {
    var s = ScriptsService.getById(id);
    if (!s) return;
    window.closeDrawer();
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw" style="height:auto;top:25%;bottom:auto;border-radius:8px 0 0 8px">' +
      '<div class="dh"><h2>Edit Script</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div id="scediterr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
      '<div class="fld"><label>Name *</label><input id="sce_name" value="' + escapeHtml(s.name) + '"></div>' +
      '<div class="fld"><label>Features</label><select id="sce_type">' +
        ['Inbound', 'Outbound', 'Inbound + Outbound', 'Chat/Message'].map(function(t) {
          return '<option' + (t === s.type ? ' selected' : '') + '>' + t + '</option>';
        }).join('') +
      '</select></div></div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.scriptsSaveEdit(' + id + ')">Save changes</button></div></div>';
    document.body.appendChild(wrap.firstChild);
    setTimeout(function() { var el = document.getElementById('sce_name'); if (el) el.focus(); }, 0);
  };

  window.scriptsSaveEdit = function(id) {
    var name = (document.getElementById('sce_name').value || '').trim();
    var type = document.getElementById('sce_type').value;
    if (name.length < 2 || scriptsCache.some(function(s) { return s.id !== id && s.name.toLowerCase() === name.toLowerCase(); })) {
      var box = document.getElementById('scediterr');
      box.style.display = '';
      box.innerHTML = 'A unique script name is required.';
      return;
    }
    ScriptsService.rename(id, name, type).then(function(updated) {
      var cached = ScriptsService.getById(id);
      if (cached) { cached.name = updated.name; cached.type = updated.type; }
      safeAudit('Edit script', name);
      window.closeDrawer();
      refreshScriptsTable();
      safeToast('\\u2713 Script updated');
    }).catch(function(err) {
      var box = document.getElementById('scediterr');
      box.style.display = '';
      box.innerHTML = escapeHtml((err && err.message) || 'Could not save changes \\u2014 please try again.');
    });
  };

  window.scriptsDuplicateFx = function(id) {
    var s = ScriptsService.getById(id);
    if (!s) return;
    ScriptsService.duplicate(id).then(function(copy) {
      scriptsCache.push(copy);
      safeAudit('Duplicate script', s.name + ' \\u2192 ' + copy.name);
      renderScriptsPage();
      safeToast('\\u2713 Duplicated as \\u201C' + escapeHtml(copy.name) + '\\u201D');
    }).catch(function() { safeToast('\\u2717 Could not duplicate script'); });
  };

  window.scriptsAssignQueues = function(id) {
    var s = ScriptsService.getById(id);
    if (!s) return;
    window.closeDrawer();
    var rows = queuesCache.length
      ? queuesCache.map(function(q) {
          var assignedId = q.config ? q.config.script : null;
          var checked = String(assignedId) === String(id);
          var otherName = (assignedId && !checked) ? (ScriptsService.getById(assignedId) || {}).name : null;
          return '<label style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f2f5f9;font-size:12.5px">' +
            '<input type="checkbox" data-qid="' + q.id + '"' + (checked ? ' checked' : '') + ' style="width:auto">' +
            '<span style="flex:1">' + escapeHtml(q.name) + '</span>' +
            (otherName ? '<span style="font-size:11px;color:#a9b4c4">currently: ' + escapeHtml(otherName) + '</span>' : '') +
            '</label>';
        }).join('')
      : '<div style="font-size:12px;color:#8794a8">No queues yet \\u2014 create one under Contact Center &gt; Queues first.</div>';
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw" style="height:auto;top:16%;bottom:auto;max-height:70vh;overflow:auto;border-radius:8px 0 0 8px">' +
      '<div class="dh"><h2>Assign \\u201C' + escapeHtml(s.name) + '\\u201D to queues</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div style="font-size:12px;color:#5b6b82;margin-bottom:8px;line-height:1.5">A queue can have one default script. Checking a queue already assigned elsewhere reassigns it to this script.</div>' + rows + '</div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.scriptsSaveQueueAssignments(' + id + ')">Save</button></div></div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.scriptsSaveQueueAssignments = function(id) {
    var boxes = document.querySelectorAll('#drw input[data-qid]');
    var updates = [];
    boxes.forEach(function(box) {
      var qid = box.getAttribute('data-qid');
      var q = queuesCache.filter(function(x) { return String(x.id) === String(qid); })[0];
      if (!q) return;
      var wasAssigned = q.config && String(q.config.script) === String(id);
      if (box.checked && !wasAssigned) updates.push({ q: q, scriptId: id });
      else if (!box.checked && wasAssigned) updates.push({ q: q, scriptId: null });
    });
    if (!updates.length) { window.closeDrawer(); return; }
    Promise.all(updates.map(function(u) {
      return scriptsApiFetch('/api/queues/' + u.q.id + '/script', { method: 'PUT', body: JSON.stringify({ script_id: u.scriptId }) })
        .then(function() { u.q.config = Object.assign({}, u.q.config, { script: u.scriptId }); });
    })).then(function() {
      safeAudit('Assign script to queues', ScriptsService.getById(id).name + ' \\u2192 ' + updates.length + ' queue(s)');
      window.closeDrawer();
      refreshScriptsTable();
      safeToast('\\u2713 Queue assignments saved');
    }).catch(function() {
      safeToast('\\u2717 Some assignments could not be saved \\u2014 please retry');
      window.closeDrawer();
      refreshScriptsTable();
    });
  };

  window.scriptsTogglePublish = function(id) {
    var s = ScriptsService.getById(id);
    if (!s) return;
    var next = !s.published;
    ScriptsService.setPublished(id, next).then(function(updated) {
      s.published = updated.published;
      safeAudit((next ? 'Publish' : 'Unpublish') + ' script', s.name);
      refreshScriptsTable();
      safeToast(next ? '\\u2713 Published' : 'Unpublished');
    }).catch(function() { safeToast('\\u2717 Could not update script'); });
  };

  /* scripts.ts's own confirmBox()/openDrawerHTML() are local to that file's
     closure, not exposed on window — same gap canned-redesign.ts's
     cannedConfirmBox works around. Self-contained equivalent here, using
     the same #drw/.dh/.db/.df drawer classes for a visually identical
     confirm dialog. */
  function scriptsConfirmBox(msg, onYes) {
    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw" style="height:auto;top:30%;bottom:auto;border-radius:8px 0 0 8px">' +
      '<div class="dh"><h2>Please confirm</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div style="font-size:13px;color:#33425c;line-height:1.6">' + msg + '</div></div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" id="scripts_cfyes">Confirm</button></div></div>';
    document.body.appendChild(wrap.firstChild);
    document.getElementById('scripts_cfyes').onclick = function() { window.closeDrawer(); onYes(); };
  }

  window.scriptsDelete = function(id) {
    var s = ScriptsService.getById(id);
    if (!s) return;
    scriptsConfirmBox('Delete script <b>' + escapeHtml(s.name) + '</b>?', function() { doScriptDelete(id, s); });
  };

  function doScriptDelete(id, s) {
    ScriptsService.remove(id).then(function() {
      scriptsCache = scriptsCache.filter(function(x) { return x.id !== id; });
      safeAudit('Delete script', s.name);
      safeToast('Script deleted');
      renderScriptsPage();
    }).catch(function() { safeToast('\\u2717 Could not delete script'); });
  }

  /* Intercept navigation to 'scripts' — it's snapshotted into scripts.ts's
     own DYN9 dispatch map at load time (DYN9.scripts = window.renderScriptsFx
     at that moment), so a plain reassignment of window.renderScriptsFx alone
     wouldn't be picked up by the router. Same wrap-openPage approach
     canned-redesign.ts uses for 'canned', which has the identical problem. */
  var prevOpenPageForScripts = window.openPage;
  window.openPage = function(id) {
    if (id === 'scripts') {
      window.closeDrawer();
      window.restoreAdmin();
      window.navMark('admin');
      window.APP.page = 'scripts';
      Promise.all([ScriptsService.refresh(), fetchQueues()]).then(renderScriptsPage);
      window.scrollTo(0, 0);
      return;
    }
    return prevOpenPageForScripts(id);
  };

  /* ================= Script Editor (per-script visual canvas) ================= */

  var COMPONENT_KIND_BY_LABEL = {
    'text block': 'text', 'rich text': 'text', 'heading': 'text', 'divider': 'text',
    'text input': 'field', 'number input': 'field', 'date picker': 'field', 'dropdown': 'field',
    'checkbox': 'field', 'radio group': 'field', 'text area': 'field',
    'action button': 'button', 'transfer button': 'button', 'secure flow button': 'button',
    'data action button': 'button', 'disposition picker': 'button',
    'data table': 'field', 'list': 'field', 'key/value pair': 'field', 'contact list field': 'field',
    'image': 'note', 'web page (iframe)': 'note', 'video': 'note',
    'group box': 'note', 'two column': 'note', 'tab set': 'note', 'page break': 'note'
  };

  var PALETTE = [
    ['Text', [['Text block', ''], ['Rich text', ''], ['Heading', ''], ['Divider', '']]],
    ['Input', [['Text input', 'b'], ['Number input', 'b'], ['Date picker', 'b'], ['Dropdown', 'b'], ['Checkbox', 'b'], ['Radio group', 'b'], ['Text area', 'b']]],
    ['Action', [['Action button', 'g'], ['Transfer button', 'g'], ['Secure flow button', 'r'], ['Data action button', 'g'], ['Disposition picker', 'g']]],
    ['Data', [['Data table', 'p'], ['List', 'p'], ['Key/value pair', 'p'], ['Contact list field', 'p']]],
    ['Media', [['Image', 'y'], ['Web page (iframe)', 'y'], ['Video', 'y']]],
    ['Layout', [['Group box', ''], ['Two column', ''], ['Tab set', ''], ['Page break', '']]]
  ];

  function newCompId() { return 'c' + Math.random().toString(36).slice(2, 9); }

  function defaultScriptContent(name) {
    var firstId = newCompId();
    return {
      name: name,
      page: 1,
      sel: firstId,
      pages: ['1. Greeting'],
      comps: { 1: [['text', firstId, 'Greeting', 'Hello {{Scripter.Customer Name}}, thank you for calling. My name is {{Scripter.Agent Name}} \\u2014 how can I help you today?']] },
      vars: [['Scripter.Customer Name', 'Built-in', 'string'], ['Scripter.Agent Name', 'Built-in', 'string'], ['Scripter.ANI', 'Built-in', 'string']]
    };
  }

  window.__editingScriptId = null;

  window.openScriptEditor = function(dbId) {
    window.__editingScriptId = dbId;
    scriptsApiFetch('/api/scripts/' + dbId).then(function(row) {
      var content = (row.content && Object.keys(row.content).length) ? row.content : defaultScriptContent(row.name);
      content.name = row.name;
      window.__editingScriptMeta = { id: row.id, name: row.name, type: row.type, published: !!row.published };
      window.SCR = content;
      if (!window.SCR.page) window.SCR.page = 1;
      window.go('admin');
      window.restoreAdmin();
      window.navMark('admin');
      window.APP.page = 'scripteditor';
      window.scriptView();
    }).catch(function() {
      safeToast('\\u2717 Could not load script');
    });
  };

  function currentScriptLabel() {
    var meta = window.__editingScriptMeta;
    if (!meta) return 'Untitled';
    return meta.name + (meta.published ? ' \\u00B7 published' : ' \\u00B7 draft');
  }

  function compKindFor(label) { return COMPONENT_KIND_BY_LABEL[label.toLowerCase()] || 'text'; }

  window.scAddComponent = function(label) {
    var S = window.SCR;
    if (!S) return;
    var kind = compKindFor(label);
    var id = newCompId();
    var list = S.comps[S.page] || (S.comps[S.page] = []);
    list.push([kind, id, label, kind === 'field' ? '' : 'Click to edit this ' + label.toLowerCase() + '.']);
    S.sel = id;
    window.scriptView();
  };

  window.scDeleteComponent = function() {
    var S = window.SCR;
    if (!S || !S.sel) return;
    var list = S.comps[S.page] || [];
    S.comps[S.page] = list.filter(function(c) { return c[1] !== S.sel; });
    S.sel = S.comps[S.page].length ? S.comps[S.page][0][1] : null;
    window.scriptView();
  };

  window.scUpdateCompField = function(field, value) {
    var S = window.SCR;
    if (!S || !S.sel) return;
    var list = S.comps[S.page] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i][1] === S.sel) {
        if (field === 'label') list[i][2] = value; else list[i][3] = value;
        break;
      }
    }
    /* Live-update the canvas node in place instead of a full re-render —
       a full innerHTML re-render on every keystroke would blow away focus
       on the input the user is actively typing in. */
    var node = document.getElementById('sc_' + field + '_' + S.sel);
    if (node) node.textContent = value;
  };

  window.scAddPage = function() {
    var S = window.SCR;
    if (!S) return;
    var name = window.prompt('Name this page (e.g. "5. Follow-up")', (S.pages.length + 1) + '. New page');
    if (!name) return;
    S.pages.push(name);
    S.page = S.pages.length;
    S.comps[S.page] = [];
    S.sel = null;
    window.scriptView();
  };

  window.scriptsSaveContent = function(showToast) {
    var S = window.SCR, meta = window.__editingScriptMeta;
    if (!S || !meta) return Promise.resolve();
    return ScriptsService.saveContent(meta.id, S).then(function() {
      var cached = ScriptsService.getById(meta.id);
      if (cached) cached.content = S;
      if (showToast !== false) safeToast('\\u2713 Script saved');
    }).catch(function() {
      if (showToast !== false) safeToast('\\u2717 Save failed \\u2014 please try again');
    });
  };

  window.scriptsPublishFromEditor = function() {
    var meta = window.__editingScriptMeta;
    if (!meta) return;
    var next = !meta.published;
    window.scriptsSaveContent(false).then(function() {
      return ScriptsService.setPublished(meta.id, next);
    }).then(function(updated) {
      meta.published = updated.published;
      var cached = ScriptsService.getById(meta.id);
      if (cached) cached.published = updated.published;
      safeAudit((next ? 'Publish' : 'Unpublish') + ' script', meta.name);
      safeToast(next ? '\\u2713 ' + escapeHtml(meta.name) + ' published' : 'Unpublished');
      window.scriptView();
    }).catch(function() { safeToast('\\u2717 Could not update script'); });
  };

  window.scriptsPreview = function() {
    var S = window.SCR;
    if (!S) return;
    window.closeDrawer();
    var body = S.pages.map(function(pageName, idx) {
      var comps = S.comps[idx + 1] || [];
      var inner = comps.length
        ? comps.map(function(c) { return '<div style="margin-bottom:10px"><b style="display:block;font-size:12.5px;color:#22304a">' + escapeHtml(c[2]) + '</b><span style="font-size:12.5px;color:#5b6b82">' + escapeHtml(c[3] || '') + '</span></div>'; }).join('')
        : '<div style="font-size:12px;color:#a9b4c4">No components on this page yet.</div>';
      return '<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:700;color:#6b7a90;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">' + escapeHtml(pageName) + '</div>' + inner + '</div>';
    }).join('');
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw" style="height:auto;top:8%;bottom:auto;max-height:80vh;overflow:auto;border-radius:8px 0 0 8px">' +
      '<div class="dh"><h2>Preview \\u2014 agent view</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db">' + body + '</div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Close preview</button></div></div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.scriptView = function() {
    var S = window.SCR, ws = document.getElementById('ws');
    if (!S || !ws) return;
    window.APP.view = 'script';

    var pl = '<div class="sr2"><input placeholder="Search components" oninput="scrFilter(this.value)"></div>';
    PALETTE.forEach(function(cat) {
      pl += '<div class="tcat">' + cat[0] + '<span>&#9662;</span></div>';
      cat[1].forEach(function(item) {
        pl += '<div class="titem" data-t="' + item[0].toLowerCase() + '" onclick="window.scAddComponent(\\'' + item[0].replace(/'/g, "\\\\'") + '\\')"><span class="ic ' + item[1] + '"></span>' + item[0] + '</div>';
      });
    });

    var comps = S.comps[S.page] || [];
    var body = comps.map(function(c) {
      var kind = c[0], id = c[1], label = c[2] || '', text = c[3] || '';
      var sel = (S.sel === id ? ' sel' : '');
      var inner;
      if (kind === 'note') {
        inner = '<div class="sclab">' + escapeHtml(label) + '</div><div style="font-size:12.5px;color:#33425c;background:#f5f7fa;border-left:3px solid #FF4F1F;padding:9px 11px;border-radius:0 4px 4px 0;line-height:1.6" id="sc_body_' + id + '">' + escapeHtml(text) + '</div>';
      } else if (kind === 'field') {
        inner = '<div class="sclab">' + escapeHtml(label) + '</div><div class="scfield" id="sc_body_' + id + '">' + (text ? escapeHtml(text) : '<span style="color:#a9b4c4">Enter ' + escapeHtml(label.toLowerCase()) + '</span>') + '</div>';
      } else if (kind === 'button') {
        inner = '<div class="sclab">Action button</div><span class="scbtn" id="sc_body_' + id + '">&#128274; ' + escapeHtml(label) + '</span>';
      } else {
        inner = '<div class="sclab">Text</div><div style="font-size:13.5px;color:#22304a;line-height:1.65"><b style="display:block;margin-bottom:4px;font-size:15px" id="sc_label_' + id + '">' + escapeHtml(label) + '</b><span id="sc_body_' + id + '">' + escapeHtml(text) + '</span></div>';
      }
      return '<div class="sccomp' + sel + '" id="sc_comp_' + id + '" onclick="scrSel(\\'' + id + '\\')">' + inner + '</div>';
    }).join('');

    var selComp = comps.filter(function(c) { return c[1] === S.sel; })[0];
    var pr;
    if (selComp) {
      pr = '<div class="pf" style="background:#f5f7fa;font-size:11px;font-weight:700;color:#6b7a90;text-transform:uppercase;letter-spacing:.5px">Component</div>' +
        '<div class="pf"><label>Label</label><input value="' + escapeHtml(selComp[2] || '') + '" oninput="window.scUpdateCompField(\\'label\\', this.value)"></div>' +
        '<div class="pf"><label>Text</label><textarea style="min-height:70px" oninput="window.scUpdateCompField(\\'body\\', this.value)">' + escapeHtml(selComp[3] || '') + '</textarea></div>' +
        '<div class="pf"><button class="btn gh" style="width:100%" onclick="window.scDeleteComponent()">Delete component</button></div>';
    } else {
      pr = '<div class="pf" style="font-size:12px;color:#8794a8">Select a component to edit its properties, or add one from the palette on the left.</div>';
    }

    var vr = (S.vars || []).map(function(v) {
      return '<div style="display:flex;gap:8px;font-size:11.5px;padding:4px 0;border-bottom:1px solid #f2f5f9"><span style="flex:1;color:#22304a">' + escapeHtml(v[0]) + '</span><span class="tag' + (v[1] === 'Built-in' ? '' : ' o') + '">' + escapeHtml(v[1]) + '</span><span style="color:#8794a8;width:52px;text-align:right">' + escapeHtml(v[2]) + '</span></div>';
    }).join('');

    var tabs = S.pages.map(function(p, i) {
      return '<button class="abtn' + (S.page === i + 1 ? ' pri' : '') + '" onclick="scrPage(' + (i + 1) + ')">' + escapeHtml(p) + '</button>';
    }).join(' ');

    ws.innerHTML = '<div class="scv"><div class="archbar"><span class="ttl">MCM Script Editor</span><span class="crumb">&#8250; <b style="color:#fff">' + escapeHtml(currentScriptLabel()) + '</b></span><span class="sp"></span>' +
      '<button class="abtn" onclick="window.scriptsPreview()">Preview</button>' +
      '<button class="abtn" onclick="window.scriptsSaveContent()">Save</button>' +
      '<button class="abtn pri" onclick="window.scriptsPublishFromEditor()">' + (window.__editingScriptMeta && window.__editingScriptMeta.published ? 'Unpublish' : 'Publish') + '</button>' +
      '<button class="abtn" onclick="window.scriptsSaveContent(false).then(function(){go(\\'admin\\');openPage(\\'scripts\\');})">Close</button></div>' +
      '<div style="background:#fff;border-bottom:1px solid #dde3ec;padding:8px 14px;display:flex;gap:7px;align-items:center"><span style="font-size:11px;font-weight:700;color:#6b7a90;text-transform:uppercase;letter-spacing:.5px;margin-right:6px">Pages</span>' +
      tabs.replace(/class="abtn/g, 'class="pgbtn abtn') + '<button class="abtn" style="background:#eef2f8;color:#33425c;border-color:#cfd7e3" onclick="window.scAddPage()">+ Page</button></div>' +
      '<div class="archmain"><div class="tbox"><div class="th">Components</div>' + pl + '</div>' +
      '<div class="sccanvas"><div class="scpage"><div class="sctitle">' + escapeHtml(S.name || '') + ' &mdash; ' + escapeHtml(S.pages[S.page - 1] || '') + '</div>' + (body || '<div style="font-size:12px;color:#a9b4c4;padding:20px">No components on this page yet \\u2014 add one from the palette.</div>') + '</div></div>' +
      '<div class="props"><div class="ph">Properties</div>' + pr +
      '<div class="pf" style="background:#f5f7fa;font-size:11px;font-weight:700;color:#6b7a90;text-transform:uppercase;letter-spacing:.5px">Variables</div>' +
      '<div class="pf">' + (vr || '<span style="font-size:11.5px;color:#a9b4c4">No variables defined.</span>') + '</div></div></div>' +
      '<div class="archfoot"><span>' + comps.length + ' components on page</span><span>' + S.pages.length + ' pages</span><span>' + (S.vars || []).length + ' variables</span></div></div>';
  };

  /* 'scripteditor' is handled by a plain \`if(id==='scripteditor'){...return window.scriptView();}\`
     branch inside scripts.ts's openPage (not one of its DYN* snapshot maps),
     so a live reassignment of window.scriptView above is picked up
     correctly with no need to also wrap openPage for it. */
})();
`;
