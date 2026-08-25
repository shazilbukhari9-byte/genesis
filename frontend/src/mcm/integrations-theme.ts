/* ============================================================
   MCM Cloud CX — Integrations enterprise theme scope

   Purely presentational. This adds NO behaviour: it wraps
   window.openPage only to stamp a marker attribute on <body> so the
   enterprise styles in mcm.css can be scoped to the three Integrations
   pages (Integrations, Data Actions, Bot Connectors) without restyling
   the rest of the application.

   Why an attribute rather than editing the page markup: every one of the
   eleven Integrations tabs is rendered from HTML strings spread across
   scripts.ts and dataact-redesign.ts. Restyling through CSS on the class
   names those strings already emit (.phd/.tabs/.tbar/.dt/.st/...) gives
   one consistent design system across all of them while leaving the
   render functions, their API calls and their data handling untouched.

   Drawers (#drw) and modals (#kmodal_scrim) are appended to <body>, not
   into #cnt, which is the other reason the marker lives on <body>.
   ============================================================ */

export const INTEGRATIONS_THEME_SCRIPT: string = `
(function() {
  'use strict';

  var INTEGRATION_PAGES = { integ: 1, dataact: 1, bots: 1 };

  function markSection(id) {
    var on = Object.prototype.hasOwnProperty.call(INTEGRATION_PAGES, id);
    if (on) document.body.setAttribute('data-mcm-section', 'integrations');
    else document.body.removeAttribute('data-mcm-section');
    // The page id is also exposed so a tab-specific rule can be written
    // later without touching any render function.
    if (on) document.body.setAttribute('data-mcm-page', id);
    else document.body.removeAttribute('data-mcm-page');
  }

  var prevOpenPage = window.openPage;
  window.openPage = function(id) {
    var result = prevOpenPage.apply(this, arguments);
    try { markSection(id); } catch (e) { /* styling must never break navigation */ }
    return result;
  };

  // adminIndex() leaves the Integrations pages without going through
  // openPage, so clear the marker there too.
  var prevAdminIndex = window.adminIndex;
  if (typeof prevAdminIndex === 'function') {
    window.adminIndex = function() {
      var result = prevAdminIndex.apply(this, arguments);
      try { markSection(null); } catch (e) {}
      return result;
    };
  }

  // Cover the case where a page is already open when this script runs.
  try { if (window.APP && window.APP.page) markSection(window.APP.page); } catch (e) {}
})();
`;
