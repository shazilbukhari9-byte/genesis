/* ============================================================
   MCM Cloud CX — Emergency Groups: Real Controls & Backend Wiring
   NOT a redesign — reproduces the existing page markup (same
   classes, same table/help layout). This replaces an earlier,
   narrower pass over this same file (see its prior version in git
   history) that made "+ Add Group" real and fixed a stale-reference
   routing bug, but left almost everything else either missing or
   quietly unsafe:

   1. WHAT WAS ALREADY REAL. Add Group (name + flow overrides only)
      and Activate/Deactivate (window.togEmer, wrapped inside
      scripts.ts itself to PUT/POST /api/emergency-groups) both
      already talked to the real backend.

   2. THE SILENT-FAILURE BUG IN THE EXISTING ACTIVATE/DEACTIVATE PATH.
      scripts.ts's own togEmer wrap calls the ORIGINAL togEmer (which
      flips g.active, re-renders, and toasts success) FIRST, and only
      *afterwards* fires the PUT/POST — fire-and-forget, with a bare
      .catch(function(){}) that swallows any failure. If that request
      fails, the UI has already told the user it worked. This file
      no longer routes through togEmer at all: window.
      emergencyToggleActive() below awaits the real request and only
      updates the table / shows success once the backend confirms it
      — a failure shows a real error and the row's state doesn't
      change. (window.togEmer itself is left completely alone, same
      as scripts.ts is never hand-edited elsewhere in this app — it's
      just no longer what this page's rows call.)

   3. EVERYTHING ELSE ON THIS TASK'S CHECKLIST WAS MISSING: Edit,
      Delete, Search, Filters, Refresh, pagination, division, members,
      emergency contacts, notification rules, escalation settings,
      duplicate-name prevention, and confirmation dialogs for
      activate/deactivate/delete. None of these had any UI, and half
      of them (division, members, emergency contacts, notification
      rules, escalation tiers) had no column in the database at all
      — added for real, not faked. See database/schema.sql and
      backend/resources.py's "emergency-groups" REGISTRY entry.
   ============================================================ */

export const EMERGENCY_SCRIPT: string = `
(function() {
  'use strict';

  var CHANNELS = [
    { v: 'sms', label: 'SMS' },
    { v: 'email', label: 'Email' },
    { v: 'call', label: 'Voice call' }
  ];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function emergencyApiFetch(path, init) {
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

  /* ═══════════ Lookup data (flows / members / divisions) ═══════════ */
  function ensureFlows() {
    if ((window.DB.flows || []).some(function(f) { return f.dbId; })) return Promise.resolve();
    return emergencyApiFetch('/api/flows?limit=500').then(function(rows) {
      if (!Array.isArray(rows)) return;
      if ((window.DB.flows || []).some(function(f) { return f.dbId; })) return;
      window.DB.flows = rows.map(function(r) {
        return { id: 'id' + Math.random().toString(36).slice(2, 10), dbId: r.id, name: r.name };
      });
    }).catch(function() {});
  }

  var membersCache = [];
  var membersLoaded = false;
  function ensureMembers(force) {
    if (membersLoaded && !force) return Promise.resolve();
    return emergencyApiFetch('/api/people?limit=500').then(function(rows) {
      membersLoaded = true;
      membersCache = Array.isArray(rows) ? rows.map(function(r) { return { id: r.id, name: r.name || r.email || ('User #' + r.id) }; }) : [];
    }).catch(function() { membersLoaded = true; });
  }

  var divisionsCache = [];
  var divisionsLoaded = false;
  // ensureMembers/ensureDivisions take a force flag (used by the
  // Refresh action below) since People and Divisions are each edited on
  // their own separate admin page — a division or person added there
  // while this page stayed open would otherwise never appear, even
  // though the whole point of a Refresh control is to pick that up.
  function ensureDivisions(force) {
    if (divisionsLoaded && !force) return Promise.resolve();
    return emergencyApiFetch('/api/divisions').then(function(rows) {
      divisionsLoaded = true;
      divisionsCache = Array.isArray(rows) ? rows : [];
    }).catch(function() { divisionsLoaded = true; });
  }
  function ensureLookups(force) { return Promise.all([ensureFlows(), ensureMembers(force), ensureDivisions(force)]); }

  function divisionLabel(code) {
    var d = divisionsCache.filter(function(x) { return x.code === code; })[0];
    return d ? d.name : code;
  }
  function memberName(id) {
    var m = membersCache.filter(function(x) { return String(x.id) === String(id); })[0];
    return m ? m.name : ('User #' + id);
  }

  /* Only flows that actually exist in the backend (have a dbId) are
     offered — DB.flows also holds a client-only mock fallback (never
     synced) when the real list hasn't loaded yet. */
  function flowOptionsHtml(selectedIds) {
    var flows = ((window.DB && window.DB.flows) || []).filter(function(f) { return f.dbId; });
    if (!flows.length) return '<div style="font-size:12px;color:#8794a8">No flows to override yet \\u2014 create one in Architect Flows first.</div>';
    return flows.map(function(f) {
      var checked = (selectedIds || []).indexOf(String(f.dbId)) > -1;
      return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0">' +
        '<input type="checkbox" class="em_flow_cb" value="' + escapeHtml(f.dbId) + '"' + (checked ? ' checked' : '') + '> ' + escapeHtml(f.name) +
        '</label>';
    }).join('');
  }

  function memberOptionsHtml(selectedIds) {
    if (!membersCache.length) return '<div style="font-size:12px;color:#8794a8">No people found.</div>';
    return membersCache.map(function(m) {
      var checked = (selectedIds || []).map(String).indexOf(String(m.id)) > -1;
      return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0">' +
        '<input type="checkbox" class="em_member_cb" value="' + m.id + '"' + (checked ? ' checked' : '') + '> ' + escapeHtml(m.name) +
        '</label>';
    }).join('');
  }

  function divisionOptionsHtml(selected) {
    return '<option value="">No division</option>' + divisionsCache.map(function(d) {
      return '<option value="' + escapeHtml(d.code) + '"' + (selected === d.code ? ' selected' : '') + '>' + escapeHtml(d.name) + '</option>';
    }).join('');
  }

  /* ═══════════ Emergency contacts / escalation tiers — dynamic rows ═══════════
     Read straight from the DOM at save time (same convention as the
     .em_flow_cb checklist above) rather than mirrored in a parallel JS
     array — Add/Remove just append/remove a row element. */
  function contactRowHtml(c) {
    c = c || { name: '', phone: '', email: '' };
    return '<div class="em_contact_row" style="display:flex;gap:6px;margin-bottom:6px;align-items:center">' +
      '<input class="em_contact_name" placeholder="Name" value="' + escapeHtml(c.name) + '" style="flex:1;min-width:0">' +
      '<input class="em_contact_phone" placeholder="Phone" value="' + escapeHtml(c.phone) + '" style="flex:1;min-width:0">' +
      '<input class="em_contact_email" placeholder="Email" value="' + escapeHtml(c.email) + '" style="flex:1;min-width:0">' +
      '<button type="button" class="btn gh" style="height:28px;padding:0 9px;flex:none" onclick="this.parentElement.remove()" title="Remove">\\u2715</button>' +
      '</div>';
  }
  window.__emAddContactRow = function() {
    var list = document.getElementById('em_contacts_list');
    if (list) list.insertAdjacentHTML('beforeend', contactRowHtml());
  };
  function collectContacts() {
    return Array.prototype.slice.call(document.querySelectorAll('.em_contact_row')).map(function(row) {
      return {
        name: row.querySelector('.em_contact_name').value.trim(),
        phone: row.querySelector('.em_contact_phone').value.trim(),
        email: row.querySelector('.em_contact_email').value.trim()
      };
    }).filter(function(c) { return c.name || c.phone || c.email; });
  }

  function tierRowHtml(t) {
    t = t || { after_minutes: 15, channels: [] };
    var ch = t.channels || [];
    return '<div class="em_tier_row" style="display:flex;gap:8px;margin-bottom:6px;align-items:center;flex-wrap:wrap">' +
      '<span style="font-size:12.5px;color:#5b6b82">After</span>' +
      '<input type="number" min="1" class="em_tier_minutes" value="' + (t.after_minutes || 15) + '" style="width:64px">' +
      '<span style="font-size:12.5px;color:#5b6b82">min, notify via</span>' +
      CHANNELS.map(function(c) {
        return '<label style="font-size:12.5px;display:flex;align-items:center;gap:4px"><input type="checkbox" class="em_tier_ch" value="' + c.v + '"' + (ch.indexOf(c.v) > -1 ? ' checked' : '') + '> ' + c.label + '</label>';
      }).join('') +
      '<button type="button" class="btn gh" style="height:28px;padding:0 9px;flex:none" onclick="this.parentElement.remove()" title="Remove">\\u2715</button>' +
      '</div>';
  }
  window.__emAddTierRow = function() {
    var list = document.getElementById('em_tiers_list');
    if (list) list.insertAdjacentHTML('beforeend', tierRowHtml());
  };
  function collectTiers() {
    return Array.prototype.slice.call(document.querySelectorAll('.em_tier_row')).map(function(row) {
      var channels = Array.prototype.slice.call(row.querySelectorAll('.em_tier_ch:checked')).map(function(cb) { return cb.value; });
      var mins = parseInt(row.querySelector('.em_tier_minutes').value, 10);
      return { after_minutes: (mins > 0 ? mins : 1), channels: channels };
    });
  }

  function notifChecked(rules, channel) {
    var r = (rules || []).filter(function(x) { return x.channel === channel; })[0];
    return r ? !!r.enabled : false;
  }
  function collectNotificationRules() {
    return CHANNELS.map(function(c) {
      var el = document.getElementById('em_notify_' + c.v);
      return { channel: c.v, enabled: !!(el && el.checked) };
    });
  }

  /* ═══════════ Data layer ═══════════ */
  function normalizeGroup(r) {
    return {
      id: 'id' + Math.random().toString(36).slice(2, 10),
      dbId: r.id,
      name: r.name || '',
      flows: r.flows || [],
      active: !!r.active,
      division: r.division || '',
      members: r.members || [],
      emergencyContacts: r.emergency_contacts || [],
      notificationRules: r.notification_rules || [],
      escalationTiers: r.escalation_tiers || []
    };
  }

  var groupsCache = [];
  var groupsLoadState = 'loading'; // 'loading' | 'ready' | 'error'

  var EmergencyGroupsService = {
    getAll: function() { return groupsCache; },
    getById: function(id) { return groupsCache.filter(function(g) { return g.id === id; })[0] || null; },
    refresh: function(force) {
      return ensureLookups(force).then(function() {
        return emergencyApiFetch('/api/emergency-groups?limit=500');
      }).then(function(rows) {
        groupsCache = Array.isArray(rows) ? rows.map(normalizeGroup) : [];
        window.DB.emerGroups = groupsCache; // window.togEmer (unused by this page's own UI, but still a live global) reads this
        return groupsCache;
      });
    },
    create: function(payload) { return emergencyApiFetch('/api/emergency-groups', { method: 'POST', body: JSON.stringify(payload) }).then(normalizeGroup); },
    update: function(dbId, payload) { return emergencyApiFetch('/api/emergency-groups/' + dbId, { method: 'PUT', body: JSON.stringify(payload) }).then(normalizeGroup); },
    patch: function(dbId, partial) { return emergencyApiFetch('/api/emergency-groups/' + dbId, { method: 'PUT', body: JSON.stringify(partial) }).then(normalizeGroup); },
    remove: function(dbId) { return emergencyApiFetch('/api/emergency-groups/' + dbId, { method: 'DELETE' }); }
  };
  window.EmergencyGroupsService = EmergencyGroupsService;

  /* ═══════════ Filters, search, pagination ═══════════ */
  var eFilters = { q: '', status: '', division: '' };
  var ePage = 1;
  var ePageSize = 25;

  function filteredGroups() {
    var q = eFilters.q.trim().toLowerCase();
    return EmergencyGroupsService.getAll().filter(function(g) {
      if (eFilters.status === 'active' && !g.active) return false;
      if (eFilters.status === 'standby' && g.active) return false;
      if (eFilters.division && g.division !== eFilters.division) return false;
      if (!q) return true;
      return g.name.toLowerCase().indexOf(q) > -1;
    });
  }

  function paginated() {
    var list = filteredGroups();
    var totalPages = Math.max(1, Math.ceil(list.length / ePageSize));
    if (ePage > totalPages) ePage = totalPages;
    if (ePage < 1) ePage = 1;
    var start = (ePage - 1) * ePageSize;
    return { rows: list.slice(start, start + ePageSize), total: list.length, totalPages: totalPages, start: start };
  }

  window.emergencySearch = function(v) { eFilters.q = v || ''; ePage = 1; refreshGroupsTable(); };
  window.emergencyFilterStatus = function(v) { eFilters.status = v || ''; ePage = 1; refreshGroupsTable(); };
  window.emergencyFilterDivision = function(v) { eFilters.division = v || ''; ePage = 1; refreshGroupsTable(); };
  window.emergencySetPageSize = function(v) { ePageSize = parseInt(v, 10) || 25; ePage = 1; refreshGroupsTable(); };
  window.emergencyPrevPage = function() { if (ePage > 1) { ePage--; refreshGroupsTable(); } };
  window.emergencyNextPage = function() {
    var totalPages = Math.max(1, Math.ceil(filteredGroups().length / ePageSize));
    if (ePage < totalPages) { ePage++; refreshGroupsTable(); }
  };

  window.emergencyReload = function() {
    groupsLoadState = 'loading';
    refreshGroupsTable();
    EmergencyGroupsService.refresh(true).then(function() {
      groupsLoadState = 'ready';
      refreshGroupsTable();
      if (window.toast) window.toast('Emergency groups refreshed');
    }).catch(function() {
      groupsLoadState = 'error';
      refreshGroupsTable();
      if (window.toast) window.toast('\\u2717 Couldn\\'t refresh \\u2014 please try again');
    });
  };

  /* ═══════════ Activate / Deactivate — real, awaited, confirmed ═══════════
     Deliberately does NOT call window.togEmer (see file header: that path
     updates the UI before its backend call even starts, so a failed
     request is invisible to the user). This awaits the real request and
     only reflects success once the server confirms it. */
  function emergencyConfirmBox(msg, onYes) {
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
        '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" id="em_cfyes">Confirm</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    document.getElementById('em_cfyes').onclick = function() { window.closeDrawer(); onYes(); };
  }

  window.emergencyToggleActive = function(id) {
    var g = EmergencyGroupsService.getById(id);
    if (!g || !g.dbId) { if (window.toast) window.toast('\\u2717 This group hasn\\'t finished saving yet \\u2014 try again in a moment.'); return; }
    var willActivate = !g.active;
    var msg = willActivate
      ? 'Activate <b>' + escapeHtml(g.name) + '</b>? This immediately overrides schedule logic on its linked flows \\u2014 callers will hear the emergency path until deactivated.'
      : 'Deactivate <b>' + escapeHtml(g.name) + '</b>? Linked flows will return to normal schedule-based routing.';
    emergencyConfirmBox(msg, function() {
      EmergencyGroupsService.patch(g.dbId, { active: willActivate }).then(function() {
        return EmergencyGroupsService.refresh();
      }).then(function() {
        if (willActivate) (window.DB.schedGroups || []).forEach(function(sg) { sg.state = 'Closed'; });
        if (window.audit) window.audit(willActivate ? 'ACTIVATE emergency group' : 'Deactivate emergency group', g.name);
        refreshGroupsTable();
        if (window.toast) window.toast(willActivate
          ? '\\u26A0 <b>' + escapeHtml(g.name) + '</b> ACTIVE \\u2014 attached flows now take the emergency path'
          : 'Emergency deactivated \\u2014 normal schedules resume');
      }).catch(function(err) {
        if (window.toast) window.toast('\\u2717 Couldn\\'t ' + (willActivate ? 'activate' : 'deactivate') + ' \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
      });
    });
  };

  window.emergencyDelete = function(id) {
    var g = EmergencyGroupsService.getById(id);
    if (!g || !g.dbId) return;
    var safeName = escapeHtml(g.name);
    var activeWarning = g.active ? ' <b style="color:#b3261e">This group is currently ACTIVE.</b>' : '';
    emergencyConfirmBox('Delete emergency group <b>' + safeName + '</b>? This cannot be undone.' + activeWarning, function() {
      EmergencyGroupsService.remove(g.dbId).then(function() {
        return EmergencyGroupsService.refresh();
      }).then(function() {
        refreshGroupsTable();
        if (window.toast) window.toast('\\u2713 Deleted <b>' + safeName + '</b>');
      }).catch(function(err) {
        if (window.toast) window.toast('\\u2717 Delete failed \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
      });
    });
  };

  /* ═══════════ Table rendering ═══════════ */
  function renderGroupRow(g) {
    var flowNames = (g.flows || []).map(function(fid) {
      var f = ((window.DB && window.DB.flows) || []).filter(function(x) { return x.dbId && String(x.dbId) === String(fid); })[0];
      return f ? f.name : '';
    }).filter(Boolean);
    var statusBadge = g.active
      ? '<span class="st" style="color:#b3261e"><span class="d" style="background:#b3261e"></span>ACTIVE</span>'
      : '<span class="st ok"><span class="d"></span>Standing by</span>';
    return '<tr onclick="window.emergencyOpenEditor(\\'' + g.id + '\\')">' +
      '<td><b class="lnk">' + escapeHtml(g.name) + '</b></td>' +
      '<td>' + (g.division ? escapeHtml(divisionLabel(g.division)) : '\\u2014') + '</td>' +
      '<td>' + (g.members.length ? (g.members.length + ' member' + (g.members.length === 1 ? '' : 's')) : '\\u2014') + '</td>' +
      '<td>' + (flowNames.length ? flowNames.map(function(n) { return '<span class="tag">' + escapeHtml(n) + '</span>'; }).join(' ') : '\\u2014') + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td style="white-space:nowrap" onclick="event.stopPropagation()">' +
        '<a class="lnk" style="font-size:12px" onclick="window.emergencyToggleActive(\\'' + g.id + '\\')">' + (g.active ? 'Deactivate' : 'Activate') + '</a> ' +
        '<a class="lnk" style="font-size:12px" onclick="window.emergencyDelete(\\'' + g.id + '\\')">Delete</a>' +
      '</td></tr>';
  }

  function renderGroupsTable() {
    if (groupsLoadState === 'loading') return '<div style="padding:28px;text-align:center;color:#8794a8">Loading emergency groups\\u2026</div>';
    if (groupsLoadState === 'error') return '<div style="padding:28px;text-align:center;color:#b3261e">Couldn\\'t load emergency groups from the server. <a class="lnk" onclick="window.emergencyReload()">Retry</a></div>';

    var pg = paginated();
    var rows = pg.rows.length
      ? pg.rows.map(renderGroupRow).join('')
      : '<tr><td colspan="6" style="text-align:center;color:#8794a8;padding:28px 0">' + (EmergencyGroupsService.getAll().length ? 'No emergency groups match your search.' : 'No emergency groups yet.') + '</td></tr>';
    var showFrom = pg.total ? pg.start + 1 : 0;
    var showTo = Math.min(pg.start + ePageSize, pg.total);

    return '<table class="dt"><thead><tr><th>Emergency group</th><th>Division</th><th>Members</th><th>Overrides flows</th><th>State</th><th style="width:130px"></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="pgr"><span>Showing <b>' + showFrom + (pg.total ? '\\u2013' + showTo : '') + '</b> of <b>' + pg.total + '</b></span><div class="sp"></div>' +
      '<span>Rows per page <select onchange="window.emergencySetPageSize(this.value)" style="border:none;background:transparent;font:inherit;color:inherit;cursor:pointer">' +
        [10, 25, 50].map(function(n) { return '<option value="' + n + '"' + (ePageSize === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
      '</select></span>' +
      '<a class="lnk" style="' + (ePage <= 1 ? 'color:#c3cbd8;cursor:default' : '') + '"' + (ePage > 1 ? ' onclick="window.emergencyPrevPage()"' : '') + '>\\u2039</a> ' +
      '<a class="lnk" style="' + (ePage >= pg.totalPages ? 'color:#c3cbd8;cursor:default' : '') + '"' + (ePage < pg.totalPages ? ' onclick="window.emergencyNextPage()"' : '') + '>\\u203A</a>' +
      '</div>';
  }

  function refreshGroupsTable() {
    var wrap = document.querySelector('#cnt .tblw');
    if (wrap) wrap.innerHTML = renderGroupsTable();
    var tab = document.querySelector('#cnt .tb.on');
    if (tab) tab.textContent = 'Groups (' + EmergencyGroupsService.getAll().length + ')';
    var divSel = document.getElementById('em_div_filter');
    if (divSel) {
      divSel.innerHTML = '<option value="">Division: All</option>' + divisionsCache.map(function(d) {
        return '<option value="' + escapeHtml(d.code) + '"' + (eFilters.division === d.code ? ' selected' : '') + '>' + escapeHtml(d.name) + '</option>';
      }).join('');
    }
  }

  /* ═══════════ Add / Edit drawer ═══════════ */
  function showDrawerError(html) {
    var box = document.getElementById('emergerr');
    if (box) { box.style.display = ''; box.innerHTML = html; }
  }
  function hideDrawerError() {
    var box = document.getElementById('emergerr');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  }

  window.emergencyOpenEditor = function(id) {
    ensureLookups().then(function() { actuallyOpenEditor(id); });
  };

  function actuallyOpenEditor(id) {
    var existing = id ? EmergencyGroupsService.getById(id) : null;
    var isNew = !existing;
    var g = existing || { id: '', dbId: null, name: '', flows: [], active: false, division: '', members: [], emergencyContacts: [], notificationRules: [], escalationTiers: [] };

    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);

    var contactsHtml = g.emergencyContacts.length ? g.emergencyContacts.map(contactRowHtml).join('') : contactRowHtml();
    var tiersHtml = g.escalationTiers.length ? g.escalationTiers.map(tierRowHtml).join('') : '';

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw"><div class="dh"><h2>' + (isNew ? 'Add' : 'Edit') + ' Emergency Group</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db">' +
        '<div id="emergerr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
        '<div class="fld"><label>Group name</label><input id="em_name" value="' + escapeHtml(g.name) + '" placeholder="Site Evacuation"></div>' +
        '<div class="fld"><label>Division</label><select id="em_division">' + divisionOptionsHtml(g.division) + '</select></div>' +
        '<div class="fld"><label>Overrides flows</label>' + flowOptionsHtml(g.flows) + '</div>' +
        '<div class="fld"><label>Members</label><div style="max-height:150px;overflow-y:auto">' + memberOptionsHtml(g.members) + '</div></div>' +
        '<div class="fld"><label>Emergency contacts</label><div id="em_contacts_list">' + contactsHtml + '</div>' +
          '<button type="button" class="btn sec" style="height:28px" onclick="window.__emAddContactRow()">+ Add contact</button></div>' +
        '<div class="fld"><label>Notify immediately via</label>' +
          CHANNELS.map(function(c) {
            return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0"><input type="checkbox" id="em_notify_' + c.v + '"' + (notifChecked(g.notificationRules, c.v) ? ' checked' : '') + '> ' + c.label + '</label>';
          }).join('') +
        '</div>' +
        '<div class="fld"><label>Escalation \\u2014 if not acknowledged</label><div id="em_tiers_list">' + tiersHtml + '</div>' +
          '<button type="button" class="btn sec" style="height:28px" onclick="window.__emAddTierRow()">+ Add escalation tier</button></div>' +
        (isNew ? '' : '<button class="btn gh" onclick="window.emergencyDelete(\\'' + g.id + '\\')">Delete</button>') +
      '</div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.emergencySave(\\'' + (g.id || '') + '\\')">' + (isNew ? 'Create' : 'Save') + '</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
  }

  function isDuplicateName(name, excludeId) {
    var lower = name.toLowerCase();
    return EmergencyGroupsService.getAll().some(function(g) {
      return g.name.toLowerCase() === lower && String(g.id) !== String(excludeId || '');
    });
  }

  window.emergencySave = function(id) {
    hideDrawerError();
    var name = document.getElementById('em_name').value.trim();
    var division = document.getElementById('em_division').value;
    var flowIds = Array.prototype.slice.call(document.querySelectorAll('.em_flow_cb:checked')).map(function(el) { return el.value; });
    var memberIds = Array.prototype.slice.call(document.querySelectorAll('.em_member_cb:checked')).map(function(el) { return parseInt(el.value, 10); });
    var contacts = collectContacts();
    var notifRules = collectNotificationRules();
    var tiers = collectTiers();

    var errs = [];
    if (name.length < 2) errs.push('Group name is required (min 2 characters).');
    else if (isDuplicateName(name, id)) errs.push('A group named \\u201C' + escapeHtml(name) + '\\u201D already exists.');
    for (var i = 0; i < contacts.length; i++) {
      if (contacts[i].name && !contacts[i].phone && !contacts[i].email) { errs.push('Contact \\u201C' + escapeHtml(contacts[i].name) + '\\u201D needs a phone number or email.'); break; }
    }
    if (errs.length) { showDrawerError(errs.join('<br>')); return; }

    var payload = {
      name: name, flows: flowIds, division: division, members: memberIds,
      emergency_contacts: contacts, notification_rules: notifRules, escalation_tiers: tiers
    };
    var isNew = !id;
    var existing = isNew ? null : EmergencyGroupsService.getById(id);
    if (isNew) payload.active = false;

    // No visual feedback while the request is in flight reads as "the
    // button doesn't work" on a slow connection — same fix as Prompts'
    // save.
    var saveBtn = Array.prototype.filter.call(document.querySelectorAll('.df button.btn'), function(b) {
      return (b.getAttribute('onclick') || '').indexOf('emergencySave') > -1;
    })[0];
    var saveBtnOrigText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving\\u2026'; }

    var op = isNew ? EmergencyGroupsService.create(payload) : EmergencyGroupsService.update(existing.dbId, payload);
    op.then(function() {
      return EmergencyGroupsService.refresh();
    }).then(function() {
      window.closeDrawer();
      refreshGroupsTable();
      if (window.toast) window.toast((isNew ? '\\u2713 Added ' : '\\u2713 Saved ') + '<b>' + escapeHtml(name) + '</b>');
    }).catch(function(err) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = saveBtnOrigText; }
      showDrawerError(escapeHtml((err && err.message) || 'Save failed \\u2014 please try again.'));
    });
  };

  /* ═══════════ Page shell ═══════════
     Header/help markup kept close to the original (same classes, same
     tab-count/"+ Add Group" pattern) — a Search/Filter/Refresh toolbar
     is added since none of it existed before, using the app's own
     .tbar/.chip/.s classes already used on Prompts/Flows/Call Routing. */
  function renderEmergencyPage() {
    var count = EmergencyGroupsService.getAll().length;
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A Routing</div>' +
      '<div class="tt"><h1>Emergency Groups</h1><div class="rt"><button class="btn" onclick="window.emergencyOpenEditor()">+ Add Group</button></div></div>' +
      '<div class="tabs"><div class="tb on">Groups (' + count + ')</div></div></div>' +
      '<div class="pbody"><div style="font-size:12px;color:#5b6b82;margin-bottom:10px">Activating an emergency group instantly overrides schedule logic on the attached flows \\u2014 callers hear the emergency path (evacuation/outage) until deactivated. Flow Test Call respects this.</div>' +
      '<div class="tbar">' +
        '<input class="s" placeholder="Search groups" oninput="window.emergencySearch(this.value)">' +
        '<select class="chip" onchange="window.emergencyFilterStatus(this.value)">' +
          '<option value="">Status: All</option><option value="active">Active</option><option value="standby">Standing by</option>' +
        '</select>' +
        '<select class="chip" id="em_div_filter" onchange="window.emergencyFilterDivision(this.value)"><option value="">Division: All</option></select>' +
        '<div class="sp"></div><div class="chip" onclick="window.emergencyReload()">\\u21BB Refresh</div>' +
      '</div>' +
      '<div class="tblw">' + renderGroupsTable() + '</div></div>' +
      '<div class="help"><div class="hh" onclick="toggleHelp()"><span style="color:#FF4F1F">\\u24D8</span> Help &amp; Resources \\u2014 Emergency Groups<span class="cx" id="helpcx">Hide</span></div>' +
      '<div class="hb" id="helpb" style=""><div class="hcols"><div><h5>What you can do here</h5><ul><li>Automatic failover schedule when a site is down</li><li>Redirect DIDs to an emergency flow</li><li>Activate manually or by schedule</li></ul>' +
      '<h5>Keywords</h5><div><span class="kw o">Emergency group</span><span class="kw">Failover</span><span class="kw">Emergency flow</span><span class="kw o">Business continuity</span></div></div>' +
      '<div><h5>Training videos</h5><div style="font-size:12px;color:#8794a8">No lab video mapped to this page yet.</div><h5 style="margin-top:14px">Reference documentation</h5>' +
      '<div><a class="reflnk" href="https://help.genesys.com/" target="_blank" rel="noopener">Help Centre \\u203A Emergency Groups</a><a class="reflnk" href="https://help.genesys.com/?q=Emergency%20Groups" target="_blank" rel="noopener">Search docs for \\u201CEmergency Groups\\u201D</a><a class="reflnk" href="https://www.genesys.com/pricing" target="_blank" rel="noopener">Licence requirements</a></div></div></div></div></div>';
  }

  function mountEmergencyPage() {
    var cnt = document.getElementById('cnt');
    if (cnt) cnt.innerHTML = renderEmergencyPage();
    var divSel = document.getElementById('em_div_filter');
    if (divSel) {
      divSel.innerHTML = '<option value="">Division: All</option>' + divisionsCache.map(function(d) {
        return '<option value="' + escapeHtml(d.code) + '"' + (eFilters.division === d.code ? ' selected' : '') + '>' + escapeHtml(d.name) + '</option>';
      }).join('');
    }
  }

  function loadEmergencyPage() {
    groupsLoadState = 'loading';
    mountEmergencyPage();
    EmergencyGroupsService.refresh().then(function() {
      groupsLoadState = 'ready';
      if (window.APP && window.APP.page === 'emergency') mountEmergencyPage();
    }).catch(function() {
      groupsLoadState = 'error';
      if (window.APP && window.APP.page === 'emergency') refreshGroupsTable();
    });
  }

  /* Same "wrap window.openPage" fix as dnclists-redesign.ts/prompts-
     redesign.ts/callrouting-redesign.ts: 'emergency' is DYN9-routed in
     scripts.ts (var DYN9={...,emergency:window.renderEmergencyFx,...}),
     captured once at boot — a plain window.renderEmergencyFx
     reassignment alone would never be picked up. */
  window.renderEmergencyFx = loadEmergencyPage;

  var prevOpenPageForEmergency = window.openPage;
  window.openPage = function(id) {
    if (id === 'emergency') {
      window.closeDrawer();
      window.restoreAdmin();
      window.navMark('admin');
      window.APP.page = 'emergency';
      loadEmergencyPage();
      var links = document.querySelectorAll('#anav .lk');
      links.forEach(function(el) { el.classList.remove('on'); });
      for (var i = 0; i < links.length; i++) {
        var onclick = links[i].getAttribute('onclick') || '';
        if (onclick.indexOf("'emergency'") > -1) { links[i].classList.add('on'); break; }
      }
      window.scrollTo(0, 0);
      return;
    }
    return prevOpenPageForEmergency(id);
  };

  function initIfActive() {
    if (window.APP && window.APP.page === 'emergency' && document.getElementById('cnt')) loadEmergencyPage();
  }
  initIfActive();
  setTimeout(initIfActive, 100);
  setTimeout(initIfActive, 400);

})();
`;
