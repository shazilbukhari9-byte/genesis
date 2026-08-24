/* ============================================================
   MCM Cloud CX — Notifications bell, wired to the real backend

   The top-nav bell icon's window.notifOpen (scripts.ts) reads
   DB.audit — a legacy in-memory-only array, never populated from the
   real database. Every "notification" shown there only exists for the
   current browser session and vanishes on refresh, and its own
   "Open full audit log" link opens a second, separate decorative
   drawer (window.auditDrawer) that reads the exact same fake list —
   not the real, backend-connected Audit Log page under Account
   Settings (frontend/src/features/audit-log/AuditLogPage.tsx).

   This module replaces window.notifOpen outright (there's nothing in
   the original worth preserving — it's 100% fake data) to fetch real
   rows from /api/subscription/audit, and points "Open full audit log"
   at the real page (openPage('auditlog')) instead of the fake drawer.
   ============================================================ */

export const NOTIFICATIONS_SCRIPT: string = `
(function() {
  'use strict';

  var API_BASE = window.__GENESIS_API_BASE || 'https://genesis-yysv.onrender.com';

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtWhen(createdAt) {
    var d = new Date(createdAt);
    if (isNaN(d.getTime())) return String(createdAt || '');
    var datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    var timePart = d.toTimeString().slice(0, 5);
    return datePart + ' ' + timePart;
  }

  // Same inline style the original itemStyle()-built rows/footer used —
  // read off the live DOM once so this drop-in replacement looks
  // identical, without needing scripts.ts's own closure-private helper.
  var ITEM_STYLE = 'padding:8px 16px;cursor:pointer;font-size:12.5px;color:#20303f;display:flex;align-items:center;gap:9px;';

  function renderLoading(nf) {
    nf.innerHTML = '<div style="padding:8px 16px 6px;font-size:11px;font-weight:700;color:#6b7a90;text-transform:uppercase;letter-spacing:.5px">Notifications</div>' +
      '<div style="padding:10px 16px;font-size:12px;color:#8794a8">Loading\\u2026</div>';
  }

  function renderError(nf) {
    nf.innerHTML = '<div style="padding:8px 16px 6px;font-size:11px;font-weight:700;color:#6b7a90;text-transform:uppercase;letter-spacing:.5px">Notifications</div>' +
      '<div style="padding:10px 16px;font-size:12px;color:#8794a8">Could not load notifications.</div>';
  }

  function renderRows(nf, rows) {
    var items = rows.slice(0, 8);
    nf.innerHTML = '<div style="padding:8px 16px 6px;font-size:11px;font-weight:700;color:#6b7a90;text-transform:uppercase;letter-spacing:.5px">Notifications</div>' +
      (items.length
        ? items.map(function(a) {
            return '<div style="padding:7px 16px;font-size:12px;border-bottom:1px solid #f2f5f9;line-height:1.5"><b>' + escHtml(a.action) + '</b>' +
              (a.detail ? ' \\u2014 ' + escHtml(a.detail) : '') +
              '<br><span style="color:#8794a8;font-size:11px">' + escHtml(fmtWhen(a.created_at)) + ' \\u00b7 ' + escHtml(a.who) + '</span></div>';
          }).join('')
        : '<div style="padding:10px 16px;font-size:12px;color:#8794a8">No notifications</div>') +
      '<div class="ddi" style="' + ITEM_STYLE + 'color:#c9401a" onclick="window.dd(\'notifddm\');window.openPage(\'auditlog\')">Open full audit log</div>';
  }

  function wrapNotifOpen() {
    if (typeof window.notifOpen !== 'function' || window.notifOpen.__mcmNotifPolished) return;
    var polished = function() {
      var nf = document.getElementById('notifddm');
      if (!nf) return;
      var badge = document.querySelector('#top .ic .bdg');
      if (badge) badge.style.display = 'none';
      window.dd('notifddm');
      renderLoading(nf);
      fetch(API_BASE + '/api/subscription/audit', { headers: window.__mcmAuthHeaders ? window.__mcmAuthHeaders() : {} })
        .then(function(r) { return r.json(); })
        .then(function(rows) { renderRows(nf, Array.isArray(rows) ? rows : []); })
        .catch(function() { renderError(nf); });
    };
    polished.__mcmNotifPolished = true;
    window.notifOpen = polished;
  }

  wrapNotifOpen();
  // scripts.ts defines window.notifOpen inside its own concatenated IIFE
  // sequence — retry briefly in case this module's script tag executes
  // first, same defensive pattern subscription-redesign.ts uses.
  setTimeout(wrapNotifOpen, 100);
  setTimeout(wrapNotifOpen, 400);
})();
`;
