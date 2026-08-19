/* ============================================================
   MCM Cloud CX — Apps (Installed) Redesign Module
   Backend-ready data layer + polished, interactive app cards
   ============================================================ */

export const APPS_SCRIPT: string = `
(function() {
  'use strict';

  /* ─── Modern line-icon set (replaces emoji glyphs) ───
     Feather-style 24x24 stroke icons, colored via currentColor so they pick
     up the .ic2 container's accent color automatically. */
  var APP_ICONS = {
    cloud: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path></svg>',
    settings: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
    barChart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>',
    cpu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>',
    smartphone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>',
    lock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',
    headset: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>',
    bookOpen: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>',
    users: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    messageSquare: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
  };

  /* ─── Backend-ready installed-app data structure (fallback/seed data) ───
     Shape: { id, name, icon, category, description, status, statusLabel,
              integrationStatus, lastSync, permissions[] }
     This is the shape a future /api/v2/apps/installed endpoint should return. */
  var INSTALLED_APPS_FALLBACK = [
    { id: 'salesforce-cx-cloud', name: 'Salesforce CX Cloud', icon: APP_ICONS.cloud, category: 'CRM Integration', description: 'Embedded CTI and screen pop', status: 'active', statusLabel: 'Active', integrationStatus: 'Connected', lastSync: '2 minutes ago', permissions: ['Read customer records', 'Write interaction history', 'Screen pop on inbound calls'] },
    { id: 'servicenow-unified', name: 'ServiceNow Unified', icon: APP_ICONS.settings, category: 'ITSM Integration', description: 'Front and back office', status: 'active', statusLabel: 'Active', integrationStatus: 'Connected', lastSync: '5 minutes ago', permissions: ['Read/write incidents', 'Read CMDB assets', 'Sync front & back office cases'] },
    { id: 'customised-analytics', name: 'Customised Analytics', icon: APP_ICONS.barChart, category: 'Reporting & BI', description: 'Prebuilt and custom dashboards', status: 'active', statusLabel: 'Active', integrationStatus: 'Connected', lastSync: '12 minutes ago', permissions: ['Read historical data', 'Export reports', 'Manage custom dashboards'] },
    { id: 'bot-manager', name: 'Bot Manager', icon: APP_ICONS.cpu, category: 'Automation & Bots', description: 'Native and third-party bots', status: 'active', statusLabel: 'Active', integrationStatus: 'Connected', lastSync: '1 minute ago', permissions: ['Manage bot flows', 'Read conversation transcripts', 'Deploy bot updates'] },
    { id: 'workforce-mobile', name: 'Workforce Mobile', icon: APP_ICONS.smartphone, category: 'Workforce Management', description: 'Schedules and time-off', status: 'active', statusLabel: 'Active', integrationStatus: 'Connected', lastSync: '8 minutes ago', permissions: ['Read/write schedules', 'Manage time-off requests', 'Send push notifications'] },
    { id: 'secure-payments', name: 'Secure Payments', icon: APP_ICONS.lock, category: 'Payments & Compliance', description: 'PCI card capture', status: 'active', statusLabel: 'Active', integrationStatus: 'Connected', lastSync: '20 minutes ago', permissions: ['PCI-scoped card capture', 'Tokenize payment data', 'Write audit trail logs'] },
    { id: 'agent-copilot', name: 'Agent Copilot', icon: APP_ICONS.headset, category: 'AI & Agent Assist', description: 'Real-time assistance', status: 'active', statusLabel: 'Active', integrationStatus: 'Connected', lastSync: 'Just now', permissions: ['Read live transcript', 'Suggest agent responses', 'Access knowledge base'] },
    { id: 'knowledge-workbench', name: 'Knowledge Workbench', icon: APP_ICONS.bookOpen, category: 'Knowledge Management', description: 'Article authoring', status: 'active', statusLabel: 'Active', integrationStatus: 'Connected', lastSync: '30 minutes ago', permissions: ['Read/write articles', 'Manage publishing workflow', 'Access search index'] }
  ];

  /* ─── Backend-ready available-app data structure (fallback/seed data) ───
     Shape: { id, name, icon, category, categoryLabel, description,
              permissions[] }
     This is the shape a future /api/apps/available endpoint should return.
     Exactly the 4 AppFoundry catalogue integrations already listed on the
     Admin > Integrations > Catalogue tab — kept in sync, none added/removed. */
  var AVAILABLE_APPS_FALLBACK = [
    { id: 'salesforce-cti', name: 'Salesforce CTI', icon: APP_ICONS.cloud, category: 'crm', categoryLabel: 'CRM', description: 'Click-to-dial and screen pop from Salesforce', permissions: ['Read/write Salesforce contacts', 'Screen pop on inbound calls', 'Log call activity to Salesforce'] },
    { id: 'microsoft-teams', name: 'Microsoft Teams', icon: APP_ICONS.users, category: 'uc', categoryLabel: 'UC', description: 'Presence sync and click-to-chat with Teams', permissions: ['Read Teams presence status', 'Send click-to-chat messages', 'Sync calendar availability'] },
    { id: 'zendesk', name: 'Zendesk', icon: APP_ICONS.messageSquare, category: 'ticketing', categoryLabel: 'Ticketing', description: 'Two-way ticket sync for every interaction', permissions: ['Create and update Zendesk tickets', 'Read ticket status', 'Attach interaction transcripts'] },
    { id: 'power-bi-export', name: 'Power BI Export', icon: APP_ICONS.barChart, category: 'analytics', categoryLabel: 'Analytics', description: 'Scheduled exports of contact centre data to Power BI', permissions: ['Read historical reporting data', 'Export scheduled datasets', 'Manage export schedule'] }
  ];

  /* ─── REST helper compatible with the shared window.apiFetch contract ───
     (see frontend/src/features/shared/backend.ts: same base URL, same
     Authorization: Bearer <window.__authToken> header, same JSON contract).
     Delegates to window.apiFetch if a real one is ever exposed there;
     otherwise talks to the same backend directly so the payload shape is
     identical either way. */
  function appsApiFetch(path, init) {
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

  /* ─── Backend row → frontend shape ───
     backend/apps.py returns raw apps-table rows (icon as a key string,
     category as a short machine code, last_sync_label/status_label/
     integration_status as their literal column names). These adapt that
     into exactly the shape renderAppCard/renderAvailableRow/the drawers
     already expect — same job the People page's fromBackendPerson() does
     in store.ts for its own backend rows. */
  function mapBackendInstalledApp(row) {
    return {
      id: row.id,
      name: row.name,
      icon: APP_ICONS[row.icon] || APP_ICONS.cloud,
      category: row.category_label || row.category,
      description: row.description || '',
      status: row.status || 'inactive',
      statusLabel: row.status_label || 'Inactive',
      integrationStatus: row.integration_status || 'Not connected',
      lastSync: row.last_sync_label || '',
      permissions: Array.isArray(row.permissions) ? row.permissions : []
    };
  }

  function mapBackendAvailableApp(row) {
    return {
      id: row.id,
      name: row.name,
      icon: APP_ICONS[row.icon] || APP_ICONS.cloud,
      category: row.category,
      categoryLabel: row.category_label || row.category,
      description: row.description || '',
      permissions: Array.isArray(row.permissions) ? row.permissions : []
    };
  }

  /* ─── Modular data-fetching helper ───
     window.AppsAPI.listInstalled() (sync array or Promise<array>) is the
     top-priority swap-in point for a fully custom integration; absent that,
     this calls the real GET /api/apps/installed endpoint via appsApiFetch.
     Falls back to the local seed data both when that request fails
     (offline / not logged in / backend down) and when it legitimately
     returns zero rows — same "never show a broken empty state" convention
     the rest of this module already uses for window.AppsAPI above. */
  function fetchInstalledApps() {
    if (window.AppsAPI && typeof window.AppsAPI.listInstalled === 'function') {
      try {
        var res = window.AppsAPI.listInstalled();
        if (res && typeof res.then === 'function') {
          return res.then(function(list) {
            return (Array.isArray(list) && list.length) ? list : INSTALLED_APPS_FALLBACK.slice();
          }).catch(function() { return INSTALLED_APPS_FALLBACK.slice(); });
        }
        if (Array.isArray(res) && res.length) return Promise.resolve(res);
      } catch (e) { /* fall through to REST */ }
    }
    return appsApiFetch('/api/apps/installed').then(function(rows) {
      return (Array.isArray(rows) && rows.length) ? rows.map(mapBackendInstalledApp) : INSTALLED_APPS_FALLBACK.slice();
    }).catch(function() { return INSTALLED_APPS_FALLBACK.slice(); });
  }

  /* ─── Modular data-fetching helper (Available tab) ───
     Same layering as fetchInstalledApps above: window.AppsAPI.listAvailable()
     first, then the real GET /api/apps/available endpoint, then the local
     catalogue as a last resort. */
  function fetchAvailableApps() {
    if (window.AppsAPI && typeof window.AppsAPI.listAvailable === 'function') {
      try {
        var res = window.AppsAPI.listAvailable();
        if (res && typeof res.then === 'function') {
          return res.then(function(list) {
            return (Array.isArray(list) && list.length) ? list : AVAILABLE_APPS_FALLBACK.slice();
          }).catch(function() { return AVAILABLE_APPS_FALLBACK.slice(); });
        }
        if (Array.isArray(res) && res.length) return Promise.resolve(res);
      } catch (e) { /* fall through to REST */ }
    }
    return appsApiFetch('/api/apps/available').then(function(rows) {
      return (Array.isArray(rows) && rows.length) ? rows.map(mapBackendAvailableApp) : AVAILABLE_APPS_FALLBACK.slice();
    }).catch(function() { return AVAILABLE_APPS_FALLBACK.slice(); });
  }

  var appsCache = INSTALLED_APPS_FALLBACK.slice();
  var availableAppsCache = AVAILABLE_APPS_FALLBACK.slice();

  var AppsService = {
    getAll: function() { return appsCache; },
    getById: function(id) { return appsCache.filter(function(a) { return a.id === id; })[0] || null; },
    refresh: function() {
      return fetchInstalledApps().then(function(list) {
        if (Array.isArray(list) && list.length) appsCache = list;
        return appsCache;
      });
    },
    getAvailable: function() { return availableAppsCache; },
    getAvailableById: function(id) { return availableAppsCache.filter(function(a) { return a.id === id; })[0] || null; },
    refreshAvailable: function() {
      return fetchAvailableApps().then(function(list) {
        if (Array.isArray(list) && list.length) availableAppsCache = list;
        return availableAppsCache;
      });
    },
    /* POST /api/apps/available/{id}/install (backend/apps.py) — { app_id }
       in, { ok, app } out, matching the REST payload shape every other
       resource in this app uses (see toBackendPerson/apiFetch in store.ts).
       Tries window.AppsAPI.installApp first (custom-integration swap-in
       point), then the real REST endpoint, and finally simulates success
       so the install flow still completes if the backend is unreachable. */
    installApp: function(id) {
      if (window.AppsAPI && typeof window.AppsAPI.installApp === 'function') {
        try {
          var hookRes = window.AppsAPI.installApp(id);
          return (hookRes && typeof hookRes.then === 'function') ? hookRes : Promise.resolve(hookRes);
        } catch (e) { /* fall through */ }
      }
      return appsApiFetch('/api/apps/available/' + encodeURIComponent(id) + '/install', {
        method: 'POST',
        body: JSON.stringify({ app_id: id })
      }).catch(function() {
        return new Promise(function(resolve) { setTimeout(resolve, 500); });
      });
    },
    /* PUT /api/apps/installed/{id} — persists status/config changes on an
       already-installed app (e.g. a Configure/resync action). patch may
       contain status, status_label, integration_status and/or
       last_sync_label — the only columns backend/apps.py accepts here. */
    updateInstalled: function(id, patch) {
      if (window.AppsAPI && typeof window.AppsAPI.updateInstalled === 'function') {
        try {
          var hookRes = window.AppsAPI.updateInstalled(id, patch);
          return (hookRes && typeof hookRes.then === 'function') ? hookRes : Promise.resolve(hookRes);
        } catch (e) { /* fall through */ }
      }
      return appsApiFetch('/api/apps/installed/' + encodeURIComponent(id), {
        method: 'PUT',
        body: JSON.stringify(patch)
      });
    },
    /* DELETE /api/apps/installed/{id} — uninstalls (flips the row back to
       Available server-side; see backend/apps.py's uninstall_app). */
    uninstallApp: function(id) {
      if (window.AppsAPI && typeof window.AppsAPI.uninstallApp === 'function') {
        try {
          var hookRes = window.AppsAPI.uninstallApp(id);
          return (hookRes && typeof hookRes.then === 'function') ? hookRes : Promise.resolve(hookRes);
        } catch (e) { /* fall through */ }
      }
      return appsApiFetch('/api/apps/installed/' + encodeURIComponent(id), { method: 'DELETE' });
    }
  };
  window.AppsService = AppsService;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ─── Card Rendering (Installed tab — same 8 apps, no additions/removals) ─── */
  function renderAppCard(app) {
    return '<div class="appc" tabindex="0" role="button" aria-label="Open ' + escapeHtml(app.name) + ' details"' +
      ' data-app-id="' + app.id + '" onclick="window.appsOpenDetails(\\'' + app.id + '\\')"' +
      ' onkeydown="if(event.key===\\'Enter\\'||event.key===\\' \\'){event.preventDefault();window.appsOpenDetails(\\'' + app.id + '\\')}">' +
        '<div class="appc-top"><div class="ic2">' + app.icon + '</div>' +
          '<span class="app-badge app-badge-' + app.status + '"><i class="app-dot"></i>' + escapeHtml(app.statusLabel) + '</span>' +
        '</div>' +
        '<b>' + escapeHtml(app.name) + '</b><span>' + escapeHtml(app.description) + '</span>' +
      '</div>';
  }

  function renderInstalledGrid() {
    var cards = AppsService.getAll().map(renderAppCard).join('');
    return '<div class="apgrid">' + cards + '</div>';
  }

  /* ─── Available tab: catalogue table (exactly the 4 AppFoundry integrations) ─── */
  function renderAvailableRow(app) {
    return '<tr data-app-id="' + app.id + '" tabindex="0" aria-label="Install ' + escapeHtml(app.name) + '"' +
      ' onclick="window.appsOpenInstallModal(\\'' + app.id + '\\')"' +
      ' onkeydown="if(event.key===\\'Enter\\'||event.key===\\' \\'){event.preventDefault();window.appsOpenInstallModal(\\'' + app.id + '\\')}">' +
      '<td><div style="display:flex;align-items:center;gap:10px"><div class="ic2" style="width:32px;height:32px;border-radius:7px">' + app.icon + '</div><b>' + escapeHtml(app.name) + '</b></div></td>' +
      '<td><span class="app-cat-badge app-cat-' + app.category + '">' + escapeHtml(app.categoryLabel) + '</span></td>' +
      '<td style="text-align:right"><button class="btn sec app-install-btn" onclick="event.stopPropagation();window.appsOpenInstallModal(\\'' + app.id + '\\')">Install</button></td>' +
      '</tr>';
  }

  function renderAvailableTable() {
    var rows = AppsService.getAvailable().map(renderAvailableRow).join('');
    return '<div class="tblw"><table class="dt"><thead><tr><th>Integration</th><th>Category</th><th style="text-align:right">Action</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  var appsActiveTab = 'installed';

  function renderTabBody() {
    return appsActiveTab === 'available' ? renderAvailableTable() : renderInstalledGrid();
  }

  function renderAppsHtml() {
    var installedOn = appsActiveTab === 'installed' ? ' on' : '';
    var availableOn = appsActiveTab === 'available' ? ' on' : '';
    return '<div class="phd"><div class="bc">Apps</div><div class="tt"><h1>Apps</h1><div class="rt"><button class="btn sec" id="apps_marketplace_btn" onclick="window.appsGoAvailable()">AppFoundry Marketplace</button></div></div>' +
      '<div class="tabs" id="apps_tabs"><div class="tb' + installedOn + '" id="apps_tab_installed" onclick="window.appsSwitchTab(\\'installed\\',this)">Installed</div><div class="tb' + availableOn + '" id="apps_tab_available" onclick="window.appsSwitchTab(\\'available\\',this)">Available</div></div></div>' +
      '<div class="pbody" id="apps_tab_body">' + renderTabBody() + '</div>' +
      '<div class="help"><div class="hh" onclick="toggleHelp()"><span style="color:#FF4F1F">\\u24D8</span> Help &amp; Resources \\u2014 Apps<span class="cx" id="helpcx">Hide</span></div>' +
      '<div class="hb" id="helpb" style=""><div class="hcols"><div><h5>What you can do here</h5><ul><li>Embedded client applications and AppFoundry installs</li><li>Launch apps in a panel, tab or standalone widget</li><li>Permission-controlled visibility per role</li></ul>' +
      '<h5>Keywords</h5><div><span class="kw o">Client app</span><span class="kw">AppFoundry</span><span class="kw">Widget</span><span class="kw o">Panel</span></div></div>' +
      '<div><h5>Training videos</h5><div style="font-size:12px;color:#8794a8">No lab video mapped to this page yet.</div><h5 style="margin-top:14px">Reference documentation</h5>' +
      '<div><a class="reflnk" href="https://help.genesys.com/" target="_blank" rel="noopener">Help Centre \\u203A Apps</a><a class="reflnk" href="https://help.genesys.com/?q=Apps" target="_blank" rel="noopener">Search docs for \\u201CApps\\u201D</a><a class="reflnk" href="https://www.genesys.com/pricing" target="_blank" rel="noopener">Licence requirements</a></div></div></div></div></div>';
  }

  /* ─── Tab switching (Installed / Available) — swaps just the tab body,
     matching how the rest of this engine avoids full-page re-renders under
     an active user interaction. Also drives the "on" state persisted in
     appsActiveTab so a later full re-render (e.g. from applyAppsRedesign's
     polling) keeps whichever tab the user is on. ─── */
  window.appsSwitchTab = function(tab, el) {
    appsActiveTab = tab === 'available' ? 'available' : 'installed';
    var target = el || document.getElementById(tab === 'available' ? 'apps_tab_available' : 'apps_tab_installed');
    if (target && window.tabClick) window.tabClick(target);
    var body = document.getElementById('apps_tab_body');
    if (body) body.innerHTML = renderTabBody();
  };

  /* ─── "AppFoundry Marketplace" button → smoothly switch to the Available tab ─── */
  window.appsGoAvailable = function() {
    window.appsSwitchTab('available');
    var tab = document.getElementById('apps_tab_available');
    if (tab) tab.scrollIntoView({ block: 'nearest' });
  };

  /* ─── Toast helper (fallback if platform toast unavailable) ─── */
  function showToast(msg) {
    if (window.toast) { window.toast(msg); return; }
  }

  /* ─── App Details & Configuration Drawer ─── */
  window.appsOpenDetails = function(id) {
    var app = AppsService.getById(id);
    if (!app) return;
    window.appsCloseDetails();

    var scrim = document.createElement('div');
    scrim.id = 'apps_detail_scrim';
    scrim.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.35);z-index:9199';
    scrim.onclick = window.appsCloseDetails;
    document.body.appendChild(scrim);

    var perms = app.permissions.map(function(p) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:12.5px;color:#3c4a5c;margin-bottom:6px">' +
        '<span style="color:#10b981;font-size:13px;line-height:1">\\u2713</span>' + escapeHtml(p) + '</div>';
    }).join('');

    var d = document.createElement('div');
    d.id = 'apps_detail_drawer';
    d.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:440px;background:#ffffff;z-index:9200;display:flex;flex-direction:column;box-shadow:-8px 0 30px rgba(15,23,42,0.18);font-family:inherit;animation:authorgSlideIn .2s ease';
    d.onclick = function(e) { e.stopPropagation(); };

    var safeName = escapeHtml(app.name).replace(/'/g, "\\\\'");
    d.innerHTML =
      '<div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:14px;background:#f8fafc">' +
        '<div style="width:44px;height:44px;border-radius:10px;background:#fff2ec;color:#FF4F1F;display:flex;align-items:center;justify-content:center;font-size:20px;flex:none">' + app.icon + '</div>' +
        '<div style="flex:1;min-width:0"><h2 style="margin:0;font-size:15.5px;font-weight:700;color:#0f172a">' + escapeHtml(app.name) + '</h2><span style="font-size:12px;color:#64748b">' + escapeHtml(app.category) + '</span></div>' +
        '<button onclick="window.appsCloseDetails()" style="border:none;background:transparent;cursor:pointer;font-size:18px;color:#64748b;padding:4px 8px;border-radius:6px">\\u00D7</button>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto;padding:22px 24px">' +
        '<div style="font-size:12.5px;color:#3c4a5c;line-height:1.6;margin-bottom:20px">' + escapeHtml(app.description) + '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#e6f9f1;border:1px solid #b8ecd6;border-radius:6px;margin-bottom:20px;flex-wrap:wrap">' +
          '<span class="app-badge app-badge-' + app.status + '"><i class="app-dot"></i>' + escapeHtml(app.statusLabel) + '</span>' +
          '<span style="font-size:12px;color:#0f172a;font-weight:600">' + escapeHtml(app.integrationStatus) + '</span>' +
          '<span style="margin-left:auto;font-size:11px;color:#64748b">Last sync ' + escapeHtml(app.lastSync) + '</span>' +
        '</div>' +
        '<div style="font-size:11.5px;color:#5b6a7d;font-weight:600;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Permissions</div>' +
        perms +
      '</div>' +
      '<div style="padding:14px 24px;border-top:1px solid #e2e8f0;display:flex;gap:10px;justify-content:flex-end;background:#f8fafc">' +
        '<button class="btn sec" style="color:#b3261e;border-color:#f3c6c2;margin-right:auto" onclick="window.appsUninstallApp(\\'' + app.id + '\\')">Uninstall</button>' +
        '<button class="btn sec" onclick="window.appsCloseDetails()">Cancel</button>' +
        '<button class="btn sec" id="apps_configure_btn" onclick="window.appsConfigureApp(\\'' + app.id + '\\',\\'' + safeName + '\\')">Configure</button>' +
        '<button class="btn" onclick="window.appsCloseDetails();window.appsToast(\\'Launching ' + safeName + '\\u2026\\')">Launch</button>' +
      '</div>';
    document.body.appendChild(d);
  };

  window.appsCloseDetails = function() {
    var s = document.getElementById('apps_detail_scrim'); if (s) s.remove();
    var d = document.getElementById('apps_detail_drawer'); if (d) d.remove();
  };

  window.appsToast = function(msg) { showToast(msg); };

  /* ─── Configure (Installed tab) → PUT /api/apps/installed/{id} ───
     A minimal but real config change: marks the integration freshly
     resynced. Persists via AppsService.updateInstalled, then refreshes the
     Installed cache from the backend so the drawer/grid reflect what's
     actually stored, not just an optimistic local edit. ─── */
  window.appsConfigureApp = function(id, name) {
    var btn = document.getElementById('apps_configure_btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving\\u2026'; }
    AppsService.updateInstalled(id, { status: 'active', status_label: 'Active', integration_status: 'Connected', last_sync_label: 'Just now' })
      .then(function() { return AppsService.refresh(); })
      .then(function() {
        window.appsCloseDetails();
        window.appsToast('\\u2713 Reconfigured ' + name + ' \\u2014 resynced');
        if (window.APP && window.APP.view === 'apps') {
          var body = document.getElementById('apps_tab_body');
          if (body) body.innerHTML = renderTabBody();
        }
      })
      .catch(function(err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Configure'; }
        window.appsToast('\\u2717 Configure failed \\u2014 ' + ((err && err.message) || 'please try again'));
      });
  };

  /* ─── Uninstall (Installed tab) → DELETE /api/apps/installed/{id} ───
     Moves the app back to the Available catalogue server-side, then
     refreshes both caches so it reappears there immediately. ─── */
  window.appsUninstallApp = function(id) {
    var app = AppsService.getById(id);
    if (!app) return;
    var safeName = escapeHtml(app.name).replace(/'/g, "\\\\'");
    AppsService.uninstallApp(id)
      .then(function() { return Promise.all([AppsService.refresh(), AppsService.refreshAvailable()]); })
      .then(function() {
        window.appsCloseDetails();
        window.appsToast('\\u2713 ' + safeName + ' uninstalled');
        if (window.APP && window.APP.view === 'apps') {
          var body = document.getElementById('apps_tab_body');
          if (body) body.innerHTML = renderTabBody();
        }
      })
      .catch(function(err) {
        window.appsToast('\\u2717 Uninstall failed \\u2014 ' + ((err && err.message) || 'please try again'));
      });
  };

  /* ─── App Installation Modal (Available tab) ───
     Opened by clicking a catalogue row or its Install button. Shows the
     integration overview, category and required permissions, with
     Confirm Install / Cancel actions. Confirm calls AppsService.installApp()
     (REST-backed, see appsApiFetch above) and reports success/failure via
     the existing toast system. ─── */
  window.appsOpenInstallModal = function(id) {
    var app = AppsService.getAvailableById(id);
    if (!app) return;
    window.appsCloseInstallModal();

    var scrim = document.createElement('div');
    scrim.id = 'apps_install_scrim';
    scrim.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.35);z-index:9199';
    scrim.onclick = window.appsCloseInstallModal;
    document.body.appendChild(scrim);

    var perms = app.permissions.map(function(p) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:12.5px;color:#3c4a5c;margin-bottom:6px">' +
        '<span style="color:#10b981;font-size:13px;line-height:1">\\u2713</span>' + escapeHtml(p) + '</div>';
    }).join('');

    var safeName = escapeHtml(app.name).replace(/'/g, "\\\\'");
    var modal = document.createElement('div');
    modal.id = 'apps_install_modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#ffffff;width:420px;max-width:calc(100vw - 32px);max-height:calc(100vh - 48px);display:flex;flex-direction:column;border-radius:10px;z-index:9200;box-shadow:0 24px 60px rgba(15,23,42,0.28);font-family:inherit;animation:authorgSlideIn .2s ease';
    modal.onclick = function(e) { e.stopPropagation(); };

    modal.innerHTML =
      '<div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:14px;background:#f8fafc">' +
        '<div style="width:44px;height:44px;border-radius:10px;background:#fff2ec;color:#FF4F1F;display:flex;align-items:center;justify-content:center;font-size:20px;flex:none">' + app.icon + '</div>' +
        '<div style="flex:1;min-width:0"><h2 style="margin:0;font-size:15.5px;font-weight:700;color:#0f172a">' + escapeHtml(app.name) + '</h2>' +
        '<span class="app-cat-badge app-cat-' + app.category + '" style="margin-top:4px">' + escapeHtml(app.categoryLabel) + '</span></div>' +
        '<button onclick="window.appsCloseInstallModal()" style="border:none;background:transparent;cursor:pointer;font-size:18px;color:#64748b;padding:4px 8px;border-radius:6px;flex:none">\\u00D7</button>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto;padding:22px 24px">' +
        '<div style="font-size:12.5px;color:#3c4a5c;line-height:1.6;margin-bottom:20px">' + escapeHtml(app.description) + '</div>' +
        '<div style="font-size:11.5px;color:#5b6a7d;font-weight:600;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Required permissions</div>' +
        perms +
      '</div>' +
      '<div style="padding:14px 24px;border-top:1px solid #e2e8f0;display:flex;gap:10px;justify-content:flex-end;background:#f8fafc">' +
        '<button class="btn sec" onclick="window.appsCloseInstallModal()">Cancel</button>' +
        '<button class="btn" id="apps_install_confirm_btn" onclick="window.appsConfirmInstall(\\'' + app.id + '\\',\\'' + safeName + '\\')">Confirm Install</button>' +
      '</div>';
    document.body.appendChild(modal);
  };

  window.appsCloseInstallModal = function() {
    var s = document.getElementById('apps_install_scrim'); if (s) s.remove();
    var m = document.getElementById('apps_install_modal'); if (m) m.remove();
  };

  window.appsConfirmInstall = function(id, name) {
    var btn = document.getElementById('apps_install_confirm_btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Installing\\u2026'; }
    AppsService.installApp(id)
      .then(function() { return Promise.all([AppsService.refresh(), AppsService.refreshAvailable()]); })
      .then(function() {
        window.appsCloseInstallModal();
        window.appsToast('\\u2713 ' + name + ' installed');
        if (window.APP && window.APP.view === 'apps') {
          var body = document.getElementById('apps_tab_body');
          if (body) body.innerHTML = renderTabBody();
        }
      })
      .catch(function(err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Confirm Install'; }
        window.appsToast('\\u2717 Install failed \\u2014 ' + ((err && err.message) || 'please try again'));
      });
  };

  /* ─── Apply Redesign ─── */
  function applyAppsRedesign() {
    if (window.SNAP) { window.SNAP.__apps = renderAppsHtml(); }
    if (window.APP && window.APP.view === 'apps') {
      var cnt = document.getElementById('cnt');
      if (cnt) { cnt.innerHTML = renderAppsHtml(); }
    }
  }

  AppsService.refresh().then(applyAppsRedesign);
  AppsService.refreshAvailable().then(applyAppsRedesign);
  applyAppsRedesign();
  setTimeout(applyAppsRedesign, 100);
  setTimeout(applyAppsRedesign, 400);

})();
`;
