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
  }

  // openPage() flags the current page's link with .lk.on but never rebuilds
  // #anav's DOM on navigation, so the accordion's own one-time collapse pass
  // (setupAccordion, below) can't know which section that link ends up in.
  // Recomputing it here instead, on every open, means the sidebar always
  // lands on the section you're already in rather than making you find and
  // tap its header first.
  function expandActiveGroup() {
    var anav = document.getElementById('anav');
    var active = anav && anav.querySelector('.lk.on');
    if (!active) return;
    var n = active.previousElementSibling;
    while (n && !n.classList.contains('grp')) n = n.previousElementSibling;
    if (n) setGroupOpen(n, true);
  }

  function openAnav() {
    document.body.classList.add('anav-open');
    expandActiveGroup();
  }

  // The dimmed backdrop is a pure-CSS body.anav-open::before (see mcm.css)
  // rather than a JS-created div, so it's always in perfect sync with the
  // 'anav-open' class with no separate DOM node to create, race against, or
  // fail to clean up. Tapping it — or anywhere outside the drawer/toggle —
  // closes the drawer via this single delegated listener.
  function installOutsideClickClose() {
    if (document.documentElement.dataset.anavOutsideClose) return;
    document.documentElement.dataset.anavOutsideClose = '1';
    document.addEventListener('click', function(e) {
      if (!document.body.classList.contains('anav-open')) return;
      var t = e.target;
      if (t && t.closest && (t.closest('#anav') || t.closest('.anav-toggle'))) return;
      closeAnav();
    });
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

  // Each ".grp" header (e.g. "ACCOUNT SETTINGS") is followed by a flat run
  // of ".lk" sibling links until the next ".grp" — same structure
  // window.filterNav already walks. On mobile that whole flat list (~40
  // links across every module) rendered open at once, which is what made
  // the sidebar overlay feel unusable — this collapses each module's links
  // by default and only reveals them when its header is tapped.
  function linksForGroup(grp) {
    var links = [];
    var n = grp.nextElementSibling;
    while (n && !n.classList.contains('grp')) {
      if (n.classList.contains('lk')) links.push(n);
      n = n.nextElementSibling;
    }
    return links;
  }

  // The visual toggle. Doesn't touch dataset.userOpen — that's the user's
  // actual intent, only updated by setGroupOpen below — so a search that
  // force-opens every group doesn't overwrite what the user had chosen
  // before they started typing.
  function showGroupLinks(grp, open) {
    grp.classList.toggle('nav-grp-open', open);
    linksForGroup(grp).forEach(function(lk) { lk.classList.toggle('nav-lk-collapsed', !open); });
  }

  function setGroupOpen(grp, open) {
    grp.dataset.userOpen = open ? '1' : '0';
    showGroupLinks(grp, open);
  }

  function setupAccordion() {
    var anav = document.getElementById('anav');
    if (!anav) return;
    var groups = anav.querySelectorAll('.grp');
    if (!groups.length || groups[0].dataset.accordionReady) return;

    groups.forEach(function(grp) {
      grp.dataset.accordionReady = '1';
      setGroupOpen(grp, false);
      grp.addEventListener('click', function() {
        setGroupOpen(grp, grp.dataset.userOpen !== '1');
      });
    });
  }

  // Rebuilds after every window.ANAV re-render (openPage/navMark/reset-demo
  // all do "$('anav').innerHTML = window.ANAV", which wipes the accordion
  // state along with the DOM nodes) — cheap no-op via the dataset guard
  // above when nothing actually changed.
  function wrapAnavRerenders() {
    var anavEl = document.getElementById('anav');
    if (anavEl && !anavEl.dataset.accordionObserved) {
      anavEl.dataset.accordionObserved = '1';
      new MutationObserver(setupAccordion).observe(anavEl, { childList: true });
    }
  }

  // Typing in the admin search should always reveal every match regardless
  // of collapsed state — filterNav sets each .lk's inline display itself,
  // so the collapse class (which also drives display via CSS) only needs
  // to get out of the way while a query is active, then restore whatever
  // the user had open/closed once the query is cleared.
  function wrapFilterNav() {
    if (typeof window.filterNav !== 'function' || window.filterNav.__mcmAccordionWrapped) return;
    var original = window.filterNav;
    var wrapped = function(v) {
      var result = original.apply(this, arguments);
      var anav = document.getElementById('anav');
      if (!anav) return result;
      var searching = Boolean((v || '').trim());
      anav.querySelectorAll('.grp').forEach(function(grp) {
        showGroupLinks(grp, searching ? true : grp.dataset.userOpen === '1');
      });
      return result;
    };
    wrapped.__mcmAccordionWrapped = true;
    window.filterNav = wrapped;
  }

  installOutsideClickClose();
  ensureToggle();
  setupAccordion();
  wrapAnavRerenders();
  wrapFilterNav();
  // #top is part of MCM_HTML's static markup (already in the DOM at mount),
  // but retry briefly anyway — same defensive pattern every other redesign
  // module here uses in case script execution order ever shifts.
  setTimeout(function() { ensureToggle(); setupAccordion(); wrapAnavRerenders(); wrapFilterNav(); }, 100);
  setTimeout(function() { ensureToggle(); setupAccordion(); wrapAnavRerenders(); wrapFilterNav(); }, 400);

  // A resize back to desktop width shouldn't leave the overlay state stuck
  // open behind now-visible desktop chrome.
  window.addEventListener('resize', function() {
    if (window.innerWidth > 880) closeAnav();
  });
})();
`;
