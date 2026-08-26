/* ============================================================
   MCM Cloud CX — Screen Gallery: Real Controls
   NOT a redesign — reproduces the existing page markup and grid
   exactly (same .galsec/.galgrid/.galc classes, same wireframe
   thumbnails, same tile set and tile order) and fixes what was
   broken or missing:

   1. THE BREADCRUMB WASN'T ACTUALLY A LINK. Every other admin page
      in this app has <a onclick="adminIndex()">Admin</a> as its
      "Back" affordance; Gallery's was plain text ("Admin › UI Map"
      with no <a> at all) — it *looked* like the same clickable
      breadcrumb every other page has, but did nothing. Fixed.
   2. NO CATEGORY FILTER EXISTED. Only a free-text search box was
      real; there was no way to narrow the grid to one section
      (Routing, Telephony, ...). Added a real one, same .chip
      convention already used on Prompts/Call Routing/Emergency
      Groups' own toolbars.
   3. NO REFRESH BUTTON EXISTED. Added one — since this page has no
      backend data (window.MENU is a static in-memory list), a
      genuine "refresh" here means resetting search/filter and
      rebuilding the grid from scratch, not a fake network spinner.
   4. FOUR BLANK THUMBNAILS. window.thumb(id) falls back to a
      near-empty header-only wireframe for any id not in
      window.PAGES — true for all four "Agent & Supervisor
      Workspaces" tiles (Performance/Activity/Directory/Apps), since
      none of them are admin-console pages with a PAGES entry. Gives
      them a real generic dashboard wireframe instead. (The
      Performance tile also used two different id strings —
      'performance' for its thumbnail/help lookup, 'perf' for its
      actual go('perf') navigation — coincidentally harmless for
      Help since window.HELP has both keys, but it's exactly the
      kind of inconsistency that causes tiles like this to end up
      blank; unified to 'perf' throughout.)
   5. FILTERING TO ZERO RESULTS SHOWED A BLANK PAGE. galFilter hid
      every .galsec/.galgrid with no matches and no fallback message
      — a real empty state is added.
   6. THE SEARCH BOX WASN'T RESPONSIVE. A bare inline-styled
      width:340px input outside any flex container, unlike every
      other page's .tbar/input.s. Same fix, same existing classes —
      not a new visual style.

   Every tile still onclick's straight into the real window.openPage
   (or window.go for the 4 workspace tiles), so a click here reaches
   whatever the already-fixed Flows/Prompts/Call Routing/Emergency
   Groups pages' own window.openPage wraps do, same as before.
   ============================================================ */

export const GALLERY_SCRIPT: string = `
(function() {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var WORKSPACE_TILES = [
    { id: 'perf', label: 'Performance / Supervisor', nav: "go('perf')" },
    { id: 'activity', label: 'Activity / Agent Workspace', nav: "go('activity')" },
    { id: 'directory', label: 'Directory', nav: "go('directory')" },
    { id: 'apps', label: 'Apps', nav: "go('apps')" }
  ];
  var WORKSPACE_GROUP = 'Agent & Supervisor Workspaces';

  /* window.thumb(id) only draws a real wireframe body when
     window.PAGES[id] exists (or for the two hard-coded editor ids)
     — none of the four workspace tiles have a PAGES entry, since
     they're agent/supervisor-facing screens, not admin-console
     pages, so window.thumb() alone leaves them blank. This reuses
     its exact header-bar chrome (so the thumbnail still reads as
     "the same wireframe style") and adds a generic dashboard body. */
  function workspaceThumb() {
    var W = 268, H = 150;
    var g = '<svg class="thumb" viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="150" xmlns="http://www.w3.org/2000/svg">';
    g += '<rect width="' + W + '" height="' + H + '" fill="#f5f7fa"/>';
    g += '<rect x="0" y="0" width="' + W + '" height="13" fill="#152550"/>';
    g += '<circle cx="8" cy="6.5" r="3.4" fill="#FF4F1F"/><rect x="15" y="4.5" width="26" height="4" rx="2" fill="#ffffff" opacity=".85"/>';
    ['Dir', 'Act', 'Perf', 'Adm', 'App'].forEach(function(t, i) {
      g += '<rect x="' + (58 + i * 17) + '" y="4.5" width="13" height="4" rx="2" fill="#ffffff" opacity="' + (i === 3 ? '1' : '.45') + '"/>';
    });
    g += '<rect x="196" y="3.5" width="44" height="6" rx="3" fill="#ffffff" opacity=".25"/><circle cx="252" cy="6.5" r="4" fill="#FF4F1F"/>';
    g += '<rect x="14" y="24" width="240" height="14" rx="3" fill="#fff" stroke="#dde3ec"/><rect x="20" y="29" width="60" height="4" rx="2" fill="#c9d2df"/>';
    for (var i = 0; i < 3; i++) {
      var x = 14 + i * 84;
      g += '<rect x="' + x + '" y="46" width="76" height="76" rx="4" fill="#fff" stroke="#dde3ec"/>';
      g += '<circle cx="' + (x + 14) + '" cy="60" r="6" fill="' + ['#FF4F1F', '#2f6fd0', '#1f9d63'][i] + '" opacity=".85"/>';
      g += '<rect x="' + (x + 26) + '" y="57" width="38" height="6" rx="3" fill="#c9d2df"/>';
      g += '<rect x="' + (x + 8) + '" y="76" width="60" height="4" rx="2" fill="#e4e9f0"/>';
      g += '<rect x="' + (x + 8) + '" y="86" width="48" height="4" rx="2" fill="#e4e9f0"/>';
      g += '<rect x="' + (x + 8) + '" y="96" width="54" height="4" rx="2" fill="#e4e9f0"/>';
      g += '<rect x="' + (x + 8) + '" y="108" width="40" height="10" rx="2" fill="' + ['#FF4F1F', '#2f6fd0', '#1f9d63'][i] + '" opacity=".12"/>';
    }
    g += '</svg>';
    return g;
  }

  function tileHtml(id, label, groupLabel, nav) {
    var h = (window.HELP && window.HELP[id]) || { kws: [] };
    var kw = (h.kws || []).slice(0, 3).map(function(k) { return '<span class="kw">' + escapeHtml(k) + '</span>'; }).join('');
    var srch = (label + ' ' + groupLabel + ' ' + (h.kws || []).join(' ') + ' ' + ((h.topics || []).join(' '))).toLowerCase().replace(/"/g, '');
    var thumbSvg = WORKSPACE_TILES.some(function(w) { return w.id === id; }) ? workspaceThumb() : window.thumb(id);
    return '<div class="galc" data-s="' + escapeHtml(srch) + '" onclick="' + nav + '">' + thumbSvg +
      '<div class="gm"><div class="gt">' + escapeHtml(label) + '</div><div class="gg">' + escapeHtml(groupLabel) + '</div><div class="gk">' + kw + '</div></div></div>';
  }

  function renderGalleryPage() {
    var groupNames = (window.MENU || []).map(function(g) { return g[0]; }).concat([WORKSPACE_GROUP]);
    var groupOptions = '<option value="">All categories</option>' + groupNames.map(function(g) {
      return '<option value="' + escapeHtml(g) + '">' + escapeHtml(g) + '</option>';
    }).join('');

    var html = '<div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A UI Map</div><h1>Screen Gallery \\u2014 every MCM Cloud CX screen</h1>' +
      '<div style="color:#5b6b82;font-size:13px;margin:-4px 0 4px">A visual index of every page in the product. Each thumbnail is a wireframe of that screen \\u2014 click to open the live page with its Help &amp; Resources panel.</div>' +
      '<div class="tbar" style="margin-top:10px">' +
        '<input class="s" placeholder="Search screens, keywords, functionality..." oninput="window.galFilter(this.value)" style="width:340px">' +
        '<select class="chip" id="gal_group_filter" onchange="window.galFilterGroup(this.value)">' + groupOptions + '</select>' +
        '<div class="sp"></div><div class="chip" onclick="window.galRefresh()">\\u21BB Refresh</div>' +
      '</div>';

    (window.MENU || []).forEach(function(g) {
      html += '<div class="galsec" data-group="' + escapeHtml(g[0]) + '">' + escapeHtml(g[0]) + '</div><div class="galgrid">';
      g[1].forEach(function(it) {
        html += tileHtml(it[0], it[1], g[0], "openPage('" + it[0] + "')");
      });
      html += '</div>';
    });

    html += '<div class="galsec" data-group="' + escapeHtml(WORKSPACE_GROUP) + '">' + escapeHtml(WORKSPACE_GROUP) + '</div><div class="galgrid">';
    WORKSPACE_TILES.forEach(function(w) {
      html += tileHtml(w.id, w.label, 'Workspace', w.nav);
    });
    html += '</div>';

    html += '<div id="gal_empty" style="display:none;padding:40px 0;text-align:center;color:#8794a8">No screens match your search.</div>';
    html += '<div style="height:30px"></div>';
    return html;
  }

  var galFilters = { q: '', group: '' };

  function applyGalleryFilters() {
    var q = galFilters.q.trim().toLowerCase();
    var anyVisible = false;
    document.querySelectorAll('.galsec').forEach(function(sec) {
      var grid = sec.nextElementSibling;
      if (!grid) return;
      var groupMatch = !galFilters.group || galFilters.group === sec.getAttribute('data-group');
      var anyInSection = false;
      Array.prototype.forEach.call(grid.children, function(tile) {
        var matchesSearch = !q || (tile.dataset.s || '').indexOf(q) > -1;
        var visible = groupMatch && matchesSearch;
        tile.style.display = visible ? '' : 'none';
        if (visible) anyInSection = true;
      });
      sec.style.display = anyInSection ? '' : 'none';
      grid.style.display = anyInSection ? '' : 'none';
      if (anyInSection) anyVisible = true;
    });
    var emptyEl = document.getElementById('gal_empty');
    if (emptyEl) emptyEl.style.display = anyVisible ? 'none' : '';
  }

  window.galFilter = function(v) { galFilters.q = v || ''; applyGalleryFilters(); };
  window.galFilterGroup = function(v) { galFilters.group = v || ''; applyGalleryFilters(); };

  window.galRefresh = function() {
    galFilters = { q: '', group: '' };
    mountGalleryPage();
    if (window.toast) window.toast('Screen Gallery refreshed');
  };

  function mountGalleryPage() {
    window.restoreAdmin();
    var c = document.getElementById('cnt');
    if (!c) return;
    if (!window.MENU || !window.MENU.length) {
      c.innerHTML = '<div style="padding:60px;text-align:center;color:#8794a8">Loading Screen Gallery\\u2026</div>';
      setTimeout(mountGalleryPage, 150);
      return;
    }
    try {
      c.innerHTML = renderGalleryPage();
    } catch (e) {
      c.innerHTML = '<div style="padding:60px;text-align:center;color:#b3261e">Couldn\\'t load the Screen Gallery. <a class="lnk" onclick="window.galRefresh()">Retry</a></div>';
    }
  }

  /* "Every tile opens the correct page without breaking" surfaced a
     real crash on the Evaluation Forms tile: eval_forms.groups has the
     correct '[]'::jsonb default in schema.sql, but at least one existing
     row (likely predating that default, or created by a raw API call
     that explicitly sent {}) has groups:{} — an empty OBJECT, not an
     array. window.renderEvalforms and friends (formMax, drawForm,
     qfDelG, qfPublish, the scoring logic — all in scripts.ts, never
     hand-edited here) call .forEach/.length/.map/.push on f.groups
     unconditionally and throw on that shape. This is a data-hygiene
     problem belonging to Evaluation Forms, not something Screen
     Gallery should redesign — but Gallery's own job is to guarantee
     its tiles don't crash the app, so this normalizes the shape right
     before rendering runs, however Evaluation Forms gets opened
     (gallery tile, sidebar link, or anywhere else), without touching
     any of that page's actual UI/logic. */
  var origRenderEvalformsForGallery = window.renderEvalforms;
  if (typeof origRenderEvalformsForGallery === 'function') {
    window.renderEvalforms = function() {
      (window.DB.evalForms || []).forEach(function(f) {
        if (!Array.isArray(f.groups)) f.groups = [];
      });
      return origRenderEvalformsForGallery.apply(this, arguments);
    };
  }

  var prevOpenPageForGallery = window.openPage;
  window.openPage = function(id) {
    if (id === 'gallery') {
      window.navMark('admin');
      window.APP.page = 'gallery';
      mountGalleryPage();
      return;
    }
    return prevOpenPageForGallery(id);
  };

})();
`;
