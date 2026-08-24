/* ============================================================
   MCM Cloud CX — App-wide Responsive: Sidebar Toggle
   NOT a redesign — the CSS side of this fix (see mcm.css's
   "RESPONSIVE (app-wide)" section) makes #anav an off-canvas panel
   below 1024px, toggled by a .sidebar-open class on #ws. There was
   no hamburger/menu button anywhere in the app (confirmed — zero
   existing toggle/collapse/mobile-menu code in scripts.ts or
   markup.ts) and no JS to add or remove that class, so this file
   adds both: a hamburger button injected into the top bar, and the
   open/close/backdrop/auto-close behavior.

   #anav's own DOM node persists across normal in-admin navigation
   (openPage() only swaps #cnt's innerHTML), but window.restoreAdmin()
   replaces #ws's entire innerHTML (destroying any child appended to
   it) when returning to the admin view from Activity/Directory/
   Performance — so the backdrop is appended to document.body, not
   #ws, to survive that. The toggle button itself lives in #top,
   which is never rebuilt.

   Bug found after first shipping this: #top (and this toggle button
   inside it) is shared by every top-level view, not just the admin
   console — Directory/Activity/Performance/Apps all keep #top visible
   too. But #anav only exists as the admin section's sidebar; on those
   other views it's already hidden via a pre-existing '.hide' class
   (scripts.ts's own go()/restoreAdmin() apply/remove it) which
   display:none's it regardless of this file's .sidebar-open toggle —
   so the button appeared on every page but silently did nothing
   outside the admin console. Fixed by hiding the button itself
   whenever #anav currently has '.hide', so it only appears where it
   actually controls something.
   ============================================================ */

export const RESPONSIVE_SCRIPT: string = `
(function() {
  'use strict';

  function openSidebar() {
    var ws = document.getElementById('ws');
    if (!ws) return;
    ws.classList.add('sidebar-open');
    if (!document.getElementById('mnavScrim')) {
      var scrim = document.createElement('div');
      scrim.id = 'mnavScrim';
      scrim.className = 'mnav-scrim';
      scrim.onclick = closeSidebar;
      document.body.appendChild(scrim);
    }
  }

  function closeSidebar() {
    var ws = document.getElementById('ws');
    if (ws) ws.classList.remove('sidebar-open');
    var scrim = document.getElementById('mnavScrim');
    if (scrim) scrim.parentNode.removeChild(scrim);
  }

  window.__mnavToggle = function(e) {
    if (e) e.stopPropagation();
    var ws = document.getElementById('ws');
    if (!ws) return;
    if (ws.classList.contains('sidebar-open')) closeSidebar(); else openSidebar();
  };

  function ensureToggleButton() {
    var top = document.getElementById('top');
    if (!top) return;
    var btn = document.getElementById('mnavToggleBtn');
    if (!btn) {
      var lg = top.querySelector('.lg');
      if (!lg || !lg.parentNode) return;
      btn = document.createElement('button');
      btn.id = 'mnavToggleBtn';
      btn.className = 'mnav-toggle';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Toggle navigation menu');
      btn.innerHTML = '<span></span><span></span><span></span>';
      btn.onclick = window.__mnavToggle;
      lg.parentNode.insertBefore(btn, lg);
    }
    // Only the admin console has a sidebar for this button to control —
    // Directory/Activity/Performance/Apps hide #anav via their own
    // pre-existing '.hide' class, independent of this file's toggle, so
    // showing the button there would just be inert.
    var anav = document.getElementById('anav');
    var inAdmin = !!anav && !anav.classList.contains('hide');
    btn.style.display = inAdmin ? '' : 'none';
    if (!inAdmin) closeSidebar();
  }

  // Close the sidebar automatically once a destination is actually picked,
  // so navigating on a phone/tablet doesn't leave the off-canvas panel
  // covering the page it just opened.
  document.addEventListener('click', function(e) {
    var lk = e.target && e.target.closest && e.target.closest('#anav .lk');
    if (lk) closeSidebar();
  });

  // A resize back to desktop width (e.g. rotating a tablet, or a real
  // window resize) shouldn't leave the panel stuck open with its backdrop
  // showing once the CSS has already made #anav static/visible again.
  window.addEventListener('resize', function() {
    if (window.innerWidth > 1023) closeSidebar();
  });

  setInterval(ensureToggleButton, 300);
  ensureToggleButton();

})();
`;
