/* ============================================================
   MCM Cloud CX — Architect Call Routing: Real Controls & Backend Wiring
   NOT a redesign — the page previously had no toolbar at all (just a
   title, a static "N bindings" tab, and a bare table), because almost
   nothing on it was real:

   1. WHAT WAS ALREADY THERE. scripts.ts itself (not a separate patch
      file — hand-inserted directly into the monolith by an earlier,
      narrower pass) had Create + Delete wired to the real
      /api/call-routes table, via two overlapping IIFEs that each
      independently fetch the route list on page load. That worked,
      but: it fires two redundant /api/call-routes requests (and
      sometimes a redundant /api/flows request) every visit, briefly
      shows "flow: (missing)" before the second fetch resolves, and
      is reachable only because it patches window.openPage a second
      time on top of the DYN5 dispatch table's stale reference to
      window.renderCallroute (the same staleness trap already
      documented in flows-redesign.ts/prompts-redesign.ts). There
      was no Edit, no Enable/Disable, no Search/Filter/Refresh/
      pagination, and only two fields were collectible at all: a
      name and a DID — even though the backend table already has
      match_type, priority, enabled, description, and (destination_
      type='queue') a queue fallback, none of which the UI exposed.

   2. WHAT THIS FILE DOES. Takes full ownership of openPage('callroute')
      the same way flows-redesign.ts/prompts-redesign.ts do for their
      pages — the old in-monolith patches become unreachable dead code
      for this id (left in place, unedited, since scripts.ts itself is
      never hand-edited in this codebase). Adds: Edit, Enable/Disable
      (a quick per-row toggle, not buried in the editor), Search,
      Status/Destination/Division filters, Refresh, and pagination.
      Exposes match_type, priority, description, and a queue
      destination in the editor. Two fields plainly requested but with
      no data model to back them were added for real rather than faked:
      a per-route schedule (schedule_id, FK to schedule_groups — the
      "schedule" concept previously only existed per-flow, not
      per-route) and a per-route division (division, a bare TEXT
      column — same no-FK-table convention queues.division already
      uses). See database/schema.sql and backend/resources.py's
      "call-routes" REGISTRY entry.

   3. DUPLICATE/CONFLICTING ROUTES. A unique index on
      (tenant_id, match_type, lower(pattern)) stops two routes from
      ever matching the exact same number the same way — checked
      client-side first for instant feedback, backed by a real
      server-side 409 (app.py's generic resource_create/update already
      translate a unique-violation into 409, added during the Prompts
      fix — this reuses it, no backend change needed here beyond the
      index itself).

   4. UNSAVED-CHANGES GUARD. Native confirm() (not the app's styled
      drawer-confirm, which would have to close-then-reopen this same
      drawer mid-guard) fires on Cancel/×/scrim-click, on navigating
      to another admin page while dirty, and on an actual tab close/
      refresh (beforeunload) — gated on this file's own dirty flag,
      so it can't fire for any other page's drawer.
   ============================================================ */

export const CALLROUTING_SCRIPT: string = `
(function() {
  'use strict';

  var MATCH_TYPES = [
    { v: 'exact', label: 'Exact number' },
    { v: 'prefix', label: 'Number prefix' },
    { v: 'regex', label: 'Regex pattern' }
  ];
  var DEST_TYPES = [
    { v: 'flow', label: 'Architect flow' },
    { v: 'queue', label: 'Queue' }
  ];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function callRoutesApiFetch(path, init) {
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

  /* ═══════════ Lookup data (flows / queues / schedules / divisions) ═══════════
     Each of these already has real backend sync elsewhere in this app, but
     only fires once the user visits that specific admin page (queues/
     schedules) or, for flows, was already handled the same way flows-
     redesign.ts's own ensureFlows() does it — Call Routing can't assume any
     of that has already run, so it preloads all four itself, matching the
     exact row shape those other pages use so nothing gets clobbered if the
     user visits them later. */
  function ensureFlows() {
    if ((window.DB.flows || []).some(function(f) { return f.dbId; })) return Promise.resolve();
    return callRoutesApiFetch('/api/flows?limit=500').then(function(rows) {
      if (!Array.isArray(rows)) return;
      if ((window.DB.flows || []).some(function(f) { return f.dbId; })) return; // hydrated elsewhere while this was in flight
      window.DB.flows = rows.map(function(r) {
        return { id: 'id' + Math.random().toString(36).slice(2, 10), dbId: r.id, name: r.name };
      });
    }).catch(function() {});
  }

  function ensureQueues() {
    if ((window.DB.queues || []).some(function(q) { return q.dbId; })) return Promise.resolve();
    return callRoutesApiFetch('/api/queues?limit=500').then(function(rows) {
      if (!Array.isArray(rows)) return;
      if ((window.DB.queues || []).some(function(q) { return q.dbId; })) return;
      window.DB.queues = rows.map(function(r) {
        var cfg = r.config || {};
        // liveTick() (this app's background queue/agent simulation ticker,
        // scripts.ts) reads q.members.length unconditionally on every
        // queue in window.DB.queues, whether or not Call Routing (or any
        // page) is the one currently open — a queue created via the
        // generic backend API with no config.members would otherwise
        // crash it as soon as this preload runs. Defaulting it here keeps
        // this preload's output exactly as complete as the richer object
        // the real Queues admin page's own hydrate produces.
        return Object.assign({ members: [] }, cfg, { id: 'id' + Math.random().toString(36).slice(2, 10), dbId: r.id, name: r.name, division: r.division || cfg.division || '' });
      });
    }).catch(function() {});
  }

  function ensureSchedules() {
    if ((window.DB.schedGroups || []).some(function(s) { return s.dbId; })) return Promise.resolve();
    return callRoutesApiFetch('/api/schedule-groups?limit=500').then(function(rows) {
      if (!Array.isArray(rows)) return;
      if ((window.DB.schedGroups || []).some(function(s) { return s.dbId; })) return;
      window.DB.schedGroups = rows.map(function(r) {
        return { id: 'id' + Math.random().toString(36).slice(2, 10), dbId: r.id, name: r.name, open: r.open_hours || '', holidays: r.holidays || '', state: r.state || 'Open' };
      });
    }).catch(function() {});
  }

  var divisionsCache = [];
  var divisionsLoaded = false;
  function ensureDivisions() {
    if (divisionsLoaded) return Promise.resolve();
    return callRoutesApiFetch('/api/divisions').then(function(rows) {
      divisionsLoaded = true;
      divisionsCache = Array.isArray(rows) ? rows : [];
    }).catch(function() { divisionsLoaded = true; });
  }
  function ensureLookups() { return Promise.all([ensureFlows(), ensureQueues(), ensureSchedules(), ensureDivisions()]); }

  function flowLabel(dbId) {
    var f = (window.DB.flows || []).filter(function(x) { return x.dbId === dbId; })[0];
    return f ? f.name : '';
  }
  function queueLabel(dbId) {
    var q = (window.DB.queues || []).filter(function(x) { return x.dbId === dbId; })[0];
    return q ? q.name : '';
  }
  function scheduleLabel(dbId) {
    var s = (window.DB.schedGroups || []).filter(function(x) { return x.dbId === dbId; })[0];
    return s ? s.name : '';
  }
  function divisionLabel(code) {
    var d = divisionsCache.filter(function(x) { return x.code === code; })[0];
    return d ? d.name : code;
  }

  /* ═══════════ Data layer ═══════════ */
  function normalizeRoute(r) {
    return {
      id: r.id,
      dbId: r.id,
      name: r.name || '',
      matchType: r.match_type || 'exact',
      pattern: r.pattern || '',
      destinationType: r.destination_type || 'flow',
      flowId: r.flow_id || null,
      queueId: r.queue_id || null,
      scheduleId: r.schedule_id || null,
      division: r.division || '',
      priority: (typeof r.priority === 'number') ? r.priority : 100,
      enabled: r.enabled !== false,
      description: r.description || ''
    };
  }

  function buildPayload(entry) {
    return {
      name: entry.name,
      match_type: entry.matchType,
      pattern: entry.pattern,
      destination_type: entry.destinationType,
      flow_id: entry.destinationType === 'flow' ? (entry.flowId || null) : null,
      queue_id: entry.destinationType === 'queue' ? (entry.queueId || null) : null,
      schedule_id: entry.scheduleId || null,
      division: entry.division || '',
      priority: entry.priority,
      enabled: entry.enabled,
      description: entry.description || ''
    };
  }

  var routesCache = [];
  var routesLoadState = 'loading'; // 'loading' | 'ready' | 'error'

  var CallRoutesService = {
    getAll: function() { return routesCache; },
    getById: function(id) { return routesCache.filter(function(r) { return String(r.id) === String(id); })[0] || null; },
    refresh: function() {
      return ensureLookups().then(function() {
        return callRoutesApiFetch('/api/call-routes?limit=500');
      }).then(function(rows) {
        routesCache = Array.isArray(rows) ? rows.map(normalizeRoute) : [];
        return routesCache;
      });
    },
    create: function(entry) {
      return callRoutesApiFetch('/api/call-routes', { method: 'POST', body: JSON.stringify(buildPayload(entry)) }).then(normalizeRoute);
    },
    update: function(id, entry) {
      return callRoutesApiFetch('/api/call-routes/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(buildPayload(entry)) }).then(normalizeRoute);
    },
    patch: function(id, partial) {
      return callRoutesApiFetch('/api/call-routes/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(partial) }).then(normalizeRoute);
    },
    remove: function(id) {
      return callRoutesApiFetch('/api/call-routes/' + encodeURIComponent(id), { method: 'DELETE' });
    }
  };
  window.CallRoutesService = CallRoutesService;

  /* ═══════════ Fallback routes ═══════════
     carrier.py's resolve_call_route() tries call_routes (pattern-matched,
     priority-ordered) first and only falls back to did_assignments —
     an exact-number lookup with no pattern/priority concept — if
     nothing above matched. That's the real "fallback route" mechanism
     already live on the backend; this page had no UI for it at all
     (did_assignments' own admin surface is the separate Telephony > DID
     Numbers page, which assigns a number to a person/label — this
     section is additive, not a duplicate of that page). */
  function normalizeFallback(r) {
    return {
      id: r.id, dbId: r.id,
      phoneNumber: r.phone_number || '',
      destinationType: r.destination_type || 'flow',
      flowId: r.flow_id || null,
      queueId: r.queue_id || null
    };
  }

  var fallbackCache = [];
  var fallbackLoadState = 'loading';

  var FallbackService = {
    getAll: function() { return fallbackCache; },
    getById: function(id) { return fallbackCache.filter(function(x) { return String(x.id) === String(id); })[0] || null; },
    refresh: function() {
      return callRoutesApiFetch('/api/did-assignments?limit=500').then(function(rows) {
        fallbackCache = Array.isArray(rows) ? rows.map(normalizeFallback) : [];
        return fallbackCache;
      });
    },
    create: function(payload) { return callRoutesApiFetch('/api/did-assignments', { method: 'POST', body: JSON.stringify(payload) }).then(normalizeFallback); },
    update: function(dbId, payload) { return callRoutesApiFetch('/api/did-assignments/' + dbId, { method: 'PUT', body: JSON.stringify(payload) }).then(normalizeFallback); },
    remove: function(dbId) { return callRoutesApiFetch('/api/did-assignments/' + dbId, { method: 'DELETE' }); }
  };
  window.FallbackRoutesService = FallbackService;

  /* ═══════════ Filters, search, pagination ═══════════ */
  var rFilters = { q: '', status: '', destType: '', division: '' };
  var rPage = 1;
  var rPageSize = 25;

  function filteredRoutes() {
    var q = rFilters.q.trim().toLowerCase();
    return CallRoutesService.getAll().filter(function(r) {
      if (rFilters.status === 'enabled' && !r.enabled) return false;
      if (rFilters.status === 'disabled' && r.enabled) return false;
      if (rFilters.destType && r.destinationType !== rFilters.destType) return false;
      if (rFilters.division && r.division !== rFilters.division) return false;
      if (!q) return true;
      return r.name.toLowerCase().indexOf(q) > -1 || r.pattern.toLowerCase().indexOf(q) > -1 || (r.description || '').toLowerCase().indexOf(q) > -1;
    });
  }

  function paginated() {
    var list = filteredRoutes();
    var totalPages = Math.max(1, Math.ceil(list.length / rPageSize));
    if (rPage > totalPages) rPage = totalPages;
    if (rPage < 1) rPage = 1;
    var start = (rPage - 1) * rPageSize;
    return { rows: list.slice(start, start + rPageSize), total: list.length, totalPages: totalPages, start: start };
  }

  window.callRoutesSearch = function(v) { rFilters.q = v || ''; rPage = 1; refreshRoutesTable(); };
  window.callRoutesFilterStatus = function(v) { rFilters.status = v || ''; rPage = 1; refreshRoutesTable(); };
  window.callRoutesFilterDest = function(v) { rFilters.destType = v || ''; rPage = 1; refreshRoutesTable(); };
  window.callRoutesFilterDivision = function(v) { rFilters.division = v || ''; rPage = 1; refreshRoutesTable(); };
  window.callRoutesSetPageSize = function(v) { rPageSize = parseInt(v, 10) || 25; rPage = 1; refreshRoutesTable(); };
  window.callRoutesPrevPage = function() { if (rPage > 1) { rPage--; refreshRoutesTable(); } };
  window.callRoutesNextPage = function() {
    var totalPages = Math.max(1, Math.ceil(filteredRoutes().length / rPageSize));
    if (rPage < totalPages) { rPage++; refreshRoutesTable(); }
  };

  window.callRoutesReload = function() {
    routesLoadState = 'loading';
    refreshRoutesTable();
    CallRoutesService.refresh().then(function() {
      routesLoadState = 'ready';
      refreshRoutesTable();
      if (window.toast) window.toast('Call routes refreshed');
    }).catch(function() {
      routesLoadState = 'error';
      refreshRoutesTable();
      if (window.toast) window.toast('\\u2717 Couldn\\'t refresh call routes \\u2014 please try again');
    });
  };

  /* ═══════════ Enable/Disable (quick, no drawer) ═══════════ */
  function actuallyToggleEnabled(id, next, name) {
    CallRoutesService.patch(id, { enabled: next }).then(function() {
      return CallRoutesService.refresh();
    }).then(function() {
      refreshRoutesTable();
      if (window.toast) window.toast((next ? '\\u2713 Enabled ' : '\\u2713 Disabled ') + '<b>' + escapeHtml(name) + '</b>');
    }).catch(function(err) {
      if (window.toast) window.toast('\\u2717 Couldn\\'t update \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
    });
  }

  window.callRoutesToggleEnabled = function(id) {
    var r = CallRoutesService.getById(id);
    if (!r) return;
    var next = !r.enabled;
    // Turning a live route off is consequential (calls stop being
    // answered by it) — confirm before disabling. Turning one back on
    // is the low-risk direction, so that stays a single click.
    if (!next) {
      routeConfirmBox('Disable <b>' + escapeHtml(r.name) + '</b>? Calls to <b>' + escapeHtml(r.pattern) + '</b> will stop matching this route until it\\'s re-enabled.', function() {
        actuallyToggleEnabled(id, next, r.name);
      });
      return;
    }
    actuallyToggleEnabled(id, next, r.name);
  };

  /* ═══════════ Table rendering ═══════════ */
  function destinationCell(r) {
    if (r.destinationType === 'flow') {
      var fl = flowLabel(r.flowId);
      return fl ? escapeHtml(fl) : '<span style="color:#b3261e">Flow not set</span>';
    }
    if (r.destinationType === 'queue') {
      var ql = queueLabel(r.queueId);
      return ql ? escapeHtml(ql) + ' <span class="tag">Queue</span>' : '<span style="color:#b3261e">Queue not set</span>';
    }
    return '\\u2014';
  }

  function renderRouteRow(r) {
    var matchLabel = { exact: 'Exact', prefix: 'Prefix', regex: 'Regex' }[r.matchType] || r.matchType;
    var sched = scheduleLabel(r.scheduleId);
    var div = r.division ? divisionLabel(r.division) : '';
    return '<tr onclick="window.callRoutesOpenEditor(\\'' + r.id + '\\')">' +
      '<td><b class="lnk">' + escapeHtml(r.name) + '</b></td>' +
      '<td><span class="tag">' + escapeHtml(r.pattern) + '</span> <span style="font-size:10.5px;color:#8794a8">' + matchLabel + '</span></td>' +
      '<td>' + destinationCell(r) + '</td>' +
      '<td>' + (div ? escapeHtml(div) : '\\u2014') + '</td>' +
      '<td>' + (sched ? escapeHtml(sched) : '\\u2014') + '</td>' +
      '<td>' + r.priority + '</td>' +
      '<td><span class="st ' + (r.enabled ? 'ok' : 'of') + '"><span class="d"></span>' + (r.enabled ? 'Enabled' : 'Disabled') + '</span></td>' +
      '<td style="white-space:nowrap" onclick="event.stopPropagation()">' +
        '<a class="lnk" style="font-size:12px" onclick="window.callRoutesToggleEnabled(\\'' + r.id + '\\')">' + (r.enabled ? 'Disable' : 'Enable') + '</a> ' +
        '<a class="lnk" style="font-size:12px" onclick="window.callRoutesDelete(\\'' + r.id + '\\')">Delete</a>' +
      '</td>' +
      '</tr>';
  }

  function renderRoutesTable() {
    if (routesLoadState === 'loading') return '<div style="padding:28px;text-align:center;color:#8794a8">Loading call routes\\u2026</div>';
    if (routesLoadState === 'error') return '<div style="padding:28px;text-align:center;color:#b3261e">Couldn\\'t load call routes from the server. <a class="lnk" onclick="window.callRoutesReload()">Retry</a></div>';

    var pg = paginated();
    var rows = pg.rows.length
      ? pg.rows.map(renderRouteRow).join('')
      : '<tr><td colspan="8" style="text-align:center;color:#8794a8;padding:28px 0">' + (CallRoutesService.getAll().length ? 'No call routes match your search.' : 'No call routes yet \\u2014 add one to answer an inbound number.') + '</td></tr>';
    var showFrom = pg.total ? pg.start + 1 : 0;
    var showTo = Math.min(pg.start + rPageSize, pg.total);

    return '<table class="dt"><thead><tr><th>Route</th><th>Phone number</th><th>Destination</th><th>Division</th><th>Schedule</th><th>Priority</th><th>Status</th><th style="width:130px"></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="pgr"><span>Showing <b>' + showFrom + (pg.total ? '\\u2013' + showTo : '') + '</b> of <b>' + pg.total + '</b></span><div class="sp"></div>' +
      '<span>Rows per page <select onchange="window.callRoutesSetPageSize(this.value)" style="border:none;background:transparent;font:inherit;color:inherit;cursor:pointer">' +
        [10, 25, 50].map(function(n) { return '<option value="' + n + '"' + (rPageSize === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
      '</select></span>' +
      '<a class="lnk" style="' + (rPage <= 1 ? 'color:#c3cbd8;cursor:default' : '') + '"' + (rPage > 1 ? ' onclick="window.callRoutesPrevPage()"' : '') + '>\\u2039</a> ' +
      '<a class="lnk" style="' + (rPage >= pg.totalPages ? 'color:#c3cbd8;cursor:default' : '') + '"' + (rPage < pg.totalPages ? ' onclick="window.callRoutesNextPage()"' : '') + '>\\u203A</a>' +
      '</div>';
  }

  function refreshRoutesTable() {
    var wrap = document.querySelector('#cnt .tblw');
    if (wrap) wrap.innerHTML = renderRoutesTable();
    var tab = document.querySelector('#cnt .tb.on');
    if (tab) tab.textContent = 'DID \\u2192 destination bindings (' + CallRoutesService.getAll().length + ')';
    var divSel = document.getElementById('cr_div_filter');
    if (divSel) {
      divSel.innerHTML = '<option value="">Division: All</option>' + divisionsCache.map(function(d) {
        return '<option value="' + escapeHtml(d.code) + '"' + (rFilters.division === d.code ? ' selected' : '') + '>' + escapeHtml(d.name) + '</option>';
      }).join('');
    }
  }

  /* ═══════════ Fallback routes: table + editor ═══════════ */
  function renderFallbackRow(r) {
    var dest = r.destinationType === 'flow' ? flowLabel(r.flowId) : queueLabel(r.queueId);
    return '<tr>' +
      '<td><span class="tag">' + escapeHtml(r.phoneNumber) + '</span></td>' +
      '<td>' + (dest ? escapeHtml(dest) : '<span style="color:#b3261e">Not set</span>') + ' <span style="font-size:10.5px;color:#8794a8">(' + (r.destinationType === 'flow' ? 'Flow' : 'Queue') + ')</span></td>' +
      '<td style="white-space:nowrap">' +
        '<a class="lnk" style="font-size:12px" onclick="window.fallbackOpenEditor(\\'' + r.id + '\\')">Edit</a> ' +
        '<a class="lnk" style="font-size:12px" onclick="window.fallbackDelete(\\'' + r.id + '\\')">Delete</a>' +
      '</td></tr>';
  }

  function renderFallbackTable() {
    if (fallbackLoadState === 'loading') return '<div style="padding:20px;text-align:center;color:#8794a8">Loading fallback routes\\u2026</div>';
    if (fallbackLoadState === 'error') return '<div style="padding:20px;text-align:center;color:#b3261e">Couldn\\'t load fallback routes. <a class="lnk" onclick="window.fallbackReload()">Retry</a></div>';
    var list = FallbackService.getAll();
    if (!list.length) return '<div style="padding:20px;text-align:center;color:#8794a8">No fallback routes yet \\u2014 used when no routing rule above matches an inbound number.</div>';
    return '<table class="dt"><thead><tr><th>Phone number</th><th>Destination</th><th style="width:120px"></th></tr></thead><tbody>' + list.map(renderFallbackRow).join('') + '</tbody></table>';
  }

  function refreshFallbackTable() {
    var wrap = document.getElementById('cr_fallback_tblw');
    if (wrap) wrap.innerHTML = renderFallbackTable();
  }

  window.fallbackReload = function() {
    fallbackLoadState = 'loading';
    refreshFallbackTable();
    FallbackService.refresh().then(function() {
      fallbackLoadState = 'ready';
      refreshFallbackTable();
      if (window.toast) window.toast('Fallback routes refreshed');
    }).catch(function() {
      fallbackLoadState = 'error';
      refreshFallbackTable();
      if (window.toast) window.toast('\\u2717 Couldn\\'t refresh \\u2014 please try again');
    });
  };

  window.fallbackOpenEditor = function(id) {
    ensureLookups().then(function() { actuallyOpenFallbackEditor(id); });
  };

  function actuallyOpenFallbackEditor(id) {
    var existing = id ? FallbackService.getById(id) : null;
    var isNew = !existing;
    var r = existing || { id: '', dbId: null, phoneNumber: '', destinationType: 'flow', flowId: null, queueId: null };

    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);

    var flowOptions = optionsHtml((window.DB.flows || []).filter(function(f) { return f.dbId; }), 'dbId', 'name', r.flowId, 'Choose a flow\\u2026');
    var queueOptions = optionsHtml((window.DB.queues || []).filter(function(q) { return q.dbId; }), 'dbId', 'name', r.queueId, 'Choose a queue\\u2026');

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw"><div class="dh"><h2>' + (isNew ? 'Add' : 'Edit') + ' Fallback Route</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db">' +
        '<div id="crerr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
        '<div style="font-size:12px;color:#5b6b82;margin-bottom:10px">Used only when none of the routing rules above match this number.</div>' +
        '<div class="fld"><label>Phone number</label><input id="fb_number" value="' + escapeHtml(r.phoneNumber) + '" placeholder="+442071234567"></div>' +
        '<div class="fld"><label>Destination</label><select id="fb_desttype"><option value="flow"' + (r.destinationType === 'flow' ? ' selected' : '') + '>Architect flow</option><option value="queue"' + (r.destinationType === 'queue' ? ' selected' : '') + '>Queue</option></select></div>' +
        '<div class="fld" id="fb_flow_field"><label>Destination flow</label><select id="fb_flow">' + flowOptions + '</select></div>' +
        '<div class="fld" id="fb_queue_field"><label>Destination queue</label><select id="fb_queue">' + queueOptions + '</select></div>' +
        (isNew ? '' : '<button class="btn gh" onclick="window.fallbackDelete(\\'' + r.id + '\\')">Delete</button>') +
      '</div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.fallbackSave(\\'' + (r.id || '') + '\\')">Save</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);

    function toggleFbDestFields() {
      var dt = document.getElementById('fb_desttype').value;
      document.getElementById('fb_flow_field').style.display = dt === 'flow' ? '' : 'none';
      document.getElementById('fb_queue_field').style.display = dt === 'queue' ? '' : 'none';
    }
    toggleFbDestFields();
    document.getElementById('fb_desttype').addEventListener('change', toggleFbDestFields);
  }

  function isDuplicateFallbackNumber(number, excludeId) {
    return FallbackService.getAll().some(function(x) { return x.phoneNumber === number && String(x.id) !== String(excludeId || ''); });
  }

  window.fallbackSave = function(id) {
    hideDrawerError();
    var number = document.getElementById('fb_number').value.trim();
    var destType = document.getElementById('fb_desttype').value;
    var flowId = document.getElementById('fb_flow').value ? parseInt(document.getElementById('fb_flow').value, 10) : null;
    var queueId = document.getElementById('fb_queue').value ? parseInt(document.getElementById('fb_queue').value, 10) : null;

    var errs = [];
    if (!/^\\+?[1-9][0-9]{6,14}$/.test(number)) errs.push('Enter a valid phone number, e.g. +442071234567.');
    else if (isDuplicateFallbackNumber(number, id)) errs.push('A fallback route for \\u201C' + escapeHtml(number) + '\\u201D already exists.');
    if (destType === 'flow' && !flowId) errs.push('Choose a destination flow.');
    if (destType === 'queue' && !queueId) errs.push('Choose a destination queue.');
    if (errs.length) { showDrawerError(errs.join('<br>')); return; }

    var payload = { phone_number: number, destination_type: destType, flow_id: destType === 'flow' ? flowId : null, queue_id: destType === 'queue' ? queueId : null };
    var isNew = !id;
    var existing = isNew ? null : FallbackService.getById(id);
    var op = isNew ? FallbackService.create(payload) : FallbackService.update(existing.dbId, payload);
    op.then(function() {
      return FallbackService.refresh();
    }).then(function() {
      window.closeDrawer();
      refreshFallbackTable();
      if (window.toast) window.toast((isNew ? '\\u2713 Added ' : '\\u2713 Saved ') + '<b>' + escapeHtml(number) + '</b>');
    }).catch(function(err) {
      showDrawerError(escapeHtml((err && err.message) || 'Save failed \\u2014 please try again.'));
    });
  };

  window.fallbackDelete = function(id) {
    var r = FallbackService.getById(id);
    if (!r || !r.dbId) return;
    var safeNumber = escapeHtml(r.phoneNumber);
    routeConfirmBox('Delete fallback route for <b>' + safeNumber + '</b>? This cannot be undone.', function() {
      FallbackService.remove(r.dbId).then(function() {
        return FallbackService.refresh();
      }).then(function() {
        refreshFallbackTable();
        if (window.toast) window.toast('\\u2713 Deleted <b>' + safeNumber + '</b>');
      }).catch(function(err) {
        if (window.toast) window.toast('\\u2717 Delete failed \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
      });
    });
  };

  /* ═══════════ Add / Edit drawer ═══════════ */
  var routeDirty = false;
  var currentEditId = '';

  function markDirty() { routeDirty = true; }

  function showDrawerError(html) {
    var box = document.getElementById('crerr');
    if (box) { box.style.display = ''; box.innerHTML = html; }
  }
  function hideDrawerError() {
    var box = document.getElementById('crerr');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  }

  function requestCloseDrawer() {
    if (routeDirty && !window.confirm('You have unsaved changes on this call route. Discard them?')) return;
    routeDirty = false;
    window.closeDrawer();
  }
  window.__callRoutesRequestClose = requestCloseDrawer;

  function optionsHtml(items, valueKey, labelKey, selected, emptyLabel) {
    var html = emptyLabel ? '<option value="">' + emptyLabel + '</option>' : '';
    html += items.map(function(it) {
      var v = it[valueKey], l = it[labelKey];
      return '<option value="' + escapeHtml(v) + '"' + (String(selected) === String(v) ? ' selected' : '') + '>' + escapeHtml(l) + '</option>';
    }).join('');
    return html;
  }

  function toggleDestFields() {
    var destType = document.getElementById('cr_desttype').value;
    var flowField = document.getElementById('cr_flow_field');
    var queueField = document.getElementById('cr_queue_field');
    if (flowField) flowField.style.display = destType === 'flow' ? '' : 'none';
    if (queueField) queueField.style.display = destType === 'queue' ? '' : 'none';
  }

  function updatePatternPlaceholder() {
    var mt = document.getElementById('cr_matchtype').value;
    var input = document.getElementById('cr_pattern');
    if (!input) return;
    input.placeholder = mt === 'exact' ? '+442071234567' : mt === 'prefix' ? '4420 (matches any number starting with this)' : '^\\\\+44207.*$';
  }

  window.callRoutesOpenEditor = function(id) {
    ensureLookups().then(function() { actuallyOpenEditor(id); });
  };

  function actuallyOpenEditor(id) {
    var existing = id ? CallRoutesService.getById(id) : null;
    var isNew = !existing;
    var r = existing || { id: '', name: '', matchType: 'exact', pattern: '', destinationType: 'flow', flowId: null, queueId: null, scheduleId: null, division: '', priority: 100, enabled: true, description: '' };

    currentEditId = r.id || '';
    routeDirty = false;

    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = requestCloseDrawer;
    document.body.appendChild(scrim);

    var flowOptions = optionsHtml((window.DB.flows || []).filter(function(f) { return f.dbId; }), 'dbId', 'name', r.flowId, 'Choose a flow\\u2026');
    var queueOptions = optionsHtml((window.DB.queues || []).filter(function(q) { return q.dbId; }), 'dbId', 'name', r.queueId, 'Choose a queue\\u2026');
    var schedOptions = optionsHtml((window.DB.schedGroups || []).filter(function(s) { return s.dbId; }), 'dbId', 'name', r.scheduleId, 'No schedule restriction');
    var divOptions = optionsHtml(divisionsCache, 'code', 'name', r.division, 'No division');
    var matchOptions = MATCH_TYPES.map(function(m) { return '<option value="' + m.v + '"' + (r.matchType === m.v ? ' selected' : '') + '>' + m.label + '</option>'; }).join('');
    var destOptions = DEST_TYPES.map(function(d) { return '<option value="' + d.v + '"' + (r.destinationType === d.v ? ' selected' : '') + '>' + d.label + '</option>'; }).join('');

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw"><div class="dh"><h2>' + (isNew ? 'Add' : 'Edit') + ' Call Route</h2><div class="x" onclick="window.__callRoutesRequestClose()">\\u00D7</div></div>' +
      '<div class="db">' +
        '<div id="crerr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
        '<div class="fld"><label>Route name</label><input id="cr_name" value="' + escapeHtml(r.name) + '" placeholder="Retail Main Line"></div>' +
        '<div class="fld"><label>Match type</label><select id="cr_matchtype">' + matchOptions + '</select></div>' +
        '<div class="fld"><label>Phone number / pattern</label><input id="cr_pattern" value="' + escapeHtml(r.pattern) + '"></div>' +
        '<div class="fld"><label>Destination</label><select id="cr_desttype">' + destOptions + '</select></div>' +
        '<div class="fld" id="cr_flow_field"><label>Destination flow</label><select id="cr_flow">' + flowOptions + '</select></div>' +
        '<div class="fld" id="cr_queue_field"><label>Destination queue</label><select id="cr_queue">' + queueOptions + '</select></div>' +
        '<div class="fld"><label>Schedule</label><select id="cr_schedule">' + schedOptions + '</select></div>' +
        '<div class="fld"><label>Division</label><select id="cr_division">' + divOptions + '</select></div>' +
        '<div class="fld"><label>Priority</label><input id="cr_priority" type="number" min="1" value="' + r.priority + '"></div>' +
        '<div class="fld"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input id="cr_enabled" type="checkbox"' + (r.enabled ? ' checked' : '') + '> Enabled</label></div>' +
        '<div class="fld"><label>Description</label><input id="cr_desc" value="' + escapeHtml(r.description) + '" placeholder="Optional note"></div>' +
        (isNew ? '' : '<button class="btn gh" onclick="window.callRoutesDelete(\\'' + r.id + '\\')">Delete</button>') +
      '</div>' +
      '<div class="df"><button class="btn sec" onclick="window.__callRoutesRequestClose()">Cancel</button><button class="btn" onclick="window.callRoutesSave(\\'' + (r.id || '') + '\\')">Save</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    updatePatternPlaceholder();
    toggleDestFields();

    document.getElementById('cr_matchtype').addEventListener('change', function() { updatePatternPlaceholder(); markDirty(); });
    document.getElementById('cr_desttype').addEventListener('change', function() { toggleDestFields(); markDirty(); });
    ['cr_name', 'cr_pattern', 'cr_flow', 'cr_queue', 'cr_schedule', 'cr_division', 'cr_priority', 'cr_enabled', 'cr_desc'].forEach(function(fid) {
      var el = document.getElementById(fid);
      if (el) el.addEventListener('input', markDirty);
      if (el) el.addEventListener('change', markDirty);
    });
  }

  function isDuplicateRoute(matchType, pattern, excludeId) {
    var norm = (pattern || '').trim().toLowerCase();
    return CallRoutesService.getAll().some(function(r) {
      return r.matchType === matchType && r.pattern.trim().toLowerCase() === norm && String(r.id) !== String(excludeId || '');
    });
  }

  window.callRoutesSave = function(id) {
    hideDrawerError();
    var name = document.getElementById('cr_name').value.trim();
    var matchType = document.getElementById('cr_matchtype').value;
    var pattern = document.getElementById('cr_pattern').value.trim();
    var destType = document.getElementById('cr_desttype').value;
    var flowId = document.getElementById('cr_flow').value ? parseInt(document.getElementById('cr_flow').value, 10) : null;
    var queueId = document.getElementById('cr_queue').value ? parseInt(document.getElementById('cr_queue').value, 10) : null;
    var scheduleId = document.getElementById('cr_schedule').value ? parseInt(document.getElementById('cr_schedule').value, 10) : null;
    var division = document.getElementById('cr_division').value;
    var priority = parseInt(document.getElementById('cr_priority').value, 10);
    var enabled = document.getElementById('cr_enabled').checked;
    var description = document.getElementById('cr_desc').value.trim();

    var errs = [];
    if (!name) errs.push('Route name is required.');
    if (!pattern) {
      errs.push('Phone number / pattern is required.');
    } else if (matchType === 'exact' && !/^\\+?[1-9][0-9]{6,14}$/.test(pattern)) {
      errs.push('Exact match numbers should look like +442071234567.');
    } else if (matchType === 'prefix' && !/^\\+?[0-9]{1,15}$/.test(pattern)) {
      errs.push('Prefix match should be digits only, with an optional leading +.');
    } else if (matchType === 'regex') {
      try { new RegExp(pattern); } catch (e) { errs.push('That regex pattern is invalid \\u2014 ' + escapeHtml(e.message)); }
    }
    if (destType === 'flow' && !flowId) errs.push('Choose a destination flow.');
    if (destType === 'queue' && !queueId) errs.push('Choose a destination queue.');
    if (!priority || priority < 1) errs.push('Priority must be a positive number.');
    if (pattern && isDuplicateRoute(matchType, pattern, id)) {
      errs.push('A route already matches \\u201C' + escapeHtml(pattern) + '\\u201D with the same match type.');
    }
    if (errs.length) { showDrawerError(errs.join('<br>')); return; }

    var entry = { name: name, matchType: matchType, pattern: pattern, destinationType: destType, flowId: flowId, queueId: queueId, scheduleId: scheduleId, division: division, priority: priority, enabled: enabled, description: description };
    var isNew = !id;
    var wantedSchedule = !!scheduleId;
    var wantedDivision = !!division;

    // No visual feedback while the request is in flight reads as "the
    // button doesn't work" on a slow connection — same fix as Prompts'
    // save (which can be much slower, but any save can lag on a cold-
    // starting free-tier backend).
    var saveBtn = Array.prototype.filter.call(document.querySelectorAll('.df button.btn'), function(b) {
      return (b.getAttribute('onclick') || '').indexOf('callRoutesSave') > -1;
    })[0];
    var saveBtnOrigText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving\\u2026'; }

    var op = isNew ? CallRoutesService.create(entry) : CallRoutesService.update(id, entry);
    op.then(function(savedRow) {
      return CallRoutesService.refresh().then(function() { return savedRow; });
    }).then(function(savedRow) {
      routeDirty = false;
      window.closeDrawer();
      refreshRoutesTable();
      // This server's call_routes table may predate the schedule_id/
      // division columns (see database/schema.sql's comment on them) —
      // the generic backend silently drops fields it doesn't recognise
      // rather than erroring, so the only honest way to know is to check
      // whether what came back actually has what was asked for.
      var droppedSchedule = wantedSchedule && !savedRow.scheduleId;
      var droppedDivision = wantedDivision && !savedRow.division;
      if (droppedSchedule || droppedDivision) {
        var what = droppedSchedule && droppedDivision ? 'the schedule and division' : droppedSchedule ? 'the schedule' : 'the division';
        if (window.toast) window.toast('\\u26A0 Saved <b>' + escapeHtml(name) + '</b> \\u2014 this server can\\'t store ' + what + ' on a route yet, so ' + (droppedSchedule && droppedDivision ? 'they weren\\'t' : 'it wasn\\'t') + ' saved.');
      } else {
        if (window.toast) window.toast((isNew ? '\\u2713 Added ' : '\\u2713 Saved ') + '<b>' + escapeHtml(name) + '</b>');
      }
    }).catch(function(err) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = saveBtnOrigText; }
      showDrawerError(escapeHtml((err && err.message) || 'Save failed \\u2014 please try again.'));
    });
  };

  function routeConfirmBox(msg, onYes) {
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
        '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" id="cr_cfyes">Confirm</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    document.getElementById('cr_cfyes').onclick = function() { window.closeDrawer(); onYes(); };
  }

  window.callRoutesDelete = function(id) {
    var r = CallRoutesService.getById(id);
    if (!r) return;
    var safeName = escapeHtml(r.name);
    routeConfirmBox('Delete call route <b>' + safeName + '</b>? Calls to <b>' + escapeHtml(r.pattern) + '</b> will no longer be answered by it. This cannot be undone.', function() {
      routeDirty = false;
      CallRoutesService.remove(id).then(function() {
        return CallRoutesService.refresh();
      }).then(function() {
        refreshRoutesTable();
        if (window.toast) window.toast('\\u2713 Deleted <b>' + safeName + '</b>');
      }).catch(function(err) {
        if (window.toast) window.toast('\\u2717 Delete failed \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
      });
    });
  };

  window.addEventListener('beforeunload', function(e) {
    if (routeDirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ═══════════ Page shell ═══════════
     Header kept close to the original: same breadcrumb/title/tab-count
     pattern, same "+ New Call Route" wording — a Search/Filter/Refresh
     toolbar is added (using the app's own .tbar/.chip/.s classes, the
     same ones Prompts/Flows already use) since none of those controls
     existed at all before, not because the existing chrome was redone. */
  function renderCallRoutingPage() {
    var count = CallRoutesService.getAll().length;
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A Routing</div>' +
      '<div class="tt"><h1>Call Routing</h1><div class="rt"><button class="btn" onclick="window.callRoutesOpenEditor()">+ New Call Route</button></div></div>' +
      '<div class="tabs"><div class="tb on">DID \\u2192 destination bindings (' + count + ')</div></div></div>' +
      '<div class="pbody"><div style="font-size:12px;color:#5b6b82;margin-bottom:10px">A call route answers an inbound number with a flow or a queue, optionally scoped to a schedule and a division. Numbers must exist in Telephony \\u203A DID Numbers.</div>' +
      '<div class="tbar">' +
        '<input class="s" placeholder="Search routes" oninput="window.callRoutesSearch(this.value)">' +
        '<select class="chip" onchange="window.callRoutesFilterStatus(this.value)">' +
          '<option value="">Status: All</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option>' +
        '</select>' +
        '<select class="chip" onchange="window.callRoutesFilterDest(this.value)">' +
          '<option value="">Destination: All</option><option value="flow">Flow</option><option value="queue">Queue</option>' +
        '</select>' +
        '<select class="chip" id="cr_div_filter" onchange="window.callRoutesFilterDivision(this.value)">' +
          '<option value="">Division: All</option>' +
        '</select>' +
        '<div class="sp"></div><div class="chip" onclick="window.callRoutesReload()">\\u21BB Refresh</div>' +
      '</div>' +
      '<div class="tblw">' + renderRoutesTable() + '</div>' +
      '<div style="height:30px"></div>' +
      '<div class="tt"><h2 style="font-size:16px;margin:0">Fallback Routes</h2><div class="rt"><button class="btn sec" onclick="window.fallbackOpenEditor()">+ Add Fallback</button></div></div>' +
      '<div style="font-size:12px;color:#5b6b82;margin:6px 0 10px">Used only when an inbound number matches none of the routing rules above \\u2014 a plain number-to-destination assignment with no pattern or priority.</div>' +
      '<div class="tblw" id="cr_fallback_tblw">' + renderFallbackTable() + '</div>' +
      '</div>';
  }

  function mountCallRoutingPage() {
    var cnt = document.getElementById('cnt');
    if (cnt) cnt.innerHTML = renderCallRoutingPage();
    var divSel = document.getElementById('cr_div_filter');
    if (divSel) {
      divSel.innerHTML = '<option value="">Division: All</option>' + divisionsCache.map(function(d) {
        return '<option value="' + escapeHtml(d.code) + '"' + (rFilters.division === d.code ? ' selected' : '') + '>' + escapeHtml(d.name) + '</option>';
      }).join('');
    }
  }

  function loadCallRoutingPage() {
    routesLoadState = 'loading';
    fallbackLoadState = 'loading';
    mountCallRoutingPage();
    FallbackService.refresh().then(function() {
      fallbackLoadState = 'ready';
      if (window.APP && window.APP.page === 'callroute') refreshFallbackTable();
    }).catch(function() {
      fallbackLoadState = 'error';
      if (window.APP && window.APP.page === 'callroute') refreshFallbackTable();
    });
    CallRoutesService.refresh().then(function() {
      routesLoadState = 'ready';
      if (window.APP && window.APP.page === 'callroute') mountCallRoutingPage();
    }).catch(function() {
      routesLoadState = 'error';
      if (window.APP && window.APP.page === 'callroute') refreshRoutesTable();
    });
  }

  var prevOpenPageForCallRoutes = window.openPage;
  window.openPage = function(id) {
    if (routeDirty && document.getElementById('drw') && id !== 'callroute') {
      if (!window.confirm('You have unsaved changes on this call route. Leave without saving?')) return;
      routeDirty = false;
    }
    if (id === 'callroute') {
      window.closeDrawer();
      window.restoreAdmin();
      window.navMark('admin');
      window.APP.page = 'callroute';
      loadCallRoutingPage();
      var links = document.querySelectorAll('#anav .lk');
      links.forEach(function(el) { el.classList.remove('on'); });
      for (var i = 0; i < links.length; i++) {
        var onclick = links[i].getAttribute('onclick') || '';
        if (onclick.indexOf("'callroute'") > -1) { links[i].classList.add('on'); break; }
      }
      window.scrollTo(0, 0);
      return;
    }
    return prevOpenPageForCallRoutes(id);
  };

  function initIfActive() {
    if (window.APP && window.APP.page === 'callroute' && document.getElementById('cnt')) loadCallRoutingPage();
  }
  initIfActive();
  setTimeout(initIfActive, 100);
  setTimeout(initIfActive, 400);

})();
`;
