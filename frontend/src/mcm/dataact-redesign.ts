/* ============================================================
   MCM Cloud CX — Data Actions Backend Wiring
   NOT a redesign — reproduces the existing page markup exactly
   (same classes, same columns, same drawer layout) and replaces
   only what was dead: Search/Division/Status filters called a
   dirFilterSet() that doesn't exist anywhere in this codebase,
   "+ Create Action" and every row opened a drawer with no editor
   registered (window.drawer('dataact') just toasted "No editor is
   defined for this object yet"), and there was no Test Action or
   Delete at all. An Integration filter chip is added — the page's
   own Integration column had no way to filter by it. Contracts /
   Test / Run History (the page's other three tabs) are untouched —
   still the original static reference tables from scripts.ts.
   ============================================================ */

export const DATAACT_SCRIPT: string = `
(function() {
  'use strict';

  var DIVISIONS = [
    { code: 'd_home', label: 'Home' },
    { code: 'd_ret', label: 'UK Retail' },
    { code: 'd_dig', label: 'UK Digital' },
    { code: 'd_col', label: 'UK Collections' },
    { code: 'd_man', label: 'Partner \\u2014 Manila' }
  ];

  function divisionLabel(code) {
    var m = DIVISIONS.filter(function(d) { return d.code === code; })[0];
    return m ? m.label : '\\u2014';
  }

  var INTEGRATIONS = ['Salesforce', 'ServiceNow', 'Web Services'];
  var METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  /* ─── Backend-ready data-action data structure (fallback/seed data) ───
     Shape: { id, name, integration, method, endpoint, contract, division,
     avgLatencyMs, status, lastError }. avgLatencyMs/status/lastError are
     written only by Test Action (see DataActService.test), never hand-set
     in the drawer — same "derive, don't duplicate" rule as
     certs-redesign.ts's statusFor(). Exactly the 9 data actions the page's
     static prototype HTML used to hardcode. */
  var DATA_ACTIONS_FALLBACK = [
    { id: 'da-crm-lookup-customer', name: 'CRM_Lookup_Customer', integration: 'Salesforce', method: 'GET', endpoint: '/services/data/v60.0/query', contract: 'ani \\u2192 tier, name, accountId', division: 'd_home', avgLatencyMs: 410, status: 'Published', lastError: '' },
    { id: 'da-crm-create-case', name: 'CRM_Create_Case', integration: 'Salesforce', method: 'POST', endpoint: '/services/data/v60.0/sobjects/Case', contract: 'subject, desc \\u2192 caseId', division: 'd_home', avgLatencyMs: 620, status: 'Published', lastError: '' },
    { id: 'da-verify-account-pin', name: 'Verify_Account_PIN', integration: 'Web Services', method: 'POST', endpoint: 'https://api.mcmgroup.example/verify', contract: 'accountId, pin \\u2192 valid', division: 'd_col', avgLatencyMs: 180, status: 'Published', lastError: '' },
    { id: 'da-get-invoice-balance', name: 'Get_Invoice_Balance', integration: 'Web Services', method: 'GET', endpoint: 'https://api.mcmgroup.example/billing/{id}', contract: 'accountId \\u2192 balance, dueDate', division: 'd_col', avgLatencyMs: 240, status: 'Published', lastError: '' },
    { id: 'da-snow-open-incident', name: 'SNOW_Open_Incident', integration: 'ServiceNow', method: 'POST', endpoint: '/api/now/table/incident', contract: 'short_desc \\u2192 number', division: 'd_dig', avgLatencyMs: 780, status: 'Published', lastError: '' },
    { id: 'da-snow-get-incident', name: 'SNOW_Get_Incident', integration: 'ServiceNow', method: 'GET', endpoint: '/api/now/table/incident', contract: 'number \\u2192 state, assignee', division: 'd_dig', avgLatencyMs: 350, status: 'Published', lastError: '' },
    { id: 'da-post-callback-request', name: 'Post_Callback_Request', integration: 'Web Services', method: 'POST', endpoint: 'https://api.mcmgroup.example/callback', contract: 'number, window \\u2192 ref', division: 'd_ret', avgLatencyMs: 200, status: 'Published', lastError: '' },
    { id: 'da-get-delivery-status', name: 'Get_Delivery_Status', integration: 'Web Services', method: 'GET', endpoint: 'https://api.mcmgroup.example/track', contract: 'orderId \\u2192 status, eta', division: 'd_ret', avgLatencyMs: 1240, status: 'Slow', lastError: '' },
    { id: 'da-legacy-balance-lookup', name: 'Legacy_Balance_Lookup', integration: 'Web Services', method: 'GET', endpoint: 'https://legacy.mcm.local/bal', contract: 'accountId \\u2192 balance', division: 'd_man', avgLatencyMs: null, status: 'Failing', lastError: 'Connection refused (503)' }
  ];

  /* ─── Backend row \u2192 frontend shape ─── */
  function normalizeActionRow(row) {
    return {
      id: row.id,
      name: row.name,
      integration: row.integration || 'Web Services',
      method: row.method || 'GET',
      endpoint: row.endpoint || '',
      contract: row.contract || '',
      division: row.division || '',
      avgLatencyMs: row.avgLatencyMs !== undefined ? row.avgLatencyMs : (row.avg_latency_ms !== undefined ? row.avg_latency_ms : null),
      status: row.status || 'Draft',
      lastError: row.lastError !== undefined ? row.lastError : (row.last_error || '')
    };
  }

  /* ─── REST helper compatible with the shared window.apiFetch contract ───
     Same base URL / Authorization: Bearer <window.__authToken> contract as
     certs-redesign.ts's certsApiFetch — kept as a local copy, same reasoning. */
  function dataactApiFetch(path, init) {
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

  /* Local-first mutable store — same reasoning as certs-redesign.ts's
     localCertStore: a fresh DATA_ACTIONS_FALLBACK.slice() on every
     refresh() would silently discard a create/update/delete/test that only
     succeeded locally (backend unreachable). */
  var localActionStore = DATA_ACTIONS_FALLBACK.slice();

  function simulateTest(endpoint, method) {
    var base = 120 + ((endpoint || '').length * 7) % 500;
    if ((endpoint || '').toLowerCase().indexOf('legacy') > -1) return { avgLatencyMs: null, status: 'Failing', lastError: 'Connection refused (503)' };
    if (method === 'POST') base += 80;
    if (base > 900) return { avgLatencyMs: base, status: 'Slow', lastError: '' };
    return { avgLatencyMs: base, status: 'Published', lastError: '' };
  }

  function fetchActions() {
    return dataactApiFetch('/api/dataact').then(function(rows) {
      return (Array.isArray(rows) && rows.length) ? rows.map(normalizeActionRow) : localActionStore;
    }).catch(function() { return localActionStore; });
  }

  var actionsCache = DATA_ACTIONS_FALLBACK.slice();

  var DataActService = {
    getAll: function() { return actionsCache; },
    getById: function(id) { return actionsCache.filter(function(a) { return a.id === id; })[0] || null; },
    refresh: function() {
      return fetchActions().then(function(list) {
        if (Array.isArray(list) && list.length) actionsCache = list;
        return actionsCache;
      });
    },
    create: function(entry) {
      return dataactApiFetch('/api/dataact', { method: 'POST', body: JSON.stringify(entry) }).then(normalizeActionRow).catch(function() {
        var created = Object.assign({ id: 'da-' + Math.random().toString(36).slice(2, 10), avgLatencyMs: null, status: 'Draft', lastError: '' }, entry);
        localActionStore.push(created);
        return created;
      });
    },
    update: function(id, entry) {
      return dataactApiFetch('/api/dataact/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(entry) }).then(normalizeActionRow).catch(function() {
        var idx = -1;
        for (var i = 0; i < localActionStore.length; i++) { if (localActionStore[i].id === id) { idx = i; break; } }
        var existing = idx > -1 ? localActionStore[idx] : (DataActService.getById(id) || {});
        var updated = Object.assign({}, existing, entry, { id: id });
        if (idx > -1) { localActionStore[idx] = updated; } else { localActionStore.push(updated); }
        return updated;
      });
    },
    remove: function(id) {
      return dataactApiFetch('/api/dataact/' + encodeURIComponent(id), { method: 'DELETE' }).catch(function() {
        localActionStore = localActionStore.filter(function(a) { return a.id !== id; });
        return { ok: true };
      });
    },
    test: function(id) {
      return dataactApiFetch('/api/dataact/' + encodeURIComponent(id) + '/test', { method: 'POST' }).then(normalizeActionRow).catch(function() {
        var idx = -1;
        for (var i = 0; i < localActionStore.length; i++) { if (localActionStore[i].id === id) { idx = i; break; } }
        var existing = idx > -1 ? localActionStore[idx] : DataActService.getById(id);
        if (!existing) throw new Error('Data action not found');
        var result = simulateTest(existing.endpoint, existing.method);
        var updated = Object.assign({}, existing, result);
        if (idx > -1) { localActionStore[idx] = updated; }
        return updated;
      });
    }
  };
  window.DataActService = DataActService;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatLatency(ms) {
    if (ms === null || ms === undefined) return '\\u2014';
    return ms.toLocaleString('en-GB') + ' ms';
  }

  /* ─── Filter state (search text + integration + division + status) ─── */
  var actFilters = { q: '', integration: '', division: '', status: '' };

  function filteredActions() {
    var q = actFilters.q.trim().toLowerCase();
    return DataActService.getAll().filter(function(a) {
      if (actFilters.integration && a.integration !== actFilters.integration) return false;
      if (actFilters.division && a.division !== actFilters.division) return false;
      if (actFilters.status && a.status !== actFilters.status) return false;
      if (!q) return true;
      return a.name.toLowerCase().indexOf(q) > -1 ||
        (a.endpoint || '').toLowerCase().indexOf(q) > -1 ||
        (a.contract || '').toLowerCase().indexOf(q) > -1;
    });
  }

  function statusBadge(status, lastError) {
    if (status === 'Failing') return '<span class="st er"><span class="d"></span>Failing' + (lastError ? ' \\u2014 ' + escapeHtml(lastError.replace(/^.*\\(|\\)$/g, '')) : '') + '</span>';
    if (status === 'Slow') return '<span class="st wn"><span class="d"></span>Slow</span>';
    if (status === 'Draft') return '<span class="st" style="background:#eef1f5;color:#5b6b82"><span class="d"></span>Draft</span>';
    return '<span class="st ok"><span class="d"></span>Published</span>';
  }

  function renderActionRow(a) {
    return '<tr data-div="' + a.division + '" data-status="' + a.status + '"' +
      ' onclick="window.dataactOpenEditor(\\'' + a.id + '\\')">' +
      '<td><input type="checkbox" onclick="event.stopPropagation()"></td>' +
      '<td><b class="lnk">' + escapeHtml(a.name) + '</b></td>' +
      '<td>' + escapeHtml(a.integration) + '</td>' +
      '<td>' + escapeHtml(a.method) + '</td>' +
      '<td>' + escapeHtml(a.endpoint) + '</td>' +
      '<td>' + escapeHtml(a.contract) + '</td>' +
      '<td>' + formatLatency(a.avgLatencyMs) + '</td>' +
      '<td>' + statusBadge(a.status, a.lastError) + '</td>' +
      '<td style="color:#a9b3c2">\\u22EE</td>' +
      '</tr>';
  }

  function renderActionsTable() {
    var list = filteredActions();
    var rows = list.length
      ? list.map(renderActionRow).join('')
      : '<tr><td colspan="9" style="text-align:center;color:#8794a8;padding:28px 0">No data actions match your search.</td></tr>';
    return '<div class="tblw"><table class="dt"><thead><tr><th style="width:34px"><input type="checkbox"></th><th>Action \\u21C5</th><th>Integration \\u21C5</th><th>Method \\u21C5</th><th>Endpoint \\u21C5</th><th>Contract \\u21C5</th><th>Avg latency \\u21C5</th><th>Status \\u21C5</th><th style="width:40px"></th></tr></thead><tbody id="tb">' + rows + '</tbody></table>' +
      '<div class="pgr"><span>Showing <b>' + (list.length ? '1\\u2013' + list.length : '0') + '</b> of <b>' + list.length + '</b></span><div class="sp"></div><span>Rows per page 25 \\u25be</span><span>\\u2039 \\u203A</span></div></div>';
  }

  function refreshActionsTable() {
    var wrap = document.getElementById('act_table_wrap');
    if (!wrap) return;
    wrap.innerHTML = renderActionsTable();
  }

  window.dataactSearch = function(value) { actFilters.q = value || ''; refreshActionsTable(); };
  window.dataactFilterIntegration = function(value) { actFilters.integration = value || ''; refreshActionsTable(); };
  window.dataactFilterDivision = function(value) { actFilters.division = value || ''; refreshActionsTable(); };
  window.dataactFilterStatus = function(value) { actFilters.status = value || ''; refreshActionsTable(); };
  window.dataactReload = function() {
    DataActService.refresh().then(function() {
      refreshActionsTable();
      if (window.toast) window.toast('Data actions refreshed');
    });
  };

  /* ─── Export — was a dead button (no onclick at all); exports exactly
     what's on screen (current search/integration/division/status filters
     applied), same CSV-blob-download approach as scripts.ts's auditCsv(). ─── */
  window.dataactExport = function() {
    var list = filteredActions();
    var header = ['Action', 'Integration', 'Method', 'Endpoint', 'Contract', 'Avg latency (ms)', 'Status', 'Last error'];
    var lines = [header.join(',')].concat(list.map(function(a) {
      return [a.name, a.integration, a.method, a.endpoint, a.contract, (a.avgLatencyMs === null || a.avgLatencyMs === undefined) ? '' : a.avgLatencyMs, a.status, a.lastError || '']
        .map(function(v) { v = String(v == null ? '' : v); return /[",\\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; })
        .join(',');
    }));
    var blob = new Blob([lines.join('\\n')], { type: 'text/csv' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'data_actions.csv';
    link.click();
    if (window.toast) window.toast('Data actions exported (' + list.length + ' rows)');
  };

  function integrationOptions(selected) {
    var opts = '<option value="">Integration: All</option>';
    INTEGRATIONS.forEach(function(i) {
      opts += '<option value="' + i + '"' + (selected === i ? ' selected' : '') + '>' + escapeHtml(i) + '</option>';
    });
    return opts;
  }

  function integrationFieldOptions(selected) {
    return INTEGRATIONS.map(function(i) {
      return '<option value="' + i + '"' + (selected === i ? ' selected' : '') + '>' + escapeHtml(i) + '</option>';
    }).join('');
  }

  function methodOptions(selected) {
    return METHODS.map(function(m) {
      return '<option value="' + m + '"' + (selected === m ? ' selected' : '') + '>' + m + '</option>';
    }).join('');
  }

  function divisionOptions(selected) {
    var opts = '<option value="">Division: All</option>';
    DIVISIONS.forEach(function(d) {
      opts += '<option value="' + d.code + '"' + (selected === d.code ? ' selected' : '') + '>' + escapeHtml(d.label) + '</option>';
    });
    return opts;
  }

  function divisionFieldOptions(selected) {
    var opts = '<option value=""' + (selected === '' ? ' selected' : '') + '>\\u2014 (not division-scoped)</option>';
    DIVISIONS.forEach(function(d) {
      opts += '<option value="' + d.code + '"' + (selected === d.code ? ' selected' : '') + '>' + escapeHtml(d.label) + '</option>';
    });
    return opts;
  }

  /* Exact original page markup — header, tabs, toolbar, table, pagination,
     help panel all unchanged from scripts.ts's static SNAP.dataact string;
     table rows and Search/Division/Status filters made real, and an
     Integration filter chip added. Contracts / Test / Run History (the
     page's other three tabs) are untouched — still window.TT.dataact in
     scripts.ts. */
  function renderActionsPage() {
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A Integrations</div>' +
      '<div class="tt"><h1>Data Actions</h1><div class="rt"><button class="btn" onclick="window.dataactOpenEditor()">+ Create Action</button><button class="btn sec" onclick="window.dataactExport()">Export</button></div></div>' +
      '<div class="tabs"><div class="tb on" onclick="tabClick(this)">Actions</div><div class="tb" onclick="tabClick(this)">Contracts</div><div class="tb" onclick="tabClick(this)">Test</div><div class="tb" onclick="tabClick(this)">Run History</div></div></div>' +
      '<div class="pbody"><div class="tbar">' +
        '<input class="s" placeholder="Search data actions" oninput="window.dataactSearch(this.value)">' +
        '<select class="chip" style="cursor:pointer" onchange="window.dataactFilterIntegration(this.value)">' + integrationOptions('') + '</select>' +
        '<select class="chip" style="cursor:pointer" onchange="window.dataactFilterDivision(this.value)">' + divisionOptions('') + '</select>' +
        '<select class="chip" style="cursor:pointer" onchange="window.dataactFilterStatus(this.value)"><option value="">Status: Any</option><option value="Published">Published</option><option value="Slow">Slow</option><option value="Failing">Failing</option><option value="Draft">Draft</option></select>' +
        '<div class="sp"></div><div class="chip">\\u2699 Columns</div><div class="chip" onclick="window.dataactReload()">\\u21BB Refresh</div>' +
      '</div>' +
      '<div id="act_table_wrap">' + renderActionsTable() + '</div>' +
      '</div>' +
      '<div class="help"><div class="hh" onclick="toggleHelp()"><span style="color:#FF4F1F">\\u24D8</span> Help &amp; Resources \\u2014 Data Actions<span class="cx" id="helpcx">Hide</span></div>' +
      '<div class="hb" id="helpb" style=""><div class="hcols"><div><h5>What you can do here</h5><ul><li>Web services data actions call a REST API from a flow or script</li><li>Contracts define input and output JSON</li><li>Static request/response mapping and velocity templates</li><li>Test the action before publishing</li></ul>' +
      '<h5>Keywords</h5><div><span class="kw o">Data action</span><span class="kw">REST</span><span class="kw">Contract</span><span class="kw o">Request mapping</span><span class="kw">Response mapping</span><span class="kw">Velocity</span><span class="kw o">Test action</span></div></div>' +
      '<div><h5>Training videos</h5><div style="font-size:12px;color:#8794a8">No lab video mapped to this page yet.</div><h5 style="margin-top:14px">Reference documentation</h5>' +
      '<div><a class="reflnk" href="https://help.genesys.com/" target="_blank" rel="noopener">Help Centre \\u203A Data Actions</a><a class="reflnk" href="https://help.genesys.com/?q=Data%20Actions" target="_blank" rel="noopener">Search docs for \\u201CData Actions\\u201D</a><a class="reflnk" href="https://www.genesys.com/pricing" target="_blank" rel="noopener">Licence requirements</a></div></div></div></div></div>';
  }

  /* ─── Create / Edit drawer ───
     Same #drw/.dh/.db/.df/.fld structure as every other drawer in this app.
     avgLatencyMs/status/lastError are shown read-only (computed by Test
     Action, not editable here) once an action has been tested at least
     once. ─── */
  window.dataactOpenEditor = function(id) {
    var existing = id ? DataActService.getById(id) : null;
    var isNew = !existing;
    var a = existing || { id: '', name: '', integration: INTEGRATIONS[2], method: 'GET', endpoint: '', contract: '', division: '', avgLatencyMs: null, status: 'Draft', lastError: '' };

    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);

    var testResultHtml = (!isNew) ? '<div class="fld"><label>Last test result</label><div style="font-size:12.5px;color:#33425c;padding:6px 0">' + statusBadge(a.status, a.lastError) + ' \\u00B7 ' + formatLatency(a.avgLatencyMs) + '</div></div>' : '';

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw"><div class="dh"><h2>' + (isNew ? 'Create' : 'Edit') + ' Data Action</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db">' +
        '<div id="dataacterr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
        '<div class="fld"><label>Name</label><input id="da_name" value="' + escapeHtml(a.name) + '" placeholder="CRM_Lookup_Customer"></div>' +
        '<div class="fld"><label>Integration</label><select id="da_integration">' + integrationFieldOptions(a.integration) + '</select></div>' +
        '<div class="fld"><label>Method</label><select id="da_method">' + methodOptions(a.method) + '</select></div>' +
        '<div class="fld"><label>Endpoint</label><input id="da_endpoint" value="' + escapeHtml(a.endpoint) + '" placeholder="https://api.example.com/resource"></div>' +
        '<div class="fld"><label>Contract</label><input id="da_contract" value="' + escapeHtml(a.contract) + '" placeholder="input \\u2192 output"></div>' +
        '<div class="fld"><label>Division</label><select id="da_division">' + divisionFieldOptions(a.division) + '</select></div>' +
        testResultHtml +
        (isNew ? '' : '<button class="btn sec" onclick="window.dataactTest(\\'' + a.id + '\\')">Test Action</button> <button class="btn gh" onclick="window.dataactDelete(\\'' + a.id + '\\')">Delete</button>') +
      '</div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.dataactSave(\\'' + (a.id || '') + '\\')">Save</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.dataactSave = function(id) {
    var name = document.getElementById('da_name').value.trim();
    var endpoint = document.getElementById('da_endpoint').value.trim();
    var errs = [];
    if (name.length < 2) errs.push('Name is required.');
    if (!endpoint) errs.push('Endpoint is required.');
    if (errs.length) {
      var box = document.getElementById('dataacterr');
      box.style.display = '';
      box.innerHTML = errs.join('<br>');
      return;
    }

    var entry = {
      name: name,
      integration: document.getElementById('da_integration').value,
      method: document.getElementById('da_method').value,
      endpoint: endpoint,
      contract: document.getElementById('da_contract').value.trim(),
      division: document.getElementById('da_division').value
    };

    var isNew = !id;
    var op = isNew ? DataActService.create(entry) : DataActService.update(id, entry);
    op.then(function() {
      return DataActService.refresh();
    }).then(function() {
      window.closeDrawer();
      refreshActionsTable();
      if (window.toast) window.toast((isNew ? '\\u2713 Created ' : '\\u2713 Saved ') + '<b>' + escapeHtml(name) + '</b>');
    }).catch(function(err) {
      var box = document.getElementById('dataacterr');
      if (box) {
        box.style.display = '';
        box.innerHTML = escapeHtml((err && err.message) || 'Save failed \\u2014 please try again.');
      }
    });
  };

  window.dataactTest = function(id) {
    var a = DataActService.getById(id);
    var safeName = escapeHtml(a ? a.name : '');
    DataActService.test(id).then(function(result) {
      return DataActService.refresh().then(function() { return result; });
    }).then(function(result) {
      refreshActionsTable();
      window.dataactOpenEditor(id);
      if (window.toast) {
        var msg = result.status === 'Failing' ? ('\\u2717 Test failed \\u2014 ' + escapeHtml(result.lastError || safeName)) : ('\\u2713 Tested <b>' + safeName + '</b> \\u2014 ' + formatLatency(result.avgLatencyMs));
        window.toast(msg);
      }
    }).catch(function(err) {
      if (window.toast) window.toast('\\u2717 Test failed \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
    });
  };

  /* scripts.ts's own confirmBox()/openDrawerHTML() are local to its
     closure, not exposed on window — self-contained equivalent using the
     same #drw/.dh/.db/.df drawer classes, same as certs-redesign.ts's
     certsConfirmBox(). */
  function dataactConfirmBox(msg, onYes) {
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
        '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" id="dataact_cfyes">Confirm</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    document.getElementById('dataact_cfyes').onclick = function() { window.closeDrawer(); onYes(); };
  }

  window.dataactDelete = function(id) {
    var a = DataActService.getById(id);
    if (!a) return;
    var safeName = escapeHtml(a.name);
    dataactConfirmBox('Delete data action <b>' + safeName + '</b>?', function() {
      DataActService.remove(id).then(function() {
        return DataActService.refresh();
      }).then(function() {
        window.closeDrawer();
        refreshActionsTable();
        if (window.toast) window.toast('\\u2713 Deleted <b>' + safeName + '</b>');
      }).catch(function(err) {
        if (window.toast) window.toast('\\u2717 Delete failed \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
      });
    });
  };

  /* ─── Apply — patches window.SNAP.dataact, same mechanism
     certs-redesign.ts/authorg-redesign.ts/apps-redesign.ts use. 'dataact'
     is plain SNAP-based routing (never in any DYN dispatcher object), so a
     direct SNAP overwrite is enough for window.openPage('dataact') to pick
     this up. ─── */
  function applyDataactRedesign() {
    DataActService.refresh().then(function() {
      if (window.SNAP) window.SNAP.dataact = renderActionsPage();
      if (window.APP && window.APP.page === 'dataact') {
        var cnt = document.getElementById('cnt');
        if (cnt) cnt.innerHTML = renderActionsPage();
      }
    });
  }

  applyDataactRedesign();
  setTimeout(applyDataactRedesign, 100);
  setTimeout(applyDataactRedesign, 400);

})();
`;
