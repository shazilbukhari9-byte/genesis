/* ============================================================
   MCM Cloud CX — Mobile/tablet navigation
   The whole shell (#top, #anav) was built fixed-width for desktop
   only — no way to reach Admin > Account Settings or People &
   Permissions on a phone-sized viewport at all: the top nav's tabs
   plus the global search overflow the viewport, and the 246px admin
   sidebar has no collapse behavior. This adds a hamburger button
   (shown only below the mobile breakpoint via CSS in mcm.css) that
   turns #anav into a slide-in overlay drawer with a scrim, without
   touching scripts.ts's own markup/behavior.
   ============================================================ */

export const RESPONSIVE_NAV_SCRIPT: string = `
(function() {
  'use strict';

  function closeAnav() {
    document.body.classList.remove('anav-open');
    var scrim = document.getElementById('anavScrim');
    if (scrim) scrim.remove();
  }

  function openAnav() {
    document.body.classList.add('anav-open');
    if (document.getElementById('anavScrim')) return;
    var scrim = document.createElement('div');
    scrim.id = 'anavScrim';
    scrim.className = 'anav-scrim';
    scrim.onclick = closeAnav;
    document.body.appendChild(scrim);
  }

  function ensureToggle() {
    if (document.getElementById('anavToggle')) return;
    var top = document.getElementById('top');
    var logo = top && top.querySelector('.lg');
    if (!top || !logo) return;

    var btn = document.createElement('div');
    btn.id = 'anavToggle';
    btn.className = 'anav-toggle';
    btn.setAttribute('aria-label', 'Toggle admin menu');
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>';
    btn.onclick = function() {
      if (document.body.classList.contains('anav-open')) closeAnav(); else openAnav();
    };
    logo.insertAdjacentElement('afterend', btn);

    // Closing on navigation makes the overlay behave like a real mobile
    // drawer instead of staying open over the page the user just picked.
    var anav = document.getElementById('anav');
    if (anav) {
      anav.addEventListener('click', function(e) {
        var t = e.target;
        if (t && t.closest && t.closest('.lk')) closeAnav();
      });
    }
  }

  ensureToggle();
  // #top is part of MCM_HTML's static markup (already in the DOM at mount),
  // but retry briefly anyway — same defensive pattern every other redesign
  // module here uses in case script execution order ever shifts.
  setTimeout(ensureToggle, 100);
  setTimeout(ensureToggle, 400);

  // A resize back to desktop width shouldn't leave the overlay state stuck
  // open behind now-visible desktop chrome.
  window.addEventListener('resize', function() {
    if (window.innerWidth > 880) closeAnav();
  });
})();
`;
