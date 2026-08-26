/* ============================================================
   MCM Cloud CX — Data Actions Backend Wiring
   Reproduces the existing page markup (same classes, same columns,
   same drawer layout) and replaces what was dead/static:
   Search/Division/Status filters called a dirFilterSet() that
   doesn't exist anywhere in this codebase; "+ Create Action" and
   every row opened a drawer with no editor registered; there was
   no Test Action or Delete at all. An Integration filter chip is
   added. All 4 tabs are now real:
     - Actions: real CRUD against /api/dataact (data_actions table).
     - Contracts: previously one hardcoded example row pair,
       disconnected from any real action. Now derived live from every
       real data action's own `contract` field ("input → output"),
       already real/persisted/editable data — no new table needed,
       just no longer thrown away.
     - Test: previously a self-contained mock unrelated to data
       actions (looked up a phone number against Contact Lists). Now
       picks a real data action and runs the same real Test Action
       call the Actions tab's drawer already makes (/api/dataact/
       <id>/test), so it's the same feature through a second entry
       point rather than a disconnected demo.
     - Run History: previously two hardcoded example rows. Now real
       rows from data_action_runs, written by every Test Action call
       from either the Actions drawer or this Test tab.
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

  /* ─── Data-action row shape ───
     { id, name, integration, method, endpoint, contract, division,
     avgLatencyMs, status, lastError }. avgLatencyMs/status/lastError are
     written only by Test Action (see DataActService.test), never hand-set
     in the drawer — same "derive, don't duplicate" rule as
     certs-redesign.ts's statusFor().

     There is deliberately NO local seed/fallback list here. A hardcoded
     array of 9 "example" actions used to stand in whenever the read
     failed (and was also the initial value of actionsCache), which meant
     a signed-out user, an unreachable backend or a 500 all painted nine
     fabricated rows — complete with fabricated latencies and statuses —
     that were indistinguishable from real records. A failed read now
     surfaces a real error state instead (see actionsLoadError). */

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

  /* Backend-confirmed only, deliberately no local-fallback-on-error here:
     create/update/remove/test used to catch a REJECTED backend request
     (validation failure, duplicate name, network error — anything) and
     silently return a fabricated "success" built from local data instead
     of re-throwing — meaning a real 409/400 from the backend still showed
     a green "Saved"/"Deleted" toast, because the .then() below always ran
     and the .catch() never did. Every one of these now either resolves
     with the real backend row/result or rejects with the real error;
     dataactSave/dataactDelete/dataactTest below already had correct
     .catch() handlers wired up, they just never used to fire.

     Reads are now backend-confirmed too: a failed GET rejects rather than
     resolving with a seed list, so the caller can paint a real error. */
  function fetchActions() {
    return dataactApiFetch('/api/dataact').then(function(rows) {
      // Deliberately no length check: a tenant that genuinely has no data
      // actions must get an empty list and a real empty state.
      if (!Array.isArray(rows)) throw new Error('Unexpected response from the server.');
      return rows.map(normalizeActionRow);
    });
  }

  /* Starts empty — never seeded. actionsLoadError holds the message from
     the last failed read so the table can show it instead of silently
     rendering an empty (or stale) list as though the read succeeded. */
  var actionsCache = [];
  var actionsLoadError = '';

  var DataActService = {
    getAll: function() { return actionsCache; },
    getById: function(id) { return actionsCache.filter(function(a) { return a.id === id; })[0] || null; },
    refresh: function() {
      return fetchActions().then(function(list) {
        actionsCache = list;
        actionsLoadError = '';
        return actionsCache;
      }).catch(function(err) {
        /* Record the real reason and re-throw: callers decide whether to
           paint the error inline, toast it, or both. The cache is left
           untouched so an already-loaded list stays browsable. */
        actionsLoadError = (err && err.message) || 'Could not load data actions.';
        throw err;
      });
    },
    getLoadError: function() { return actionsLoadError; },
    create: function(entry) {
      return dataactApiFetch('/api/dataact', { method: 'POST', body: JSON.stringify(entry) }).then(normalizeActionRow);
    },
    update: function(id, entry) {
      return dataactApiFetch('/api/dataact/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(entry) }).then(normalizeActionRow);
    },
    remove: function(id) {
      return dataactApiFetch('/api/dataact/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    /* source records which entry point ran it ('test' = the Actions
       drawer's Test Action button, 'test-tab' = the Test tab), stored on
       the Run History row so the log shows how each run was started. */
    test: function(id, source) {
      return dataactApiFetch('/api/dataact/' + encodeURIComponent(id) + '/test?source=' + encodeURIComponent(source || 'test'),
        { method: 'POST' }).then(normalizeActionRow);
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

  /* ─── Sorting ───
     The \\u21C5 glyph in these headers used to be decoration only: the
     header cells had no handler at all, so clicking them did nothing
     while advertising that they would sort. Each sortable header is now
     really clickable, toggling asc/desc and showing the active
     direction. Sorting is client-side over the already-fetched list, so
     it composes with the search/filter state rather than re-querying. */
  var actSort = { key: '', dir: 1 };

  window.dataactSort = function(key) {
    if (actSort.key === key) actSort.dir = -actSort.dir;
    else { actSort.key = key; actSort.dir = 1; }
    refreshActionsTable();
  };

  function sortedActions() {
    var list = filteredActions();
    if (!actSort.key) return list;
    var key = actSort.key, dir = actSort.dir;
    // slice() first: never sort the service's cache in place.
    return list.slice().sort(function(a, b) {
      var x = a[key], y = b[key];
      // Nulls (e.g. an untested action's latency) always sort last.
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).toLowerCase().localeCompare(String(y).toLowerCase()) * dir;
    });
  }

  function sortableTh(label, key, style) {
    var glyph = actSort.key === key ? (actSort.dir === 1 ? '\\u2191' : '\\u2193') : '\\u21C5';
    return '<th' + (style ? ' style="' + style + '"' : '') +
      ' class="srt" onclick="window.dataactSort(\\'' + key + '\\')">' +
      escapeHtml(label) + ' ' + glyph + '</th>';
  }

  function renderActionsTable() {
    var list = sortedActions();
    var loadErr = DataActService.getLoadError();
    /* A failed read is announced in a banner rather than by replacing the
       table, so a refresh that fails does not silently leave stale rows
       looking current, and does not throw away a list the user can still
       read. When there is nothing cached, the empty row states the reason
       too instead of the misleading "none yet". */
    var banner = loadErr
      ? '<div class="int-banner err">\\u2717 ' + escapeHtml(loadErr) +
        '<button class="btn sec" style="height:26px;margin-left:auto" onclick="window.dataactReload()">Retry</button></div>'
      : '';
    var rows;
    if (list.length) {
      rows = list.map(renderActionRow).join('');
    } else {
      rows = '<tr><td colspan="8" style="text-align:center;color:' + (loadErr ? '#b3261e' : '#8794a8') + ';padding:28px 0">' +
        (loadErr ? 'Could not load data actions.'
                 : (DataActService.getAll().length ? 'No data actions match your search.' : 'No data actions yet. Create one to get started.')) +
        '</td></tr>';
    }
    return banner + '<div class="tblw"><table class="dt"><thead><tr>' +
      sortableTh('Action', 'name') + sortableTh('Integration', 'integration') +
      sortableTh('Method', 'method') + sortableTh('Endpoint', 'endpoint') +
      sortableTh('Contract', 'contract') + sortableTh('Avg latency', 'avgLatencyMs') +
      sortableTh('Status', 'status') +
      '<th style="width:40px"></th></tr></thead><tbody id="tb">' + rows + '</tbody></table>' +
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
  /* refresh() could not reject while a failed read resolved with the seed
     list, so this always toasted success — even with the backend down.
     It now reports the real outcome either way. */
  window.dataactReload = function() {
    DataActService.refresh().then(function() {
      refreshActionsTable();
      if (window.toast) window.toast('Data actions refreshed');
    }).catch(function(err) {
      refreshActionsTable();
      if (window.toast) window.toast('\\u2717 ' + ((err && err.message) || 'Refresh failed'));
    });
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
  /* The Actions tab's .pbody contents (toolbar + table) — split out of
     renderActionsPage below so dataactActionsTabClick can re-render just
     this part live when returning to the tab, without rebuilding the
     page header/tabs/help panel around it. */
  function renderActionsBody() {
    return '<div class="tbar">' +
        '<input class="s" placeholder="Search data actions" value="' + escapeHtml(actFilters.q) + '" oninput="window.dataactSearch(this.value)">' +
        '<select class="chip" style="cursor:pointer" onchange="window.dataactFilterIntegration(this.value)">' + integrationOptions(actFilters.integration) + '</select>' +
        '<select class="chip" style="cursor:pointer" onchange="window.dataactFilterDivision(this.value)">' + divisionOptions(actFilters.division) + '</select>' +
        '<select class="chip" style="cursor:pointer" onchange="window.dataactFilterStatus(this.value)"><option value="">Status: Any</option>' +
          ['Published', 'Slow', 'Failing', 'Draft'].map(function(s) {
            return '<option value="' + s + '"' + (actFilters.status === s ? ' selected' : '') + '>' + s + '</option>';
          }).join('') +
        '</select>' +
        '<div class="sp"></div><div class="chip">\\u2699 Columns</div><div class="chip" onclick="window.dataactReload()">\\u21BB Refresh</div>' +
      '</div>' +
      '<div id="act_table_wrap">' + renderActionsTable() + '</div>';
  }

  function renderActionsPage() {
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A Integrations</div>' +
      '<div class="tt"><h1>Data Actions</h1><div class="rt"><button class="btn" onclick="window.dataactOpenEditor()">+ Create Action</button><button class="btn sec">Export</button></div></div>' +
      '<div class="tabs"><div class="tb on" onclick="window.dataactActionsTabClick(this)">Actions</div><div class="tb" onclick="window.dataactContractsTabClick(this)">Contracts</div><div class="tb" onclick="window.dataactTestTabClick(this)">Test</div><div class="tb" onclick="window.dataactRunHistoryTabClick(this)">Run History</div></div></div>' +
      '<div class="pbody">' + renderActionsBody() + '</div>' +
      '<div class="help"><div class="hh" onclick="toggleHelp()"><span style="color:#FF4F1F">\\u24D8</span> Help &amp; Resources \\u2014 Data Actions<span class="cx" id="helpcx">Hide</span></div>' +
      '<div class="hb" id="helpb" style=""><div class="hcols"><div><h5>What you can do here</h5><ul><li>Web services data actions call a REST API from a flow or script</li><li>Contracts define input and output JSON</li><li>Static request/response mapping and velocity templates</li><li>Test the action before publishing</li></ul>' +
      '<h5>Keywords</h5><div><span class="kw o">Data action</span><span class="kw">REST</span><span class="kw">Contract</span><span class="kw o">Request mapping</span><span class="kw">Response mapping</span><span class="kw">Velocity</span><span class="kw o">Test action</span></div></div>' +
      '<div><h5>Training videos</h5><div style="font-size:12px;color:#8794a8">No lab video mapped to this page yet.</div><h5 style="margin-top:14px">Reference documentation</h5>' +
      '<div><a class="reflnk" href="https://help.genesys.com/" target="_blank" rel="noopener">Help Centre \\u203A Data Actions</a><a class="reflnk" href="https://help.genesys.com/?q=Data%20Actions" target="_blank" rel="noopener">Search docs for \\u201CData Actions\\u201D</a><a class="reflnk" href="https://www.genesys.com/pricing" target="_blank" rel="noopener">Licence requirements</a></div></div></div></div></div>';
  }

  /* ─── Shared tab-switch helper for all 4 tabs ───
     Marks the clicked tab active and returns the .pbody to render into.
     All four tabs bypass scripts.ts's generic TT[page][tabName] delegated
     listener (see the Run History comment below for why it's unreachable
     from this separate script). The Actions tab in particular MUST NOT go
     through that listener: for the first tab it restores window.TABORIG —
     an HTML snapshot captured before the user first navigated away — so
     any change made meanwhile (e.g. running a test from the Test tab,
     which updates status/avg latency in PostgreSQL) was silently
     invisible on return, showing stale "Draft / \\u2014" against a row the
     database already had as "Published / 281 ms". Every tab now renders
     from live DataActService data instead of a frozen snapshot. ─── */
  function activateTab(el) {
    var par = el.parentElement;
    Array.prototype.forEach.call(par.children, function(c) { c.classList.remove('on'); });
    el.classList.add('on');
    return document.querySelector('#cnt .pbody');
  }

  /* ─── Actions tab — re-renders the toolbar + live table from the current
     DataActService cache, then refreshes from the backend so returning to
     this tab always reflects what PostgreSQL actually holds. ─── */
  window.dataactActionsTabClick = function(el) {
    var pb = activateTab(el);
    if (!pb) return;
    pb.innerHTML = renderActionsBody();
    DataActService.refresh().then(function() {
      var active = document.querySelector('#cnt .tabs .tb.on');
      if (!active || active.textContent.trim() !== 'Actions') return;
      var pb2 = document.querySelector('#cnt .pbody');
      if (pb2) pb2.innerHTML = renderActionsBody();
    }).catch(function() { /* keep the cached render — refresh() already falls back safely */ });
  };

  /* ─── Contracts tab — reads the real data_action_contracts rows from
     GET /api/dataact/contracts. This tab used to parse each action's
     freeform contract string in the browser, so the structured breakdown
     it displayed existed only in the DOM: nothing in PostgreSQL held
     which fields were inputs, which were outputs, or their types. The
     parsing now lives in the backend (dataact.py's parse_contract), which
     persists the result into data_action_contracts on every action
     create/update — so what this tab shows is read back from the
     database rather than recomputed here. ─── */
  function renderContractsTable(rows) {
    if (rows === null) {
      return '<div class="tblw"><table class="dt"><thead><tr><th>Contract</th><th>Direction</th><th>Fields</th><th>Type</th></tr></thead>' +
        '<tbody><tr><td colspan="4" style="text-align:center;color:#8794a8;padding:20px">Loading contracts\\u2026</td></tr></tbody></table></div>';
    }
    // One display row per action+direction, joining that group's fields —
    // matching how this tab has always presented a contract.
    var groups = [];
    var byKey = {};
    (rows || []).forEach(function(r) {
      var key = r.data_action_id + '|' + r.direction;
      if (!byKey[key]) { byKey[key] = { name: r.action_name, direction: r.direction, fields: [], types: [] }; groups.push(byKey[key]); }
      byKey[key].fields.push(r.field_name);
      byKey[key].types.push(r.field_type);
    });
    var rowsHtml = groups.map(function(gp) {
      var arrow = gp.direction === 'input' ? '\\u2192 input' : '\\u2190 output';
      var types = gp.types.filter(function(t, i, a) { return a.indexOf(t) === i; }).join(', ');
      return '<tr><td><b>' + escapeHtml(gp.name) + '</b></td><td>' + arrow + '</td><td>' +
        escapeHtml(gp.fields.join(', ')) + '</td><td>' + escapeHtml(types) + '</td></tr>';
    }).join('');
    if (!rowsHtml) rowsHtml = '<tr><td colspan="4" style="text-align:center;color:#8794a8;padding:20px">No data action has a contract defined yet \\u2014 set one in the Contract field when creating or editing an action</td></tr>';
    return '<div class="tblw"><table class="dt"><thead><tr><th>Contract</th><th>Direction</th><th>Fields</th><th>Type</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
  }

  window.dataactContractsTabClick = function(el) {
    var pb = activateTab(el);
    if (!pb) return;
    pb.innerHTML = '<div style="margin-bottom:4px"></div>' + renderContractsTable(null);
    dataactApiFetch('/api/dataact/contracts').then(function(rows) {
      var active = document.querySelector('#cnt .tabs .tb.on');
      if (!active || active.textContent.trim() !== 'Contracts') return;
      var pb2 = document.querySelector('#cnt .pbody');
      if (pb2) pb2.innerHTML = '<div style="margin-bottom:4px"></div>' + renderContractsTable(rows);
    }).catch(function(err) {
      var active = document.querySelector('#cnt .tabs .tb.on');
      if (!active || active.textContent.trim() !== 'Contracts') return;
      var pb2 = document.querySelector('#cnt .pbody');
      // Show the real failure rather than an empty table that reads as
      // "this tenant has no contracts".
      if (pb2) pb2.innerHTML = '<div style="margin-bottom:4px"></div><div style="color:#b3261e;font-size:12.5px;padding:12px">\\u2717 Could not load contracts \\u2014 ' +
        escapeHtml((err && err.message) || 'please try again') + '</div>';
    });
  };

  /* ─── Test tab — runs a REAL data action through the same
     /api/dataact/<id>/test endpoint the Actions tab's drawer already
     calls, instead of the previous self-contained mock that looked up a
     phone number against Contact Lists (a different feature entirely,
     with no connection to any data action). Picking an action + Run
     writes a real data_action_runs row too, exactly like testing from
     the drawer does — same feature, second entry point. ─── */
  function renderTestTable() {
    var actions = DataActService.getAll();
    var options = actions.map(function(a) { return '<option value="' + a.id + '">' + escapeHtml(a.name) + '</option>'; }).join('');
    return '<div>' +
      '<div class="fld" style="max-width:340px"><label>Data action</label><select id="da_test_pick">' + (options || '<option value="">No data actions yet</option>') + '</select></div>' +
      '<button class="btn" id="da_test_run_btn" onclick="window.dataactRunTestTab()"' + (actions.length ? '' : ' disabled') + '>Run action</button>' +
      '<div id="da_test_out" style="margin-top:10px"></div>' +
      '</div>';
  }

  window.dataactTestTabClick = function(el) {
    var pb = activateTab(el);
    if (!pb) return;
    pb.innerHTML = '<div style="margin-bottom:4px"></div>' + renderTestTable();
    // Refresh so the picker lists actions created/deleted elsewhere.
    DataActService.refresh().then(function() {
      var active = document.querySelector('#cnt .tabs .tb.on');
      if (!active || active.textContent.trim() !== 'Test') return;
      var pb2 = document.querySelector('#cnt .pbody');
      if (pb2) pb2.innerHTML = '<div style="margin-bottom:4px"></div>' + renderTestTable();
    }).catch(function() { /* keep the cached render */ });
  };

  window.dataactRunTestTab = function() {
    var sel = document.getElementById('da_test_pick');
    var out = document.getElementById('da_test_out');
    if (!sel || !sel.value) return;
    var a = DataActService.getById(sel.value);
    var btn = document.getElementById('da_test_run_btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Running\\u2026'; }
    out.innerHTML = '';
    DataActService.test(sel.value, 'test-tab').then(function(result) {
      return DataActService.refresh().then(function() { return result; });
    }).then(function(result) {
      if (btn) { btn.disabled = false; btn.textContent = 'Run action'; }
      out.innerHTML = '<pre style="background:#152550;color:#b8f5d0;border-radius:8px;padding:12px;font-size:12px">' +
        escapeHtml(JSON.stringify({ action: a ? a.name : sel.value, status: result.status, avgLatencyMs: result.avgLatencyMs, lastError: result.lastError || undefined, output: result.output || undefined }, null, 2)) + '</pre>';
    }).catch(function(err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Run action'; }
      out.innerHTML = '<div style="color:#b3261e;font-size:12.5px">\\u2717 ' + escapeHtml((err && err.message) || 'Test failed \\u2014 please try again') + '</div>';
    });
  };

  /* ─── Run History tab — real backend data (GET /api/dataact/runs),
     one row per genuine Test Action invocation, replacing the two
     permanently-hardcoded example rows this tab used to show. The
     page's other multi-tab dispatch (Actions/Contracts/Test) runs
     through scripts.ts's generic TT[page][tabName] delegated click
     listener, which is closure-scoped there and unreachable from this
     separate script — same reasoning as Integrations' igTabClick, this
     tab gets its own onclick instead of the generic tabClick(this). It
     replicates that listener's "snapshot the Actions-tab HTML before
     first leaving it" step itself, so clicking back to the first tab
     ("Actions") still restores correctly even if Run History is the
     first non-Actions tab a user ever clicks. ─── */
  function resultBadge(text) {
    var t = (text || '').toLowerCase();
    var cls = t.indexOf('refused') > -1 || t.indexOf('fail') > -1 ? 'st er' : (t.indexOf('timeout') > -1 || t.indexOf('slow') > -1 ? 'st wn' : 'st ok');
    return '<span class="' + cls + '"><span class="d"></span>' + escapeHtml(text) + '</span>';
  }

  function formatRunTime(iso) {
    try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return '\\u2014'; }
  }

  var TRIGGER_LABELS = { 'test': 'Test Action', 'test-tab': 'Test tab', 'execute': 'Execute' };

  /* runs === null renders the loading state; passing an Error renders a
     real failure state. Previously a failed fetch was swallowed and left
     the loading row on screen forever, so an outage was indistinguishable
     from a slow request. */
  function renderRunHistoryTable(runs) {
    var head = '<div class="tblw"><table class="dt"><thead><tr><th>When</th><th>Action</th><th>Triggered by</th><th>Duration</th><th>Result</th></tr></thead>';
    if (runs instanceof Error) {
      return head + '<tbody><tr><td colspan="5" style="text-align:center;color:#b3261e;padding:20px">\\u2717 ' +
        escapeHtml(runs.message || 'Could not load run history.') +
        ' <button class="btn sec" style="height:26px;margin-left:8px" onclick="window.dataactRunHistoryRetry()">Retry</button></td></tr></tbody></table></div>';
    }
    if (runs === null) {
      return head +
        '<tbody><tr><td colspan="5" style="text-align:center;color:#8794a8;padding:20px">Loading run history\\u2026</td></tr></tbody></table></div>';
    }
    var rows = (runs && runs.length) ? runs.map(function(r) {
      return '<tr><td>' + formatRunTime(r.ran_at) + '</td><td>' + escapeHtml(r.action_name) + '</td>' +
        '<td>' + escapeHtml(TRIGGER_LABELS[r.trigger_source] || r.trigger_source || '\\u2014') + '</td>' +
        '<td>' + (r.duration_ms != null ? r.duration_ms.toLocaleString('en-GB') + ' ms' : '\\u2014') + '</td>' +
        '<td>' + resultBadge(r.result) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" style="text-align:center;color:#8794a8;padding:20px">No data action has been run yet \\u2014 use Test Action on a data action to create history</td></tr>';
    return '<div class="tblw"><table class="dt"><thead><tr><th>When</th><th>Action</th><th>Triggered by</th><th>Duration</th><th>Result</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* Re-runs the fetch without needing the tab element, so the error
     state's Retry button works. */
  window.dataactRunHistoryRetry = function() {
    var pb = document.querySelector('#cnt .pbody');
    if (pb) pb.innerHTML = '<div style="margin-bottom:4px"></div>' + renderRunHistoryTable(null);
    loadRunHistory();
  };

  function loadRunHistory() {
    return dataactApiFetch('/api/dataact/runs?limit=50').then(function(runs) {
      var stillOnTab = document.querySelector('#cnt .tabs .tb.on');
      if (!stillOnTab || stillOnTab.textContent.trim() !== 'Run History') return;
      var pb2 = document.querySelector('#cnt .pbody');
      if (pb2) pb2.innerHTML = '<div style="margin-bottom:4px"></div>' + renderRunHistoryTable(runs);
    }).catch(function(err) {
      var stillOnTab = document.querySelector('#cnt .tabs .tb.on');
      if (!stillOnTab || stillOnTab.textContent.trim() !== 'Run History') return;
      var pb2 = document.querySelector('#cnt .pbody');
      if (pb2) pb2.innerHTML = '<div style="margin-bottom:4px"></div>' +
        renderRunHistoryTable(err instanceof Error ? err : new Error('Could not load run history.'));
    });
  }

  window.dataactRunHistoryTabClick = function(el) {
    var pb = activateTab(el);
    if (!pb) return;
    pb.innerHTML = '<div style="margin-bottom:4px"></div>' + renderRunHistoryTable(null);
    loadRunHistory();
  };

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
  function repaintDataactPage() {
    if (window.SNAP) window.SNAP.dataact = renderActionsPage();
    if (window.APP && window.APP.page === 'dataact') {
      var cnt = document.getElementById('cnt');
      if (cnt) cnt.innerHTML = renderActionsPage();
    }
  }

  /* Repaints on both outcomes: refresh() rejects on a failed read now, and
     the error path still has to paint so the table can show the real
     failure state instead of the pre-redesign markup. */
  function applyDataactRedesign() {
    DataActService.refresh().then(repaintDataactPage, repaintDataactPage);
  }

  applyDataactRedesign();
  setTimeout(applyDataactRedesign, 100);
  setTimeout(applyDataactRedesign, 400);

  /* Opening the page used to repaint window.SNAP.dataact - an HTML
     snapshot captured shortly after load - so records created, edited or
     deleted since then didn't appear until the user clicked the Actions
     tab. This hook refetches and re-renders on every open, the same way
     Bot Connectors already does. */
  var prevOpenPageForDataact = window.openPage;
  window.openPage = function(id) {
    var result = prevOpenPageForDataact.apply(this, arguments);
    if (id === 'dataact') {
      /* Repaint on failure too, so an unreachable backend shows the error
         state rather than whatever was on screen before. */
      DataActService.refresh().then(repaintDataactPage, repaintDataactPage);
    }
    return result;
  };

})();
`;
