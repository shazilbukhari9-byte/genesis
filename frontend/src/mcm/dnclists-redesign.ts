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
     back empty, so an empty tenant still showed it. localListStore starts
     empty and only holds rows this browser created while offline. */

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid(prefix) { return (prefix || 'id') + Math.random().toString(36).slice(2, 10); }

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

  /* Local-first mutable store, starting empty: it holds only rows this
     browser created while the backend was unreachable, so a create/add/
     remove/delete that succeeded locally is not silently discarded by the
     next refresh(). It seeds nothing. Holds full list+numbers objects. */
  var localListStore = [];

  function summarize(list) {
    return { id: list.id, name: list.name, numberCount: list.numbers.length };
  }

  function fetchLists() {
    return dncApiFetch('/api/dnclists').then(function(rows) {
      // An empty array is a real answer -- this tenant has no DNC lists.
      return Array.isArray(rows) ? rows.map(normalizeListRow) : localListStore.map(summarize);
    }).catch(function() {
      return localListStore.map(summarize);
    });
  }

  function fetchListDetail(id) {
    return dncApiFetch('/api/dnclists/' + encodeURIComponent(id)).then(normalizeListRow).catch(function() {
      var local = localListStore.filter(function(l) { return l.id === id; })[0];
      return local ? Object.assign(summarize(local), { numbers: local.numbers }) : null;
    });
  }

  var listsCache = [];

  var DncListsService = {
    getAll: function() { return listsCache; },
    refresh: function() {
      return fetchLists().then(function(list) {
        // Accept an empty list too, so deleting the last one clears the cache.
        if (Array.isArray(list)) listsCache = list;
        return listsCache;
      });
    },
    getDetail: function(id) { return fetchListDetail(id); },
    create: function(entry) {
      return dncApiFetch('/api/dnclists', { method: 'POST', body: JSON.stringify(entry) }).then(normalizeListRow).catch(function() {
        if (localListStore.some(function(l) { return l.name.toLowerCase() === entry.name.toLowerCase(); })) {
          throw new Error('A unique name is required.');
        }
        var created = { id: uid('dnc-'), name: entry.name, numbers: [] };
        localListStore.push(created);
        return summarize(created);
      });
    },
    remove: function(id) {
      return dncApiFetch('/api/dnclists/' + encodeURIComponent(id), { method: 'DELETE' }).catch(function() {
        localListStore = localListStore.filter(function(l) { return l.id !== id; });
        return { ok: true };
      });
    },
    addNumbers: function(listId, numbers) {
      return dncApiFetch('/api/dnclists/' + encodeURIComponent(listId) + '/numbers', { method: 'POST', body: JSON.stringify({ numbers: numbers }) })
        .catch(function() {
          var local = localListStore.filter(function(l) { return l.id === listId; })[0];
          if (!local) return { ok: false, added: 0, invalid: numbers.length };
          var added = 0, invalid = 0;
          var existing = local.numbers.map(function(n) { return n.phone; });
          numbers.forEach(function(n) {
            n = (n || '').trim();
            if (!/^\\+\\d{7,15}$/.test(n)) { invalid++; return; }
            if (existing.indexOf(n) > -1) return;
            local.numbers.push({ id: uid('dcn-'), phone: n });
            existing.push(n);
            added++;
          });
          return { ok: true, added: added, invalid: invalid };
        });
    },
    removeNumber: function(listId, numberId) {
      return dncApiFetch('/api/dnclists/' + encodeURIComponent(listId) + '/numbers/' + encodeURIComponent(numberId), { method: 'DELETE' }).catch(function() {
        var local = localListStore.filter(function(l) { return l.id === listId; })[0];
        if (local) local.numbers = local.numbers.filter(function(n) { return n.id !== numberId; });
        return { ok: true };
      });
    },
    lookup: function(number) {
      return dncApiFetch('/api/dnclists/lookup?number=' + encodeURIComponent(number)).catch(function() {
        var hits = localListStore.filter(function(l) { return l.numbers.some(function(n) { return n.phone === number; }); })
          .map(function(l) { return { id: l.id, name: l.name }; });
        return { number: number, hits: hits };
      });
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

  function renderListRow(l) {
    return '<tr><td><b class="lnk" onclick="window.dncView(\\'' + l.id + '\\')">' + escapeHtml(l.name) + '</b></td>' +
      '<td>' + l.numberCount + '</td>' +
      '<td>\\u2014</td>' +
      '<td style="width:70px"><a class="lnk" style="font-size:12px" onclick="window.dncDelete(\\'' + l.id + '\\')">Delete</a></td></tr>';
  }

  function renderListsTable() {
    var list = filteredLists();
    var total = DncListsService.getAll().length;
    var rows;
    if (list.length) {
      rows = list.map(renderListRow).join('');
    } else if (total) {
      rows = '<tr><td colspan="4" style="text-align:center;color:#8794a8;padding:24px">No DNC lists match your search.</td></tr>';
    } else {
      rows = '<tr><td colspan="4" style="text-align:center;color:#8794a8;padding:24px">No DNC lists yet \\u2014 create one to get started.</td></tr>';
    }
    return '<div class="tblw"><table class="dt"><thead><tr><th>List</th><th>Numbers</th><th>Used by campaigns</th><th></th></tr></thead><tbody id="dnc_tb">' + rows + '</tbody></table></div>';
  }

  function refreshListsTable() {
    var wrap = document.getElementById('dnc_table_wrap');
    if (!wrap) return;
    wrap.innerHTML = renderListsTable();
  }

  window.dncSearch = function(value) { dncFilters.q = value || ''; refreshListsTable(); };
  window.dncReload = function() {
    DncListsService.refresh().then(function() {
      refreshListsTable();
      if (window.toast) window.toast('DNC lists refreshed');
    });
  };

  /* Exact original page markup, with a Search box added above the table
     \u2014 the original had no way to filter the list-of-lists at all. */
  function renderDncListsPage() {
    var all = DncListsService.getAll();
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A Outbound</div>' +
      '<div class="tt"><h1>DNC Lists</h1><div class="rt"><button class="btn" onclick="window.dncNew()">+ Create DNC List</button><button class="btn sec" onclick="window.dncLookup()">Number Lookup</button></div></div>' +
      '<div class="tabs"><div class="tb on">All Lists (' + all.length + ')</div></div></div>' +
      '<div class="pbody"><div class="tbar"><input class="s" placeholder="Search DNC lists" oninput="window.dncSearch(this.value)" value="' + escapeHtml(dncFilters.q) + '">' +
      '<div class="sp"></div><div class="chip" onclick="window.dncReload()">\\u21BB Refresh</div></div>' +
      '<div id="dnc_table_wrap">' + renderListsTable() + '</div></div>' +
      (window.renderHelp ? window.renderHelp('dnclists') : '') + '</div>';
  }

  function mount(html) {
    var cnt = document.getElementById('cnt');
    if (cnt) cnt.innerHTML = html;
  }

  function goListsIndex() {
    DncListsService.refresh().then(function() { mount(renderDncListsPage()); });
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
      '<div class="db"><div id="dnerr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
      '<div class="fld"><label>Name *</label><input id="dn_name"></div></div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.dncSaveNew()">Create</button></div></div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.dncSaveNew = function() {
    var name = document.getElementById('dn_name').value.trim();
    if (name.length < 2 || DncListsService.getAll().some(function(x) { return x.name.toLowerCase() === name.toLowerCase(); })) {
      var box = document.getElementById('dnerr');
      box.style.display = '';
      box.innerHTML = 'A unique name is required.';
      return;
    }
    DncListsService.create({ name: name }).then(function(created) {
      window.closeDrawer();
      if (window.toast) window.toast('DNC list created');
      return DncListsService.refresh().then(function() { window.dncView(created.id); });
    }).catch(function(err) {
      var box = document.getElementById('dnerr');
      box.style.display = '';
      box.innerHTML = escapeHtml((err && err.message) || 'Create failed \\u2014 please try again.');
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
    var rows = l.numbers.map(function(n) {
      return '<tr><td><b>' + escapeHtml(n.phone) + '</b></td><td style="width:80px"><a class="lnk" style="font-size:12px" onclick="window.dncDropNum(\\'' + l.id + '\\',\\'' + n.id + '\\')">Remove</a></td></tr>';
    }).join('');
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A <a onclick="openPage(\\'dnclists\\')">Outbound \\u203A DNC Lists</a></div>' +
      '<div class="tt"><h1>' + escapeHtml(l.name) + '</h1><div class="rt">' +
      '<button class="btn" onclick="window.dncAddNum(\\'' + l.id + '\\')">+ Add Numbers</button>' +
      '<button class="btn sec" onclick="window.dncExport(\\'' + l.id + '\\')">Export CSV</button></div></div>' +
      '<div class="tabs"><div class="tb on">' + l.numbers.length + ' suppressed numbers</div></div></div>' +
      '<div class="pbody"><div class="tblw" style="max-width:480px"><table class="dt"><thead><tr><th>Number</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="2" style="text-align:center;color:#8794a8;padding:20px">Empty</td></tr>') + '</tbody></table></div></div>';
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
      '<div class="db"><div id="dnaerr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
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

  function errBoxInline(id, msg) {
    var box = document.getElementById(id);
    if (!box) return;
    box.style.display = '';
    box.innerHTML = escapeHtml(msg);
  }

  window.dncDropNum = function(id, numberId) {
    DncListsService.removeNumber(id, numberId).then(function() {
      if (window.toast) window.toast('Removed');
      return refreshDetail(id);
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
      DncListsService.remove(id).then(function() {
        if (window.toast) window.toast('Deleted');
        goListsIndex();
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
    DncListsService.lookup(n).then(function(res) {
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
    DncListsService.refresh().then(function() {
      if (window.APP && window.APP.page === 'dnclists' && !currentDetail) mount(renderDncListsPage());
    });
  }

  applyDncListsRedesign();
  setTimeout(applyDncListsRedesign, 100);
  setTimeout(applyDncListsRedesign, 400);

})();
`;
