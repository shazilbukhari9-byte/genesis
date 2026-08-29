/* ============================================================
   MCM Cloud CX — Contact Lists Backend Wiring
   NOT a redesign — reproduces the existing page markup exactly
   (same classes, same list table, same list-detail table/columns)
   and replaces only what was dead: Create Contact List, Add
   Contact, Import CSV, Export CSV, Mark DNC, Delete contact and
   Delete list all only mutated an in-memory DB.contactLists array
   that reset on every page load. A Search + Division filter toolbar
   (same .tbar/.s/.chip pattern every other admin table already
   uses) is added above the list table — the original page had no
   way to filter a list of lists at all.
   ============================================================ */

export const CONTACTLISTS_SCRIPT: string = `
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

  /* No seed/fallback list here on purpose. This module used to carry a
     CONTACT_LISTS_FALLBACK copy of the two demo lists (13 contacts) that
     scripts.ts's ensureOB() and init_db.py both also produced, and it was
     rendered whenever the read failed OR came back empty -- so a tenant
     with no contact lists, and a deleted list, both still showed the demo
     data. An empty response is a real answer now and paints the empty
     state, and there is no local store left to fall back to at all. */

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
      division: row.division || '',
      cols: row.cols || ['FirstName', 'LastName', 'Phone'],
      contactCount: row.contactCount !== undefined ? row.contactCount : (row.contact_count || 0),
      statusSummary: row.statusSummary || row.status_summary || {},
      contacts: row.contacts ? row.contacts.map(normalizeContactRow) : undefined
    };
  }

  function normalizeContactRow(row) {
    return {
      id: row.id,
      data: row.data || {},
      status: row.status || 'Not attempted',
      attempts: row.attempts || 0,
      lastResult: row.lastResult !== undefined ? row.lastResult : (row.last_result || '')
    };
  }

  /* ─── REST helper compatible with the shared window.apiFetch contract ───
     Same base URL / Authorization: Bearer <window.__authToken> contract as
     certs-redesign.ts's certsApiFetch — kept as a local copy, same reasoning. */
  function clApiFetch(path, init) {
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
     sit here that each .catch() fell back to, which meant a create, delete,
     import or DNC-mark the server had REJECTED still resolved successfully:
     the drawer closed, a green toast fired and the row appeared or vanished
     while PostgreSQL had changed nothing. Failures now propagate to the
     caller, and every caller surfaces them. */

  function fetchLists() {
    return clApiFetch('/api/contactlists').then(function(rows) {
      if (!Array.isArray(rows)) throw new Error('Unexpected response from the server.');
      // An empty array is a real answer: this tenant has no contact lists.
      return rows.map(normalizeListRow);
    });
  }

  function fetchListDetail(id) {
    return clApiFetch('/api/contactlists/' + encodeURIComponent(id)).then(normalizeListRow);
  }

  var listsCache = [];
  var listsLoadError = '';
  var listsLoaded = false;

  var ContactListsService = {
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
        listsLoadError = (err && err.message) || 'Could not load contact lists.';
        listsLoaded = true;
        throw err;
      });
    },
    getDetail: function(id) { return fetchListDetail(id); },
    create: function(entry) {
      return clApiFetch('/api/contactlists', { method: 'POST', body: JSON.stringify(entry) }).then(normalizeListRow);
    },
    remove: function(id) {
      return clApiFetch('/api/contactlists/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    addContact: function(listId, data) {
      return clApiFetch('/api/contactlists/' + encodeURIComponent(listId) + '/contacts',
        { method: 'POST', body: JSON.stringify({ data: data }) }).then(normalizeContactRow);
    },
    importContacts: function(listId, rows) {
      return clApiFetch('/api/contactlists/' + encodeURIComponent(listId) + '/contacts/import',
        { method: 'POST', body: JSON.stringify({ rows: rows }) });
    },
    removeContact: function(listId, contactId) {
      return clApiFetch('/api/contactlists/' + encodeURIComponent(listId) + '/contacts/' + encodeURIComponent(contactId),
        { method: 'DELETE' });
    },
    markDnc: function(listId, contactId) {
      return clApiFetch('/api/contactlists/' + encodeURIComponent(listId) + '/contacts/' + encodeURIComponent(contactId) + '/dnc',
        { method: 'PATCH' }).then(normalizeContactRow);
    }
  };
  window.ContactListsService = ContactListsService;

  /* ─── Filter state (search text + division) ─── */
  var clFilters = { q: '', division: '' };

  function filteredLists() {
    var q = clFilters.q.trim().toLowerCase();
    return ContactListsService.getAll().filter(function(l) {
      if (clFilters.division && l.division !== clFilters.division) return false;
      if (!q) return true;
      return l.name.toLowerCase().indexOf(q) > -1;
    });
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

  /* Status summary as pills rather than one run-on "k: n \\u00B7 k: n" string,
     so a list with contacts still to dial reads at a glance. */
  function summaryPills(summary) {
    var M = window.MCMOut;
    var keys = Object.keys(summary || {});
    if (!keys.length) return '<span class="ob-muted">\\u2014</span>';
    var tone = { 'Not attempted': 'info', Contacted: 'ok', Complete: 'off', DNC: 'warn' };
    return keys.map(function(k) {
      return M ? M.pill(k + ' ' + summary[k], tone[k] || 'off')
               : escapeHtml(k + ': ' + summary[k]);
    }).join(' ');
  }

  function renderListRow(l) {
    var M = window.MCMOut;
    return '<tr onclick="window.clView(\\'' + l.id + '\\')">' +
      '<td><b class="ob-name lnk">' + escapeHtml(l.name) + '</b>' +
        '<span class="ob-sub">' + escapeHtml((l.cols || []).join(' \\u00B7 ')) + '</span></td>' +
      '<td class="ob-opt">' + escapeHtml(divisionLabel(l.division)) + '</td>' +
      '<td class="ob-num">' + l.contactCount + '</td>' +
      '<td class="ob-opt2">' + summaryPills(l.statusSummary) + '</td>' +
      (M ? M.goCell() : '<td></td>') + '</tr>';
  }

  var COLS = 5;

  /* Drawer error boxes all render through the shared .ob-banner shell (see
     window.MCMOut). html=true keeps the multi-line validation list. */
  function showFormError(id, message, html) {
    var box = document.getElementById(id);
    if (!box) return;
    box.style.display = '';
    box.innerHTML = window.MCMOut
      ? '<span class="ob-banner-ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/></svg></span>' +
        '<span class="ob-banner-txt">' + (html ? message : escapeHtml(message)) + '</span>'
      : (html ? message : escapeHtml(message));
  }

  function renderListsTable() {
    var M = window.MCMOut;
    var list = filteredLists();
    var total = ContactListsService.getAll().length;
    var loadErr = ContactListsService.getLoadError();
    var rows;
    if (list.length) {
      rows = list.map(renderListRow).join('');
    } else if (loadErr) {
      rows = M ? M.stateRow(COLS, 'error', {
        title: 'Could not load contact lists',
        sub: loadErr,
        actionLabel: 'Retry', actionCall: 'window.clReload()'
      }) : '<tr><td colspan="5">' + escapeHtml(loadErr) + '</td></tr>';
    } else if (!ContactListsService.isLoaded()) {
      rows = M ? M.stateRow(COLS, 'loading', { title: 'Loading contact lists\\u2026' })
               : '<tr><td colspan="5">Loading\\u2026</td></tr>';
    } else if (total) {
      rows = M ? M.stateRow(COLS, 'nomatch', {
        title: 'No contact lists match your filters',
        sub: 'Try a different search term, or clear the division filter.',
        actionLabel: 'Clear filters', actionCall: 'window.clClearFilters()'
      }) : '<tr><td colspan="5">No matches</td></tr>';
    } else {
      rows = M ? M.stateRow(COLS, 'empty', {
        title: 'No contact lists yet',
        sub: 'Create a list, then import contacts from CSV to dial against it.',
        actionLabel: '+ Create Contact List', actionCall: 'window.newContactList()'
      }) : '<tr><td colspan="5">No contact lists yet</td></tr>';
    }
    // A refresh can fail while the cache still holds the previous read.
    // Those rows are still worth showing, but not without saying they may
    // be out of date.
    var staleBanner = (list.length && loadErr && M)
      ? M.banner(loadErr + ' The rows below are from the last successful load and may be out of date.',
                 'Retry', 'window.clReload()')
      : '';
    return staleBanner + '<div class="tblw"><table class="dt"><thead><tr>' +
      '<th>List</th><th class="ob-opt">Division</th><th class="ob-num">Contacts</th>' +
      '<th class="ob-opt2">Status summary</th><th class="ob-go"></th></tr></thead><tbody id="cl_tb">' +
      rows + '</tbody></table></div>';
  }

  function refreshListsTable() {
    var wrap = document.getElementById('cl_table_wrap');
    if (!wrap) return;
    wrap.innerHTML = renderListsTable();
  }

  window.clSearch = function(value) { clFilters.q = value || ''; refreshListsTable(); };
  window.clClearFilters = function() {
    clFilters.q = '';
    clFilters.division = '';
    mount(renderContactListsPage());
  };
  window.clFilterDivision = function(value) { clFilters.division = value || ''; refreshListsTable(); };
  window.clReload = function() {
    ContactListsService.refresh().then(function() {
      refreshListsTable();
      if (window.toast) window.toast('Contact lists refreshed');
    }).catch(function(err) {
      refreshListsTable();
      if (window.toast) window.toast('✗ ' + ((err && err.message) || 'Refresh failed'));
    });
  };

  /* Exact original page markup (header/tabs/table/help), with a Search +
     Division filter toolbar added above the table \\u2014 the original had
     no way to filter the list-of-lists at all. */
  /* Every figure is counted from the lists already loaded and already shown
     in the table below \\u2014 no extra request, nothing invented. */
  function listsKpis(all) {
    var M = window.MCMOut;
    if (!M) return '';
    var contacts = 0, pending = 0, dnc = 0;
    all.forEach(function(l) {
      contacts += l.contactCount || 0;
      var sum = l.statusSummary || {};
      pending += sum['Not attempted'] || 0;
      dnc += sum.DNC || 0;
    });
    return M.kpis([
      { label: 'Lists', value: all.length, sub: all.length === 1 ? '1 list' : all.length + ' lists', tone: 'accent' },
      { label: 'Contacts', value: contacts, sub: 'Across every list' },
      { label: 'Not attempted', value: pending, sub: 'Still to be dialed', tone: pending ? 'ok' : '' },
      { label: 'Marked DNC', value: dnc, sub: 'Suppressed by an agent', tone: dnc ? 'warn' : '' }
    ]);
  }

  function renderContactListsPage() {
    var all = ContactListsService.getAll();
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A Outbound</div>' +
      '<div class="tt"><h1>Contact Lists</h1><div class="rt"><button class="btn" onclick="window.newContactList()">+ Create Contact List</button></div></div>' +
      '<div class="tabs"><div class="tb on">All Lists (' + all.length + ')</div></div></div>' +
      '<div class="pbody">' + listsKpis(all) + '<div class="tbar">' +
        '<input class="s" placeholder="Search contact lists" oninput="window.clSearch(this.value)" value="' + escapeHtml(clFilters.q) + '">' +
        '<select class="chip" onchange="window.clFilterDivision(this.value)">' + divisionOptions(clFilters.division) + '</select>' +
        '<div class="sp"></div>' +
        '<button class="chip" type="button" onclick="window.clReload()"><i class="ob-refresh-ic">\\u21BB</i> Refresh</button>' +
      '</div>' +
      '<div id="cl_table_wrap">' + renderListsTable() + '</div></div>' +
      (window.renderHelp ? window.renderHelp('contactlists') : '') + '</div>';
  }

  function mount(html) {
    var cnt = document.getElementById('cnt');
    if (cnt) cnt.innerHTML = html;
  }

  function goListsIndex() {
    // Paints on both outcomes: a failed refresh must still render, so the
    // table can show the real error rather than the previous screen.
    ContactListsService.refresh().then(
      function() { mount(renderContactListsPage()); },
      function() { mount(renderContactListsPage()); }
    );
  }

  window.newContactList = function() {
    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw" style="height:auto;top:20%;bottom:auto;border-radius:8px 0 0 8px"><div class="dh"><h2>Create Contact List</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div id="clerr" class="ob-banner" style="display:none"></div>' +
      '<div class="fld"><label>Name *</label><input id="cl_name"></div>' +
      '<div class="fld"><label>Division</label><select id="cl_div">' + divisionFieldOptions('') + '</select></div>' +
      '<div class="fld"><label>Columns (comma separated \\u2014 must include Phone)</label><input id="cl_cols" value="FirstName,LastName,Phone"></div></div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.saveContactList()">Create</button></div></div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.saveContactList = function() {
    var name = document.getElementById('cl_name').value.trim();
    var cols = document.getElementById('cl_cols').value.split(',').map(function(x) { return x.trim(); }).filter(Boolean);
    var errs = [];
    if (name.length < 2) errs.push('List name is required.');
    if (ContactListsService.getAll().some(function(x) { return x.name.toLowerCase() === name.toLowerCase(); })) errs.push('A list with this name already exists.');
    if (cols.indexOf('Phone') < 0) errs.push('Columns must include "Phone".');
    if (errs.length) {
      showFormError('clerr', errs.join('<br>'), true);
      return;
    }
    var division = document.getElementById('cl_div').value;
    ContactListsService.create({ name: name, division: division, cols: cols }).then(function(created) {
      window.closeDrawer();
      if (window.toast) window.toast('Contact list created \\u2014 now import contacts');
      return ContactListsService.refresh().then(function() { window.clView(created.id); });
    }).catch(function(err) {
      showFormError('clerr', (err && err.message) || 'Create failed \\u2014 please try again.');
    });
  };

  var currentDetail = null;

  window.clView = function(id) {
    ContactListsService.getDetail(id).then(function(l) {
      if (!l) { if (window.toast) window.toast('List not found'); return; }
      currentDetail = l;
      if (window.APP) window.APP.page = 'contactlists';
      mount(renderListDetail(l));
    });
  };

  function statusTone(status) {
    return status === 'DNC' ? 'warn' : status === 'Contacted' ? 'ok' : status === 'Complete' ? 'off' : 'info';
  }

  function renderListDetail(l) {
    var M = window.MCMOut;
    var head = l.cols.map(function(c) { return '<th>' + escapeHtml(c) + '</th>'; }).join('');
    var rows = l.contacts.map(function(ct) {
      var cells = l.cols.map(function(c) { return '<td>' + escapeHtml(ct.data[c] || '') + '</td>'; }).join('');
      return '<tr>' + cells +
        '<td>' + (M ? M.pill(ct.status, statusTone(ct.status)) : escapeHtml(ct.status)) +
          (ct.lastResult ? '<span class="ob-sub">' + escapeHtml(ct.lastResult) + '</span>' : '') + '</td>' +
        '<td class="ob-num ob-opt">' + ct.attempts + '</td>' +
        '<td class="ob-acts">' +
          (ct.status !== 'DNC' ? '<button class="ob-act" type="button" onclick="window.ctDnc(\\'' + l.id + '\\',\\'' + ct.id + '\\')">Mark DNC</button> ' : '') +
          '<button class="ob-act" type="button" onclick="window.ctDel(\\'' + l.id + '\\',\\'' + ct.id + '\\')">Delete</button></td></tr>';
    }).join('');
    // The detail response carries the contacts themselves rather than a
    // status summary, so these are counted from the rows rendered above.
    var sum = {};
    l.contacts.forEach(function(ct) { sum[ct.status] = (sum[ct.status] || 0) + 1; });
    var meta = '<div class="ob-meta"><span>Division <b>' + escapeHtml(divisionLabel(l.division)) + '</b></span>' +
      '<span>Columns <b>' + escapeHtml(l.cols.join(', ')) + '</b></span>' +
      (sum['Not attempted'] ? '<span>Not attempted <b>' + sum['Not attempted'] + '</b></span>' : '') +
      (sum.Contacted ? '<span>Contacted <b>' + sum.Contacted + '</b></span>' : '') +
      (sum.DNC ? '<span>Marked DNC <b>' + sum.DNC + '</b></span>' : '') + '</div>';
    var empty = M ? M.stateRow(l.cols.length + 3, 'empty', {
      title: 'No contacts in this list',
      sub: 'Add a contact directly, or import a CSV with a Phone column.',
      actionLabel: 'Import CSV', actionCall: 'window.clImport(\\'' + l.id + '\\')'
    }) : '<tr><td colspan="' + (l.cols.length + 3) + '">No contacts</td></tr>';
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A <a onclick="openPage(\\'contactlists\\')">Outbound \\u203A Contact Lists</a></div>' +
      '<div class="tt"><h1>' + escapeHtml(l.name) + '</h1><div class="rt">' +
      '<button class="btn" onclick="window.ctAdd(\\'' + l.id + '\\')">+ Add Contact</button>' +
      '<button class="btn sec" onclick="window.clImport(\\'' + l.id + '\\')">Import CSV</button>' +
      '<button class="btn sec" onclick="window.clExport(\\'' + l.id + '\\')">Export CSV</button>' +
      '<button class="btn gh" onclick="window.clDelete(\\'' + l.id + '\\')">Delete list</button></div></div>' +
      '<div class="tabs"><div class="tb on">' + l.contacts.length + (l.contacts.length === 1 ? ' contact' : ' contacts') + '</div></div></div>' +
      '<div class="pbody">' + meta + '<div class="tblw"><table class="dt"><thead><tr>' + head +
      '<th>Status</th><th class="ob-num ob-opt">Attempts</th><th class="ob-acts"></th></tr></thead><tbody>' +
      (rows || empty) + '</tbody></table></div></div>';
  }

  function refreshDetail(id) {
    return ContactListsService.getDetail(id).then(function(l) {
      currentDetail = l;
      if (l) mount(renderListDetail(l));
      return l;
    });
  }

  window.ctAdd = function(lid) {
    var l = currentDetail && currentDetail.id === lid ? currentDetail : null;
    var cols = l ? l.cols : ['FirstName', 'LastName', 'Phone'];
    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);

    var flds = cols.map(function(c) { return '<div class="fld"><label>' + escapeHtml(c) + (c === 'Phone' ? ' * (E.164)' : '') + '</label><input data-ctf="' + escapeHtml(c) + '"></div>'; }).join('');
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw" style="height:auto;top:16%;bottom:auto;border-radius:8px 0 0 8px"><div class="dh"><h2>Add Contact</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div id="cterr" class="ob-banner" style="display:none"></div>' + flds + '</div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.ctSave(\\'' + lid + '\\')">Add</button></div></div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.ctSave = function(lid) {
    var data = {};
    document.querySelectorAll('#drw [data-ctf]').forEach(function(i) { data[i.dataset.ctf] = i.value.trim(); });
    ContactListsService.addContact(lid, data).then(function() {
      window.closeDrawer();
      if (window.toast) window.toast('Contact added');
      return refreshDetail(lid);
    }).catch(function(err) {
      showFormError('cterr', (err && err.message) || 'Add failed \\u2014 please try again.');
    });
  };

  window.ctDnc = function(lid, cid) {
    ContactListsService.markDnc(lid, cid).then(function() {
      if (window.toast) window.toast('Contact marked DNC');
      return refreshDetail(lid);
    }).catch(function(err) {
      if (window.toast) window.toast('✗ Could not mark DNC — ' + escapeHtml((err && err.message) || 'please try again'));
    });
  };

  window.ctDel = function(lid, cid) {
    ContactListsService.removeContact(lid, cid).then(function() {
      // Only refreshes (and so only removes the row) once the API confirmed.
      if (window.toast) window.toast('Contact removed');
      return refreshDetail(lid);
    }).catch(function(err) {
      if (window.toast) window.toast('✗ Could not remove the contact — ' + escapeHtml((err && err.message) || 'please try again'));
    });
  };

  window.clImport = function(lid) {
    var l = currentDetail && currentDetail.id === lid ? currentDetail : null;
    var cols = l ? l.cols : ['FirstName', 'LastName', 'Phone'];
    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw"><div class="dh"><h2>Import CSV \\u2014 ' + escapeHtml(l ? l.name : '') + '</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div style="font-size:12px;color:#5b6b82;margin-bottom:8px;line-height:1.6">Columns: <code>' + escapeHtml(cols.join(',')) + '</code> \\u2014 header row optional. Phone must be E.164; duplicates and invalid rows are rejected.</div>' +
      '<div class="fld"><textarea id="clcsv" style="height:160px;font-family:monospace;font-size:12px" placeholder="' + escapeHtml(cols.join(',')) + '\\n..."></textarea></div>' +
      '<div id="clres" style="font-size:12.5px;color:#33425c"></div></div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.clRunImport(\\'' + lid + '\\')">Import</button></div></div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.clRunImport = function(lid) {
    var l = currentDetail && currentDetail.id === lid ? currentDetail : null;
    var cols = l ? l.cols : ['FirstName', 'LastName', 'Phone'];
    var txt = (document.getElementById('clcsv').value || '').trim();
    if (!txt) { if (window.toast) window.toast('Paste CSV rows first'); return; }
    var lines = txt.split(/\\r?\\n/).filter(function(x) { return x.trim(); });
    if (lines.length && lines[0].toLowerCase().indexOf(cols[0].toLowerCase()) === 0) lines.shift();
    var rows = lines.map(function(ln) {
      var c = ln.split(',').map(function(x) { return x.trim(); });
      var data = {};
      cols.forEach(function(col, j) { data[col] = c[j] || ''; });
      return data;
    });
    ContactListsService.importContacts(lid, rows).then(function(res) {
      var ok = res.imported || 0, fail = res.failed || [];
      var resBox = document.getElementById('clres');
      if (resBox) resBox.innerHTML = '<b style="color:#1f9d63">' + ok + ' imported.</b> ' + (fail.length ? '<b style="color:#b3261e">' + fail.length + ' rejected:</b><br>' + fail.map(escapeHtml).join('<br>') : '');
      if (ok) {
        if (window.toast) window.toast(ok + ' contacts imported');
        if (!fail.length) setTimeout(function() { window.closeDrawer(); refreshDetail(lid); }, 800);
        else refreshDetail(lid);
      }
    }).catch(function(err) {
      var resBox = document.getElementById('clres');
      if (resBox) resBox.innerHTML = '<b style="color:#b3261e">✗ Import failed — ' +
        escapeHtml((err && err.message) || 'please try again') + '</b>';
    });
  };

  window.clExport = function(lid) {
    var l = currentDetail && currentDetail.id === lid ? currentDetail : null;
    if (!l) return;
    var hdr = l.cols.join(',') + ',Status,Attempts,LastResult';
    var lines = l.contacts.map(function(ct) {
      return l.cols.map(function(c) { return '"' + String(ct.data[c] || '').replace(/"/g, '""') + '"'; }).join(',') + ',"' + ct.status + '",' + ct.attempts + ',"' + (ct.lastResult || '') + '"';
    });
    var blob = new Blob([hdr + '\\n' + lines.join('\\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = l.name + '.csv';
    a.click();
    if (window.toast) window.toast('List exported with dialing results');
  };

  /* scripts.ts's own confirmBox()/openDrawerHTML() are local to its
     closure, not exposed on window \\u2014 self-contained equivalent using
     the same #drw/.dh/.db/.df drawer classes, same as certs-redesign.ts's
     certsConfirmBox(). */
  function clConfirmBox(msg, onYes) {
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
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" id="cl_cfyes">Confirm</button></div></div>';
    document.body.appendChild(wrap.firstChild);
    document.getElementById('cl_cfyes').onclick = function() { window.closeDrawer(); onYes(); };
  }

  window.clDelete = function(lid) {
    var l = currentDetail && currentDetail.id === lid ? currentDetail : null;
    var name = l ? l.name : 'this list';
    var count = l ? l.contacts.length : 0;
    clConfirmBox('Delete contact list <b>' + escapeHtml(name) + '</b> and its ' + count + ' contacts?', function() {
      // Navigates away only after the API confirms the delete. This used to
      // fall back to a local removal, so a rejected DELETE still looked like
      // it had worked until the next page load brought the list back.
      ContactListsService.remove(lid).then(function() {
        if (window.toast) window.toast('List deleted');
        goListsIndex();
      }).catch(function(err) {
        if (window.toast) window.toast('✗ Delete failed — ' + escapeHtml((err && err.message) || 'please try again'));
      });
    });
  };

  /* ─── Wire into the router ───
     scripts.ts's own DYN4 router hook (later in that same file) does:
       var DYN4 = { campaigns: ..., contactlists: window.renderContactLists, dnclists: ... };
       window.openPage = function(id) { if (DYN4[id]) { ...; DYN4[id](); return; } return prevOpen(id); };
     DYN4.contactlists captures whatever window.renderContactLists *was* at
     that point in time \\u2014 a plain reassignment here does NOT change what
     DYN4.contactlists calls, since DYN4 already holds the old function
     value, not a live reference. Same issue canned-redesign.ts hit with
     DYN9; the fix is the same \\u2014 wrap window.openPage itself so this
     module's wrapper runs first and only falls through to the existing
     chain for every id other than 'contactlists'. campaigns/dnclists (the
     other two DYN4 entries) are untouched \\u2014 they still fall through to
     prevOpen -> DYN4[id](), so they keep working exactly as before. */
  window.renderContactLists = function() { goListsIndex(); };

  var prevOpenPageForCl = window.openPage;
  window.openPage = function(id) {
    if (id === 'contactlists') {
      window.closeDrawer();
      window.restoreAdmin();
      window.navMark('admin');
      window.APP.page = 'contactlists';
      goListsIndex();
      var links = document.querySelectorAll('#anav .lk');
      links.forEach(function(el) { el.classList.remove('on'); });
      for (var i = 0; i < links.length; i++) {
        var onclick = links[i].getAttribute('onclick') || '';
        if (onclick.indexOf("'contactlists'") > -1) { links[i].classList.add('on'); break; }
      }
      window.scrollTo(0, 0);
      return;
    }
    return prevOpenPageForCl(id);
  };

  function applyContactListsRedesign() {
    var paint = function() {
      if (window.APP && window.APP.page === 'contactlists' && !currentDetail) mount(renderContactListsPage());
    };
    ContactListsService.refresh().then(paint, paint);
  }

  applyContactListsRedesign();
  setTimeout(applyContactListsRedesign, 100);
  setTimeout(applyContactListsRedesign, 400);

})();
`;
