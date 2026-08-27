/* ============================================================
   MCM Cloud CX — Canned Responses Redesign Module
   Backend-ready data layer + fully interactive, filterable library
   ============================================================ */

export const CANNED_SCRIPT: string = `
(function() {
  'use strict';

  /* ─── Backend-ready canned-response data structure (fallback/seed data) ───
     Shape: { id, name, category, categoryLabel, body, substitutionFields[],
              createdAt, updatedAt }
     This is the shape a future /api/canned endpoint should return.
     substitutionFields is always derived from body (the {{Token}} markers
     inside it), never hand-maintained separately from the text that uses
     them — see extractSubstitutionFields(). */
  var CANNED_CATEGORIES = [
    { code: 'greetings', label: 'Greetings' },
    { code: 'billing', label: 'Billing' },
    { code: 'technical', label: 'Technical Support' },
    { code: 'escalation', label: 'Escalation' },
    { code: 'closing', label: 'Closing' },
    { code: 'general', label: 'General' }
  ];

  function categoryLabel(code) {
    var m = CANNED_CATEGORIES.filter(function(c) { return c.code === code; })[0];
    return m ? m.label : 'General';
  }

  var CANNED_FALLBACK = [
    { id: 'cr-greeting-email', name: 'Greeting — email', category: 'greetings', body: 'Dear {{Contact.FirstName}}, thank you for contacting MCM Support.', createdAt: '2026-01-04T09:00:00Z', updatedAt: '2026-01-04T09:00:00Z' },
    { id: 'cr-greeting-call', name: 'Greeting — call opener', category: 'greetings', body: 'Hi {{Contact.FirstName}}, thanks for calling MCM, this is {{Agent.FirstName}} — how can I help today?', createdAt: '2026-01-05T09:00:00Z', updatedAt: '2026-01-05T09:00:00Z' },
    { id: 'cr-payment-received', name: 'Payment received', category: 'billing', body: 'We confirm receipt of your payment. Your balance is now {{Contact.Balance}}.', createdAt: '2026-01-06T10:00:00Z', updatedAt: '2026-02-11T14:20:00Z' },
    { id: 'cr-billing-dispute', name: 'Billing dispute acknowledged', category: 'billing', body: 'We have logged your dispute for invoice {{Invoice.Number}} and will respond within 3 business days.', createdAt: '2026-01-08T11:00:00Z', updatedAt: '2026-01-08T11:00:00Z' },
    { id: 'cr-password-reset', name: 'Password reset instructions', category: 'technical', body: 'Hi {{Contact.FirstName}}, please reset your password at the link we just emailed to {{Contact.Email}}.', createdAt: '2026-01-10T09:30:00Z', updatedAt: '2026-01-10T09:30:00Z' },
    { id: 'cr-outage-notice', name: 'Technical outage notice', category: 'technical', body: 'We are aware of an issue affecting {{Service.Name}} and are working on a fix. Updates at status.mcmgroup.com.', createdAt: '2026-01-12T08:00:00Z', updatedAt: '2026-03-02T16:45:00Z' },
    { id: 'cr-escalate-supervisor', name: 'Escalated to supervisor', category: 'escalation', body: 'Your case has been escalated to {{Supervisor.Name}} and will be reviewed within 24 hours.', createdAt: '2026-01-14T13:00:00Z', updatedAt: '2026-01-14T13:00:00Z' },
    { id: 'cr-call-closing', name: 'Thank you — call closing', category: 'closing', body: 'Thank you for calling MCM, {{Contact.FirstName}}. Is there anything else I can help you with today?', createdAt: '2026-01-16T15:00:00Z', updatedAt: '2026-01-16T15:00:00Z' },
    { id: 'cr-general-followup', name: 'General follow-up', category: 'general', body: 'Just checking in on your recent request — let us know if you need anything further, {{Contact.FirstName}}.', createdAt: '2026-01-18T12:00:00Z', updatedAt: '2026-01-18T12:00:00Z' }
  ];

  function extractSubstitutionFields(body) {
    var re = /\\{\\{\\s*([^}]+?)\\s*\\}\\}/g;
    var out = [];
    var m;
    while ((m = re.exec(body || '')) !== null) {
      var token = m[1].trim();
      if (token && out.indexOf(token) === -1) out.push(token);
    }
    return out;
  }

  function withDerivedFields(entry) {
    return Object.assign({}, entry, {
      categoryLabel: categoryLabel(entry.category),
      substitutionFields: extractSubstitutionFields(entry.body)
    });
  }

  /* ─── Backend row → frontend shape ───
     backend/canned.py (RealDictCursor) returns raw canned_responses columns
     — snake_case created_at/updated_at, same as apps.py's rows. This maps
     those onto the camelCase createdAt/updatedAt formatUpdated() and the
     rest of this module expect, same job mapBackendInstalledApp() does in
     apps-redesign.ts. category/categoryLabel/substitutionFields pass through
     as-is (or are absent) — withDerivedFields() always recomputes those two
     from category/body regardless, so this only needs to fix the date
     fields. Safe to call on already-camelCase local objects too: the ||
     fallback is a no-op when createdAt/updatedAt are already set. */
  function normalizeCannedRow(row) {
    return Object.assign({}, row, {
      createdAt: row.createdAt || row.created_at,
      updatedAt: row.updatedAt || row.updated_at
    });
  }

  /* ─── REST helper compatible with the shared window.apiFetch contract ───
     Same base URL / Authorization: Bearer <window.__authToken> contract as
     frontend/src/features/shared/backend.ts and apps-redesign.ts's own
     appsApiFetch — kept as a local copy here since every one of these
     legacy-engine redesign modules (authorg/apps/directory) is already
     self-contained rather than sharing helpers with one another. */
  function cannedApiFetch(path, init) {
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

  /* ─── Local-first mutable store (used only while no real backend is
     reachable) ───
     A plain CANNED_FALLBACK.slice() returned fresh on every refresh() would
     silently discard any create/update/delete that only succeeded locally
     (no /api/canned endpoint exists yet) — refresh() would just overwrite
     cannedCache with the pristine seed again right after a save. This
     mutable array is what create/update/remove actually write to when the
     REST call fails, and what fetchCannedResponses()'s fallback returns
     instead of a fresh copy — so local-only changes survive subsequent
     refresh() calls for the rest of the session, and get superseded by
     real server data automatically once /api/canned exists and starts
     responding. */
  var localCannedStore = CANNED_FALLBACK.slice();

  /* ─── Modular data-fetching helper ───
     Swap in a real backend call by defining window.CannedAPI.list()
     (sync array or Promise<array>) — this helper falls back to the local
     GET /api/canned REST call, then to the local store above, so the UI
     works end-to-end whether or not that endpoint exists yet server-side. */
  function fetchCannedResponses() {
    if (window.CannedAPI && typeof window.CannedAPI.list === 'function') {
      try {
        var res = window.CannedAPI.list();
        if (res && typeof res.then === 'function') {
          return res.then(function(list) {
            return (Array.isArray(list) && list.length) ? list.map(normalizeCannedRow) : localCannedStore;
          }).catch(function() { return localCannedStore; });
        }
        if (Array.isArray(res) && res.length) return Promise.resolve(res.map(normalizeCannedRow));
      } catch (e) { /* fall through to REST */ }
    }
    return cannedApiFetch('/api/canned').then(function(rows) {
      return (Array.isArray(rows) && rows.length) ? rows.map(normalizeCannedRow) : localCannedStore;
    }).catch(function() { return localCannedStore; });
  }

  var cannedCache = CANNED_FALLBACK.slice().map(withDerivedFields);

  var CannedService = {
    getAll: function() { return cannedCache; },
    getById: function(id) { return cannedCache.filter(function(c) { return c.id === id; })[0] || null; },
    refresh: function() {
      return fetchCannedResponses().then(function(list) {
        if (Array.isArray(list) && list.length) cannedCache = list.map(withDerivedFields);
        return cannedCache;
      });
    },
    /* POST /api/canned — create. Falls back to a local-only insert (with a
       generated id) if the endpoint isn't reachable, so Save always works. */
    create: function(entry) {
      var payload = { name: entry.name, category: entry.category, body: entry.body };
      var hook = window.CannedAPI && window.CannedAPI.create;
      if (typeof hook === 'function') {
        try {
          var hookRes = hook(payload);
          return (hookRes && typeof hookRes.then === 'function') ? hookRes : Promise.resolve(hookRes);
        } catch (e) { /* fall through */ }
      }
      return cannedApiFetch('/api/canned', { method: 'POST', body: JSON.stringify(payload) }).then(normalizeCannedRow).catch(function() {
        var now = new Date().toISOString();
        var created = Object.assign({ id: 'cr-' + Math.random().toString(36).slice(2, 10), createdAt: now, updatedAt: now }, payload);
        localCannedStore.push(created);
        return created;
      });
    },
    /* PUT /api/canned/{id} — update. Same fallback shape as create(). */
    update: function(id, entry) {
      var payload = { name: entry.name, category: entry.category, body: entry.body };
      var hook = window.CannedAPI && window.CannedAPI.update;
      if (typeof hook === 'function') {
        try {
          var hookRes = hook(id, payload);
          return (hookRes && typeof hookRes.then === 'function') ? hookRes : Promise.resolve(hookRes);
        } catch (e) { /* fall through */ }
      }
      return cannedApiFetch('/api/canned/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(payload) }).then(normalizeCannedRow).catch(function() {
        var idx = -1;
        for (var i = 0; i < localCannedStore.length; i++) { if (localCannedStore[i].id === id) { idx = i; break; } }
        var existing = idx > -1 ? localCannedStore[idx] : (CannedService.getById(id) || {});
        var updated = Object.assign({}, existing, payload, { id: id, updatedAt: new Date().toISOString() });
        if (idx > -1) { localCannedStore[idx] = updated; } else { localCannedStore.push(updated); }
        return updated;
      });
    },
    /* DELETE /api/canned/{id}. */
    remove: function(id) {
      var hook = window.CannedAPI && window.CannedAPI.remove;
      if (typeof hook === 'function') {
        try {
          var hookRes = hook(id);
          return (hookRes && typeof hookRes.then === 'function') ? hookRes : Promise.resolve(hookRes);
        } catch (e) { /* fall through */ }
      }
      return cannedApiFetch('/api/canned/' + encodeURIComponent(id), { method: 'DELETE' }).catch(function() {
        localCannedStore = localCannedStore.filter(function(c) { return c.id !== id; });
        return { ok: true };
      });
    }
  };
  window.CannedService = CannedService;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatUpdated(iso) {
    if (!iso) return '\\u2014';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '\\u2014';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /* ─── Filter state (search text + category) ─── */
  var cannedFilters = { q: '', category: '' };

  function filteredCanned() {
    var q = cannedFilters.q.trim().toLowerCase();
    return CannedService.getAll().filter(function(c) {
      if (cannedFilters.category && c.category !== cannedFilters.category) return false;
      if (!q) return true;
      return c.name.toLowerCase().indexOf(q) > -1 || c.body.toLowerCase().indexOf(q) > -1;
    });
  }

  function renderCategoryOptions(selected) {
    return '<option value="">All categories</option>' + CANNED_CATEGORIES.map(function(c) {
      return '<option value="' + c.code + '"' + (selected === c.code ? ' selected' : '') + '>' + escapeHtml(c.label) + '</option>';
    }).join('');
  }

  function renderCannedRow(c) {
    var preview = c.body.length > 90 ? c.body.slice(0, 90) + '\\u2026' : c.body;
    return '<tr data-canned-id="' + c.id + '" tabindex="0" onclick="window.cannedOpenEditor(\\'' + c.id + '\\')"' +
      ' onkeydown="if(event.key===\\'Enter\\'){window.cannedOpenEditor(\\'' + c.id + '\\')}">' +
      '<td><b class="lnk">' + escapeHtml(c.name) + '</b></td>' +
      '<td><span class="canned-cat-badge canned-cat-' + c.category + '">' + escapeHtml(c.categoryLabel) + '</span></td>' +
      '<td style="max-width:380px;font-size:12px;color:#5b6b82">' + escapeHtml(preview) + '</td>' +
      '<td>' + (c.substitutionFields.length ? '<span class="canned-sub-count">' + c.substitutionFields.length + '</span>' : '\\u2014') + '</td>' +
      '<td style="font-size:12px;color:#8794a8">' + formatUpdated(c.updatedAt) + '</td>' +
      '<td style="text-align:right;white-space:nowrap" onclick="event.stopPropagation()">' +
        '<button class="canned-row-btn" title="Copy text to clipboard" onclick="window.cannedCopy(\\'' + c.id + '\\')">\\uD83D\\uDCCB</button>' +
        '<button class="canned-row-btn" title="Duplicate" onclick="window.cannedDuplicate(\\'' + c.id + '\\')">\\uD83D\\uDDD0</button>' +
        '<button class="canned-row-btn" title="Edit" onclick="window.cannedOpenEditor(\\'' + c.id + '\\')">' + '\\u270E' + '</button>' +
        '<button class="canned-row-btn canned-row-btn-danger" title="Delete" onclick="window.cannedDelete(\\'' + c.id + '\\')">' + '\\u2715' + '</button>' +
      '</td>' +
      '</tr>';
  }

  function renderCannedTable() {
    var list = filteredCanned();
    var rows = list.length
      ? list.map(renderCannedRow).join('')
      : '<tr><td colspan="6" style="text-align:center;color:#8794a8;padding:28px 0">No canned responses match your search.</td></tr>';
    return '<div class="tblw"><table class="dt"><thead><tr><th>Response</th><th>Category</th><th>Preview</th><th>Fields</th><th>Updated</th><th style="width:150px;text-align:right">Actions</th></tr></thead><tbody id="canned_tbody">' + rows + '</tbody></table></div>';
  }

  function refreshCannedTable() {
    var body = document.getElementById('canned_tbody');
    if (!body) return;
    var list = filteredCanned();
    body.innerHTML = list.length
      ? list.map(renderCannedRow).join('')
      : '<tr><td colspan="6" style="text-align:center;color:#8794a8;padding:28px 0">No canned responses match your search.</td></tr>';
    var countEl = document.getElementById('canned_count');
    if (countEl) countEl.textContent = 'Library (' + list.length + ')';
  }

  window.cannedSearch = function(value) {
    cannedFilters.q = value || '';
    refreshCannedTable();
  };

  window.cannedFilterCategory = function(value) {
    cannedFilters.category = value || '';
    refreshCannedTable();
  };

  function renderCannedPage() {
    var total = CannedService.getAll().length;
    document.getElementById('cnt').innerHTML =
      '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A Contact Center</div>' +
      '<div class="tt"><h1>Canned Responses</h1><div class="rt"><button class="btn" onclick="window.cannedOpenEditor()">+ Add Canned Response</button></div></div>' +
      '<div class="tabs"><div class="tb on" id="canned_count">Library (' + total + ')</div></div></div>' +
      '<div class="pbody">' +
      '<div class="tbar">' +
        '<input class="s" id="canned_search" placeholder="Search name or text\\u2026" oninput="window.cannedSearch(this.value)">' +
        '<select class="chip" id="canned_cat_filter" style="cursor:pointer" onchange="window.cannedFilterCategory(this.value)">' + renderCategoryOptions('') + '</select>' +
        '<div class="sp"></div>' +
        '<div class="chip" onclick="window.cannedReload()">\\u21BB Refresh</div>' +
      '</div>' +
      renderCannedTable() +
      '</div>';
  }

  window.cannedReload = function() {
    CannedService.refresh().then(function() {
      renderCannedPage();
      if (window.toast) window.toast('Canned responses refreshed');
    });
  };

  window.cannedCopy = function(id) {
    var c = CannedService.getById(id);
    if (!c) return;
    var done = function() { if (window.toast) window.toast('Copied <b>' + escapeHtml(c.name) + '</b> to clipboard'); };
    var fail = function() { if (window.toast) window.toast('Could not copy \\u2014 clipboard access blocked'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(c.body).then(done).catch(fail);
    } else {
      fail();
    }
  };

  window.cannedDuplicate = function(id) {
    var c = CannedService.getById(id);
    if (!c) return;
    var all = CannedService.getAll();
    var base = c.name + ' copy', name = base, n = 1;
    while (all.some(function(x) { return x.name.toLowerCase() === name.toLowerCase(); })) { n++; name = base + ' ' + n; }
    CannedService.create({ name: name, category: c.category, body: c.body }).then(function() {
      return CannedService.refresh();
    }).then(function() {
      renderCannedPage();
      if (window.toast) window.toast('Duplicated as <b>' + escapeHtml(name) + '</b>');
    }).catch(function(err) {
      if (window.toast) window.toast('\\u2717 Duplicate failed \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
    });
  };

  /* ─── Add / Edit drawer ─── */
  window.cannedOpenEditor = function(id) {
    var existing = id ? CannedService.getById(id) : null;
    var isNew = !existing;
    var c = existing || { id: '', name: '', category: 'general', body: '' };

    var fields = extractSubstitutionFields(c.body);
    var fieldsHtml = fields.length
      ? fields.map(function(f) { return '<span class="canned-field-chip">{{' + escapeHtml(f) + '}}</span>'; }).join('')
      : '<span style="font-size:11.5px;color:#8794a8">No {{Substitution}} fields detected yet \\u2014 type {{Contact.FirstName}} style tokens in the text.</span>';

    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw" style="height:auto;max-height:88vh;top:6%;bottom:auto;border-radius:8px 0 0 8px;display:flex;flex-direction:column">' +
        '<div class="dh" style="flex:0 0 auto"><h2>' + (isNew ? 'Add' : 'Edit') + ' Canned Response</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
        '<div class="db" style="flex:1 1 auto;overflow-y:auto">' +
          '<div id="cnerr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
          '<div class="fld"><label>Name *</label><input id="cn_name" value="' + escapeHtml(c.name) + '"></div>' +
          '<div class="fld"><label>Category</label><select id="cn_category">' + renderCategoryOptions(c.category) + '</select></div>' +
          '<div class="fld"><label>Text (supports {{Contact.FirstName}} style substitutions)</label><textarea id="cn_body" style="height:110px" oninput="window.cannedPreviewFields()">' + escapeHtml(c.body) + '</textarea>' +
          '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">' +
            ['Contact.FirstName', 'Contact.LastName', 'Contact.Email', 'Agent.FirstName', 'Invoice.Number'].map(function(t) {
              return '<span class="canned-field-chip" style="cursor:pointer" onclick="window.cannedInsertToken(\\'' + t + '\\')" title="Insert into text">+ {{' + t + '}}</span>';
            }).join('') +
          '</div></div>' +
          '<div class="fld"><label>Substitution fields</label><div id="cn_fields" class="canned-field-list">' + fieldsHtml + '</div></div>' +
          (isNew ? '' : '<button class="btn gh" onclick="window.cannedDelete(\\'' + c.id + '\\')">Delete</button>') +
        '</div>' +
        '<div class="df" style="flex:0 0 auto"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.cannedSave(\\'' + (c.id || '') + '\\')">Save</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.cannedInsertToken = function(token) {
    var textarea = document.getElementById('cn_body');
    if (!textarea) return;
    var start = textarea.selectionStart == null ? textarea.value.length : textarea.selectionStart;
    var end = textarea.selectionEnd == null ? textarea.value.length : textarea.selectionEnd;
    var snippet = '{{' + token + '}}';
    textarea.value = textarea.value.slice(0, start) + snippet + textarea.value.slice(end);
    textarea.focus();
    var pos = start + snippet.length;
    textarea.setSelectionRange(pos, pos);
    window.cannedPreviewFields();
  };

  window.cannedPreviewFields = function() {
    var textarea = document.getElementById('cn_body');
    var box = document.getElementById('cn_fields');
    if (!textarea || !box) return;
    var fields = extractSubstitutionFields(textarea.value);
    box.innerHTML = fields.length
      ? fields.map(function(f) { return '<span class="canned-field-chip">{{' + escapeHtml(f) + '}}</span>'; }).join('')
      : '<span style="font-size:11.5px;color:#8794a8">No {{Substitution}} fields detected yet \\u2014 type {{Contact.FirstName}} style tokens in the text.</span>';
  };

  window.cannedSave = function(id) {
    var nameEl = document.getElementById('cn_name');
    var catEl = document.getElementById('cn_category');
    var bodyEl = document.getElementById('cn_body');
    var name = nameEl.value.trim();
    var category = catEl.value;
    var body = bodyEl.value.trim();
    var errs = [];
    if (name.length < 2) errs.push('Name is required.');
    if (body.length < 3) errs.push('Response text is required.');
    if (errs.length) {
      var box = document.getElementById('cnerr');
      box.style.display = '';
      box.innerHTML = errs.join('<br>');
      return;
    }

    var isNew = !id;
    var op = isNew ? CannedService.create({ name: name, category: category, body: body }) : CannedService.update(id, { name: name, category: category, body: body });
    op.then(function() {
      return CannedService.refresh();
    }).then(function() {
      window.closeDrawer();
      renderCannedPage();
      if (window.toast) window.toast((isNew ? '\\u2713 Created ' : '\\u2713 Saved ') + '<b>' + escapeHtml(name) + '</b>');
    }).catch(function(err) {
      var box = document.getElementById('cnerr');
      if (box) {
        box.style.display = '';
        box.innerHTML = escapeHtml((err && err.message) || 'Save failed \\u2014 please try again.');
      }
    });
  };

  /* scripts.ts's own confirmBox()/openDrawerHTML() are local to its closure,
     not exposed on window, so this module can't call them — this is a
     self-contained equivalent using the same #drw/.dh/.db/.df drawer
     classes for a visually identical confirm dialog. */
  function cannedConfirmBox(msg, onYes) {
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
        '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" id="cn_cfyes">Confirm</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    document.getElementById('cn_cfyes').onclick = function() { window.closeDrawer(); onYes(); };
  }

  window.cannedDelete = function(id) {
    var c = CannedService.getById(id);
    if (!c) return;
    var safeName = escapeHtml(c.name);
    cannedConfirmBox('Delete response <b>' + safeName + '</b>?', function() {
      CannedService.remove(id).then(function() {
        return CannedService.refresh();
      }).then(function() {
        window.closeDrawer();
        renderCannedPage();
        if (window.toast) window.toast('\\u2713 Deleted <b>' + safeName + '</b>');
      }).catch(function(err) {
        if (window.toast) window.toast('\\u2717 Delete failed \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
      });
    });
  };

  /* ─── Wire into the router ───
     scripts.ts's own router hook (later in that same file) does:
       var DYN9 = {..., canned: window.renderCannedFx};
       window.openPage = function(id) { if (DYN9[id]) { ...; DYN9[id](); return; } return prevOpen(id); };
     DYN9.canned captures whatever window.renderCannedFx *was* at that
     point in time — a plain reassignment here (window.renderCannedFx =
     renderCannedPage) does NOT change what DYN9.canned calls, since DYN9
     already holds the old function value, not a live reference. The only
     way to actually intercept navigation to 'canned' is to wrap
     window.openPage itself, the same way scripts.ts wraps its own
     prevOpen — this module's wrapper runs first and only falls through
     to the existing chain for every id other than 'canned'. */
  window.renderCannedFx = renderCannedPage;
  window.editCannedFx = window.cannedOpenEditor;
  window.saveCannedFx = window.cannedSave;
  window.delCannedFx = window.cannedDelete;

  var prevOpenPageForCanned = window.openPage;
  window.openPage = function(id) {
    if (id === 'canned') {
      window.closeDrawer();
      window.restoreAdmin();
      window.navMark('admin');
      window.APP.page = 'canned';
      renderCannedPage();
      var links = document.querySelectorAll('#anav .lk');
      links.forEach(function(el) { el.classList.remove('on'); });
      for (var i = 0; i < links.length; i++) {
        var onclick = links[i].getAttribute('onclick') || '';
        if (onclick.indexOf("'canned'") > -1) { links[i].classList.add('on'); break; }
      }
      window.scrollTo(0, 0);
      return;
    }
    return prevOpenPageForCanned(id);
  };

  function applyCannedRedesign() {
    CannedService.refresh().then(function() {
      if (window.APP && window.APP.page === 'canned') renderCannedPage();
    });
  }

  applyCannedRedesign();
  setTimeout(applyCannedRedesign, 100);
  setTimeout(applyCannedRedesign, 400);

})();
`;
