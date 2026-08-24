/* ============================================================
   MCM Cloud CX — Integrations KPI strip

   Purely presentational, same spirit as integrations-theme.ts. Adds one
   additive DOM affordance to the Integrations/Data Actions/Bot Connectors
   pages: a KPI stat strip above the primary list on each of the 3 pages'
   first tab, using the exact same .kpis/.kpi markup and classes the rest
   of Genesis already uses elsewhere (Queues, Dashboard, etc. — see
   mcm.css lines ~166-171) so it reads as the same product, not a
   bespoke component. Counts come from data the page already holds in
   memory (DB.integrations / DB.botConnectors / DataActService.getAll())
   — no new fetch.

   No render function, API call, fetch, or event handler that touches
   data is modified by this file. Every touch point is wrapped so a
   failure here can never break the page it's decorating.
   ============================================================ */

export const INTEGRATIONS_RESPONSIVE_SCRIPT: string = `
(function() {
  'use strict';

  function activeSection() {
    return document.body.getAttribute('data-mcm-section') === 'integrations';
  }

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

  /* ---- Sweep -------------------------------------------------------------- */

  function sweep() {
    if (!activeSection()) return;
    try {
      var cnt = document.getElementById('cnt');
      if (!cnt) return;
      enhanceKpis(cnt);
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      startObserver();
      sweep();
    });
  } else {
    startObserver();
    sweep();
  }
})();
`;
