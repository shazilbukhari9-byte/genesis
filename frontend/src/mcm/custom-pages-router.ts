/* ============================================================
   MCM Cloud CX — shared router for real-React migrated pages
   Generalizes the pattern recpol-redesign.ts introduced: wrap
   window.openPage once, hide every other custom-mounted page (plus
   scripts.ts's own built-in REACT_PAGES roots) and show the target.
   Each migrated page registers itself with one call —
   window.__registerCustomPage(id, show, hide) — instead of every
   redesign file hand-rolling its own window.openPage wrapper and a
   hardcoded, ever-growing "hide all the OTHER pages" list. Must be
   injected after MCM_SCRIPT (so window.openPage/closeDrawer/etc.
   already exist) and before any *-redesign.ts script that calls
   window.__registerCustomPage.
   ============================================================ */

export const CUSTOM_PAGES_ROUTER_SCRIPT: string = `
(function() {
  'use strict';

  // scripts.ts's own REACT_PAGES registry isn't exposed on window, so
  // there's nothing to iterate over — these hide-function names are
  // hardcoded from that registry (see routes/index.tsx's mountLegacyReactPage
  // calls for the matching __showX/__hideX pairs).
  var BUILTIN_REACT_HIDE_FNS = [
    '__hideOrgSettings', '__hidePurchases', '__hideAuditLog', '__hidePeople',
    '__hideRoles', '__hideDivisions', '__hideGroups', '__hideSkills',
    '__hideLangs', '__hideLicences', '__hideSso', '__hideOauth'
  ];

  var customPages = {};

  window.__registerCustomPage = function(id, show, hide) {
    customPages[id] = { show: show, hide: hide };
  };

  var prevOpenPageForCustom = window.openPage;
  window.openPage = function(id) {
    var page = customPages[id];
    if (page) {
      window.closeDrawer && window.closeDrawer();
      window.restoreAdmin && window.restoreAdmin();
      window.navMark && window.navMark('admin');
      window.APP.page = id;
      BUILTIN_REACT_HIDE_FNS.forEach(function(fn) { if (window[fn]) window[fn](); });
      Object.keys(customPages).forEach(function(k) { if (k !== id) customPages[k].hide(); });
      page.show();
      var links = document.querySelectorAll('#anav .lk');
      links.forEach(function(el) { el.classList.remove('on'); });
      for (var i = 0; i < links.length; i++) {
        var onclick = links[i].getAttribute('onclick') || '';
        if (onclick.indexOf("'" + id + "'") > -1) { links[i].classList.add('on'); break; }
      }
      window.scrollTo(0, 0);
      return;
    }
    Object.keys(customPages).forEach(function(k) { customPages[k].hide(); });
    return prevOpenPageForCustom(id);
  };
})();
`;
