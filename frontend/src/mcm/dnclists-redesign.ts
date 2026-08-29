/* ============================================================
   MCM Cloud CX — DNC Compliance Lists Backend Wiring
   NOT a redesign — reproduces the existing page markup exactly
   (same classes, same list table, same per-list numbers view) and
   replaces only what was dead: Create DNC List, Add Numbers, Delete
   list, Remove number and Number Lookup all only mutated an
   in-memory DB.dncLists array that reset on every page load. A
   Search box (list-of-lists view) and an Export CSV button
   (per-list numbers view) are added — the original page had neither.
   ============================================================ */

export const DNCLISTS_SCRIPT: string = `
(function() {
  'use strict';

  /* No seed/fallback list here on purpose -- same reasoning as
     contactlists-redesign.ts. The DNC_LISTS_FALLBACK copy of the demo
     'UK-Internal-DNC' list was rendered whenever the read failed OR came
     back empty, so an empty tenant still showed it. There is no local store
     left to fall back to at all. */

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ─── Backend row \u2192 frontend shape ─── */
  function normalizeListRow(row) {
    return {
      id: row.id,
      name: row.name,
      numberCount: row.numberCount !== undefined ? row.numberCount : (row.number_count || 0),
      numbers: row.numbers ? row.numbers.map(normalizeNumberRow) : undefined
    };
  }

  function normalizeNumberRow(row) {
    return { id: row.id, phone: row.phone };
  }

  /* ─── REST helper compatible with the shared window.apiFetch contract ───
     Same base URL / Authorization: Bearer <window.__authToken> contract as
     contactlists-redesign.ts's clApiFetch — kept as a local copy, same
     reasoning. */
  function dncApiFetch(path, init) {
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

  /* Every read and write below is backend-confirmed. A localListStore used to
     sit here that each .catch() fell back to, so a create, delete or
     number-add the server had REJECTED still resolved successfully and the UI
     reported it as done while PostgreSQL was unchanged. A DNC list silently
     failing to save is the worst case in this section -- it is the
     suppression list a dialer is legally required to honour -- so failures
     now propagate to the caller, and every caller surfaces them. */

  function fetchLists() {
    return dncApiFetch('/api/dnclists').then(function(rows) {
      if (!Array.isArray(rows)) throw new Error('Unexpected response from the server.');
      // An empty array is a real answer: this tenant has no DNC lists.
      return rows.map(normalizeListRow);
    });
  }

  function fetchListDetail(id) {
    return dncApiFetch('/api/dnclists/' + encodeURIComponent(id)).then(normalizeListRow);
  }

  var listsCache = [];
  var listsLoadError = '';
  var listsLoaded = false;

  var DncListsService = {
    getAll: function() { return listsCache; },
    getLoadError: function() { return listsLoadError; },
    isLoaded: function() { return listsLoaded; },
    refresh: function() {
      return fetchLists().then(function(list) {
        listsCache = list;
        listsLoadError = '';
        listsLoaded = true;
        return listsCache;
      }).catch(function(err) {
        listsLoadError = (err && err.message) || 'Could not load DNC lists.';
        listsLoaded = true;
        throw err;
      });
    },
    getDetail: function(id) { return fetchListDetail(id); },
    create: function(entry) {
      return dncApiFetch('/api/dnclists', { method: 'POST', body: JSON.stringify(entry) }).then(normalizeListRow);
    },
    remove: function(id) {
      return dncApiFetch('/api/dnclists/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    addNumbers: function(listId, numbers) {
      return dncApiFetch('/api/dnclists/' + encodeURIComponent(listId) + '/numbers',
        { method: 'POST', body: JSON.stringify({ numbers: numbers }) });
    },
    removeNumber: function(listId, numberId) {
      return dncApiFetch('/api/dnclists/' + encodeURIComponent(listId) + '/numbers/' + encodeURIComponent(numberId),
        { method: 'DELETE' });
    },
    lookup: function(number) {
      return dncApiFetch('/api/dnclists/lookup?number=' + encodeURIComponent(number));
    }
  };
  window.DncListsService = DncListsService;

  /* ─── Filter state (search text) ─── */
  var dncFilters = { q: '' };

  function filteredLists() {
    var q = dncFilters.q.trim().toLowerCase();
    return DncListsService.getAll().filter(function(l) {
      if (!q) return true;
      return l.name.toLowerCase().indexOf(q) > -1;
    });
  }

  /* The whole row opens the list, matching Campaigns and Contact Lists --
     the name alone used to be the only hit target. The Delete button stops
     the click from bubbling so it cannot both delete and navigate. */
  function renderListRow(l) {
    return '<tr onclick="window.dncView(\\'' + l.id + '\\')">' +
      '<td><b class="ob-name lnk">' + escapeHtml(l.name) + '</b>' +
        '<span class="ob-sub">' + (l.numberCount === 1 ? '1 suppressed number' : l.numberCount + ' suppressed numbers') + '</span></td>' +
      '<td class="ob-num">' + l.numberCount + '</td>' +
      '<td class="ob-opt"><span class="ob-muted">\\u2014</span></td>' +
      '<td class="ob-acts"><button class="ob-act" type="button" onclick="event.stopPropagation();window.dncDelete(\\'' + l.id + '\\')">Delete</button></td></tr>';
  }

  var COLS = 4;

  function renderListsTable() {
    var M = window.MCMOut;
    var list = filteredLists();
    var total = DncListsService.getAll().length;
    var loadErr = DncListsService.getLoadError();
    var rows;
    if (list.length) {
      rows = list.map(renderListRow).join('');
    } else if (loadErr) {
      rows = M ? M.stateRow(COLS, 'error', {
        title: 'Could not load DNC lists',
        sub: loadErr,
        actionLabel: 'Retry', actionCall: 'window.dncReload()'
      }) : '<tr><td colspan="4">' + escapeHtml(loadErr) + '</td></tr>';
    } else if (!DncListsService.isLoaded()) {
      rows = M ? M.stateRow(COLS, 'loading', { title: 'Loading DNC lists\\u2026' })
               : '<tr><td colspan="4">Loading\\u2026</td></tr>';
    } else if (total) {
      rows = M ? M.stateRow(COLS, 'nomatch', {
        title: 'No DNC lists match your search',
        sub: 'Try a different search term.',
        actionLabel: 'Clear search', actionCall: 'window.dncClearFilters()'
      }) : '<tr><td colspan="4">No matches</td></tr>';
    } else {
      rows = M ? M.stateRow(COLS, 'empty', {
        title: 'No DNC lists yet',
        sub: 'Create a suppression list, then attach it to a campaign so those numbers are never dialed.',
        actionLabel: '+ Create DNC List', actionCall: 'window.dncNew()'
      }) : '<tr><td colspan="4">No DNC lists yet</td></tr>';
    }
    // A refresh can fail while the cache still holds the previous read.
    // Those rows are still worth showing, but not without saying they may
    // be out of date.
    var staleBanner = (list.length && loadErr && M)
      ? M.banner(loadErr + ' The rows below are from the last successful load and may be out of date.',
                 'Retry', 'window.dncReload()')
      : '';
    return staleBanner + '<div class="tblw"><table class="dt"><thead><tr>' +
      '<th>List</th><th class="ob-num">Numbers</th><th class="ob-opt">Used by campaigns</th>' +
      '<th class="ob-acts"></th></tr></thead><tbody id="dnc_tb">' + rows + '</tbody></table></div>';
  }

  function refreshListsTable() {
    var wrap = document.getElementById('dnc_table_wrap');
    if (!wrap) return;
    wrap.innerHTML = renderListsTable();
  }

  window.dncSearch = function(value) { dncFilters.q = value || ''; refreshListsTable(); };
  window.dncClearFilters = function() {
    dncFilters.q = '';
    mount(renderDncListsPage());
  };
  window.dncReload = function() {
    DncListsService.refresh().then(function() {
      refreshListsTable();
      if (window.toast) window.toast('DNC lists refreshed');
    }).catch(function(err) {
      refreshListsTable();
      if (window.toast) window.toast('✗ ' + ((err && err.message) || 'Refresh failed'));
    });
  };

  /* Exact original page markup, with a Search box added above the table
     \u2014 the original had no way to filter the list-of-lists at all. */
  /* Counted from the lists already loaded and already shown below \\u2014 no
     extra request, nothing invented. */
  function dncKpis(all) {
    var M = window.MCMOut;
    if (!M) return '';
    var numbers = 0;
    all.forEach(function(l) { numbers += l.numberCount || 0; });
    var largest = all.reduce(function(a, b) { return (b.numberCount || 0) > (a.numberCount || 0) ? b : a; }, all[0] || null);
    return M.kpis([
      { label: 'DNC lists', value: all.length, sub: all.length === 1 ? '1 list' : all.length + ' lists', tone: 'accent' },
      { label: 'Suppressed numbers', value: numbers, sub: 'Never dialed by any campaign', tone: numbers ? 'warn' : '' },
      { label: 'Largest list', value: largest ? (largest.numberCount || 0) : 0, sub: largest ? largest.name : 'No lists yet' }
    ]);
  }

  function renderDncListsPage() {
    var all = DncListsService.getAll();
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A Outbound</div>' +
      '<div class="tt"><h1>DNC Lists</h1><div class="rt"><button class="btn" onclick="window.dncNew()">+ Create DNC List</button><button class="btn sec" onclick="window.dncLookup()">Number Lookup</button></div></div>' +
      '<div class="tabs"><div class="tb on">All Lists (' + all.length + ')</div></div></div>' +
      '<div class="pbody">' + dncKpis(all) + '<div class="tbar">' +
      '<input class="s" placeholder="Search DNC lists" oninput="window.dncSearch(this.value)" value="' + escapeHtml(dncFilters.q) + '">' +
      '<div class="sp"></div>' +
      '<button class="chip" type="button" onclick="window.dncReload()"><i class="ob-refresh-ic">\\u21BB</i> Refresh</button></div>' +
      '<div id="dnc_table_wrap">' + renderListsTable() + '</div></div>' +
      (window.renderHelp ? window.renderHelp('dnclists') : '') + '</div>';
  }

  function mount(html) {
    var cnt = document.getElementById('cnt');
    if (cnt) cnt.innerHTML = html;
  }

  function goListsIndex() {
    // Paints on both outcomes so a failed read shows the real error.
    DncListsService.refresh().then(
      function() { mount(renderDncListsPage()); },
      function() { mount(renderDncListsPage()); }
    );
  }

  window.dncNew = function() {
    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw" style="height:auto;top:25%;bottom:auto;border-radius:8px 0 0 8px"><div class="dh"><h2>Create DNC List</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div id="dnerr" class="ob-banner" style="display:none"></div>' +
      '<div class="fld"><label>Name *</label><input id="dn_name"></div></div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.dncSaveNew()">Create</button></div></div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.dncSaveNew = function() {
    var name = document.getElementById('dn_name').value.trim();
    if (name.length < 2 || DncListsService.getAll().some(function(x) { return x.name.toLowerCase() === name.toLowerCase(); })) {
      errBoxInline('dnerr', 'A unique name is required.');
      return;
    }
    DncListsService.create({ name: name }).then(function(created) {
      window.closeDrawer();
      if (window.toast) window.toast('DNC list created');
      return DncListsService.refresh().then(function() { window.dncView(created.id); });
    }).catch(function(err) {
      errBoxInline('dnerr', (err && err.message) || 'Create failed \\u2014 please try again.');
    });
  };

  var currentDetail = null;

  window.dncView = function(id) {
    DncListsService.getDetail(id).then(function(l) {
      if (!l) { if (window.toast) window.toast('List not found'); return; }
      currentDetail = l;
      if (window.APP) window.APP.page = 'dnclists';
      mount(renderListDetail(l));
    });
  };

  function renderListDetail(l) {
    var M = window.MCMOut;
    var rows = l.numbers.map(function(n) {
      return '<tr><td><b class="ob-mono">' + escapeHtml(n.phone) + '</b></td>' +
        '<td class="ob-acts"><button class="ob-act" type="button" onclick="window.dncDropNum(\\'' + l.id + '\\',\\'' + n.id + '\\')">Remove</button></td></tr>';
    }).join('');
    var empty = M ? M.stateRow(2, 'empty', {
      title: 'No numbers suppressed yet',
      sub: 'Add numbers in E.164 form (for example +447700900123). Campaigns using this list will never dial them.',
      actionLabel: '+ Add Numbers', actionCall: 'window.dncAddNum(\\'' + l.id + '\\')'
    }) : '<tr><td colspan="2">Empty</td></tr>';
    var count = l.numbers.length;
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A <a onclick="openPage(\\'dnclists\\')">Outbound \\u203A DNC Lists</a></div>' +
      '<div class="tt"><h1>' + escapeHtml(l.name) + '</h1><div class="rt">' +
      '<button class="btn" onclick="window.dncAddNum(\\'' + l.id + '\\')">+ Add Numbers</button>' +
      '<button class="btn sec" onclick="window.dncExport(\\'' + l.id + '\\')">Export CSV</button></div></div>' +
      '<div class="tabs"><div class="tb on">' + count + (count === 1 ? ' suppressed number' : ' suppressed numbers') + '</div></div></div>' +
      '<div class="pbody"><div class="ob-meta"><span>Numbers on this list <b>' + count + '</b></span>' +
      '<span>Never dialed by any campaign this list is attached to</span></div>' +
      '<div class="tblw ob-detail-narrow"><table class="dt"><thead><tr><th>Number</th><th class="ob-acts"></th></tr></thead><tbody>' +
      (rows || empty) + '</tbody></table></div></div>';
  }

  function refreshDetail(id) {
    return DncListsService.getDetail(id).then(function(l) {
      currentDetail = l;
      if (l) mount(renderListDetail(l));
      return l;
    });
  }

  window.dncAddNum = function(id) {
    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw" style="height:auto;top:25%;bottom:auto;border-radius:8px 0 0 8px"><div class="dh"><h2>Add Numbers</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div id="dnaerr" class="ob-banner" style="display:none"></div>' +
      '<div class="fld"><label>E.164 numbers (one per line or comma separated)</label><textarea id="dna_nums" style="height:110px" placeholder="+447700900123"></textarea></div></div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.dncSaveNums(\\'' + id + '\\')">Add</button></div></div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.dncSaveNums = function(id) {
    var raw = (document.getElementById('dna_nums').value || '').split(/[\\s,;]+/).filter(Boolean);
    if (!raw.length) { errBoxInline('dnaerr', 'Enter at least one number.'); return; }
    DncListsService.addNumbers(id, raw).then(function(res) {
      var added = res.added || 0, invalid = res.invalid || 0;
      if (invalid && !added) { errBoxInline('dnaerr', invalid + ' invalid number(s) \\u2014 use E.164 like +447700900123.'); return; }
      window.closeDrawer();
      var l = DncListsService.getAll().filter(function(x) { return x.id === id; })[0];
      if (window.toast) window.toast(added + ' number(s) added' + (invalid ? ' \\u2014 ' + invalid + ' invalid skipped' : ''));
      return refreshDetail(id);
    }).catch(function(err) {
      errBoxInline('dnaerr', (err && err.message) || 'Add failed \\u2014 please try again.');
    });
  };

  /* Drawer error boxes all render through the shared .ob-banner shell (see
     window.MCMOut), so a failed save reads the same as a failed load. */
  function errBoxInline(id, msg) {
    var box = document.getElementById(id);
    if (!box) return;
    box.style.display = '';
    box.innerHTML = window.MCMOut
      ? '<span class="ob-banner-ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/></svg></span>' +
        '<span class="ob-banner-txt">' + escapeHtml(msg) + '</span>'
      : escapeHtml(msg);
  }

  window.dncDropNum = function(id, numberId) {
    // Only refreshes (and so only drops the row) once the API confirmed.
    DncListsService.removeNumber(id, numberId).then(function() {
      if (window.toast) window.toast('Removed');
      return refreshDetail(id);
    }).catch(function(err) {
      if (window.toast) window.toast('✗ Could not remove the number — ' + escapeHtml((err && err.message) || 'please try again'));
    });
  };

  window.dncExport = function(id) {
    var l = currentDetail && currentDetail.id === id ? currentDetail : null;
    if (!l) return;
    var lines = l.numbers.map(function(n) { return n.phone; });
    var blob = new Blob(['Phone\\n' + lines.join('\\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = l.name + '.csv';
    a.click();
    if (window.toast) window.toast('List exported');
  };

  /* scripts.ts's own confirmBox()/openDrawerHTML() are local to its
     closure, not exposed on window \u2014 self-contained equivalent using
     the same #drw/.dh/.db/.df drawer classes, same as
     contactlists-redesign.ts's clConfirmBox(). */
  function dncConfirmBox(msg, onYes) {
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
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" id="dnc_cfyes">Confirm</button></div></div>';
    document.body.appendChild(wrap.firstChild);
    document.getElementById('dnc_cfyes').onclick = function() { window.closeDrawer(); onYes(); };
  }

  window.dncDelete = function(id) {
    var l = DncListsService.getAll().filter(function(x) { return x.id === id; })[0];
    var name = l ? l.name : 'this list';
    dncConfirmBox('Delete DNC list <b>' + escapeHtml(name) + '</b>?', function() {
      // Navigates away only after the API confirms the delete.
      DncListsService.remove(id).then(function() {
        if (window.toast) window.toast('Deleted');
        goListsIndex();
      }).catch(function(err) {
        if (window.toast) window.toast('✗ Delete failed — ' + escapeHtml((err && err.message) || 'please try again'));
      });
    });
  };

  window.dncLookup = function() {
    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw" style="height:auto;top:25%;bottom:auto;border-radius:8px 0 0 8px"><div class="dh"><h2>DNC Number Lookup</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div class="fld"><label>Number</label><input id="dl_n" placeholder="+447700900104"></div>' +
      '<div class="fld"><label>&nbsp;</label><button class="btn" onclick="window.dncRunLookup()">Check</button></div>' +
      '<div id="dl_out" style="font-size:12.5px"></div></div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Close</button></div></div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.dncRunLookup = function() {
    var n = document.getElementById('dl_n').value.trim();
    DncListsService.lookup(n).catch(function(err) {
      var out = document.getElementById('dl_out');
      if (out) out.innerHTML = '<div style="background:#fdecea;border:1px solid #f5c6c0;border-radius:6px;padding:9px 12px;color:#b3261e">✗ Lookup failed — ' +
        escapeHtml((err && err.message) || 'please try again') + '</div>';
      return null;
    }).then(function(res) {
      if (!res) return;
      var hits = res.hits || [];
      var out = document.getElementById('dl_out');
      if (!out) return;
      out.innerHTML = hits.length
        ? '<div style="background:#fff8e6;border:1px solid #f2dfa7;border-radius:6px;padding:9px 12px">\\u26A0 <b>' + escapeHtml(n) + '</b> is suppressed by: ' + hits.map(function(d) { return '<span class="tag o">' + escapeHtml(d.name) + '</span>'; }).join(' ') + '</div>'
        : '<div style="background:#e8f7ef;border:1px solid #bfe6cf;border-radius:6px;padding:9px 12px">\\u2713 <b>' + escapeHtml(n) + '</b> is not on any DNC list \\u2014 dialable.</div>';
    });
  };

  /* ─── Wire into the router ───
     scripts.ts's own DYN4 router hook does:
       var DYN4 = { campaigns: ..., contactlists: ..., dnclists: window.renderDnc };
       window.openPage = function(id) { if (DYN4[id]) { ...; DYN4[id](); return; } return prevOpen(id); };
     DYN4.dnclists captures whatever window.renderDnc *was* at that point in
     time \u2014 same stale-closure issue contactlists-redesign.ts hit with
     DYN4.contactlists. Fix is the same \u2014 wrap window.openPage itself so
     this module's wrapper runs first and only falls through to the
     existing chain for every id other than 'dnclists'. campaigns/
     contactlists (the other two DYN4 entries) are untouched here \u2014
     contactlists-redesign.ts already wraps window.openPage for its own id
     and falls through to this chain in turn, so both keep working. */
  window.renderDnc = function() { goListsIndex(); };

  var prevOpenPageForDnc = window.openPage;
  window.openPage = function(id) {
    if (id === 'dnclists') {
      window.closeDrawer();
      window.restoreAdmin();
      window.navMark('admin');
      window.APP.page = 'dnclists';
      goListsIndex();
      var links = document.querySelectorAll('#anav .lk');
      links.forEach(function(el) { el.classList.remove('on'); });
      for (var i = 0; i < links.length; i++) {
        var onclick = links[i].getAttribute('onclick') || '';
        if (onclick.indexOf("'dnclists'") > -1) { links[i].classList.add('on'); break; }
      }
      window.scrollTo(0, 0);
      return;
    }
    return prevOpenPageForDnc(id);
  };

  function applyDncListsRedesign() {
    var paint = function() {
      if (window.APP && window.APP.page === 'dnclists' && !currentDetail) mount(renderDncListsPage());
    };
    DncListsService.refresh().then(paint, paint);
  }

  applyDncListsRedesign();
  setTimeout(applyDncListsRedesign, 100);
  setTimeout(applyDncListsRedesign, 400);

})();
`;
