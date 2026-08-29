/* ============================================================
   MCM Cloud CX — Outbound enterprise theme scope + presentation kit

   Purely presentational. Two things live here:

   1. A marker attribute. window.openPage is wrapped only to stamp
      data-mcm-outbound="<page>" on <body>, so the Outbound styles in
      mcm.css can scope themselves to Campaigns, Contact Lists and DNC
      Lists without restyling the rest of Genesis. A distinct attribute
      (not data-mcm-section) is used deliberately: integrations-theme.ts
      also wraps openPage and clears data-mcm-section on every page that
      is not one of its three, so sharing that attribute would have the
      two wrappers erase each other depending on injection order.

   2. window.MCMOut — the shared markup helpers the three pages render
      their KPI row, empty/loading/error states and stale-data banner
      through, so the same situation looks the same on all of them. Same
      idea as window.MCMInt for Integrations.

   No render function's data path, API call or event handler is touched
   by anything in this file: the helpers return HTML strings, and the
   callers decide what to put in them.

   Drawers (#drw) and the scrim are appended to <body>, not into #cnt,
   which is why the marker lives on <body>.
   ============================================================ */

export const OUTBOUND_THEME_SCRIPT: string = `
(function() {
  'use strict';

  var OUTBOUND_PAGES = { campaigns: 1, contactlists: 1, dnclists: 1 };

  function markSection(id) {
    var on = Object.prototype.hasOwnProperty.call(OUTBOUND_PAGES, id);
    if (on) document.body.setAttribute('data-mcm-outbound', id);
    else document.body.removeAttribute('data-mcm-outbound');
  }

  var prevOpenPage = window.openPage;
  window.openPage = function(id) {
    var result = prevOpenPage.apply(this, arguments);
    try { markSection(id); } catch (e) { /* styling must never break navigation */ }
    return result;
  };

  // adminIndex() leaves these pages without going through openPage.
  var prevAdminIndex = window.adminIndex;
  if (typeof prevAdminIndex === 'function') {
    window.adminIndex = function() {
      var result = prevAdminIndex.apply(this, arguments);
      try { markSection(null); } catch (e) {}
      return result;
    };
  }

  try { if (window.APP && window.APP.page) markSection(window.APP.page); } catch (e) {}

  /* ─── Shared presentation helpers ─────────────────────────────────── */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* A row of summary cards: title + value only, no secondary/helper line.
     Every value is counted from rows the page has already loaded and is
     already showing — nothing here reads the API or invents a figure.
     items: [{label, value, tone}] — a caller's own 'sub' field, if still
     passed, is accepted but intentionally not rendered. */
  function kpis(items) {
    if (!items || !items.length) return '';
    return '<div class="ob-kpis">' + items.map(function(k) {
      return '<div class="ob-kpi' + (k.tone ? ' tone-' + k.tone : '') + '">' +
        '<span class="ob-kpi-label">' + esc(k.label) + '</span>' +
        '<b class="ob-kpi-val">' + esc(k.value) + '</b>' +
        '</div>';
    }).join('') + '</div>';
  }

  var ICONS = {
    loading: '<span class="ob-spinner" aria-hidden="true"></span>',
    empty: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></svg>',
    search: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    error: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/></svg>'
  };

  /* One <tr> covering the whole table for the four states a list can be in.
     kind: 'loading' | 'empty' | 'nomatch' | 'error'. opts: {title, sub,
     actionLabel, actionCall}. The caller decides which state applies — this
     only settles how each one looks. */
  function stateRow(colspan, kind, opts) {
    opts = opts || {};
    var icon = ICONS[kind === 'nomatch' ? 'search' : kind] || ICONS.empty;
    var action = (opts.actionLabel && opts.actionCall)
      ? '<button class="btn sec ob-state-btn" onclick="' + opts.actionCall + '">' + esc(opts.actionLabel) + '</button>'
      : '';
    return '<tr class="ob-state-row"><td colspan="' + colspan + '">' +
      '<div class="ob-state ob-state-' + kind + '">' +
      '<span class="ob-state-ic">' + icon + '</span>' +
      '<b class="ob-state-title">' + esc(opts.title || '') + '</b>' +
      (opts.sub ? '<span class="ob-state-sub">' + esc(opts.sub) + '</span>' : '') +
      action +
      '</div></td></tr>';
  }

  /* Shown above a table whose rows are the last good read but whose most
     recent refresh failed. */
  function banner(message, actionLabel, actionCall) {
    return '<div class="ob-banner" role="status">' +
      '<span class="ob-banner-ic">' + ICONS.error + '</span>' +
      '<span class="ob-banner-txt">' + esc(message) + '</span>' +
      ((actionLabel && actionCall)
        ? '<button class="btn sec ob-banner-btn" onclick="' + actionCall + '">' + esc(actionLabel) + '</button>'
        : '') +
      '</div>';
  }

  /* Inline form error box (drawers). Same shell as .ob-banner so a failed
     save reads the same as a failed load. */
  function formError(message) {
    return '<span class="ob-banner-ic">' + ICONS.error + '</span><span class="ob-banner-txt">' + esc(message) + '</span>';
  }

  /* The chevron in the last cell of every row that opens a detail view. The
     rows already navigate on click; this replaces a decorative vertical
     ellipsis that looked like a menu button but had no handler. */
  function goCell() {
    return '<td class="ob-go"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></td>';
  }

  /* Status pill. tone: ok | warn | err | off | info */
  function pill(label, tone) {
    return '<span class="ob-pill tone-' + (tone || 'off') + '"><span class="dot"></span>' + esc(label) + '</span>';
  }

  window.MCMOut = {
    esc: esc,
    kpis: kpis,
    stateRow: stateRow,
    banner: banner,
    formError: formError,
    goCell: goCell,
    pill: pill
  };
})();
`;
