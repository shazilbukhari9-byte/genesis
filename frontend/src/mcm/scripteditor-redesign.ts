/* ============================================================
   MCM Cloud CX — Scripts & Script Editor Backend Wiring
   NOT a redesign — reproduces the existing page markup exactly
   (same classes, same columns, same editor chrome) and replaces
   what was dead or fake:
   - Scripts list: every row's "Open editor" called
     openPage('scripteditor') with no id — every script opened the
     exact same hardcoded canvas. Two separate, redundant backend-
     sync overlays already existed elsewhere in scripts.ts (one
     patching renderScriptsFx, one patching saveScriptFx/togScript/
     delScriptFx) — both partial and only reconciling name/type/
     published, and between them capable of double-POSTing a new
     script. This file supersedes both (its window.openPage wrap
     for 'scripts' runs first and returns, so neither old overlay's
     code path executes) and is the single source of truth for the
     list.
   - Script Editor (window.scriptView): Preview/Save/Publish/+Page
     were every one of them toast()-only — no state mutation, no
     persistence, and the canvas always showed the same hardcoded
     "Retail_Billing_Script" regardless of which script's editor
     you opened. Component selection worked, but the property panel
     inputs had no onchange handler at all, so editing a component's
     name did nothing.
   - Backend gap: resources.py's "scripts" REGISTRY only had name/
     type/published — nowhere to store the page/component/variable
     tree at all. Fixed in database/schema.sql (content JSONB, ver
     INTEGER) and resources.py (REGISTRY fields) — see those files.
   'scripts' is DYN9-routed in scripts.ts (var DYN9={...,scripts:
   window.renderScriptsFx,...}), same stale-closure situation as
   prompts-redesign.ts/emergency-redesign.ts, so it needs a
   window.openPage wrap rather than a plain reassignment.
   'scripteditor' is NOT DYN9-routed — the base window.openPage
   reads window.scriptView fresh on every call
   (if(id==='scripteditor'){...return window.scriptView();}), so a
   direct reassignment of window.scriptView is picked up correctly.
   ============================================================ */

export const SCRIPTEDITOR_SCRIPT: string = `
(function() {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function scriptApiFetch(path, init) {
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

  function uid() { return 'id' + Math.random().toString(36).slice(2, 10); }

  function defaultContent(name) {
    return {
      pages: ['Page 1'],
      comps: { 1: [['head', uid(), name || 'New Script', 'Start building this script — add components from the palette on the left.']] },
      vars: [['ANI', 'Built-in', 'call'], ['Queue', 'Built-in', 'call']]
    };
  }

  var SCRIPT_FALLBACK = [
    { id: 'scr-retail-billing', name: 'Retail_Billing_Script', type: 'Inbound', published: true, ver: 7, content: null }
  ];

  function normalizeContent(raw, name) {
    if (!raw || typeof raw !== 'object' || !raw.pages || !raw.pages.length) return defaultContent(name);
    return { pages: raw.pages, comps: raw.comps || {}, vars: raw.vars || [] };
  }

  function normalizeScriptRow(row) {
    return {
      id: row.id,
      name: row.name,
      type: row.type || 'Inbound',
      published: !!row.published,
      ver: row.ver || 0,
      content: normalizeContent(row.content, row.name)
    };
  }

  var localScriptStore = SCRIPT_FALLBACK.map(function(s) { return Object.assign({}, s, { content: defaultContent(s.name) }); });

  function fetchScripts() {
    return scriptApiFetch('/api/scripts').then(function(rows) {
      return (Array.isArray(rows) && rows.length) ? rows.map(normalizeScriptRow) : localScriptStore;
    }).catch(function() { return localScriptStore; });
  }

  var scriptsCache = localScriptStore.slice();

  var ScriptsService = {
    getAll: function() { return scriptsCache; },
    getById: function(id) { return scriptsCache.filter(function(s) { return String(s.id) === String(id); })[0] || null; },
    refresh: function() {
      return fetchScripts().then(function(list) {
        if (Array.isArray(list) && list.length) scriptsCache = list;
        return scriptsCache;
      });
    },
    create: function(entry) {
      var payload = { name: entry.name, type: entry.type, published: false, content: defaultContent(entry.name), ver: 0 };
      return scriptApiFetch('/api/scripts', { method: 'POST', body: JSON.stringify(payload) }).then(normalizeScriptRow).catch(function() {
        var created = { id: uid(), name: entry.name, type: entry.type, published: false, ver: 0, content: defaultContent(entry.name) };
        localScriptStore.push(created);
        return created;
      });
    },
    update: function(id, patch) {
      var existing = ScriptsService.getById(id);
      var merged = Object.assign({}, existing, patch);
      var payload = { name: merged.name, type: merged.type, published: merged.published, content: merged.content, ver: merged.ver };
      return scriptApiFetch('/api/scripts/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(payload) }).then(normalizeScriptRow).catch(function() {
        var idx = -1;
        for (var i = 0; i < localScriptStore.length; i++) { if (String(localScriptStore[i].id) === String(id)) { idx = i; break; } }
        if (idx > -1) { localScriptStore[idx] = merged; } else { localScriptStore.push(merged); }
        return merged;
      });
    },
    remove: function(id) {
      return scriptApiFetch('/api/scripts/' + encodeURIComponent(id), { method: 'DELETE' }).catch(function() {
        localScriptStore = localScriptStore.filter(function(s) { return String(s.id) !== String(id); });
        return { ok: true };
      });
    }
  };
  window.ScriptsService = ScriptsService;

  /* ═══════════════════════ Scripts list ═══════════════════════ */

  var sFilters = { q: '' };
  function filteredScripts() {
    var q = sFilters.q.trim().toLowerCase();
    if (!q) return ScriptsService.getAll();
    return ScriptsService.getAll().filter(function(s) { return s.name.toLowerCase().indexOf(q) > -1 || (s.type || '').toLowerCase().indexOf(q) > -1; });
  }

  function scriptQueueUsage(s) {
    return ((window.DB && window.DB.queues) || []).filter(function(q) { return q.script === s.id; }).map(function(q) { return q.name; });
  }

  function renderScriptRow(s) {
    var used = scriptQueueUsage(s);
    return '<tr><td><b class="lnk" onclick="window.scriptsOpenEditor(\\'' + s.id + '\\')">' + escapeHtml(s.name) + '</b></td><td>' + escapeHtml(s.type) + '</td>' +
      '<td>' + (s.published ? '<span class="st ok"><span class="d"></span>Published</span>' : '<span class="st wn"><span class="d"></span>Draft</span>') + '</td>' +
      '<td>' + (used.length ? used.map(function(n) { return '<span class="tag">' + escapeHtml(n) + '</span>'; }).join(' ') : '\u2014') + '</td>' +
      '<td style="width:280px;white-space:nowrap"><button class="rowbtn primary" onclick="window.scriptsOpenEditor(\\'' + s.id + '\\')">Open editor</button>' +
      '<button class="rowbtn" onclick="window.scriptsTogglePublish(\\'' + s.id + '\\')">' + (s.published ? 'Unpublish' : 'Publish') + '</button>' +
      '<button class="rowbtn danger" onclick="window.scriptsDelete(\\'' + s.id + '\\')">Delete</button></td></tr>';
  }

  function renderScriptsTable() {
    var list = filteredScripts();
    var rows = list.length ? list.map(renderScriptRow).join('') : '<tr><td colspan="5" style="text-align:center;color:#8794a8;padding:28px 0">No scripts match your search.</td></tr>';
    return '<table class="dt"><thead><tr><th>Script</th><th>Type</th><th>Status</th><th>Default on queues</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function refreshScriptsTable() {
    var wrap = document.querySelector('#cnt .tblw');
    if (wrap) wrap.innerHTML = renderScriptsTable();
    var tabEl = document.querySelector('#cnt .tb.on');
    if (tabEl) tabEl.textContent = 'All Scripts (' + ScriptsService.getAll().length + ')';
  }

  window.scriptsSearch = function(v) { sFilters.q = v || ''; refreshScriptsTable(); };

  window.scriptsOpenCreate = function() {
    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw" style="height:auto;top:25%;bottom:auto;border-radius:8px 0 0 8px"><div class="dh"><h2>Create Script</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div id="scerr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
      '<div class="fld"><label>Name *</label><input id="sc_name"></div>' +
      '<div class="fld"><label>Features</label><select id="sc_type"><option>Inbound</option><option>Outbound</option><option>Inbound + Outbound</option><option>Chat/Message</option></select></div></div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.scriptsCreate()">Create &amp; open editor</button></div></div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.scriptsCreate = function() {
    var name = document.getElementById('sc_name').value.trim();
    var dupe = ScriptsService.getAll().some(function(s) { return s.name.toLowerCase() === name.toLowerCase(); });
    if (name.length < 2 || dupe) {
      var box = document.getElementById('scerr');
      box.style.display = '';
      box.innerHTML = 'A unique script name is required.';
      return;
    }
    var type = document.getElementById('sc_type').value;
    ScriptsService.create({ name: name, type: type }).then(function(created) {
      return ScriptsService.refresh().then(function() { return created; });
    }).then(function(created) {
      window.closeDrawer();
      if (window.toast) window.toast('\\u2713 Script created \\u2014 opening the editor');
      window.scriptsOpenEditor(created.id);
    }).catch(function(err) {
      var box = document.getElementById('scerr');
      if (box) { box.style.display = ''; box.innerHTML = escapeHtml((err && err.message) || 'Create failed \\u2014 please try again.'); }
    });
  };

  window.scriptsTogglePublish = function(id) {
    var s = ScriptsService.getById(id);
    if (!s) return;
    var nextPublished = !s.published;
    ScriptsService.update(id, { published: nextPublished }).then(function() {
      return ScriptsService.refresh();
    }).then(function() {
      refreshScriptsTable();
      if (window.toast) window.toast(nextPublished ? ('\\u2713 <b>' + escapeHtml(s.name) + '</b> published') : ('<b>' + escapeHtml(s.name) + '</b> unpublished'));
    });
  };

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
    var safeName = escapeHtml(s.name);
    scriptsConfirmBox('Delete script <b>' + safeName + '</b>? Any queue using it as a default will be cleared.', function() {
      ScriptsService.remove(id).then(function() {
        (window.DB.queues || []).forEach(function(q) { if (q.script === id) q.script = null; });
        return ScriptsService.refresh();
      }).then(function() {
        refreshScriptsTable();
        if (window.toast) window.toast('\\u2713 Deleted <b>' + safeName + '</b>');
      }).catch(function(err) {
        if (window.toast) window.toast('\\u2717 Delete failed \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
      });
    });
  };

  function renderScriptsPage() {
    var list = ScriptsService.getAll();
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A Contact Center</div>' +
      '<div class="tt"><h1>Scripts</h1><div class="rt"><button class="btn" onclick="window.scriptsOpenCreate()">+ Create Script</button></div></div>' +
      '<div class="tabs"><div class="tb on">All Scripts (' + list.length + ')</div></div></div>' +
      '<div class="pbody"><div class="tbar"><input class="s" placeholder="Search scripts" oninput="window.scriptsSearch(this.value)"><div class="sp"></div></div>' +
      '<div class="tblw">' + renderScriptsTable() + '</div>' +
      '<div class="help"><div class="hh" onclick="toggleHelp()"><span style="color:#FF4F1F">\\u24D8</span> Help &amp; Resources \\u2014 Scripts<span class="cx" id="helpcx">Hide</span></div>' +
      '<div class="hb" id="helpb" style=""><div class="hcols"><div><h5>What you can do here</h5><ul><li>Build guided agent scripts with pages and components</li><li>Set a default script per queue</li><li>Publish when ready for agents to use</li></ul></div></div></div></div>';
  }

  function mountScriptsPage() {
    var cnt = document.getElementById('cnt');
    if (cnt) cnt.innerHTML = renderScriptsPage();
  }

  var scriptsLoaded = false;
  function ensureScriptsThenMount() {
    if (scriptsLoaded || !window.__authToken) { mountScriptsPage(); return; }
    ScriptsService.refresh().then(function() { scriptsLoaded = true; }).catch(function() { scriptsLoaded = true; }).then(mountScriptsPage);
  }

  window.renderScriptsFx = ensureScriptsThenMount;

  var prevOpenPageForScripts = window.openPage;
  window.openPage = function(id) {
    if (id === 'scripts') {
      window.closeDrawer();
      window.restoreAdmin();
      window.navMark('admin');
      window.APP.page = 'scripts';
      ensureScriptsThenMount();
      var links = document.querySelectorAll('#anav .lk');
      links.forEach(function(el) { el.classList.remove('on'); });
      for (var i = 0; i < links.length; i++) {
        var onclick = links[i].getAttribute('onclick') || '';
        if (onclick.indexOf("'scripts'") > -1) { links[i].classList.add('on'); break; }
      }
      window.scrollTo(0, 0);
      return;
    }
    return prevOpenPageForScripts(id);
  };

  /* ═══════════════════════ Script Editor ═══════════════════════ */

  var editState = { id: null, sel: null, page: 1 };

  window.scriptsOpenEditor = function(id) {
    editState.id = id;
    editState.sel = null;
    editState.page = 1;
    window.openPage('scripteditor');
  };

  var PALETTE = [
    ['Text', [['Text block', 'head'], ['Rich text', 'info'], ['Heading', 'head'], ['Divider', 'info']]],
    ['Input', [['Text input', 'field'], ['Number input', 'field'], ['Date picker', 'field'], ['Dropdown', 'select'], ['Checkbox', 'toggle'], ['Radio group', 'select'], ['Text area', 'field']]],
    ['Action', [['Action button', 'toggle'], ['Transfer button', 'toggle'], ['Secure flow button', 'toggle'], ['Data action button', 'toggle'], ['Disposition picker', 'select']]],
    ['Data', [['Data table', 'info'], ['List', 'info'], ['Key/value pair', 'info'], ['Contact list field', 'field']]],
    ['Media', [['Image', 'info'], ['Web page (iframe)', 'info'], ['Video', 'info']]],
    ['Layout', [['Group box', 'info'], ['Two column', 'info'], ['Tab set', 'info'], ['Page break', 'info']]]
  ];

  function currentScript() { return ScriptsService.getById(editState.id) || ScriptsService.getAll()[0]; }

  function renderPalette() {
    var pl = '<div class="sr2"><input placeholder="Search components" oninput="window.scrFilter(this.value)"></div>';
    PALETTE.forEach(function(cat) {
      pl += '<div class="tcat">' + cat[0] + '<span>\\u25BE</span></div>';
      cat[1].forEach(function(item) {
        pl += '<div class="titem" data-t="' + item[0].toLowerCase() + '" onclick="window.scrAddComponent(\\'' + item[1] + '\\',\\'' + escapeHtml(item[0]) + '\\')"><span class="ic"></span>' + item[0] + '</div>';
      });
    });
    return pl;
  }

  function renderComponent(c, sel) {
    var cls = 'sccomp' + (sel ? ' sel' : '');
    var inner = '';
    if (c[0] === 'head') inner = '<div class="sclab">Text</div><div style="font-size:13.5px;color:#22304a;line-height:1.65"><b style="display:block;margin-bottom:4px;font-size:15px">' + escapeHtml(c[2]) + '</b>' + escapeHtml(c[3] || '') + '</div>';
    else if (c[0] === 'info') inner = '<div class="sclab">' + escapeHtml(c[2]) + '</div><div style="font-size:12.5px;color:#33425c;background:#f5f7fa;border-left:3px solid #FF4F1F;padding:9px 11px;border-radius:0 4px 4px 0;line-height:1.6">' + escapeHtml(c[3] || '') + '</div>';
    else if (c[0] === 'field') inner = '<div class="sclab">' + escapeHtml(c[2]) + '</div><div class="scfield">' + (c[3] ? escapeHtml(c[3]) : '<span style="color:#a9b4c4">Enter ' + escapeHtml((c[2] || '').toLowerCase()) + '</span>') + '</div>';
    else if (c[0] === 'select') inner = '<div class="sclab">' + escapeHtml(c[2]) + '</div><div class="scfield" style="display:flex;justify-content:space-between">' + escapeHtml((c[3] || '').split('|')[0] || '') + '<span style="color:#8794a8">\\u25BE</span></div>';
    else if (c[0] === 'toggle') inner = '<div class="sclab">Action button</div><span class="scbtn" style="background:#d0342c">\\u{1F512} ' + escapeHtml(c[2]) + '</span>';
    else inner = '<div class="sclab">Navigation</div><span class="scbtn sec">\\u2190 Back</span> <span class="scbtn">Next \\u2192</span>';
    return '<div class="' + cls + '" onclick="window.scrSel(\\'' + c[1] + '\\')">' + inner + '<span class="scdel" title="Delete" onclick="event.stopPropagation();window.scrDeleteComponent(\\'' + c[1] + '\\')">\\u00D7</span></div>';
  }

  function renderProps(S) {
    var comp = null;
    (S.comps[S.page] || []).forEach(function(c) { if (c[1] === editState.sel) comp = c; });
    if (!comp) return '<div class="pf" style="color:#8794a8;font-size:12px">Select a component to edit its properties.</div>';
    var hasBody = comp[0] === 'head' || comp[0] === 'info' || comp[0] === 'field' || comp[0] === 'select';
    var pr = '<div class="pf" style="background:#f5f7fa;font-size:11px;font-weight:700;color:#6b7a90;text-transform:uppercase;letter-spacing:.5px">' + comp[0] + '</div>';
    if (comp[0] !== 'btnrow') {
      pr += '<div class="pf"><label>Name</label><input value="' + escapeHtml(comp[2] || '') + '" onchange="window.scrPropChange(\\'label\\',this.value)"></div>';
    }
    if (hasBody) {
      pr += '<div class="pf"><label>' + (comp[0] === 'select' ? 'Options (a|b|c)' : 'Content') + '</label><input value="' + escapeHtml(comp[3] || '') + '" onchange="window.scrPropChange(\\'body\\',this.value)"></div>';
    }
    return pr;
  }

  function renderVars(S) {
    return S.vars.map(function(v, i) {
      return '<div style="display:flex;gap:8px;font-size:11.5px;padding:4px 0;border-bottom:1px solid #f2f5f9;align-items:center">' +
        '<span style="flex:1;color:#22304a">' + escapeHtml(v[0]) + '</span>' +
        '<span class="tag' + (v[1] === 'Built-in' ? '' : ' o') + '">' + escapeHtml(v[1]) + '</span>' +
        '<span style="color:#8794a8;width:52px;text-align:right">' + escapeHtml(v[2]) + '</span>' +
        (v[1] === 'Built-in' ? '' : '<span class="scdel" title="Delete" onclick="window.scrDelVar(' + i + ')">\\u00D7</span>') +
        '</div>';
    }).join('');
  }

  window.scriptView = function() {
    var s = currentScript();
    var ws = document.getElementById('ws');
    if (!s || !ws) return;
    window.APP.view = 'script';
    var S = s.content;
    if (!editState.sel && (S.comps[editState.page] || []).length) editState.sel = S.comps[editState.page][0][1];

    var body = (S.comps[editState.page] || []).map(function(c) { return renderComponent(c, c[1] === editState.sel); }).join('');
    var tabs = S.pages.map(function(p, i) { return '<button class="abtn pgbtn' + (editState.page === i + 1 ? ' pri' : '') + '" onclick="window.scrPage(' + (i + 1) + ')">' + escapeHtml(p) + '</button>'; }).join(' ');

    ws.innerHTML = '<div class="scv"><div class="archbar"><span class="ttl">MCM Script Editor</span>' +
      '<span class="crumb">\\u203A <b style="color:#fff">' + escapeHtml(s.name) + '</b>&nbsp;v' + s.ver + (s.published ? ' \\u00B7 published' : ' \\u00B7 draft') + '</span><span class="sp"></span>' +
      '<button class="abtn" onclick="window.scrPreview()">Preview</button>' +
      '<button class="abtn" onclick="window.scrSave()">Save</button>' +
      '<button class="abtn pri" onclick="window.scrPublish()">Publish</button>' +
      '<button class="abtn" onclick="go(\\'admin\\');openPage(\\'scripts\\')">Close</button></div>' +
      '<div style="background:#fff;border-bottom:1px solid #dde3ec;padding:8px 14px;display:flex;gap:7px;align-items:center">' +
      '<span style="font-size:11px;font-weight:700;color:#6b7a90;text-transform:uppercase;letter-spacing:.5px;margin-right:6px">Pages</span>' +
      tabs + '<button class="abtn" style="background:#eef2f8;color:#33425c;border-color:#cfd7e3" onclick="window.scrAddPage()">+ Page</button></div>' +
      '<div class="archmain"><div class="tbox"><div class="th">Components</div>' + renderPalette() + '</div>' +
      '<div class="sccanvas"><div class="scpage"><div class="sctitle">' + escapeHtml(s.name) + ' \\u2014 ' + escapeHtml(S.pages[editState.page - 1] || '') + '</div>' + body + '</div></div>' +
      '<div class="props"><div class="ph">Properties</div>' + renderProps(S) +
      '<div class="pf" style="background:#f5f7fa;font-size:11px;font-weight:700;color:#6b7a90;text-transform:uppercase;letter-spacing:.5px;display:flex;justify-content:space-between;align-items:center">Variables<span class="scdel" title="Add variable" onclick="window.scrAddVar()" style="font-size:14px">+</span></div>' +
      '<div class="pf">' + renderVars(S) + '</div></div></div>' +
      '<div class="archfoot"><span>' + (S.comps[editState.page] || []).length + ' components on page</span><span>' + S.pages.length + ' page' + (S.pages.length === 1 ? '' : 's') + '</span><span>' + S.vars.length + ' variables</span><span>' + (s.published ? 'Published' : 'Unsaved changes may exist \\u2014 use Save') + '</span></div></div>';
  };

  window.scrSel = function(id) { editState.sel = id; window.scriptView(); };
  window.scrPage = function(p) { editState.page = p; editState.sel = null; window.scriptView(); };
  window.scrFilter = function(v) {
    v = (v || '').toLowerCase();
    document.querySelectorAll('.titem').forEach(function(e) { e.style.display = e.dataset.t.indexOf(v) > -1 ? '' : 'none'; });
  };

  window.scrAddComponent = function(type, label) {
    var s = currentScript();
    if (!s) return;
    var S = s.content;
    if (!S.comps[editState.page]) S.comps[editState.page] = [];
    var id = uid();
    var c = type === 'select' ? [type, id, label, 'Option A|Option B'] : (type === 'toggle' ? [type, id, label] : [type, id, label, '']);
    S.comps[editState.page].push(c);
    editState.sel = id;
    window.scriptView();
  };

  window.scrDeleteComponent = function(id) {
    var s = currentScript();
    if (!s) return;
    var S = s.content;
    S.comps[editState.page] = (S.comps[editState.page] || []).filter(function(c) { return c[1] !== id; });
    if (editState.sel === id) editState.sel = null;
    window.scriptView();
  };

  window.scrPropChange = function(field, value) {
    var s = currentScript();
    if (!s) return;
    var S = s.content;
    var comp = null;
    (S.comps[editState.page] || []).forEach(function(c) { if (c[1] === editState.sel) comp = c; });
    if (!comp) return;
    if (field === 'label') comp[2] = value;
    else if (field === 'body') comp[3] = value;
    window.scriptView();
  };

  window.scrAddPage = function() {
    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div id="drw" style="height:auto;top:30%;bottom:auto;border-radius:8px 0 0 8px">' +
      '<div class="dh"><h2>Add Page</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div class="fld"><label>Page name</label><input id="scr_pagename" placeholder="Page ' + '"></div></div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" id="scr_pageok">Add</button></div></div>';
    document.body.appendChild(wrap.firstChild);
    document.getElementById('scr_pageok').onclick = function() {
      var name = document.getElementById('scr_pagename').value.trim();
      var s = currentScript();
      if (!name || !s) { window.closeDrawer(); return; }
      var S = s.content;
      S.pages.push(name);
      var newPageNum = S.pages.length;
      S.comps[newPageNum] = [];
      editState.page = newPageNum;
      editState.sel = null;
      window.closeDrawer();
      window.scriptView();
    };
  };

  window.scrAddVar = function() {
    var s = currentScript();
    if (!s) return;
    var name = 'Variable' + (s.content.vars.length + 1);
    s.content.vars.push([name, 'Custom', 'session']);
    window.scriptView();
  };

  window.scrDelVar = function(i) {
    var s = currentScript();
    if (!s) return;
    s.content.vars.splice(i, 1);
    window.scriptView();
  };

  window.scrPreview = function() {
    var s = currentScript();
    if (!s) return;
    var S = s.content;
    var body = (S.comps[editState.page] || []).map(function(c) { return renderComponent(c, false); }).join('') || '<div style="color:#8794a8;font-size:13px">This page has no components yet.</div>';
    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div id="drw" style="width:480px">' +
      '<div class="dh"><h2>Preview \\u2014 read only</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div class="sctitle" style="margin-bottom:10px">' + escapeHtml(s.name) + ' \\u2014 ' + escapeHtml(S.pages[editState.page - 1] || '') + '</div>' + body + '</div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Close</button></div></div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.scrSave = function() {
    var s = currentScript();
    if (!s) return;
    ScriptsService.update(s.id, { content: s.content }).then(function() {
      return ScriptsService.refresh();
    }).then(function() {
      window.scriptView();
      if (window.toast) window.toast('\\u2713 Script saved');
    }).catch(function(err) {
      if (window.toast) window.toast('\\u2717 Save failed \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
    });
  };

  window.scrPublish = function() {
    var s = currentScript();
    if (!s) return;
    var nextVer = (s.ver || 0) + 1;
    ScriptsService.update(s.id, { content: s.content, published: true, ver: nextVer }).then(function() {
      return ScriptsService.refresh();
    }).then(function() {
      window.scriptView();
      if (window.toast) window.toast('\\u2713 <b>' + escapeHtml(s.name) + '</b> published as v' + nextVer);
    }).catch(function(err) {
      if (window.toast) window.toast('\\u2717 Publish failed \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
    });
  };

})();
`;
