/* ============================================================
   MCM Cloud CX — Subscription Page Polish
   NOT a rewrite of the page's data/rendering logic (SubsAPI,
   tab panes, Export CSV, invoice statements, Manage Plan /
   Add Seats modals all stay exactly as scripts.ts already built
   them — window.renderSubsFx keeps computing live seats/usage
   data from the real backend and assembling the same markup).
   This module wraps window.renderSubsFx (and window.subsOpenModal)
   to post-process the DOM after every render:
     - strips the billing card's own duplicate "Manage Plan" button
       (the page header already has one)
     - swaps every emoji glyph (tier icons, warning triangles, the
       AI Tokens robot, download/plus glyphs, the modal's ✕) for a
       proper stroke SVG icon, same style as authorg-redesign.ts's
       ICONS library
   Everything else the design brief asked for (light banner instead
   of the dark navy strip, no harsh KPI top-borders, licence-card
   hover polish to match Apps/Authorized Organizations) is CSS-only
   — see mcm.css's .subs-banner / .subs-kpi / .subs-card rules — so
   it applies automatically without touching this page's logic.

   It also wraps window.SubsAPI.getOverview to fix a real bug: that
   function's own .then() does `Object.keys(d.pool)` on whatever the
   backend returned with zero validation. An expired/missing auth
   token, a Render cold-start timeout, or any other non-2xx response
   still resolves to valid JSON (e.g. {"ok":false,"error":"..."}) with
   no `pool` field — Object.keys(undefined) throws, the rejection is
   never caught anywhere in the chain, and window.renderSubsFx's
   `await SubsAPI.getOverview()` aborts before cnt.innerHTML is ever
   touched. Clicking "Subscription" then updates window.APP.page but
   leaves the previous screen exactly as it was — reads as "the page
   doesn't open". The wrap here validates the response shape, races
   it against a timeout, and falls back to a static placeholder
   dataset (with a toast) so the page always renders something.
   ============================================================ */

export const SUBSCRIPTION_SCRIPT: string = `
(function() {
  'use strict';

  var ICONS = {
    phone: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>',
    chat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>',
    barChart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line></svg>',
    cpu: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>',
    folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
    alertTriangle: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    download: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
    plus: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
    x: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
  };

  var TIER_ICON_BY_CLASS = { cx1: ICONS.phone, cx2: ICONS.chat, cx3: ICONS.barChart, cx4: ICONS.cpu, add: ICONS.folder };

  /* Strips a leading emoji/glyph token from an element's text and
     rebuilds it as "<icon-chip> label" — used for buttons whose original
     markup is "\\u2b73 Export CSV", "+ Manage Plan", etc. Generic on
     purpose so it doesn't depend on which exact codepoint scripts.ts
     used for the glyph.
     The icon is wrapped in its own inline-flex span rather than dropped
     in as a bare <svg> — this app's global stylesheet imports Tailwind,
     whose preflight sets svg{display:block}, which breaks a raw inline
     <svg> out of the button's text flow and wraps the label onto its own
     line inside the button's fixed height. Wrapping the icon in an
     inline-flex span keeps it and the label on one line — same technique
     authorg-redesign.ts's ICONS usages already rely on. */
  function swapLeadingGlyph(el, svg) {
    if (!el) return;
    var label = el.textContent.replace(/^\\s*\\S+\\s*/, '').trim();
    el.innerHTML = '<span style="display:inline-flex;align-items:center;vertical-align:middle;margin-right:6px">' + svg + '</span>' + label;
  }

  function stripDuplicateManagePlanButton() {
    var cta = document.querySelector('.subs-banner .sb-cta');
    if (cta) cta.remove();
    var spacer = document.querySelector('.subs-banner .sb-sp');
    if (spacer) spacer.remove();
  }

  function modernizeSubsIcons() {
    /* Licence-card tier icons (phone/chat/bar-chart/cpu/folder) */
    document.querySelectorAll('.subs-card .sc-icon').forEach(function(el) {
      for (var cls in TIER_ICON_BY_CLASS) {
        if (el.classList.contains(cls)) { el.innerHTML = TIER_ICON_BY_CLASS[cls]; break; }
      }
    });

    /* AI Experience Tokens card heading icon (was a robot emoji) —
       rebuilt around the existing "Consumption model" badge span so
       that pill stays exactly as scripts.ts renders it. */
    document.querySelectorAll('.subs-token-wrap h4').forEach(function(h4) {
      var badge = h4.querySelector('.tk-badge');
      h4.innerHTML = ICONS.cpu + ' AI Experience Token Consumption ';
      if (badge) h4.appendChild(badge);
    });

    /* Warning triangles: the at-risk alert strip's header icon and the
       AI-token low-balance warning box's icon. */
    document.querySelectorAll('.subs-alert .sa-icon, .tk-warn .tw-icon').forEach(function(el) {
      el.innerHTML = ICONS.alertTriangle;
    });

    /* Header "N pools at capacity" badge (only rendered with a leading
       warning glyph when atRisk.length > 0). */
    document.querySelectorAll('.subs-hdr-badge.err').forEach(function(el) {
      swapLeadingGlyph(el, ICONS.alertTriangle);
    });

    /* Export CSV / Manage Plan (header), Statement (invoice rows,
       rendered in both the Overview and Invoices tab panes), Add Seats
       (licence cards + at-risk alert rows). */
    document.querySelectorAll('button[onclick="subsExportCsv()"]').forEach(function(el) { swapLeadingGlyph(el, ICONS.download); });
    document.querySelectorAll('button[onclick="subsManagePlan()"]').forEach(function(el) { swapLeadingGlyph(el, ICONS.plus); });
    document.querySelectorAll('.ic-dl').forEach(function(el) { swapLeadingGlyph(el, ICONS.download); });
    document.querySelectorAll('.sc-add, .sa-btn').forEach(function(el) { swapLeadingGlyph(el, ICONS.plus); });
  }

  /* Placeholder dataset shaped exactly like SubsAPI.getOverview()'s real
     resolved value (same field names renderSubsFx destructures) — used
     only when the real call fails validation or times out, so the page
     still renders instead of leaving the previous screen in place. */
  function buildFallbackOverview() {
    var pool = { 'CX 1': 40, 'CX 2': 60, 'CX 3': 25, 'CX 4': 10, 'Communicate': 50 };
    var unitPrice = { 'CX 1': 75, 'CX 2': 115, 'CX 3': 155, 'CX 4': 240, 'Communicate': 18 };
    var label = { 'CX 1': 'CX 1 \\u2014 Voice', 'CX 2': 'CX 2 \\u2014 Digital', 'CX 3': 'CX 3 \\u2014 WEM', 'CX 4': 'CX 4 \\u2014 AI', 'Communicate': 'Communicate' };
    var licModel = { 'CX 1': 'Named user', 'CX 2': 'Named user', 'CX 3': 'Named user', 'CX 4': 'Named user', 'Communicate': 'Named user' };
    var usedMap = { 'CX 1': 0, 'CX 2': 0, 'CX 3': 0, 'CX 4': 0, 'Communicate': 0 };
    var now = new Date();
    var billEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      pool: pool, unitPrice: unitPrice, label: label, tierLabel: label, licModel: licModel, usedMap: usedMap,
      tierCls: { 'CX 1': 'cx1', 'CX 2': 'cx2', 'CX 3': 'cx3', 'CX 4': 'cx4', 'Communicate': 'add' },
      tierIcon: {}, totalSeats: 0,
      voiceMin: 0, msgN: 0, recN: 0, storGb: 0, aiUsed: 0,
      voiceCost: 0, msgCost: 0, storCost: 0, aiCost: 0, usageTotal: 0, grandTotal: 0,
      now: now, billEnd: billEnd,
      daysLeft: Math.max(1, billEnd.getDate() - now.getDate() + 1),
      billPeriod: now.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
      nextInvDate: '\\u2014', atRisk: [], inv: [],
      aiPurchased: 182500, aiPct: 0, aiRemaining: 182500, aiDaysLeft: 99
    };
  }

  function wrapGetOverview() {
    if (typeof window.SubsAPI !== 'object' || !window.SubsAPI || typeof window.SubsAPI.getOverview !== 'function' || window.SubsAPI.getOverview.__mcmSubsPolished) return;
    var originalGetOverview = window.SubsAPI.getOverview;
    var polished = function() {
      var timedOut = new Promise(function(resolve) { setTimeout(function() { resolve(null); }, 10000); });
      var live = originalGetOverview.call(window.SubsAPI).catch(function() { return null; });
      return Promise.race([live, timedOut]).then(function(result) {
        if (result && result.pool && typeof result.pool === 'object') return result;
        if (window.toast) window.toast('\\u26A0 Live billing data unavailable \\u2014 showing a placeholder view. Try Refresh once the connection recovers.');
        return buildFallbackOverview();
      });
    };
    polished.__mcmSubsPolished = true;
    window.SubsAPI.getOverview = polished;
  }

  function wrapRenderSubsFx() {
    if (typeof window.renderSubsFx !== 'function' || window.renderSubsFx.__mcmSubsPolished) return;
    var originalRenderSubsFx = window.renderSubsFx;
    var polished = async function() {
      try {
        var result = await originalRenderSubsFx.apply(this, arguments);
        stripDuplicateManagePlanButton();
        modernizeSubsIcons();
        return result;
      } catch (e) {
        // Last-resort net: even with getOverview() now always resolving,
        // render something rather than silently leaving the previous
        // page on screen if anything else in the chain still throws.
        var cnt = document.getElementById('cnt');
        if (cnt) {
          cnt.innerHTML = '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203a Account Settings</div>' +
            '<div class="tt"><h1>Subscription</h1></div></div>' +
            '<div class="pbody"><div class="panel" style="padding:24px;text-align:center;color:#5b6a7d">' +
            'Couldn\\u2019t load the Subscription page right now.<br>' +
            '<button class="btn sec" style="margin-top:12px" onclick="renderSubsFx()">Retry</button>' +
            '</div></div>';
        }
        if (window.toast) window.toast('\\u2717 Subscription page failed to load \\u2014 please try again.');
      }
    };
    polished.__mcmSubsPolished = true;
    window.renderSubsFx = polished;
  }

  /* Manage Plan / Add Seats modal close button (✕) — subsOpenModal is a
     separate global (used for both), so it needs its own wrap rather
     than being caught by the renderSubsFx post-process above. */
  function wrapSubsOpenModal() {
    if (typeof window.subsOpenModal !== 'function' || window.subsOpenModal.__mcmSubsPolished) return;
    var originalSubsOpenModal = window.subsOpenModal;
    var polished = function() {
      var result = originalSubsOpenModal.apply(this, arguments);
      var closeBtn = document.querySelector('#subsModal .sm-x');
      if (closeBtn) closeBtn.innerHTML = ICONS.x;
      return result;
    };
    polished.__mcmSubsPolished = true;
    window.subsOpenModal = polished;
  }

  function applySubsPolish() {
    wrapGetOverview();
    wrapRenderSubsFx();
    wrapSubsOpenModal();
  }

  applySubsPolish();
  // scripts.ts defines window.renderSubsFx / window.subsOpenModal across
  // several concatenated IIFEs loaded in sequence — retry briefly in case
  // this module's script tag executes before those definitions land, same
  // defensive pattern certs-redesign.ts / dataact-redesign.ts use for
  // window.SNAP.
  setTimeout(applySubsPolish, 100);
  setTimeout(applySubsPolish, 400);

  // If the Subscription page is already the active view when this module
  // loads, re-render once so the already-painted page picks up the fix
  // immediately rather than waiting for the next navigation.
  setTimeout(function() {
    if (window.APP && window.APP.page === 'subs' && typeof window.renderSubsFx === 'function') {
      window.renderSubsFx();
    }
  }, 450);

})();
`;
