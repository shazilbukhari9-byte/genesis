/* ============================================================
   MCM Cloud CX — Authorized Organizations Redesign Module
   Full Working Implementation with Backend-Ready Service Layer
   ============================================================ */

export const AUTHORG_SCRIPT: string = `
(function() {
  'use strict';

  /* ─── SVG Icon Library ─── */
  var ICONS = {
    shield: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    plus: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
    download: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
    link: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    users: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    building: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="9" y1="6" x2="9" y2="6.01"></line><line x1="15" y1="6" x2="15" y2="6.01"></line><line x1="9" y1="10" x2="9" y2="10.01"></line><line x1="15" y1="10" x2="15" y2="10.01"></line><line x1="9" y1="14" x2="9" y2="14.01"></line><line x1="15" y1="14" x2="15" y2="14.01"></line><line x1="9" y1="18" x2="9" y2="18.01"></line><line x1="15" y1="18" x2="15" y2="18.01"></line></svg>',
    alertTriangle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
    copy: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    arrowDownLeft: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="17" y1="7" x2="7" y2="17"></line><polyline points="17 17 7 17 7 7"></polyline></svg>',
    arrowUpRight: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>',
    eye: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    edit: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
    clock: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
    refresh: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
    trash: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
    sliders: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>',
    info: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FF4F1F" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
    check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    book: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
    code: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
    creditCard: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>',
    sortAsc: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7-7 7 7"/></svg>',
    sortDesc: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
    sortNeutral: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15l5 5 5-5M7 9l5-5 5 5"/></svg>',
    chevronLeft: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>',
    chevronRight: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'
  };

  /* ─── Toast Helper (fallback if platform toast unavailable) ─── */
  function showToast(msg) {
    if (window.toast) { window.toast(msg); return; }
    var existing = document.getElementById('authorg_toast');
    if (existing) existing.remove();
    var t = document.createElement('div');
    t.id = 'authorg_toast';
    t.className = 'authorg-toast';
    t.innerHTML = msg;
    document.body.appendChild(t);
    setTimeout(function(){ t.classList.add('show'); }, 10);
    setTimeout(function(){ t.classList.remove('show'); setTimeout(function(){ t.remove(); }, 300); }, 3000);
  }

  /* ─── Confirmation Dialog ─── */
  function showConfirm(title, message, confirmLabel, confirmColor, onConfirm) {
    var scrim = document.createElement('div');
    scrim.id = 'authorg_confirm_scrim';
    scrim.className = 'authorg-modal-scrim';
    scrim.onclick = function(){ scrim.remove(); };

    var card = document.createElement('div');
    card.className = 'authorg-confirm-card';
    card.onclick = function(e){ e.stopPropagation(); };
    card.innerHTML =
      '<div class="authorg-confirm-header">' +
        '<h3>' + title + '</h3>' +
        '<button class="authorg-modal-close" onclick="document.getElementById(\\'authorg_confirm_scrim\\').remove()">' + ICONS.x + '</button>' +
      '</div>' +
      '<div class="authorg-confirm-body"><p>' + message + '</p></div>' +
      '<div class="authorg-confirm-footer">' +
        '<button class="btn sec" onclick="document.getElementById(\\'authorg_confirm_scrim\\').remove()">Cancel</button>' +
        '<button class="btn" id="authorg_confirm_btn" style="background:' + (confirmColor || '#dc2626') + '">' + confirmLabel + '</button>' +
      '</div>';

    scrim.appendChild(card);
    document.body.appendChild(scrim);
    document.getElementById('authorg_confirm_btn').onclick = function(){ scrim.remove(); onConfirm(); };
  }

  /* ═══════════════════════════════════════════
     DATA LAYER — AuthOrgService
     Backed by the Flask REST API (backend/app.py) when reachable;
     falls back to the local mock data below if the server is offline.
     ═══════════════════════════════════════════ */

  var API_BASE = 'http://localhost:5000/api/v2/authorization';

  function fmtDMY(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* Maps a backend trust record onto the shape this module renders. */
  function mapApiTrust(t) {
    var relationship = t.relationship || 'Trustee';
    var direction = relationship === 'Owner' ? 'Root Organization' : (relationship === 'Trustor' ? 'Outbound Request' : 'Inbound Access');
    var orgId = t.org_id || '';
    var uuidShort = orgId ? (orgId.slice(0, 4) + '...' + orgId.slice(-3)) : '';
    var status = t.status || 'Active';

    var expiry, expiryDate, expiryDays, isExpiring, statusClass;
    if (status === 'Owner' || !t.expires_at) {
      expiry = 'Permanent';
      expiryDate = new Date('2099-12-31');
      expiryDays = 'Account Root Tenant';
      isExpiring = false;
    } else if (status === 'Revoked') {
      expiryDate = new Date(t.expires_at);
      expiry = 'Terminated';
      expiryDays = 'Revoked on ' + fmtDMY(expiryDate);
      isExpiring = false;
    } else {
      expiryDate = new Date(t.expires_at);
      expiry = fmtDMY(expiryDate);
      var diffDays = Math.ceil((expiryDate.getTime() - Date.now()) / 86400000);
      isExpiring = diffDays <= 14;
      expiryDays = diffDays < 0 ? 'Expired' : (diffDays <= 14 ? 'Expiring in ' + diffDays + ' days' : 'Valid for ' + diffDays + ' days');
    }
    statusClass = status === 'Owner' ? 'status-owner' : (status === 'Revoked' ? 'status-revoked' : ((status === 'Expiring soon' || isExpiring) ? 'status-expiring' : 'status-active'));

    return {
      id: String(t.id),
      name: t.org_name,
      domain: t.domain || '',
      uuid: orgId,
      uuidShort: uuidShort,
      relationship: relationship,
      direction: direction,
      roles: t.scope_roles || [],
      divisions: t.divisions || [],
      expiry: expiry,
      expiryDate: expiryDate,
      expiryDays: expiryDays,
      isExpiring: isExpiring,
      status: status,
      statusClass: statusClass,
      note: t.notes || '',
      createdAt: t.created_at ? new Date(t.created_at) : new Date()
    };
  }

  /* Maps this module's org shape onto the backend's write payload. */
  function toApiPayload(org) {
    return {
      org_name: org.name,
      org_id: org.uuid,
      domain: org.domain,
      relationship: org.relationship,
      scope_roles: org.roles,
      divisions: org.divisions,
      expires_at: (org.status === 'Owner' || !org.expiryDate) ? null : org.expiryDate.toISOString().slice(0, 10),
      status: org.status,
      notes: org.note
    };
  }

  /* Loads live trusts from the backend on startup; keeps the local mock
     data (and the app fully usable) if the server is unreachable. */
  function loadTrustsFromApi() {
    fetch(API_BASE + '/trusts')
      .then(function(res) { if (!res.ok) throw new Error('bad status'); return res.json(); })
      .then(function(list) {
        if (!list || !list.length) return;
        authorgData = list.map(mapApiTrust);
        authorgApplyFilters();
      })
      .catch(function() {
        // Backend offline — the seeded local mock data below stays in use.
      });
  }

  var authorgData = [
    {
      id: 'org_ie',
      name: 'MCM Retail Ireland',
      domain: 'retail.ie.mcmgroup.com · EU (Dublin)',
      uuid: 'a19c4b82-9f33-44f1-bc82-019e28344fa1',
      uuidShort: 'a19c...44f',
      relationship: 'Trustee',
      direction: 'Inbound Access',
      roles: ['Contact Centre Admin'],
      divisions: ['UK Retail', 'IE Retail'],
      expiry: '31 Dec 2026',
      expiryDate: new Date('2026-12-31'),
      expiryDays: 'Valid for 138 days',
      isExpiring: false,
      status: 'Active',
      statusClass: 'status-active',
      note: 'Regional operations management for Irish entity. Provisioned under standard Master Services Agreement.',
      createdAt: new Date('2026-01-15')
    },
    {
      id: 'org_ns',
      name: 'Northstar BPO',
      domain: 'partner.northstarbpo.ph · Asia (Manila)',
      uuid: '77bd18f0-1a22-49a1-8e01-cc82910499a1',
      uuidShort: '77bd...9a1',
      relationship: 'Trustee',
      direction: 'Inbound Access',
      roles: ['Supervisor', 'Agent'],
      divisions: ['Partner — Manila'],
      expiry: '30 Sep 2026',
      expiryDate: new Date('2026-09-30'),
      expiryDays: 'Valid for 46 days',
      isExpiring: false,
      status: 'Active',
      statusClass: 'status-active',
      note: 'Outsourced tier-1 customer support partner handling voice & digital queues.',
      createdAt: new Date('2026-03-10')
    },
    {
      id: 'org_mg',
      name: 'MCM Group PLC',
      domain: 'mcmcloudcx.com · EU (London) · Parent Entity',
      uuid: '8f14e45f-ceea-4d3b-9c7f-2b1a0d7e33aa',
      uuidShort: '8f14...3aa',
      relationship: 'Owner',
      direction: 'Root Organization',
      roles: ['Root / Full Platform Access'],
      divisions: ['All'],
      expiry: 'Permanent',
      expiryDate: new Date('2099-12-31'),
      expiryDays: 'Account Root Tenant',
      isExpiring: false,
      status: 'Owner',
      statusClass: 'status-owner',
      note: 'Primary billing and root governance entity holding platform ownership.',
      createdAt: new Date('2024-06-01')
    },
    {
      id: 'org_cp',
      name: 'Cloudline Partners',
      domain: 'cloudline.co.uk · EU (London)',
      uuid: '32ee991a-4421-40c8-8812-7819920100c8',
      uuidShort: '32ee...0c8',
      relationship: 'Trustee',
      direction: 'Inbound Access',
      roles: ['Read-only Admin'],
      divisions: ['UK Digital'],
      expiry: '11 Aug 2026',
      expiryDate: new Date('2026-08-11'),
      expiryDays: 'Expiring in 5 days',
      isExpiring: true,
      status: 'Expiring soon',
      statusClass: 'status-expiring',
      note: 'External security auditor reviewing chat routing and data privacy compliance.',
      createdAt: new Date('2026-02-20')
    },
    {
      id: 'org_vc',
      name: 'Vertex Consulting',
      domain: 'vertex-cx.com · US (East)',
      uuid: 'be408819-aa21-4712-9c12-381902847712',
      uuidShort: 'be40...712',
      relationship: 'Trustee',
      direction: 'Inbound Access',
      roles: ['Implementation'],
      divisions: ['All'],
      expiry: 'Terminated',
      expiryDate: new Date('2026-07-18'),
      expiryDays: 'Revoked on 18 Jul 2026',
      isExpiring: false,
      status: 'Revoked',
      statusClass: 'status-revoked',
      note: 'Architect flow migration partner. Project completed and access revoked.',
      createdAt: new Date('2025-11-05')
    }
  ];

  /* ── Service Layer — mutates local state instantly, persists to the
     Flask API in the background. Network failures are swallowed so the
     UI keeps working entirely off local state when the backend is down. ── */
  var AuthOrgService = {
    getAll: function() { return authorgData; },
    getById: function(id) { return authorgData.filter(function(x){ return x.id === id; })[0] || null; },
    create: function(org) {
      authorgData.unshift(org);
      fetch(API_BASE + '/trusts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toApiPayload(org))
      })
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(saved) {
          if (saved && saved.id && saved.id !== org.id) {
            org.id = String(saved.id);
            // Row was already painted with the pre-reconciliation id baked
            // into its onclick handlers — repaint so it's clickable again.
            authorgApplyFilters();
          }
        })
        .catch(function() {});
      return org;
    },
    update: function(id, changes) {
      var org = AuthOrgService.getById(id);
      if (!org) return null;
      for (var k in changes) { if (changes.hasOwnProperty(k)) org[k] = changes[k]; }
      fetch(API_BASE + '/trusts/' + org.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toApiPayload(org))
      }).catch(function() {});
      return org;
    },
    remove: function(id) {
      authorgData = authorgData.filter(function(x){ return x.id !== id; });
      fetch(API_BASE + '/trusts/' + id + '?hard=true', { method: 'DELETE' }).catch(function() {});
    },
    getStats: function() {
      var total = authorgData.length;
      var active = authorgData.filter(function(o){ return o.status === 'Active'; }).length;
      var owners = authorgData.filter(function(o){ return o.relationship === 'Owner'; }).length;
      var expiring = authorgData.filter(function(o){ return o.isExpiring || o.status === 'Expiring soon'; }).length;
      var revoked = authorgData.filter(function(o){ return o.status === 'Revoked'; }).length;
      var attention = expiring + revoked;
      var ownerOrg = authorgData.filter(function(o){ return o.relationship === 'Owner'; })[0];
      var divSet = {};
      authorgData.forEach(function(o){ o.divisions.forEach(function(d){ if(d !== 'All') divSet[d] = true; }); });
      return { total: total, active: active, owners: owners, attention: attention, expiring: expiring, revoked: revoked, ownerName: ownerOrg ? ownerOrg.name : '—', divCount: Object.keys(divSet).length };
    }
  };

  /* ─── State ─── */
  var filtersState = { tab: 'all', search: '', division: 'All', status: 'Any' };
  var sortState = { col: null, dir: null }; // dir: 'asc' | 'desc' | null
  var pageState = { size: 25, current: 1 };
  var columnState = { chk: true, org: true, uuid: true, rel: true, roles: true, divs: true, exp: true, stat: true, act: true };
  var selectedIds = {};

  /* ─── Available Options ─── */
  var AVAILABLE_ROLES = ['Contact Centre Admin', 'Supervisor', 'Agent', 'Read-only Admin', 'Implementation', 'Root / Full Platform Access'];
  var AVAILABLE_DIVISIONS = ['UK Retail', 'IE Retail', 'UK Digital', 'UK Collections', 'Partner — Manila', 'All'];

  /* ═══════════════════════════════════════════
     RENDERING
     ═══════════════════════════════════════════ */

  function renderAuthorgHtml() {
    var stats = AuthOrgService.getStats();
    return '<div class="phd">' +
      '<div class="bc"><a onclick="adminIndex()">Admin</a> › Account Settings</div>' +
      '<div class="tt">' +
        '<h1>Authorized Organizations <span class="authorg-header-badge">' + ICONS.shield + ' Multi-Tenant Trust</span></h1>' +
        '<div class="rt">' +
          '<button class="btn sec" onclick="authorgExport()"><span style="margin-right:6px;display:inline-flex;align-items:center">' + ICONS.download + '</span> Export</button>' +
          '<button class="btn" onclick="authorgAddDrawer()"><span style="margin-right:6px;display:inline-flex;align-items:center">' + ICONS.plus + '</span> Authorize Organization</button>' +
        '</div>' +
      '</div>' +
      '<div class="tabs">' +
        '<div class="tb on" data-tab="all" onclick="authorgTab(this, \\'all\\')">All Relationships <span class="authorg-tab-badge" id="authorg_badge_all">' + stats.total + '</span></div>' +
        '<div class="tb" data-tab="trustees" onclick="authorgTab(this, \\'trustees\\')">Trustees <span class="authorg-tab-badge" id="authorg_badge_trustees">' + (stats.active + stats.expiring) + '</span></div>' +
        '<div class="tb" data-tab="trustors" onclick="authorgTab(this, \\'trustors\\')">Trustors <span class="authorg-tab-badge" id="authorg_badge_trustors">' + stats.owners + '</span></div>' +
        '<div class="tb" data-tab="audit" onclick="authorgTab(this, \\'audit\\')">Trust Audit Log</div>' +
      '</div>' +
    '</div>' +
    '<div class="pbody">' +
      '<div class="authorg-wrap">' +
        '<!-- Bulk Actions Bar (hidden by default) -->' +
        '<div class="authorg-bulk-bar" id="authorg_bulk_bar" style="display:none">' +
          '<span class="authorg-bulk-count" id="authorg_bulk_count">0 selected</span>' +
          '<div class="sp"></div>' +
          '<button class="btn sec" style="height:30px;font-size:12px;padding:0 12px" onclick="authorgBulkExtend()"><span style="display:inline-flex;margin-right:4px">' + ICONS.clock + '</span> Extend All</button>' +
          '<button class="btn sec" style="height:30px;font-size:12px;padding:0 12px" onclick="authorgBulkExportSelected()"><span style="display:inline-flex;margin-right:4px">' + ICONS.download + '</span> Export Selected</button>' +
          '<button class="btn" style="height:30px;font-size:12px;padding:0 12px;background:#dc2626" onclick="authorgBulkRevoke()"><span style="display:inline-flex;margin-right:4px">' + ICONS.trash + '</span> Revoke All</button>' +
        '</div>' +

        '<!-- Toolbar -->' +
        '<div class="tbar" style="margin-bottom:0">' +
          '<div style="position:relative;display:flex;align-items:center">' +
            '<span style="position:absolute;left:10px;pointer-events:none;display:flex">' + ICONS.search + '</span>' +
            '<input class="s" id="authorg_search" placeholder="Search authorized organizations" oninput="authorgSearch(this.value)" style="width:310px;padding-left:32px;border-radius:6px">' +
          '</div>' +
          '<div class="authorg-chip" id="authorg_chip_div" onclick="authorgOpenDropdown(\\'div\\', this)">Division: <span id="authorg_lbl_div">All</span> <span style="font-size:10px;margin-left:2px">▾</span></div>' +
          '<div class="authorg-chip" id="authorg_chip_stat" onclick="authorgOpenDropdown(\\'status\\', this)">Status: <span id="authorg_lbl_stat">Any</span> <span style="font-size:10px;margin-left:2px">▾</span></div>' +
          '<div class="sp"></div>' +
          '<div class="authorg-chip" id="authorg_chip_cols" onclick="authorgOpenColumnsModal(this)"><span style="display:inline-flex;margin-right:4px">' + ICONS.sliders + '</span> Columns</div>' +
          '<div class="authorg-chip" onclick="authorgRefresh()"><span style="display:inline-flex;margin-right:4px">' + ICONS.refresh + '</span> Refresh</div>' +
        '</div>' +

        '<!-- Table -->' +
        '<div class="authorg-table-wrap">' +
          '<table class="authorg-table" id="authorg_table">' +
            '<thead>' +
              '<tr>' +
                '<th data-col="chk" style="width:34px;text-align:center"><input type="checkbox" id="authorg_chk_all" onclick="authorgToggleAll(this)"></th>' +
                '<th data-col="org" class="authorg-sortable" data-sortkey="org" onclick="authorgSort(\\'org\\')">Organization <span class="authorg-sort-icon" id="authorg_sort_org">' + ICONS.sortNeutral + '</span></th>' +
                '<th data-col="uuid" class="authorg-sortable" data-sortkey="uuid" onclick="authorgSort(\\'uuid\\')">Org ID <span class="authorg-sort-icon" id="authorg_sort_uuid">' + ICONS.sortNeutral + '</span></th>' +
                '<th data-col="rel" class="authorg-sortable" data-sortkey="rel" onclick="authorgSort(\\'rel\\')">Relationship <span class="authorg-sort-icon" id="authorg_sort_rel">' + ICONS.sortNeutral + '</span></th>' +
                '<th data-col="roles" class="authorg-sortable" data-sortkey="roles" onclick="authorgSort(\\'roles\\')">Scope (roles) <span class="authorg-sort-icon" id="authorg_sort_roles">' + ICONS.sortNeutral + '</span></th>' +
                '<th data-col="divs" class="authorg-sortable" data-sortkey="divs" onclick="authorgSort(\\'divs\\')">Divisions <span class="authorg-sort-icon" id="authorg_sort_divs">' + ICONS.sortNeutral + '</span></th>' +
                '<th data-col="exp" class="authorg-sortable" data-sortkey="exp" onclick="authorgSort(\\'exp\\')">Expires <span class="authorg-sort-icon" id="authorg_sort_exp">' + ICONS.sortNeutral + '</span></th>' +
                '<th data-col="stat" class="authorg-sortable" data-sortkey="stat" onclick="authorgSort(\\'stat\\')">Status <span class="authorg-sort-icon" id="authorg_sort_stat">' + ICONS.sortNeutral + '</span></th>' +
                '<th data-col="act" style="width:34px;text-align:center"></th>' +
              '</tr>' +
            '</thead>' +
            '<tbody id="authorg_tb">' +
              renderRows(authorgData) +
            '</tbody>' +
          '</table>' +
          '<div class="pgr" id="authorg_pgr">' +
            renderPagination(authorgData.length) +
          '</div>' +
        '</div>' +

        '<!-- Help & Resources Hub -->' +
        '<div class="authorg-help-box">' +
          '<div class="authorg-help-header" onclick="authorgToggleHelp()">' +
            '<div class="authorg-help-title-wrap">' +
              '<span style="display:flex;align-items:center;color:#FF4F1F">' + ICONS.info + '</span>' +
              '<span>Help &amp; Resources — Authorized Organizations (Multi-Tenant Trust)</span>' +
              '<span class="authorg-help-tag">Knowledge Base</span>' +
            '</div>' +
            '<button class="authorg-help-toggle-btn" id="authorg_help_toggle_btn">' +
              '<span id="authorg_help_toggle_text">Hide</span> <span id="authorg_help_toggle_icon">▴</span>' +
            '</button>' +
          '</div>' +
          '<div class="authorg-help-body" id="authorg_help_body">' +
            '<div class="authorg-help-col">' +
              '<h5>' + ICONS.shield + ' Core Capabilities</h5>' +
              '<ul class="authorg-help-list">' +
                '<li class="authorg-help-list-item"><span class="authorg-help-check-icon">' + ICONS.check + '</span><span><b>Establish multi-tenant trust relationships</b> between independent MCM tenants for cross-organization administration.</span></li>' +
                '<li class="authorg-help-list-item"><span class="authorg-help-check-icon">' + ICONS.check + '</span><span><b>Grant delegated partner administration</b> rights without provisioning expensive dedicated user licenses.</span></li>' +
                '<li class="authorg-help-list-item"><span class="authorg-help-check-icon">' + ICONS.check + '</span><span><b>Scope trustee access</b> strictly by security roles, granular permissions, and operational division boundaries.</span></li>' +
                '<li class="authorg-help-list-item"><span class="authorg-help-check-icon">' + ICONS.check + '</span><span><b>Enforce auto-expiring trust windows</b> with automated notifications prior to permission revocation.</span></li>' +
              '</ul>' +
              '<h5 style="margin-top:18px;margin-bottom:8px">' + ICONS.sliders + ' Security Concepts &amp; Terminology</h5>' +
              '<div class="authorg-keywords-grid">' +
                '<span class="authorg-keyword-chip accent">Trustor (Grantor)</span>' +
                '<span class="authorg-keyword-chip accent">Trustee (Delegate)</span>' +
                '<span class="authorg-keyword-chip">Delegated Admin</span>' +
                '<span class="authorg-keyword-chip">Least Privilege</span>' +
                '<span class="authorg-keyword-chip">Time-Bound Expiry</span>' +
                '<span class="authorg-keyword-chip">Multi-Tenant Isolation</span>' +
              '</div>' +
            '</div>' +
            '<div class="authorg-help-col">' +
              '<h5>' + ICONS.book + ' Documentation &amp; Developer API</h5>' +
              '<div class="authorg-resource-cards">' +
                '<a class="authorg-resource-card" href="https://help.genesys.com/" target="_blank" rel="noopener"><div class="authorg-resource-icon">' + ICONS.book + '</div><div class="authorg-resource-content"><div class="authorg-resource-title">Help Centre Guide <span style="color:#64748b;font-size:11px">↗</span></div><div class="authorg-resource-sub">Authorized Organizations &amp; Multi-Tenant Setup</div></div></a>' +
                '<a class="authorg-resource-card" href="https://developer.genesys.cloud/" target="_blank" rel="noopener"><div class="authorg-resource-icon">' + ICONS.code + '</div><div class="authorg-resource-content"><div class="authorg-resource-title">Developer REST API <span style="color:#64748b;font-size:11px">↗</span></div><div class="authorg-resource-sub"><code>/api/v2/authorization/trusts</code> endpoint reference</div></div></a>' +
                '<a class="authorg-resource-card" href="https://www.genesys.com/pricing" target="_blank" rel="noopener"><div class="authorg-resource-icon">' + ICONS.creditCard + '</div><div class="authorg-resource-content"><div class="authorg-resource-title">Licensing &amp; Quotas <span style="color:#64748b;font-size:11px">↗</span></div><div class="authorg-resource-sub">Multi-tenant policies &amp; compliance guidelines</div></div></a>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ─── Pagination Renderer ─── */
  function renderPagination(totalItems) {
    var totalPages = pageState.size >= totalItems ? 1 : Math.ceil(totalItems / pageState.size);
    if (pageState.current > totalPages) pageState.current = totalPages || 1;
    var start = (pageState.current - 1) * pageState.size + 1;
    var end = Math.min(pageState.current * pageState.size, totalItems);
    if (totalItems === 0) { start = 0; end = 0; }

    return '<span id="authorg_count_text">Showing <b>' + (totalItems > 0 ? start + '–' + end : '0') + '</b> of <b>' + totalItems + '</b></span>' +
      '<div class="sp"></div>' +
      '<span class="authorg-rpp" id="authorg_rpp">Rows per page <b class="authorg-rpp-val" onclick="authorgOpenRppDropdown(this)">' + (pageState.size >= 9999 ? 'All' : pageState.size) + ' ▾</b></span>' +
      '<span class="authorg-page-nav">' +
        '<button class="authorg-page-btn" onclick="authorgPagePrev()" ' + (pageState.current <= 1 ? 'disabled' : '') + '>' + ICONS.chevronLeft + '</button>' +
        '<span class="authorg-page-num">' + pageState.current + ' / ' + totalPages + '</span>' +
        '<button class="authorg-page-btn" onclick="authorgPageNext()" ' + (pageState.current >= totalPages ? 'disabled' : '') + '>' + ICONS.chevronRight + '</button>' +
      '</span>';
  }

  /* ─── Table Row Renderer ─── */
  function renderRows(list) {
    if (!list || !list.length) {
      return '<tr><td colspan="9" style="text-align:center;padding:32px;color:#64748b">No matching authorized organizations found.</td></tr>';
    }
    // Paginate
    var pageList = list;
    if (pageState.size < 9999) {
      var startIdx = (pageState.current - 1) * pageState.size;
      pageList = list.slice(startIdx, startIdx + pageState.size);
    }
    return pageList.map(function(org) {
      var relBadge = org.relationship === 'Owner'
        ? '<span class="authorg-rel-badge rel-owner">' + ICONS.shield + ' Owner</span>'
        : (org.relationship === 'Trustee'
          ? '<span class="authorg-rel-badge rel-trustee">' + ICONS.arrowDownLeft + ' Trustee</span>'
          : '<span class="authorg-rel-badge rel-trustor">' + ICONS.arrowUpRight + ' Trustor</span>');

      var rolesHtml = org.roles.map(function(r){
        return '<span class="authorg-pill role-pill"' + (org.relationship === 'Owner' ? ' style="font-weight:700"' : '') + '>' + r + '</span>';
      }).join(' ');

      var divsHtml = org.divisions.map(function(d){
        return '<span class="authorg-pill div-pill">' + d + '</span>';
      }).join(' ');

      var expirySubHtml = org.isExpiring
        ? '<span class="authorg-expiry-sub warn"><span style="display:inline-flex;align-items:center;margin-right:3px">' + ICONS.alertTriangle + '</span> ' + org.expiryDays + '</span>'
        : '<span class="authorg-expiry-sub">' + org.expiryDays + '</span>';

      var isChecked = selectedIds[org.id] ? ' checked' : '';

      return '<tr data-orgid="' + org.id + '" onclick="authorgViewDrawer(\\'' + org.id + '\\')">' +
        '<td data-col="chk" style="text-align:center;' + (columnState.chk ? '' : 'display:none;') + '" onclick="event.stopPropagation()"><input type="checkbox" data-orgchk="' + org.id + '"' + isChecked + ' onchange="authorgOnCheckRow(this, \\'' + org.id + '\\')"></td>' +
        '<td data-col="org" style="' + (columnState.org ? '' : 'display:none;') + '">' +
          '<span class="authorg-name lnk">' + org.name + '</span>' +
        '</td>' +
        '<td data-col="uuid" style="' + (columnState.uuid ? '' : 'display:none;') + '">' +
          '<div class="authorg-id-chip" onclick="event.stopPropagation();authorgCopy(\\'' + org.uuid + '\\')">' +
            '<span>' + org.uuidShort + '</span>' +
            '<button class="authorg-copy-btn" title="Copy Full ID">' + ICONS.copy + '</button>' +
          '</div>' +
        '</td>' +
        '<td data-col="rel" style="' + (columnState.rel ? '' : 'display:none;') + '">' + relBadge + '</td>' +
        '<td data-col="roles" style="' + (columnState.roles ? '' : 'display:none;') + '">' + rolesHtml + '</td>' +
        '<td data-col="divs" style="' + (columnState.divs ? '' : 'display:none;') + '">' + divsHtml + '</td>' +
        '<td data-col="exp" style="' + (columnState.exp ? '' : 'display:none;') + '">' +
          '<div class="authorg-expiry-cell">' +
            '<span class="authorg-expiry-date"' + (org.isExpiring ? ' style="color:#d97706"' : '') + '>' + org.expiry + '</span>' +
            expirySubHtml +
          '</div>' +
        '</td>' +
        '<td data-col="stat" style="' + (columnState.stat ? '' : 'display:none;') + '"><span class="authorg-status ' + org.statusClass + '"><span class="dot"></span>' + org.status + '</span></td>' +
        '<td data-col="act" style="text-align:center;' + (columnState.act ? '' : 'display:none;') + '" onclick="event.stopPropagation()">' +
          '<button class="authorg-more-btn" title="Actions" onclick="authorgOpenCtxMenu(event, \\'' + org.id + '\\')">⋮</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  /* ═══════════════════════════════════════════
     CORE ENGINE
     ═══════════════════════════════════════════ */

  function applyColumnStyles() {
    var tbl = document.getElementById('authorg_table');
    if (!tbl) return;
    for (var key in columnState) {
      var isVisible = columnState[key];
      var ths = tbl.querySelectorAll('th[data-col="' + key + '"]');
      var tds = tbl.querySelectorAll('td[data-col="' + key + '"]');
      ths.forEach(function(el){ el.style.display = isVisible ? '' : 'none'; });
      tds.forEach(function(el){ el.style.display = isVisible ? '' : 'none'; });
    }
  }

  /* ─── Sorting ─── */
  function getSortedData(data) {
    if (!sortState.col || !sortState.dir) return data;
    var sorted = data.slice();
    var col = sortState.col;
    var asc = sortState.dir === 'asc' ? 1 : -1;

    sorted.sort(function(a, b) {
      var va, vb;
      if (col === 'org') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      else if (col === 'uuid') { va = a.uuid; vb = b.uuid; }
      else if (col === 'rel') { va = a.relationship; vb = b.relationship; }
      else if (col === 'roles') { va = (a.roles[0] || '').toLowerCase(); vb = (b.roles[0] || '').toLowerCase(); }
      else if (col === 'divs') { va = (a.divisions[0] || '').toLowerCase(); vb = (b.divisions[0] || '').toLowerCase(); }
      else if (col === 'exp') { va = a.expiryDate ? a.expiryDate.getTime() : 0; vb = b.expiryDate ? b.expiryDate.getTime() : 0; }
      else if (col === 'stat') { va = a.status.toLowerCase(); vb = b.status.toLowerCase(); }
      else { return 0; }
      if (va < vb) return -1 * asc;
      if (va > vb) return 1 * asc;
      return 0;
    });
    return sorted;
  }

  function updateSortIcons() {
    var cols = ['org','uuid','rel','roles','divs','exp','stat'];
    cols.forEach(function(c) {
      var el = document.getElementById('authorg_sort_' + c);
      if (!el) return;
      if (sortState.col === c) {
        el.innerHTML = sortState.dir === 'asc' ? ICONS.sortAsc : ICONS.sortDesc;
        el.parentElement.classList.add('authorg-sort-active');
      } else {
        el.innerHTML = ICONS.sortNeutral;
        el.parentElement.classList.remove('authorg-sort-active');
      }
    });
  }

  /* ─── Combined Filtering + Sorting + Pagination ─── */
  function authorgApplyFilters() {
    var q = (filtersState.search || '').toLowerCase().trim();
    var div = filtersState.division;
    var stat = filtersState.status;
    var tab = filtersState.tab;

    var filtered = AuthOrgService.getAll().filter(function(org) {
      var matchSearch = !q ||
        org.name.toLowerCase().indexOf(q) > -1 ||
        org.uuid.toLowerCase().indexOf(q) > -1 ||
        org.relationship.toLowerCase().indexOf(q) > -1 ||
        org.roles.some(function(r){ return r.toLowerCase().indexOf(q) > -1; }) ||
        org.divisions.some(function(d){ return d.toLowerCase().indexOf(q) > -1; }) ||
        org.status.toLowerCase().indexOf(q) > -1;
      if (!matchSearch) return false;

      if (div && div !== 'All') {
        var matchDiv = org.divisions.some(function(d) {
          return d.toLowerCase().indexOf(div.toLowerCase()) > -1 || div.toLowerCase().indexOf(d.toLowerCase()) > -1 || d === 'All';
        });
        if (!matchDiv) return false;
      }

      if (stat && stat !== 'Any' && stat !== 'All') {
        if (org.status.toLowerCase() !== stat.toLowerCase()) return false;
      }

      if (tab === 'trustees' && org.relationship !== 'Trustee') return false;
      if (tab === 'trustors' && org.relationship !== 'Owner' && org.relationship !== 'Trustor') return false;

      return true;
    });

    // Sort
    filtered = getSortedData(filtered);

    // Render table
    var tb = document.getElementById('authorg_tb');
    if (tb) { tb.innerHTML = renderRows(filtered); applyColumnStyles(); }

    // Render pagination
    var pgr = document.getElementById('authorg_pgr');
    if (pgr) pgr.innerHTML = renderPagination(filtered.length);

    // Update tab badges
    refreshTabBadges();

    // Update bulk bar
    updateBulkBar();
  }

  /* ─── Refresh Tab Badges ─── */
  function refreshTabBadges() {
    var all = AuthOrgService.getAll();
    var bAll = document.getElementById('authorg_badge_all');
    var bTrustees = document.getElementById('authorg_badge_trustees');
    var bTrustors = document.getElementById('authorg_badge_trustors');
    if (bAll) bAll.textContent = all.length;
    if (bTrustees) bTrustees.textContent = all.filter(function(o){ return o.relationship === 'Trustee'; }).length;
    if (bTrustors) bTrustors.textContent = all.filter(function(o){ return o.relationship === 'Owner' || o.relationship === 'Trustor'; }).length;
  }

  /* ─── Apply Redesign ─── */
  function applyAuthorgRedesign() {
    if (window.SNAP) { window.SNAP.authorg = renderAuthorgHtml(); }
    if (window.APP && window.APP.page === 'authorg') {
      var cnt = document.getElementById('cnt');
      if (cnt) { cnt.innerHTML = renderAuthorgHtml(); applyColumnStyles(); }
    }
  }

  applyAuthorgRedesign();
  setTimeout(applyAuthorgRedesign, 100);
  setTimeout(applyAuthorgRedesign, 400);
  loadTrustsFromApi();

  /* ═══════════════════════════════════════════
     GLOBAL WINDOW FUNCTIONS
     ═══════════════════════════════════════════ */

  /* ─── Copy UUID ─── */
  window.authorgCopy = function(text) {
    if (navigator && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); }
    showToast('Copied Org UUID: <b>' + text + '</b>');
  };

  /* ─── Search ─── */
  window.authorgSearch = function(q) { filtersState.search = q; pageState.current = 1; authorgApplyFilters(); };

  /* ─── Tab Switching ─── */
  window.authorgTab = function(el, type) {
    var p = el.parentElement;
    if (p) { p.querySelectorAll('.tb').forEach(function(t){ t.classList.remove('on'); }); el.classList.add('on'); }
    filtersState.tab = type;
    pageState.current = 1;

    if (type === 'audit') {
      renderAuditLogTab();
    } else { authorgApplyFilters(); }
  };

  /* ─── Trust Audit Log tab: live from the API, static fallback if offline ─── */
  function staticAuditRows() {
    return '<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9"><span style="color:#64748b;min-width:130px">Today 09:14</span><b style="color:#0f172a;min-width:160px">MCM Retail Ireland</b><span style="color:#059669;font-weight:600">Delegated Admin Login</span><span style="color:#64748b">User fkhan@mcmgroup.com assumed role Contact Centre Admin in UK Retail</span></div>' +
      '<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9"><span style="color:#64748b;min-width:130px">18 Jul 2026</span><b style="color:#0f172a;min-width:160px">Vertex Consulting</b><span style="color:#dc2626;font-weight:600">Trust Revoked</span><span style="color:#64748b">Access window expired and permissions purged by Master Admin</span></div>' +
      '<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9"><span style="color:#64748b;min-width:130px">14 Jun 2026</span><b style="color:#0f172a;min-width:160px">Cloudline Partners</b><span style="color:#2563eb;font-weight:600">Scope Modified</span><span style="color:#64748b">Scoped down to Read-only Admin for UK Digital Division</span></div>';
  }

  function apiAuditRows(logs) {
    return logs.map(function(a) {
      var when = new Date(a.timestamp);
      var whenLabel = isNaN(when.getTime()) ? a.timestamp : (fmtDMY(when) + ' ' + when.toTimeString().slice(0, 5));
      return '<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9">' +
        '<span style="color:#64748b;min-width:130px">' + whenLabel + '</span>' +
        '<b style="color:#0f172a;min-width:160px">' + (a.org_domain || '—') + '</b>' +
        '<span style="color:#334155">' + a.action_text + '</span>' +
        '<span style="color:#64748b;margin-left:auto">' + a.actor_name + '</span>' +
        '</div>';
    }).join('');
  }

  function renderAuditLogTab() {
    var tb4 = document.getElementById('authorg_tb');
    if (!tb4) return;
    var wrap = function(rowsHtml) {
      return '<tr><td colspan="9" style="padding:18px 24px">' +
        '<div style="font-weight:700;font-size:13px;margin-bottom:12px;color:#0f172a;display:flex;align-items:center;gap:6px">' + ICONS.shield + ' Recent Multi-Tenant Trust Audit Trail</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;font-size:12.5px">' + rowsHtml + '</div>' +
      '</td></tr>';
    };
    tb4.innerHTML = wrap(staticAuditRows());
    fetch(API_BASE + '/audit-logs')
      .then(function(res) { if (!res.ok) throw new Error('bad status'); return res.json(); })
      .then(function(logs) {
        if (!logs || !logs.length) return;
        var tb = document.getElementById('authorg_tb');
        if (tb && filtersState.tab === 'audit') tb.innerHTML = wrap(apiAuditRows(logs));
      })
      .catch(function() {
        // Backend offline — the static rows rendered above stay in place.
      });
  }

  /* ─── Sorting ─── */
  window.authorgSort = function(colKey) {
    if (sortState.col === colKey) {
      if (sortState.dir === 'asc') sortState.dir = 'desc';
      else if (sortState.dir === 'desc') { sortState.col = null; sortState.dir = null; }
    } else {
      sortState.col = colKey;
      sortState.dir = 'asc';
    }
    updateSortIcons();
    authorgApplyFilters();
  };

  /* ─── Checkbox Selection ─── */
  window.authorgToggleAll = function(chk) {
    var tb = document.getElementById('authorg_tb');
    if (tb) {
      tb.querySelectorAll('input[type="checkbox"][data-orgchk]').forEach(function(c){
        c.checked = chk.checked;
        var oid = c.getAttribute('data-orgchk');
        if (chk.checked) selectedIds[oid] = true;
        else delete selectedIds[oid];
      });
    }
    updateBulkBar();
  };

  window.authorgOnCheckRow = function(chk, orgId) {
    if (chk.checked) selectedIds[orgId] = true;
    else delete selectedIds[orgId];
    // Update header checkbox state
    var allChks = document.querySelectorAll('#authorg_tb input[type="checkbox"][data-orgchk]');
    var allChecked = true;
    allChks.forEach(function(c){ if (!c.checked) allChecked = false; });
    var headerChk = document.getElementById('authorg_chk_all');
    if (headerChk) headerChk.checked = allChecked && allChks.length > 0;
    updateBulkBar();
  };

  function updateBulkBar() {
    var ids = Object.keys(selectedIds);
    var bar = document.getElementById('authorg_bulk_bar');
    var cnt = document.getElementById('authorg_bulk_count');
    if (bar) bar.style.display = ids.length > 0 ? 'flex' : 'none';
    if (cnt) cnt.textContent = ids.length + ' selected';
  }

  /* ─── Bulk Actions ─── */
  window.authorgBulkExtend = function() {
    var ids = Object.keys(selectedIds);
    if (!ids.length) return;
    showConfirm('Extend Trust', 'Extend trust validity by 90 days for <b>' + ids.length + '</b> selected organizations?', 'Extend All', '#059669', function() {
      ids.forEach(function(id) { AuthOrgService.update(id, { expiry: '14 Nov 2026', expiryDate: new Date('2026-11-14'), expiryDays: 'Valid for 91 days', isExpiring: false, status: 'Active', statusClass: 'status-active' }); });
      selectedIds = {};
      var hc = document.getElementById('authorg_chk_all'); if (hc) hc.checked = false;
      authorgApplyFilters();
      showToast('Extended trust for <b>' + ids.length + '</b> organizations by 90 days');
    });
  };

  window.authorgBulkRevoke = function() {
    var ids = Object.keys(selectedIds);
    if (!ids.length) return;
    showConfirm('Revoke Trust', 'Are you sure you want to <b>revoke trust</b> for <b>' + ids.length + '</b> selected organizations? This action cannot be undone.', 'Revoke All', '#dc2626', function() {
      ids.forEach(function(id) { AuthOrgService.update(id, { status: 'Revoked', statusClass: 'status-revoked', expiry: 'Terminated', expiryDays: 'Revoked on ' + new Date().toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}), isExpiring: false }); });
      selectedIds = {};
      var hc = document.getElementById('authorg_chk_all'); if (hc) hc.checked = false;
      authorgApplyFilters();
      showToast('Revoked trust for <b>' + ids.length + '</b> organizations');
    });
  };

  window.authorgBulkExportSelected = function() {
    var ids = Object.keys(selectedIds);
    if (!ids.length) return;
    var sel = AuthOrgService.getAll().filter(function(o){ return ids.indexOf(o.id) > -1; });
    exportCSV(sel);
    showToast('Exported <b>' + sel.length + '</b> selected trust relationships to CSV');
  };

  /* ─── Refresh ─── */
  window.authorgRefresh = function() {
    filtersState = { tab: 'all', search: '', division: 'All', status: 'Any' };
    sortState = { col: null, dir: null };
    pageState.current = 1;
    selectedIds = {};

    var s = document.getElementById('authorg_search'); if (s) s.value = '';
    var lDiv = document.getElementById('authorg_lbl_div'); if (lDiv) lDiv.textContent = 'All';
    var lStat = document.getElementById('authorg_lbl_stat'); if (lStat) lStat.textContent = 'Any';
    var hc = document.getElementById('authorg_chk_all'); if (hc) hc.checked = false;

    var tabs = document.querySelectorAll('.phd .tabs .tb');
    if (tabs && tabs.length) { tabs.forEach(function(t){ t.classList.remove('on'); }); tabs[0].classList.add('on'); }

    updateSortIcons();
    authorgApplyFilters();
    showToast('Authorized Organizations refreshed');
  };

  /* ─── Pagination ─── */
  window.authorgPagePrev = function() { if (pageState.current > 1) { pageState.current--; authorgApplyFilters(); } };
  window.authorgPageNext = function() {
    var total = AuthOrgService.getAll().length;
    var maxPage = Math.ceil(total / pageState.size);
    if (pageState.current < maxPage) { pageState.current++; authorgApplyFilters(); }
  };
  window.authorgSetPageSize = function(size) {
    pageState.size = size;
    pageState.current = 1;
    authorgApplyFilters();
    var old = document.getElementById('authorg_rpp_menu'); if (old) old.remove();
  };
  window.authorgOpenRppDropdown = function(el) {
    var old = document.getElementById('authorg_rpp_menu'); if (old) { old.remove(); return; }
    var parent = el.closest('.authorg-rpp') || el.parentElement;
    parent.style.position = 'relative';

    var menu = document.createElement('div');
    menu.id = 'authorg_rpp_menu';
    menu.className = 'authorg-dropdown-menu';
    menu.style.cssText = 'position:absolute;bottom:calc(100% + 5px);top:auto;right:0;left:auto;min-width:80px;';
    menu.onclick = function(ev){ ev.stopPropagation(); };

    [10, 25, 50, 9999].forEach(function(sz) {
      var label = sz >= 9999 ? 'All' : sz;
      var isActive = pageState.size === sz;
      menu.innerHTML += '<div class="authorg-dropdown-item ' + (isActive ? 'selected' : '') + '" onclick="authorgSetPageSize(' + sz + ')"><span>' + label + '</span></div>';
    });
    parent.appendChild(menu);
    setTimeout(function() {
      function onDocClick(e) {
        if (!menu.contains(e.target) && !el.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', onDocClick);
          window.removeEventListener('scroll', onDocClick, true);
        }
      }
      document.addEventListener('click', onDocClick);
      window.addEventListener('scroll', onDocClick, true);
    }, 10);
  };

  /* ─── Division / Status Dropdown ─── */
  window.authorgOpenDropdown = function(type, chipEl) {
    var old = document.getElementById('authorg_dropdown_menu');
    if (old) {
      var oldType = old.getAttribute('data-type');
      old.remove();
      document.querySelectorAll('.authorg-chip').forEach(function(c){ c.classList.remove('active'); });
      if (oldType === type) return;
    }
    chipEl.classList.add('active');

    var menu = document.createElement('div');
    menu.id = 'authorg_dropdown_menu';
    menu.className = 'authorg-dropdown-menu';
    menu.setAttribute('data-type', type);
    menu.onclick = function(ev){ ev.stopPropagation(); };

    var options = [];
    var currentVal = '';
    if (type === 'div') { options = ['All', 'Partner — Manila', 'UK Digital', 'UK Retail, IE Retail']; currentVal = filtersState.division; }
    else if (type === 'status') { options = ['All', 'Active', 'Expiring soon', 'Owner', 'Revoked']; currentVal = filtersState.status; }

    menu.innerHTML = options.map(function(opt) {
      var isSelected = (opt === currentVal) || (opt === 'All' && (currentVal === 'All' || currentVal === 'Any'));
      return '<div class="authorg-dropdown-item ' + (isSelected ? 'selected' : '') + '" onclick="authorgSelectFilterOption(\\'' + type + '\\', \\'' + opt.replace(/'/g,"\\\\'") + '\\')"><span>' + opt + '</span></div>';
    }).join('');

    chipEl.appendChild(menu);
    setTimeout(function() {
      function onDocClick(e) {
        if (!menu.contains(e.target) && !chipEl.contains(e.target)) {
          menu.remove();
          chipEl.classList.remove('active');
          document.removeEventListener('click', onDocClick);
          window.removeEventListener('scroll', onDocClick, true);
        }
      }
      document.addEventListener('click', onDocClick);
      window.addEventListener('scroll', onDocClick, true);
    }, 10);
  };

  window.authorgSelectFilterOption = function(type, val) {
    var menu = document.getElementById('authorg_dropdown_menu'); if (menu) menu.remove();
    document.querySelectorAll('.authorg-chip').forEach(function(c){ c.classList.remove('active'); });
    if (type === 'div') { filtersState.division = val; var lDiv = document.getElementById('authorg_lbl_div'); if (lDiv) lDiv.textContent = val; }
    else if (type === 'status') { filtersState.status = val === 'All' ? 'Any' : val; var lStat = document.getElementById('authorg_lbl_stat'); if (lStat) lStat.textContent = val === 'All' ? 'Any' : val; }
    pageState.current = 1;
    authorgApplyFilters();
  };

  /* ─── Columns Modal (Side Popover) ─── */
  window.authorgOpenColumnsModal = function(btnEl) {
    var old = document.getElementById('authorg_col_scrim');
    if (old) { old.remove(); return; }

    var scrim = document.createElement('div');
    scrim.id = 'authorg_col_scrim';
    scrim.className = 'authorg-modal-scrim';
    scrim.onclick = function(){ scrim.remove(); };

    var card = document.createElement('div');
    card.className = 'authorg-modal-card';
    card.onclick = function(e){ e.stopPropagation(); };

    var wrap = document.querySelector('.authorg-wrap') || document.querySelector('.authorg-table-wrap');
    if (wrap) {
      var wrapRect = wrap.getBoundingClientRect();
      card.style.right = Math.max(16, window.innerWidth - wrapRect.right) + 'px';
    } else {
      card.style.right = '24px';
    }

    if (btnEl && btnEl.getBoundingClientRect) {
      var rect = btnEl.getBoundingClientRect();
      card.style.top = (rect.bottom + 6) + 'px';
    } else {
      card.style.top = '190px';
    }

    var columnsList = [
      { key: 'chk', label: 'Column 1' }, { key: 'org', label: 'Organization' }, { key: 'uuid', label: 'Org ID' },
      { key: 'rel', label: 'Relationship' }, { key: 'roles', label: 'Scope (roles)' }, { key: 'divs', label: 'Divisions' },
      { key: 'exp', label: 'Expires' }, { key: 'stat', label: 'Status' }, { key: 'act', label: 'Column 9' }
    ];

    card.innerHTML = '<div class="authorg-modal-header"><h3>Columns</h3><button class="authorg-modal-close" onclick="document.getElementById(\\'authorg_col_scrim\\').remove()">' + ICONS.x + '</button></div>' +
    '<div class="authorg-modal-body">' +
      columnsList.map(function(col) {
        return '<label class="authorg-col-item"><input type="checkbox" data-colkey="' + col.key + '" ' + (columnState[col.key] !== false ? 'checked' : '') + ' onchange="authorgToggleColumn(\\'' + col.key + '\\', this.checked)"><span>' + col.label + '</span></label>';
      }).join('') +
    '</div>' +
    '<div class="authorg-modal-footer"><button class="authorg-btn-done" onclick="document.getElementById(\\'authorg_col_scrim\\').remove()">Done</button></div>';

    scrim.appendChild(card);
    document.body.appendChild(scrim);

    // Auto-close on scroll
    function onColScrollClose() {
      var sc = document.getElementById('authorg_col_scrim');
      if (sc) sc.remove();
      window.removeEventListener('scroll', onColScrollClose, true);
    }
    window.addEventListener('scroll', onColScrollClose, true);
  };

  window.authorgToggleColumn = function(colKey, isVisible) { columnState[colKey] = isVisible; applyColumnStyles(); };

  /* ─── 3-Dots Context Menu ─── */
  window.authorgOpenCtxMenu = function(e, orgId) {
    e.stopPropagation();
    var old = document.getElementById('authorg_ctx_menu'); if (old) old.remove();
    var org = AuthOrgService.getById(orgId);
    if (!org) return;

    var menu = document.createElement('div');
    menu.id = 'authorg_ctx_menu';
    menu.className = 'authorg-ctx-menu';
    var rect = e.target.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';

    var items = [
      { icon: ICONS.eye, label: 'View Details', action: 'authorgViewDrawer(\\'' + orgId + '\\')' },
      { icon: ICONS.edit, label: 'Edit Organization', action: 'authorgEditDrawer(\\'' + orgId + '\\')' }
    ];

    if (org.status === 'Active' || org.isExpiring) {
      items.push({ icon: ICONS.clock, label: 'Extend Trust (90 days)', action: 'authorgExtendConfirm(\\'' + orgId + '\\')' });
      items.push({ divider: true });
      items.push({ icon: ICONS.trash, label: 'Revoke Trust', action: 'authorgRevokeConfirm(\\'' + orgId + '\\')', danger: true });
    } else if (org.status === 'Revoked') {
      items.push({ icon: ICONS.refresh, label: 'Reactivate Trust', action: 'authorgReactivateConfirm(\\'' + orgId + '\\')' });
      items.push({ divider: true });
      items.push({ icon: ICONS.trash, label: 'Delete Permanently', action: 'authorgDeleteConfirm(\\'' + orgId + '\\')', danger: true });
    }

    menu.innerHTML = items.map(function(it) {
      if (it.divider) return '<div class="authorg-ctx-divider"></div>';
      return '<div class="authorg-ctx-item' + (it.danger ? ' danger' : '') + '" onclick="' + it.action + ';document.getElementById(\\'authorg_ctx_menu\\').remove()"><span class="authorg-ctx-icon">' + it.icon + '</span><span>' + it.label + '</span></div>';
    }).join('');

    document.body.appendChild(menu);
    setTimeout(function() {
      function onDocClick(e) { var m = document.getElementById('authorg_ctx_menu'); if (m && !m.contains(e.target)) { m.remove(); document.removeEventListener('click', onDocClick); } }
      document.addEventListener('click', onDocClick);
    }, 10);
  };

  /* ─── CRUD Operations (with confirmation) ─── */
  window.authorgExtendConfirm = function(id) {
    var org = AuthOrgService.getById(id); if (!org) return;
    showConfirm('Extend Trust', 'Extend trust validity for <b>' + org.name + '</b> by 90 days?', 'Extend', '#059669', function() {
      AuthOrgService.update(id, { expiry: '14 Nov 2026', expiryDate: new Date('2026-11-14'), expiryDays: 'Valid for 91 days', isExpiring: false, status: 'Active', statusClass: 'status-active' });
      authorgApplyFilters();
      showToast('Extended trust for <b>' + org.name + '</b> by 90 days');
    });
  };

  window.authorgRevokeConfirm = function(id) {
    var org = AuthOrgService.getById(id); if (!org) return;
    showConfirm('Revoke Trust', 'Are you sure you want to <b>revoke all access</b> for <b>' + org.name + '</b>? Their delegated permissions will be immediately terminated.', 'Revoke Trust', '#dc2626', function() {
      var now = new Date();
      AuthOrgService.update(id, { status: 'Revoked', statusClass: 'status-revoked', expiry: 'Terminated', expiryDays: 'Revoked on ' + now.toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}), isExpiring: false });
      authorgApplyFilters();
      showToast('Trust revoked for <b>' + org.name + '</b>');
    });
  };

  window.authorgReactivateConfirm = function(id) {
    var org = AuthOrgService.getById(id); if (!org) return;
    showConfirm('Reactivate Trust', 'Reactivate trust relationship for <b>' + org.name + '</b>? They will regain their previously assigned delegated permissions.', 'Reactivate', '#059669', function() {
      AuthOrgService.update(id, { status: 'Active', statusClass: 'status-active', expiry: '31 Dec 2026', expiryDate: new Date('2026-12-31'), expiryDays: 'Valid for 138 days', isExpiring: false });
      authorgApplyFilters();
      showToast('Trust reactivated for <b>' + org.name + '</b>');
    });
  };

  window.authorgDeleteConfirm = function(id) {
    var org = AuthOrgService.getById(id); if (!org) return;
    showConfirm('Delete Permanently', 'Permanently delete the trust record for <b>' + org.name + '</b>? This action <b>cannot be undone</b>.', 'Delete Forever', '#dc2626', function() {
      AuthOrgService.remove(id);
      delete selectedIds[id];
      authorgApplyFilters();
      showToast('Trust record for <b>' + org.name + '</b> permanently deleted');
    });
  };

  /* Backward compat (called from drawers) */
  window.authorgExtend = function(id) {
    AuthOrgService.update(id, { expiry: '14 Nov 2026', expiryDate: new Date('2026-11-14'), expiryDays: 'Valid for 91 days', isExpiring: false, status: 'Active', statusClass: 'status-active' });
    authorgApplyFilters();
  };
  window.authorgReactivate = function(id) {
    AuthOrgService.update(id, { status: 'Active', statusClass: 'status-active', expiry: '31 Dec 2026', expiryDate: new Date('2026-12-31'), expiryDays: 'Valid for 138 days', isExpiring: false });
    authorgApplyFilters();
  };
  window.authorgDelete = function(id) { AuthOrgService.remove(id); delete selectedIds[id]; authorgApplyFilters(); };

  /* ─── Export CSV ─── */
  function exportCSV(data) {
    var csv = 'Organization Name,Org ID,Relationship,Roles,Divisions,Expiration,Status\\n' +
      data.map(function(o){ return '"' + o.name + '","' + o.uuid + '","' + o.relationship + '","' + o.roles.join(';') + '","' + o.divisions.join(';') + '","' + o.expiry + '","' + o.status + '"'; }).join('\\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'authorized_organizations_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
  }

  window.authorgExport = function() {
    exportCSV(AuthOrgService.getAll());
    showToast('Exported ' + AuthOrgService.getAll().length + ' trust relationships to CSV');
  };

  /* ─── View Org Details Drawer ─── */
  window.authorgViewDrawer = function(id) {
    var org = AuthOrgService.getById(id);
    if (!org) return;
    // Close ctx menu if open
    var cm = document.getElementById('authorg_ctx_menu'); if (cm) cm.remove();

    var scrim = document.createElement('div');
    scrim.id = 'authorg_drw_scrim';
    scrim.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:9100;backdrop-filter:blur(2px)';
    scrim.onclick = function(){ scrim.remove(); };

    var d = document.createElement('div');
    d.id = 'authorg_drw';
    d.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:540px;background:#ffffff;z-index:9200;display:flex;flex-direction:column;box-shadow:-8px 0 30px rgba(15,23,42,0.18);font-family:inherit;animation:authorgSlideIn .2s ease';
    d.onclick = function(e){ e.stopPropagation(); };

    d.innerHTML = '<div style="padding:18px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;background:#f8fafc">' +
      '<div>' +
        '<h2 style="margin:0;font-size:16px;font-weight:700;color:#0f172a">' + org.name + '</h2>' +
        '<span style="font-size:12px;color:#64748b">' + org.domain + '</span>' +
      '</div>' +
      '<button onclick="document.getElementById(\\'authorg_drw_scrim\\').remove()" style="margin-left:auto;border:none;background:transparent;cursor:pointer;font-size:16px;color:#64748b;padding:4px 8px;border-radius:6px;display:flex;align-items:center">' + ICONS.x + '</button>' +
    '</div>' +
    '<div style="flex:1;overflow-y:auto;padding:22px 24px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#f1f5f9;border-radius:8px;margin-bottom:20px">' +
        '<div><span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Relationship Type</span><div style="margin-top:2px"><b style="color:#0f172a;font-size:14px">' + org.relationship + '</b> · ' + org.direction + '</div></div>' +
        '<span class="authorg-status ' + org.statusClass + '"><span class="dot"></span>' + org.status + '</span>' +
      '</div>' +
      '<div class="authorg-drawer-section">' +
        '<div class="authorg-drawer-title">' + ICONS.shield + ' Organization Metadata</div>' +
        '<div class="authorg-meta-row"><span class="authorg-meta-label">Organization UUID</span><span class="authorg-meta-val" style="font-family:monospace">' + org.uuid + '</span></div>' +
        '<div class="authorg-meta-row"><span class="authorg-meta-label">Assigned Divisions</span><span class="authorg-meta-val">' + org.divisions.join(', ') + '</span></div>' +
        '<div class="authorg-meta-row"><span class="authorg-meta-label">Trust Validity Expiry</span><span class="authorg-meta-val">' + org.expiry + ' (' + org.expiryDays + ')</span></div>' +
      '</div>' +
      '<div class="authorg-drawer-section">' +
        '<div class="authorg-drawer-title"><span style="display:inline-flex;margin-right:4px">' + ICONS.sliders + '</span> Delegated Roles & Scopes</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">' +
          org.roles.map(function(r){ return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;font-size:12.5px"><span style="display:flex;align-items:center">' + ICONS.check + '</span><b>' + r + '</b> <span style="margin-left:auto;color:#64748b;font-size:11.5px">Scoped to ' + org.divisions.join(', ') + '</span></div>'; }).join('') +
        '</div>' +
      '</div>' +
      '<div class="authorg-drawer-section">' +
        '<div class="authorg-drawer-title"><span style="display:inline-flex;margin-right:4px">' + ICONS.book + '</span> Security Context & Notes</div>' +
        '<p style="margin:0;font-size:12.5px;color:#334155;line-height:1.6">' + org.note + '</p>' +
      '</div>' +
    '</div>' +
    '<div style="padding:14px 24px;border-top:1px solid #e2e8f0;display:flex;gap:10px;justify-content:flex-end;background:#f8fafc">' +
      '<button onclick="document.getElementById(\\'authorg_drw_scrim\\').remove();authorgEditDrawer(\\'' + org.id + '\\')" class="btn sec"><span style="display:inline-flex;margin-right:4px">' + ICONS.edit + '</span> Edit</button>' +
      (org.status === 'Active' || org.isExpiring
        ? '<button onclick="authorgExtend(\\'' + org.id + '\\');document.getElementById(\\'authorg_drw_scrim\\').remove()" class="btn sec"><span style="display:inline-flex;margin-right:4px">' + ICONS.clock + '</span> Extend 90 Days</button><button onclick="document.getElementById(\\'authorg_drw_scrim\\').remove();authorgRevokeConfirm(\\'' + org.id + '\\')" class="btn" style="background:#dc2626">Revoke Trust</button>'
        : '<button onclick="authorgReactivate(\\'' + org.id + '\\');document.getElementById(\\'authorg_drw_scrim\\').remove()" class="btn">Reactivate Trust</button>'
      ) +
    '</div>';

    document.body.appendChild(scrim);
    scrim.appendChild(d);
  };

  /* ─── Edit Org Drawer ─── */
  window.authorgEditDrawer = function(id) {
    var org = AuthOrgService.getById(id);
    if (!org) return;
    var cm = document.getElementById('authorg_ctx_menu'); if (cm) cm.remove();

    var scrim = document.createElement('div');
    scrim.id = 'authorg_edit_scrim';
    scrim.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:9100;backdrop-filter:blur(2px)';
    scrim.onclick = function(){ scrim.remove(); };

    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:540px;background:#ffffff;z-index:9200;display:flex;flex-direction:column;box-shadow:-8px 0 30px rgba(15,23,42,0.18);font-family:inherit;animation:authorgSlideIn .2s ease';
    d.onclick = function(e){ e.stopPropagation(); };

    var rolesCheckboxes = AVAILABLE_ROLES.map(function(r) {
      var checked = org.roles.indexOf(r) > -1 ? ' checked' : '';
      return '<label class="authorg-checkbox-label"><input type="checkbox" class="authorg-custom-chk authorg-edit-role"' + checked + ' value="' + r + '"><span class="authorg-chk-text">' + r + '</span></label>';
    }).join('');

    var divsCheckboxes = AVAILABLE_DIVISIONS.map(function(dv) {
      var checked = org.divisions.indexOf(dv) > -1 ? ' checked' : '';
      return '<label class="authorg-checkbox-label"><input type="checkbox" class="authorg-custom-chk authorg-edit-div"' + checked + ' value="' + dv + '"><span class="authorg-chk-text">' + dv + '</span></label>';
    }).join('');

    d.innerHTML = '<div style="padding:18px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;background:#f8fafc">' +
      '<div><h2 style="margin:0;font-size:16px;font-weight:700;color:#0f172a">Edit Organization</h2><span style="font-size:12px;color:#64748b">' + org.name + '</span></div>' +
      '<button onclick="document.getElementById(\\'authorg_edit_scrim\\').remove()" style="margin-left:auto;border:none;background:transparent;cursor:pointer;font-size:16px;color:#64748b;padding:4px 8px;border-radius:6px;display:flex;align-items:center">' + ICONS.x + '</button>' +
    '</div>' +
    '<div style="flex:1;overflow-y:auto;padding:22px 24px">' +
      '<div class="fld"><label>Organization Name *</label><input id="edit_authorg_name" value="' + org.name + '"></div>' +
      '<div class="fld"><label>Organization Domain</label><input id="edit_authorg_domain" value="' + org.domain + '"></div>' +
      '<div class="fld"><label>Relationship Type</label><select id="edit_authorg_rel"><option value="Trustee"' + (org.relationship === 'Trustee' ? ' selected' : '') + '>Trustee (Delegate access TO them)</option><option value="Trustor"' + (org.relationship === 'Trustor' ? ' selected' : '') + '>Trustor (Request access FROM them)</option><option value="Owner"' + (org.relationship === 'Owner' ? ' selected' : '') + '>Owner (Root organization)</option></select></div>' +
      '<div class="fld"><label>Delegated Role Scopes</label><div class="authorg-checkbox-list">' + rolesCheckboxes + '</div></div>' +
      '<div class="fld"><label>Assigned Division Scopes</label><div class="authorg-checkbox-list">' + divsCheckboxes + '</div></div>' +
      '<div class="fld"><label>Security Notes</label><textarea id="edit_authorg_note">' + org.note + '</textarea></div>' +
    '</div>' +
    '<div style="padding:14px 24px;border-top:1px solid #e2e8f0;display:flex;gap:10px;justify-content:flex-end;background:#f8fafc">' +
      '<button onclick="document.getElementById(\\'authorg_edit_scrim\\').remove()" class="btn sec">Cancel</button>' +
      '<button onclick="authorgSaveEdit(\\'' + id + '\\')" class="btn">Save Changes</button>' +
    '</div>';

    document.body.appendChild(scrim);
    scrim.appendChild(d);
  };

  window.authorgSaveEdit = function(id) {
    var nameEl = document.getElementById('edit_authorg_name');
    var domainEl = document.getElementById('edit_authorg_domain');
    var relEl = document.getElementById('edit_authorg_rel');
    var noteEl = document.getElementById('edit_authorg_note');

    var name = nameEl ? nameEl.value.trim() : '';
    if (!name || name.length < 2) { showToast('Please enter a valid Organization Name (min 2 characters)'); if (nameEl) nameEl.style.borderColor = '#dc2626'; return; }

    var roles = [];
    document.querySelectorAll('.authorg-edit-role:checked').forEach(function(c){ roles.push(c.value); });
    if (!roles.length) { showToast('Please select at least one role'); return; }

    var divs = [];
    document.querySelectorAll('.authorg-edit-div:checked').forEach(function(c){ divs.push(c.value); });
    if (!divs.length) { showToast('Please select at least one division'); return; }

    var rel = relEl ? relEl.value : 'Trustee';
    var direction = rel === 'Owner' ? 'Root Organization' : (rel === 'Trustor' ? 'Outbound Request' : 'Inbound Access');

    AuthOrgService.update(id, {
      name: name,
      domain: domainEl ? domainEl.value.trim() : '',
      relationship: rel,
      direction: direction,
      roles: roles,
      divisions: divs,
      note: noteEl ? noteEl.value.trim() : ''
    });

    var scrim = document.getElementById('authorg_edit_scrim');
    if (scrim) scrim.remove();
    authorgApplyFilters();
    showToast('Organization <b>' + name + '</b> updated successfully');
  };

  /* ─── Authorize New Org Drawer ─── */
  window.authorgAddDrawer = function() {
    var scrim = document.createElement('div');
    scrim.id = 'authorg_add_scrim';
    scrim.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:9100;backdrop-filter:blur(2px)';
    scrim.onclick = function(){ scrim.remove(); };

    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:520px;background:#ffffff;z-index:9200;display:flex;flex-direction:column;box-shadow:-8px 0 30px rgba(15,23,42,0.18);font-family:inherit;animation:authorgSlideIn .2s ease';
    d.onclick = function(e){ e.stopPropagation(); };

    d.innerHTML = '<div style="padding:18px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;background:#f8fafc">' +
      '<div><h2 style="margin:0;font-size:16px;font-weight:700;color:#0f172a">Authorize New Organization</h2><span style="font-size:12px;color:#64748b">Establish a new multi-tenant trust relationship</span></div>' +
      '<button onclick="document.getElementById(\\'authorg_add_scrim\\').remove()" style="margin-left:auto;border:none;background:transparent;cursor:pointer;font-size:16px;color:#64748b;padding:4px 8px;border-radius:6px;display:flex;align-items:center">' + ICONS.x + '</button>' +
    '</div>' +
    '<div style="flex:1;overflow-y:auto;padding:22px 24px">' +
      '<div class="fld"><label>Target Organization Name *</label><input id="new_authorg_name" placeholder="e.g. Apex Global Logistics"></div>' +
      '<div class="fld"><label>Target Organization UUID / ID</label><input id="new_authorg_uuid" placeholder="e.g. 5d91e320-c8f0-4a81-9b12-0019284102ff"><div class="authorg-field-hint" id="new_uuid_hint"></div></div>' +
      '<div class="fld"><label>Relationship Type</label><select id="new_authorg_rel"><option value="Trustee">Trustee (Delegate access TO them)</option><option value="Trustor">Trustor (Request access FROM them)</option></select></div>' +
      '<div class="fld"><label>Delegated Role Scopes</label><select id="new_authorg_role"><option>Contact Centre Admin</option><option>Supervisor</option><option>Agent</option><option>Read-only Admin</option><option>Implementation</option></select></div>' +
      '<div class="fld"><label>Assigned Division Scope</label><select id="new_authorg_div"><option>UK Retail</option><option>UK Digital</option><option>UK Collections</option><option>IE Retail</option><option>Partner — Manila</option><option>All</option></select></div>' +
      '<div class="fld"><label>Trust Validity Duration</label><select id="new_authorg_dur"><option value="90">90 Days (Recommended for partners)</option><option value="180">180 Days (Half Year)</option><option value="365">365 Days (1 Year)</option></select></div>' +
    '</div>' +
    '<div style="padding:14px 24px;border-top:1px solid #e2e8f0;display:flex;gap:10px;justify-content:flex-end;background:#f8fafc">' +
      '<button onclick="document.getElementById(\\'authorg_add_scrim\\').remove()" class="btn sec">Cancel</button>' +
      '<button onclick="authorgSubmitNew()" class="btn">Send Trust Invitation</button>' +
    '</div>';

    document.body.appendChild(scrim);
    scrim.appendChild(d);
  };

  window.authorgSubmitNew = function() {
    var nameEl = document.getElementById('new_authorg_name');
    var uuidEl = document.getElementById('new_authorg_uuid');
    var hintEl = document.getElementById('new_uuid_hint');
    var name = nameEl ? nameEl.value.trim() : '';
    var uuid = uuidEl ? uuidEl.value.trim() : '';

    // Validate name
    if (!name || name.length < 2) {
      showToast('Please enter a valid Organization Name (minimum 2 characters)');
      if (nameEl) { nameEl.style.borderColor = '#dc2626'; nameEl.focus(); }
      return;
    }
    if (nameEl) nameEl.style.borderColor = '';

    // Check duplicate name
    var dup = AuthOrgService.getAll().filter(function(o){ return o.name.toLowerCase() === name.toLowerCase(); });
    if (dup.length > 0) {
      showToast('An organization with the name <b>' + name + '</b> already exists');
      if (nameEl) { nameEl.style.borderColor = '#dc2626'; nameEl.focus(); }
      return;
    }

    // Validate UUID format if provided
    if (uuid) {
      var uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(uuid)) {
        showToast('Invalid UUID format. Expected: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
        if (uuidEl) { uuidEl.style.borderColor = '#dc2626'; uuidEl.focus(); }
        if (hintEl) { hintEl.textContent = 'Invalid UUID format'; hintEl.style.color = '#dc2626'; }
        return;
      }
    }
    if (uuidEl) uuidEl.style.borderColor = '';
    if (hintEl) hintEl.textContent = '';

    var genUuid = uuid || (Math.random().toString(16).slice(2,10) + '-' + Math.random().toString(16).slice(2,6) + '-4' + Math.random().toString(16).slice(2,5) + '-' + Math.random().toString(16).slice(2,6) + '-' + Math.random().toString(16).slice(2,14));
    var durDays = parseInt(document.getElementById('new_authorg_dur').value) || 90;
    var expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + durDays);
    var expiryStr = expiryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    var relVal = document.getElementById('new_authorg_rel').value;

    var newOrg = {
      id: 'org_' + Math.random().toString(36).slice(2,7),
      name: name,
      domain: name.toLowerCase().replace(/[^a-z0-9]/g,'') + '.mcmcloudcx.com',
      uuid: genUuid,
      uuidShort: genUuid.slice(0,4) + '...' + genUuid.slice(-3),
      relationship: relVal,
      direction: relVal === 'Trustor' ? 'Outbound Request' : 'Inbound Access',
      roles: [document.getElementById('new_authorg_role').value],
      divisions: [document.getElementById('new_authorg_div').value],
      expiry: expiryStr,
      expiryDate: expiryDate,
      expiryDays: 'Valid for ' + durDays + ' days',
      isExpiring: false,
      status: 'Active',
      statusClass: 'status-active',
      note: 'Newly authorized multi-tenant trust relationship.',
      createdAt: new Date()
    };

    AuthOrgService.create(newOrg);
    authorgApplyFilters();
    var scrim = document.getElementById('authorg_add_scrim');
    if (scrim) scrim.remove();
    showToast('Trust relationship initiated for <b>' + name + '</b>');
  };

  /* ─── Help Toggle ─── */
  window.authorgToggleHelp = function() {
    var b = document.getElementById('authorg_help_body');
    var txt = document.getElementById('authorg_help_toggle_text');
    var ico = document.getElementById('authorg_help_toggle_icon');
    if (!b) return;
    if (b.style.display === 'none') { b.style.display = 'grid'; if (txt) txt.textContent = 'Hide'; if (ico) ico.textContent = '▴'; }
    else { b.style.display = 'none'; if (txt) txt.textContent = 'Show'; if (ico) ico.textContent = '▾'; }
  };

})();
`;
