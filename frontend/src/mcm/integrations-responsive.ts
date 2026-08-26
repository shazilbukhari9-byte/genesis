/* ============================================================
   MCM Cloud CX — Integrations KPI strip + Salesforce connect UI

   Purely additive, same spirit as integrations-theme.ts — no render
   function, fetch, or event handler that already existed is modified;
   everything here only adds new DOM/behaviour on top of markup those
   functions already produce, wrapped so a failure here can never break
   the page it's decorating.

   Two independent pieces:

   1. KPI strip — a stat strip above the primary list on each of the 3
      pages' first tab, using the exact same .kpis/.kpi markup and classes
      the rest of Genesis already uses elsewhere (Queues, Dashboard, etc.
      — see mcm.css lines ~166-171). Counts come from data the page
      already holds in memory (DB.integrations / DB.botConnectors /
      DataActService.getAll()) — no new fetch.

   2. Salesforce connect UI (Integrations Phase 1) — when the Installed
      tab's edit drawer is open on the "Salesforce CTI" row, appends a
      small Connect / Disconnect / Test Connection block wired to the new
      backend/salesforce_oauth.py endpoints. This is the one place in the
      Integrations section that now makes a real, non-simulated backend
      call. Also handles the ?salesforce=connected|failed query param
      Salesforce's OAuth redirect lands back on (see salesforce_oauth.py's
      callback()) with a toast, since the SPA's in-memory state (which
      tab/drawer was open) doesn't survive that round trip through an
      external site.
   ============================================================ */

export const INTEGRATIONS_RESPONSIVE_SCRIPT: string = `
(function() {
  'use strict';

  function activeSection() {
    return document.body.getAttribute('data-mcm-section') === 'integrations';
  }

  function escapeHtmlLite(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---- 1. KPI stat strip --------------------------------------------------- */

  function statusCounts(list, key) {
    var counts = {};
    for (var i = 0; i < list.length; i++) {
      var v = list[i][key];
      counts[v] = (counts[v] || 0) + 1;
    }
    return counts;
  }

  function kpiHtml(val, label) {
    return '<div class="kpi"><span>' + label + '</span><b>' + val + '</b></div>';
  }

  function buildKpisForActiveTab(cnt) {
    var onTab = cnt.querySelector('.tabs .tb.on');
    var tabName = onTab ? onTab.textContent.trim() : '';
    var win = window;

    if (tabName === 'Installed' && win.DB && Array.isArray(win.DB.integrations)) {
      var list = win.DB.integrations;
      var c = statusCounts(list, 'status');
      return [
        kpiHtml(list.length, 'Installed'),
        kpiHtml(c['Active'] || 0, 'Active'),
        kpiHtml(c['Warning'] || 0, 'Warning'),
        kpiHtml(c['Disabled'] || 0, 'Disabled')
      ].join('');
    }
    if (tabName === 'Bots' && win.DB && Array.isArray(win.DB.botConnectors)) {
      var blist = win.DB.botConnectors;
      var bc = statusCounts(blist, 'status');
      var totalIntents = 0;
      for (var i = 0; i < blist.length; i++) totalIntents += (blist[i].intentCount || 0);
      return [
        kpiHtml(blist.length, 'Bots'),
        kpiHtml(bc['Connected'] || 0, 'Connected'),
        kpiHtml(bc['Disconnected'] || 0, 'Disconnected'),
        kpiHtml(totalIntents, 'Intents trained')
      ].join('');
    }
    if (tabName === 'Actions' && win.DataActService) {
      var alist = win.DataActService.getAll() || [];
      var ac = statusCounts(alist, 'status');
      return [
        kpiHtml(alist.length, 'Data Actions'),
        kpiHtml(ac['Published'] || 0, 'Published'),
        kpiHtml(ac['Slow'] || 0, 'Slow'),
        kpiHtml(ac['Failing'] || 0, 'Failing')
      ].join('');
    }
    return null;
  }

  function enhanceKpis(cnt) {
    var pbody = cnt.querySelector('.pbody');
    if (!pbody) return;
    var html = buildKpisForActiveTab(cnt);
    var existing = pbody.querySelector('.kpis[data-int-kpis="1"]');
    if (!html) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      // Cheap idempotent refresh — counts can change after create/delete/test.
      if (existing.getAttribute('data-int-kpi-sig') !== html.length + ':' + html) {
        existing.innerHTML = html;
        existing.setAttribute('data-int-kpi-sig', html.length + ':' + html);
      }
      return;
    }
    var strip = document.createElement('div');
    strip.className = 'kpis';
    strip.setAttribute('data-int-kpis', '1');
    strip.setAttribute('data-int-kpi-sig', html.length + ':' + html);
    strip.innerHTML = html;
    pbody.insertBefore(strip, pbody.firstChild);
  }

  /* ---- 2. Salesforce connect UI (Integrations Phase 1) --------------------- */

  var SALESFORCE_INTEGRATION_NAME = 'Salesforce CTI';

  function authHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + window.__authToken };
  }

  function sfFetch(path, opts) {
    return fetch(window.SUBS_API_BASE + path, opts).then(function(r) {
      return r.json().catch(function() { return {}; }).then(function(body) { return { httpOk: r.ok, body: body }; });
    });
  }

  function renderSalesforceStatus(installedId, status) {
    var line = document.getElementById('sf_status_line');
    var actions = document.getElementById('sf_actions');
    if (!line || !actions) return;

    var label = status.connection_status || 'Not Connected';
    var color = label === 'Connected' ? '#1c7a4c'
      : (label === 'Authentication Failed' || label === 'Token Expired') ? '#b3261e'
      : '#5b6a7d';
    line.innerHTML = '<span style="color:' + color + ';font-weight:600">' + escapeHtmlLite(label) + '</span>' +
      (status.last_error ? ' \\u2014 ' + escapeHtmlLite(status.last_error) : '') +
      (status.connected_at ? ' <span style="color:#8a94a6">(since ' + escapeHtmlLite(new Date(status.connected_at).toLocaleString()) + ')</span>' : '');

    if (label === 'Connected' || label === 'Token Expired') {
      actions.innerHTML =
        '<button type="button" class="btn sec" id="sf_test_btn" style="height:30px;margin-right:8px">Test Connection</button>' +
        '<button type="button" class="btn gh" id="sf_disconnect_btn" style="height:30px">Disconnect</button>';
      var testBtn = document.getElementById('sf_test_btn');
      var discBtn = document.getElementById('sf_disconnect_btn');
      if (testBtn) testBtn.addEventListener('click', function() { runSalesforceTest(installedId, testBtn); });
      if (discBtn) discBtn.addEventListener('click', function() { runSalesforceDisconnect(installedId, discBtn); });
    } else {
      actions.innerHTML = '<button type="button" class="btn sec" id="sf_connect_btn" style="height:30px">Connect</button>';
      var connectBtn = document.getElementById('sf_connect_btn');
      if (connectBtn) connectBtn.addEventListener('click', function() { runSalesforceConnect(installedId, connectBtn); });
    }
  }

  function fetchSalesforceStatus(installedId) {
    sfFetch('/api/integrations/salesforce/oauth/status/' + installedId, { headers: authHeaders() })
      .then(function(res) { renderSalesforceStatus(installedId, res.httpOk ? res.body : { connection_status: 'Not Connected' }); })
      .catch(function() { renderSalesforceStatus(installedId, { connection_status: 'Not Connected' }); });
  }

  function runSalesforceConnect(installedId, btn) {
    btn.disabled = true; btn.textContent = 'Connecting\\u2026';
    var redirectUri = window.location.href.split('?')[0].split('#')[0];
    sfFetch('/api/integrations/salesforce/oauth/authorize-url', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ installed_integration_id: installedId, redirect_uri: redirectUri })
    }).then(function(res) {
      if (res.httpOk && res.body.authorize_url) {
        window.location.href = res.body.authorize_url;
        return;
      }
      btn.disabled = false; btn.textContent = 'Connect';
      if (window.toast) window.toast('\\u2717 ' + (res.body.error || 'Could not start the Salesforce connection.'));
    }).catch(function() {
      btn.disabled = false; btn.textContent = 'Connect';
      if (window.toast) window.toast('\\u2717 Could not start the Salesforce connection \\u2014 network error.');
    });
  }

  function runSalesforceTest(installedId, btn) {
    btn.disabled = true; btn.textContent = 'Testing\\u2026';
    sfFetch('/api/integrations/salesforce/oauth/test', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ installed_integration_id: installedId })
    }).then(function(res) {
      if (window.toast) window.toast(res.httpOk ? '\\u2713 Salesforce connection verified' : '\\u2717 ' + (res.body.error || 'Test failed.'));
      fetchSalesforceStatus(installedId);
    }).catch(function() {
      if (window.toast) window.toast('\\u2717 Test failed \\u2014 network error.');
      fetchSalesforceStatus(installedId);
    });
  }

  function runSalesforceDisconnect(installedId, btn) {
    btn.disabled = true; btn.textContent = 'Disconnecting\\u2026';
    sfFetch('/api/integrations/salesforce/oauth/disconnect', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ installed_integration_id: installedId })
    }).then(function(res) {
      if (window.toast) window.toast(res.httpOk ? 'Salesforce disconnected' : '\\u2717 ' + (res.body.error || 'Disconnect failed.'));
      fetchSalesforceStatus(installedId);
    }).catch(function() {
      if (window.toast) window.toast('\\u2717 Disconnect failed \\u2014 network error.');
      fetchSalesforceStatus(installedId);
    });
  }

  function enhanceSalesforceDrawer(cnt) {
    var drw = document.getElementById('drw');
    if (!drw || drw.getAttribute('data-sf-enhanced') === '1') return;
    var h2 = drw.querySelector('.dh h2');
    if (!h2 || h2.textContent.trim() !== 'Edit \\u2014 ' + SALESFORCE_INTEGRATION_NAME) return;

    var row = null;
    var list = (window.DB && window.DB.integrations) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === SALESFORCE_INTEGRATION_NAME) { row = list[i]; break; }
    }
    if (!row || !row.dbId) return; // not backend-confirmed yet — nothing to connect

    var db = drw.querySelector('.db');
    if (!db) return;
    drw.setAttribute('data-sf-enhanced', '1');

    var block = document.createElement('div');
    block.id = 'sf_connect_block';
    block.style.cssText = 'margin-top:14px;padding-top:14px;border-top:1px solid #eef1f6';
    block.innerHTML =
      '<label style="display:block;font-size:11.5px;color:#5b6a7d;margin-bottom:6px;font-weight:600">Salesforce connection</label>' +
      '<div id="sf_status_line" style="font-size:12.6px;color:#3c4a5c;margin-bottom:8px">Checking\\u2026</div>' +
      '<div id="sf_actions"></div>';
    db.appendChild(block);

    fetchSalesforceStatus(row.dbId);
  }

  /* One-time: Salesforce's OAuth redirect lands back here with
     ?salesforce=connected or ?salesforce=failed&error=... — the SPA's own
     in-memory state (which tab/drawer was open) doesn't survive a full
     redirect out to an external site and back, so this just surfaces a
     toast and cleans the query string; the drawer itself (opened again
     from the Installed tab) fetches real status fresh every time. */
  function handleSalesforceReturn() {
    var params = new URLSearchParams(window.location.search);
    var result = params.get('salesforce');
    if (!result) return;
    var error = params.get('error');
    params.delete('salesforce');
    params.delete('error');
    var newSearch = params.toString();
    var newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
    window.history.replaceState(null, '', newUrl);

    var show = function() {
      if (!window.toast) { setTimeout(show, 200); return; }
      if (result === 'connected') window.toast('\\u2713 Salesforce connected');
      else window.toast('\\u2717 Salesforce connection failed' + (error ? ' \\u2014 ' + error : ''));
    };
    show();
  }

  /* ---- Sweep -------------------------------------------------------------- */

  function sweep() {
    if (!activeSection()) return;
    try {
      var cnt = document.getElementById('cnt');
      if (!cnt) return;
      enhanceKpis(cnt);
      enhanceSalesforceDrawer(cnt);
    } catch (e) { /* presentation only — never block the page */ }
  }

  var prevOpenPage = window.openPage;
  window.openPage = function(id) {
    var result = prevOpenPage.apply(this, arguments);
    setTimeout(sweep, 0);
    return result;
  };

  function startObserver() {
    var cnt = document.getElementById('cnt');
    if (!cnt || !window.MutationObserver) return;
    var scheduled = false;
    var obs = new MutationObserver(function() {
      if (scheduled) return;
      scheduled = true;
      setTimeout(function() { scheduled = false; sweep(); }, 60);
    });
    obs.observe(cnt, { childList: true, subtree: true });
    // #drw (the edit drawer, including the Salesforce connect block) is
    // appended directly to <body>, a sibling of #cnt rather than a
    // descendant — iOpenDrawerHTML()'s own doing, not something this file
    // controls — so it's invisible to the observer above. A second,
    // shallow (non-subtree) watch on <body> catches it opening/closing
    // without re-scanning the whole page on every unrelated body mutation.
    var bodyObs = new MutationObserver(function() {
      if (scheduled) return;
      scheduled = true;
      setTimeout(function() { scheduled = false; sweep(); }, 60);
    });
    bodyObs.observe(document.body, { childList: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      startObserver();
      sweep();
      handleSalesforceReturn();
    });
  } else {
    startObserver();
    sweep();
    handleSalesforceReturn();
  }
})();
`;
