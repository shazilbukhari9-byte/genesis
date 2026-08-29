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

  window.dataactThKeyFx = function(ev, key) {
    if (ev && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); window.dataactSort(key); }
  };

  function sortableTh(label, key, style) {
    var active = actSort.key === key;
    var glyph = active ? (actSort.dir === 1 ? '\\u2191' : '\\u2193') : '\\u21C5';
    return '<th' + (style ? ' style="' + style + '"' : '') +
      ' class="srt' + (active ? ' on' : '') + '" tabindex="0" role="button"' +
      ' aria-sort="' + (active ? (actSort.dir === 1 ? 'ascending' : 'descending') : 'none') + '"' +
      ' onclick="window.dataactSort(\\'' + key + '\\')"' +
      ' onkeydown="window.dataactThKeyFx(event,\\'' + key + '\\')">' +
      escapeHtml(label) + '<i class="srt-g" aria-hidden="true">' + glyph + '</i></th>';
  }

  function renderActionsTable() {
    var list = sortedActions();
    var total = DataActService.getAll().length;
    var loadErr = DataActService.getLoadError();
    /* A failed read is announced in a banner rather than by replacing the
       table, so a refresh that fails does not silently leave stale rows
       looking current, and does not throw away a list the user can still
       read. When there is nothing cached, the empty row states the reason
       too instead of the misleading "none yet".
       Loading / empty / failure all render through window.MCMInt (see
       scripts.ts's Integrations block), which is the one place the whole
       section defines those three states. */
    var banner = (loadErr && list.length) ? window.MCMInt.banner(loadErr, 'window.dataactReload()') : '';
    var rows;
    if (list.length) {
      rows = list.map(renderActionRow).join('');
    } else if (loadErr) {
      rows = window.MCMInt.errorRow(8, loadErr, 'window.dataactReload()');
    } else if (total) {
      rows = window.MCMInt.emptyRow(8, 'No data actions match your filters',
        'Try a different search term, or reset the integration, division and status filters.',
        '<button type="button" class="btn sec int-state-btn" onclick="window.dataactClearFiltersFx()">Clear filters</button>');
    } else {
      rows = window.MCMInt.emptyRow(8, 'No data actions yet',
        'A data action calls a REST endpoint from an Architect flow or a script. Create one to get started.',
        '<button type="button" class="btn int-state-btn" onclick="window.dataactOpenEditor()">+ Create Action</button>');
    }
    return banner + '<div class="tblw"><table class="dt"><thead><tr>' +
      sortableTh('Action', 'name') + sortableTh('Integration', 'integration') +
      sortableTh('Method', 'method') + sortableTh('Endpoint', 'endpoint') +
      sortableTh('Contract', 'contract') + sortableTh('Avg latency', 'avgLatencyMs') +
      sortableTh('Status', 'status') +
      '<th class="int-th-act"></th></tr></thead><tbody id="tb">' + rows + '</tbody></table>' +
      window.MCMInt.footer(list.length, total) + '</div>';
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
  window.dataactClearFiltersFx = function() {
    actFilters.q = ''; actFilters.integration = ''; actFilters.division = ''; actFilters.status = '';
    var pb = document.querySelector('#cnt .pbody');
    if (pb) pb.innerHTML = renderActionsBody();
  };
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
  /* The "\\u2699 Columns" chip that used to sit next to Refresh was wired to
     nothing at all -- it is dropped rather than left advertising a column
     manager this page has never had. Refresh is now the shared chip every
     other Integrations toolbar uses. */
  function renderActionsBody() {
    return '<div class="tbar">' +
        '<input class="s" id="da_q" type="search" placeholder="Search data actions" aria-label="Search data actions" value="' + escapeHtml(actFilters.q) + '" oninput="window.dataactSearch(this.value)">' +
        '<select class="chip" aria-label="Filter by integration" onchange="window.dataactFilterIntegration(this.value)">' + integrationOptions(actFilters.integration) + '</select>' +
        '<select class="chip" aria-label="Filter by division" onchange="window.dataactFilterDivision(this.value)">' + divisionOptions(actFilters.division) + '</select>' +
        '<select class="chip" aria-label="Filter by status" onchange="window.dataactFilterStatus(this.value)"><option value="">Status: Any</option>' +
          ['Published', 'Slow', 'Failing', 'Draft'].map(function(s) {
            return '<option value="' + s + '"' + (actFilters.status === s ? ' selected' : '') + '>Status: ' + s + '</option>';
          }).join('') +
        '</select>' +
        '<div class="sp"></div>' + window.MCMInt.refreshChip('window.dataactReload()') +
      '</div>' +
      '<div id="act_table_wrap">' + renderActionsTable() + '</div>';
  }

  /* Which tab is showing, so the header's primary action can belong to the
     tab rather than to the page: "+ Create Action" used to stay up on
     Contracts, Test and Run History, and the Export button beside it was
     wired to nothing at all on every one of the four. */
  var daTab = 'Actions';

  function dataactHeaderActionsHtml() {
    if (daTab === 'Contracts') return '<button class="btn sec" onclick="window.dataactExportFx()">Export</button>';
    if (daTab === 'Run History') return '<button class="btn sec" onclick="window.dataactExportFx()">Export</button>';
    if (daTab === 'Test') return '';
    return '<button class="btn" onclick="window.dataactOpenEditor()">+ Create Action</button>' +
      '<button class="btn sec" onclick="window.dataactExportFx()">Export</button>';
  }

  window.dataactTabKeyFx = function(ev, el, fn) {
    if (ev && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); window[fn](el); }
  };

  function dataactTabHtml(name, fn) {
    var on = daTab === name;
    return '<div class="tb' + (on ? ' on' : '') + '" role="tab" tabindex="0" aria-selected="' + (on ? 'true' : 'false') + '"' +
      ' onclick="window.' + fn + '(this)" onkeydown="window.dataactTabKeyFx(event,this,\\'' + fn + '\\')">' + name + '</div>';
  }

  function renderActionsPage() {
    daTab = 'Actions';
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A Integrations</div>' +
      '<div class="tt"><h1>Data Actions</h1><div class="rt" id="da_actions">' + dataactHeaderActionsHtml() + '</div></div>' +
      '<div class="tabs" role="tablist">' +
        dataactTabHtml('Actions', 'dataactActionsTabClick') +
        dataactTabHtml('Contracts', 'dataactContractsTabClick') +
        dataactTabHtml('Test', 'dataactTestTabClick') +
        dataactTabHtml('Run History', 'dataactRunHistoryTabClick') +
      '</div></div>' +
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
  function activateTab(el, name) {
    var par = el.parentElement;
    Array.prototype.forEach.call(par.children, function(c) {
      var on = c === el;
      c.classList.toggle('on', on);
      c.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    daTab = name;
    var actions = document.getElementById('da_actions');
    if (actions) actions.innerHTML = dataactHeaderActionsHtml();
    return document.querySelector('#cnt .pbody');
  }

  /* ─── Actions tab — re-renders the toolbar + live table from the current
     DataActService cache, then refreshes from the backend so returning to
     this tab always reflects what PostgreSQL actually holds. ─── */
  window.dataactActionsTabClick = function(el) {
    var pb = activateTab(el, 'Actions');
    if (!pb) return;
    pb.innerHTML = renderActionsBody();
    DataActService.refresh().then(function() {
      if (daTab !== 'Actions') return;
      // Repaint only the table, so the toolbar (and any focus in its search
      // box) survives a refresh that lands while the user is already typing.
      refreshActionsTable();
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
  /* Held rather than rendered-and-discarded, so this tab can be searched,
     counted and exported like every other list in the section.
     null = the first read has not finished yet. */
  var contractsCache = null;
  var contractsError = '';
  var contractsQ = '';

  // One display group per action+direction, joining that group's fields —
  // matching how this tab has always presented a contract.
  function contractGroups() {
    var groups = [];
    var byKey = {};
    (contractsCache || []).forEach(function(r) {
      var key = r.data_action_id + '|' + r.direction;
      if (!byKey[key]) { byKey[key] = { name: r.action_name, direction: r.direction, fields: [], types: [] }; groups.push(byKey[key]); }
      byKey[key].fields.push(r.field_name);
      byKey[key].types.push(r.field_type);
    });
    return groups;
  }

  function contractsVisible() {
    var groups = contractGroups();
    if (!contractsQ) return groups;
    return groups.filter(function(gp) {
      return (gp.name + ' ' + gp.direction + ' ' + gp.fields.join(' ')).toLowerCase().indexOf(contractsQ) > -1;
    });
  }

  window.dataactContractsFilterFx = function() {
    var q = document.getElementById('da_contract_q');
    if (q) contractsQ = q.value.toLowerCase();
    var w = document.getElementById('da_contract_wrap');
    if (w) w.innerHTML = renderContractsTable();
  };
  window.dataactContractsClearFx = function() {
    contractsQ = '';
    var q = document.getElementById('da_contract_q'); if (q) q.value = '';
    var w = document.getElementById('da_contract_wrap'); if (w) w.innerHTML = renderContractsTable();
  };

  function renderContractsTable() {
    var visible = contractsVisible();
    var total = contractGroups().length;
    var rowsHtml;
    if (visible.length) {
      rowsHtml = visible.map(function(gp) {
        var arrow = gp.direction === 'input'
          ? '<span class="tag">\\u2192 input</span>'
          : '<span class="tag o">\\u2190 output</span>';
        var types = gp.types.filter(function(t, i, a) { return a.indexOf(t) === i; }).join(', ');
        return '<tr><td><b>' + escapeHtml(gp.name) + '</b></td><td>' + arrow + '</td><td>' +
          escapeHtml(gp.fields.join(', ')) + '</td><td>' + window.MCMInt.cell(types) + '</td></tr>';
      }).join('');
    } else if (contractsError) {
      rowsHtml = window.MCMInt.errorRow(4, contractsError, 'window.dataactContractsReloadFx()');
    } else if (contractsCache === null) {
      rowsHtml = window.MCMInt.loadingRow(4, 'Loading contracts\\u2026');
    } else if (total) {
      rowsHtml = window.MCMInt.emptyRow(4, 'No contracts match your search', 'Try a different term, or clear the search.',
        '<button type="button" class="btn sec int-state-btn" onclick="window.dataactContractsClearFx()">Clear search</button>');
    } else {
      rowsHtml = window.MCMInt.emptyRow(4, 'No contracts defined yet',
        'A contract is derived from an action\\'s Contract field, e.g. ani \\u2192 tier, name. Set one when creating or editing an action.', '');
    }
    return '<div class="tblw"><table class="dt"><thead><tr><th>Contract</th><th>Direction</th><th>Fields</th><th>Type</th></tr></thead><tbody>' +
      rowsHtml + '</tbody></table>' + window.MCMInt.footer(visible.length, total) + '</div>';
  }

  function renderContractsBody() {
    return '<div class="tbar">' +
      '<input class="s" id="da_contract_q" type="search" placeholder="Search contracts" aria-label="Search contracts" value="' + escapeHtml(contractsQ) + '" oninput="window.dataactContractsFilterFx()">' +
      '<div class="sp"></div>' + window.MCMInt.refreshChip('window.dataactContractsReloadFx()') + '</div>' +
      '<div id="da_contract_wrap">' + renderContractsTable() + '</div>';
  }

  function paintContracts() {
    if (daTab !== 'Contracts') return;
    var w = document.getElementById('da_contract_wrap');
    if (w) { w.innerHTML = renderContractsTable(); return; }
    var pb = document.querySelector('#cnt .pbody');
    if (pb) pb.innerHTML = renderContractsBody();
  }

  window.dataactContractsReloadFx = function() {
    contractsCache = null; contractsError = '';
    paintContracts();
    dataactApiFetch('/api/dataact/contracts').then(function(rows) {
      contractsCache = Array.isArray(rows) ? rows : [];
      contractsError = '';
      paintContracts();
    }).catch(function(err) {
      // Show the real failure rather than an empty table that reads as
      // "this tenant has no contracts".
      contractsCache = [];
      contractsError = 'Could not load contracts \\u2014 ' + ((err && err.message) || 'please try again');
      paintContracts();
    });
  };

  window.dataactContractsTabClick = function(el) {
    var pb = activateTab(el, 'Contracts');
    if (!pb) return;
    contractsCache = null; contractsError = '';
    pb.innerHTML = renderContractsBody();
    window.dataactContractsReloadFx();
  };

  /* ─── Test tab — runs a REAL data action through the same
     /api/dataact/<id>/test endpoint the Actions tab's drawer already
     calls, instead of the previous self-contained mock that looked up a
     phone number against Contact Lists (a different feature entirely,
     with no connection to any data action). Picking an action + Run
     writes a real data_action_runs row too, exactly like testing from
     the drawer does — same feature, second entry point. ─── */
  /* Presented in the same .panel card the Bot Connectors Test Utterances tab
     now uses, so the two "run something and read the result" tabs in this
     section look like one feature rather than two unrelated forms. */
  function renderTestTable() {
    var actions = DataActService.getAll();
    var options = actions.map(function(a) { return '<option value="' + a.id + '">' + escapeHtml(a.name) + '</option>'; }).join('');
    return '<div class="panel int-panel"><h3>Run a data action</h3>' +
      '<div class="int-panel-b">' +
      '<div class="int-note">Runs the selected action through the same endpoint the Actions drawer uses, and records the result in Run History.</div>' +
      '<div class="int-testrow">' +
      '<div class="fld"><label for="da_test_pick">Data action</label><select id="da_test_pick"' + (actions.length ? '' : ' disabled') + '>' +
        (options || '<option value="">No data actions yet</option>') + '</select></div>' +
      '<button class="btn" id="da_test_run_btn" onclick="window.dataactRunTestTab()"' + (actions.length ? '' : ' disabled') + '>Run action</button>' +
      '</div>' +
      (actions.length ? '' : '<div class="int-note int-note-warn">Create a data action first \\u2014 there is nothing to run yet.</div>') +
      '<div id="da_test_out"></div>' +
      '</div></div>';
  }

  window.dataactTestTabClick = function(el) {
    var pb = activateTab(el, 'Test');
    if (!pb) return;
    pb.innerHTML = renderTestTable();
    // Refresh so the picker lists actions created/deleted elsewhere.
    DataActService.refresh().then(function() {
      if (daTab !== 'Test') return;
      var pb2 = document.querySelector('#cnt .pbody');
      if (pb2) pb2.innerHTML = renderTestTable();
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

  /* runsCache === null renders the loading state. Previously a failed fetch
     was swallowed and left the loading row on screen forever, so an outage
     was indistinguishable from a slow request. Held rather than
     rendered-and-discarded so the tab can be searched and exported. */
  var runsCache = null;
  var runsError = '';
  var runsQ = '';

  function runsVisible() {
    var list = runsCache || [];
    if (!runsQ) return list;
    return list.filter(function(r) {
      var trigger = TRIGGER_LABELS[r.trigger_source] || r.trigger_source || '';
      return ((r.action_name || '') + ' ' + trigger + ' ' + (r.result || '')).toLowerCase().indexOf(runsQ) > -1;
    });
  }

  window.dataactRunsFilterFx = function() {
    var q = document.getElementById('da_runs_q');
    if (q) runsQ = q.value.toLowerCase();
    var w = document.getElementById('da_runs_wrap');
    if (w) w.innerHTML = renderRunHistoryTable();
  };
  window.dataactRunsClearFx = function() {
    runsQ = '';
    var q = document.getElementById('da_runs_q'); if (q) q.value = '';
    var w = document.getElementById('da_runs_wrap'); if (w) w.innerHTML = renderRunHistoryTable();
  };

  function renderRunHistoryTable() {
    var visible = runsVisible();
    var total = (runsCache || []).length;
    var rows;
    if (visible.length) {
      rows = visible.map(function(r) {
        return '<tr><td>' + formatRunTime(r.ran_at) + '</td><td><b>' + escapeHtml(r.action_name) + '</b></td>' +
          '<td><span class="tag">' + escapeHtml(TRIGGER_LABELS[r.trigger_source] || r.trigger_source || '\\u2014') + '</span></td>' +
          '<td>' + (r.duration_ms != null ? r.duration_ms.toLocaleString('en-GB') + ' ms' : '<span class="int-muted">\\u2014</span>') + '</td>' +
          '<td>' + resultBadge(r.result) + '</td></tr>';
      }).join('');
    } else if (runsError) {
      rows = window.MCMInt.errorRow(5, runsError, 'window.dataactRunHistoryRetry()');
    } else if (runsCache === null) {
      rows = window.MCMInt.loadingRow(5, 'Loading run history\\u2026');
    } else if (total) {
      rows = window.MCMInt.emptyRow(5, 'No runs match your search', 'Try a different term, or clear the search.',
        '<button type="button" class="btn sec int-state-btn" onclick="window.dataactRunsClearFx()">Clear search</button>');
    } else {
      rows = window.MCMInt.emptyRow(5, 'No data action has been run yet',
        'Use Test Action on a data action, or the Test tab, and every run is recorded here.', '');
    }
    return '<div class="tblw"><table class="dt"><thead><tr><th>When</th><th>Action</th><th>Triggered by</th><th>Duration</th><th>Result</th></tr></thead><tbody>' +
      rows + '</tbody></table>' + window.MCMInt.footer(visible.length, total) + '</div>';
  }

  function renderRunHistoryBody() {
    return '<div class="tbar">' +
      '<input class="s" id="da_runs_q" type="search" placeholder="Search run history" aria-label="Search run history" value="' + escapeHtml(runsQ) + '" oninput="window.dataactRunsFilterFx()">' +
      '<div class="sp"></div>' + window.MCMInt.refreshChip('window.dataactRunHistoryRetry()') + '</div>' +
      '<div id="da_runs_wrap">' + renderRunHistoryTable() + '</div>';
  }

  function paintRuns() {
    if (daTab !== 'Run History') return;
    var w = document.getElementById('da_runs_wrap');
    if (w) { w.innerHTML = renderRunHistoryTable(); return; }
    var pb = document.querySelector('#cnt .pbody');
    if (pb) pb.innerHTML = renderRunHistoryBody();
  }

  /* Re-runs the fetch without needing the tab element, so the error
     state's Retry button and the toolbar's Refresh chip both work. */
  window.dataactRunHistoryRetry = function() {
    runsCache = null; runsError = '';
    paintRuns();
    loadRunHistory();
  };

  function loadRunHistory() {
    return dataactApiFetch('/api/dataact/runs?limit=50').then(function(runs) {
      runsCache = Array.isArray(runs) ? runs : [];
      runsError = '';
      paintRuns();
    }).catch(function(err) {
      runsCache = [];
      runsError = (err && err.message) || 'Could not load run history.';
      paintRuns();
    });
  }

  window.dataactRunHistoryTabClick = function(el) {
    var pb = activateTab(el, 'Run History');
    if (!pb) return;
    runsCache = null; runsError = '';
    pb.innerHTML = renderRunHistoryBody();
    loadRunHistory();
  };

  /* Export writes the rows currently on screen for the active tab, the same
     client-side CSV the Bot Connectors page already used. The Export button
     beside "+ Create Action" had no handler at all before. */
  window.dataactExportFx = function() {
    if (daTab === 'Contracts') {
      var groups = contractsVisible();
      window.MCMInt.downloadCsv('data_action_contracts.csv', ['Contract', 'Direction', 'Fields', 'Type'],
        groups.map(function(gp) {
          var types = gp.types.filter(function(t, i, a) { return a.indexOf(t) === i; }).join(', ');
          return [gp.name, gp.direction, gp.fields.join(', '), types].map(window.MCMInt.csvCell).join(',');
        }), 'contract row(s)');
      return;
    }
    if (daTab === 'Run History') {
      var runs = runsVisible();
      window.MCMInt.downloadCsv('data_action_runs.csv', ['When', 'Action', 'Triggered by', 'Duration (ms)', 'Result'],
        runs.map(function(r) {
          return [r.ran_at, r.action_name, TRIGGER_LABELS[r.trigger_source] || r.trigger_source || '',
            r.duration_ms == null ? '' : r.duration_ms, r.result].map(window.MCMInt.csvCell).join(',');
        }), 'run(s)');
      return;
    }
    var list = sortedActions();
    window.MCMInt.downloadCsv('data_actions.csv', ['Action', 'Integration', 'Method', 'Endpoint', 'Contract', 'Avg latency (ms)', 'Status'],
      list.map(function(a) {
        return [a.name, a.integration, a.method, a.endpoint, a.contract,
          a.avgLatencyMs == null ? '' : a.avgLatencyMs, a.status].map(window.MCMInt.csvCell).join(',');
      }), 'data action(s)');
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
