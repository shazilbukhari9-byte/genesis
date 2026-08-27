/* ============================================================
   MCM Script Editor — mobile panel switcher
   Script Editor (.scv > .archmain: .tbox "Components" / .sccanvas
   "Canvas" / .props "Properties") replaces #ws wholesale on every
   interaction (scrSel/scrPage/etc. all re-run `ws.innerHTML = ...`), and on
   a phone the three panels are each full-width, side by side — usable via
   horizontal swipe (see mcm.css's .sccanvas mobile rule), but with nothing
   telling you there's more to the right or letting you jump straight to
   Properties without three separate swipes. This adds a small "Components /
   Canvas / Properties" switcher above .archmain, mobile-only (CSS hides it
   above the breakpoint), that scrolls to and highlights the active panel —
   without touching any of scripts.ts's actual editing logic.
   ============================================================ */

export const SCRIPT_EDITOR_RESPONSIVE_SCRIPT: string = `
(function() {
  'use strict';

  var PANEL_LABELS = ['Components', 'Canvas', 'Properties'];

  function panels(archmain) {
    return [archmain.querySelector('.tbox'), archmain.querySelector('.sccanvas'), archmain.querySelector('.props')];
  }

  function goToPanel(archmain, i) {
    var p = panels(archmain)[i];
    if (!p) return;
    if (archmain.scrollTo) archmain.scrollTo({ left: p.offsetLeft, behavior: 'smooth' });
    else archmain.scrollLeft = p.offsetLeft;
  }

  function syncActive(archmain, bar) {
    var list = panels(archmain);
    var center = archmain.scrollLeft + archmain.clientWidth / 2;
    var activeIdx = 0;
    list.forEach(function(p, i) { if (p && p.offsetLeft <= center) activeIdx = i; });
    var btns = bar.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', i === activeIdx);
  }

  var syncScheduled = false;
  function scheduleSync(archmain, bar) {
    if (syncScheduled) return;
    syncScheduled = true;
    setTimeout(function() { syncScheduled = false; syncActive(archmain, bar); }, 100);
  }

  function ensureTabs() {
    var archmain = document.querySelector('.scv .archmain');
    if (!archmain) return;

    var bar = document.createElement('div');
    bar.className = 'sc-panel-tabs';
    bar.innerHTML = PANEL_LABELS.map(function(label, i) {
      return '<button type="button" data-i="' + i + '"' + (i === 0 ? ' class="on"' : '') + '>' + label + '</button>';
    }).join('');
    archmain.insertAdjacentElement('beforebegin', bar);

    bar.addEventListener('click', function(e) {
      var btn = e.target.closest && e.target.closest('button');
      if (!btn) return;
      goToPanel(archmain, +btn.getAttribute('data-i'));
    });
    archmain.addEventListener('scroll', function() { scheduleSync(archmain, bar); });
  }

  function init() {
    // scriptView() rebuilds .scv from scratch on every interaction, wiping
    // any bar this already added — if .archmain exists but its own tab bar
    // doesn't (immediately precede it), the DOM was just replaced and needs
    // a fresh one.
    var archmain = document.querySelector('.scv .archmain');
    if (!archmain) return;
    var prev = archmain.previousElementSibling;
    if (prev && prev.classList.contains('sc-panel-tabs')) return;
    ensureTabs();
  }

  init();
  var ws = document.getElementById('ws');
  if (ws) new MutationObserver(init).observe(ws, { childList: true });
  setTimeout(init, 100);
  setTimeout(init, 400);
})();
`;
