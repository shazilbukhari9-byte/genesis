/* ============================================================
   MCM Cloud CX — Sidebar on every section
   #anav (the 246px left column, already fully responsive — desktop
   permanent column, mobile slide-in drawer via responsive-nav.ts) only
   ever gets populated for the Admin section; every other section
   (Directory/Activity/Performance/Apps) explicitly hides it and relies
   on the top #nav tab row alone. This mirrors the same navigation those
   sections already expose — the top-level #nav tabs, plus whichever
   page's own ".tabs" sub-navigation is on screen (Directory's
   People/Groups/Locations/..., Apps' Installed/Available, ...) — into
   #anav so a sidebar is present everywhere, without touching Admin's own
   tree or re-implementing any of these sections' actual navigation:
   every mirrored item just clicks the real element it mirrors.
   ============================================================ */

export const GLOBAL_SIDEBAR_SCRIPT: string = `
(function() {
  'use strict';

  var lastHtml = null;

  function sectionLinks() {
    var navEl = document.getElementById('nav');
    if (!navEl) return '';
    var items = navEl.querySelectorAll('.n');
    if (!items.length) return '';
    var html = '<div class="grp">Sections</div>';
    for (var i = 0; i < items.length; i++) {
      var label = items[i].textContent.replace(/^[^A-Za-z]+/, '');
      html += '<div class="lk gsb-lk gsb-section' + (items[i].classList.contains('on') ? ' on' : '') +
        '" data-gsb-idx="' + i + '">' + label + '</div>';
    }
    return html;
  }

  // Only mirrors a page's own ".tabs" row when it's real sub-navigation
  // (2+ ".tb" items with click handlers) — a single-item ".tabs" (e.g.
  // Activity's live status readout) isn't a link to mirror.
  function pageTabLinks() {
    var cnt = document.getElementById('cnt');
    var tabsRow = cnt && cnt.querySelector('.tabs');
    if (!tabsRow) return '';
    var tabs = [];
    for (var i = 0; i < tabsRow.children.length; i++) {
      if (tabsRow.children[i].classList.contains('tb')) tabs.push(tabsRow.children[i]);
    }
    if (tabs.length < 2) return '';
    var html = '<div class="grp">On this page</div>';
    tabs.forEach(function(tb, i) {
      html += '<div class="lk gsb-lk gsb-tab' + (tb.classList.contains('on') ? ' on' : '') +
        '" data-gsb-idx="' + i + '">' + tb.textContent.trim() + '</div>';
    });
    return html;
  }

  function render() {
    var anav = document.getElementById('anav');
    if (!anav) return;
    if (window.APP && window.APP.view === 'admin') {
      // restoreAdmin() only re-populates #anav.innerHTML from window.ANAV
      // the very first time #cnt is created — every visit after that just
      // toggles the 'hide' class and trusts #anav's innerHTML was never
      // touched. That held until this script started overwriting it for
      // every other section, so coming back to Admin has to hand the real
      // tree back itself once it notices its own mirror is still showing.
      if (window.ANAV && anav.innerHTML.indexOf('gsb-lk') !== -1) {
        anav.innerHTML = window.ANAV;
        lastHtml = null;
      }
      return;
    }
    var html = sectionLinks() + pageTabLinks();
    if (html !== lastHtml) {
      anav.innerHTML = html;
      lastHtml = html;
    }
    anav.classList.remove('hide');
  }

  var renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    setTimeout(function() { renderScheduled = false; render(); }, 0);
  }

  function onSidebarClick(e) {
    var t = e.target.closest && e.target.closest('.gsb-lk');
    if (!t) return;
    var idx = +t.getAttribute('data-gsb-idx');
    if (t.classList.contains('gsb-section')) {
      var navItems = document.querySelectorAll('#nav .n');
      if (navItems[idx]) navItems[idx].click();
    } else {
      var cnt = document.getElementById('cnt');
      var tabsRow = cnt && cnt.querySelector('.tabs');
      var tabs = tabsRow ? Array.prototype.filter.call(tabsRow.children, function(c) { return c.classList.contains('tb'); }) : [];
      if (tabs[idx]) tabs[idx].click();
    }
  }

  function attachObservers() {
    var anav = document.getElementById('anav');
    var cnt = document.getElementById('cnt');
    if (!anav || !cnt || anav.dataset.gsbObserved) return;
    anav.dataset.gsbObserved = '1';
    anav.addEventListener('click', onSidebarClick);

    var mo = new MutationObserver(scheduleRender);
    mo.observe(anav, { attributes: true, attributeFilter: ['class'] });
    mo.observe(cnt, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    scheduleRender();
  }

  attachObservers();
  setTimeout(attachObservers, 100);
  setTimeout(attachObservers, 400);
})();
`;
