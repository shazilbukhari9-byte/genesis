/* ============================================================
   MCM Cloud CX — Gamification: adds the toolbar controls and
   pagination footer the prototype's own static markup (see the
   'gamif' entry in scripts.ts's PAGES fallback table) already specifies,
   but window.renderGamif's real, backend-connected implementation never
   built: a Division filter, a Status filter, a Columns show/hide
   popover, an Export CSV button, and a "Showing N-M of T" pagination
   footer (scripts.ts's own .pgr CSS class, already styled, just never
   used by the real render function).

   Wraps window.renderGamif (defined earlier by the from-scratch
   Gamification block in scripts.ts) rather than editing that block
   directly — same reasoning certs-redesign.ts / dataact-redesign.ts use
   for every other "patch an existing render function" case in this
   codebase. Re-declares its own esc()/uid()/audit()/etc. helpers instead
   of reusing scripts.ts's, because those exist only as function
   declarations inside other closures, not real globals (the original
   Gamification block's own comment already noted this same constraint).
   ============================================================ */

export const GAMIFICATION_SCRIPT: string = `
(function() {
  'use strict';
  var DB = window.DB;
  if (!DB) return;

  var SUBS_API_BASE = window.SUBS_API_BASE || window.__GENESIS_API_BASE || 'https://genesis-yysv.onrender.com';
  var PAGE_SIZE = 25;

  // Matches the fixed 5-division set used across the rest of the app
  // (certs-redesign.ts / dataact-redesign.ts / CalibrationsPage.tsx) — a
  // simple free-text tag, not a normalised FK.
  var DIVISIONS = [
    { code: 'd_home', label: 'Home' },
    { code: 'd_ret', label: 'UK Retail' },
    { code: 'd_dig', label: 'UK Digital' },
    { code: 'd_col', label: 'UK Collections' },
    { code: 'd_man', label: 'Partner — Manila' }
  ];
  function divLabel(code) {
    for (var i = 0; i < DIVISIONS.length; i++) if (DIVISIONS[i].code === code) return DIVISIONS[i].label;
    return '—';
  }

  function gEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function gUid() { return 'id' + Math.random().toString(36).slice(2, 10); }
  function gamifById(id) { var r = null; (DB.gamification || []).forEach(function(x) { if (x.id === id) r = x; }); return r; }
  function gAudit(act, obj) {
    DB.audit = DB.audit || [];
    DB.audit.unshift({
      t: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + new Date().toTimeString().slice(0, 5),
      who: (window.__backendUser && window.__backendUser.name) || 'Demo User', act: act, obj: obj
    });
  }
  function gScrim() { var s = document.createElement('div'); s.id = 'scrim'; s.onclick = window.closeDrawer; document.body.appendChild(s); }
  function gOpenDrawerHTML(html) { window.closeDrawer(); gScrim(); var w = document.createElement('div'); w.innerHTML = html; document.body.appendChild(w.firstChild); }
  function gErrBox(id, msgs) { var e = document.getElementById(id); e.style.display = ''; e.innerHTML = msgs.join('<br>'); }
  function gConfirmBox(msg, onYes) {
    gOpenDrawerHTML('<div id="drw" style="height:auto;top:30%;bottom:auto;border-radius:8px 0 0 8px"><div class="dh"><h2>Please confirm</h2><div class="x" onclick="closeDrawer()">×</div></div>' +
      '<div class="db"><div style="font-size:13px;color:#33425c;line-height:1.6">' + msg + '</div></div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" id="cfyes">Confirm</button></div></div>');
    document.getElementById('cfyes').onclick = function() { window.closeDrawer(); onYes(); };
  }

  // ---- filter / pagination / column-visibility state ----
  window.__gamifDiv = window.__gamifDiv || '';
  window.__gamifStatus = window.__gamifStatus || '';
  window.__gamifPage = window.__gamifPage || 1;
  window.__gamifCols = window.__gamifCols || { appliesTo: true, metrics: true, target: true, points: true, leaderboard: true, status: true };

  function filteredProfiles() {
    return (DB.gamification || []).filter(function(p) {
      if (window.__gamifDiv && (p.division || '') !== window.__gamifDiv) return false;
      if (window.__gamifStatus && p.status !== window.__gamifStatus) return false;
      return true;
    });
  }

  function escapeCsvCell(v) { return /[",\\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function exportGamifCsv() {
    var rows = filteredProfiles();
    var lines = ['Metric profile,Applies to,Metrics,Target,Points,Leaderboard,Status,Division'].concat(rows.map(function(p) {
      var metricsCount = p.m2 ? 2 : 1;
      var targetStr = p.m1 + ' ' + p.t1 + '%' + (p.m2 ? (', ' + p.m2 + ' ' + p.t2 + '%') : '');
      var points = (p.w1 || 0) + (p.w2 || 0);
      return [p.name, p.appliesTo + (p.target ? (': ' + p.target) : ''), String(metricsCount), targetStr, String(points),
        p.leaderboard ? 'Enabled' : 'Hidden', p.status, divLabel(p.division)].map(escapeCsvCell).join(',');
    }));
    var blob = new Blob([lines.join('\\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gamification_profiles.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // th/td index: 0 checkbox, 1 name, 2 appliesTo, 3 metrics, 4 target,
  // 5 points, 6 leaderboard, 7 status, 8 actions — matches renderGamif's
  // fixed column order exactly (see scripts.ts's Gamification block).
  var COL_IDX = { appliesTo: 2, metrics: 3, target: 4, points: 5, leaderboard: 6, status: 7 };
  function applyColumnVisibility() {
    var table = document.querySelector('#cnt .tblw table.dt');
    if (!table) return;
    Object.keys(COL_IDX).forEach(function(key) {
      var visible = window.__gamifCols[key] !== false;
      var idx = COL_IDX[key];
      table.querySelectorAll('tr').forEach(function(tr) {
        var cell = tr.children[idx];
        if (cell) cell.style.display = visible ? '' : 'none';
      });
    });
  }

  function renderPagination(totalCount) {
    var container = document.getElementById('gamifPagination');
    if (!container) return;
    var totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    if (window.__gamifPage > totalPages) window.__gamifPage = totalPages;
    var start = totalCount === 0 ? 0 : (window.__gamifPage - 1) * PAGE_SIZE + 1;
    var end = Math.min(totalCount, window.__gamifPage * PAGE_SIZE);
    container.className = 'pgr';
    container.innerHTML =
      '<span>Showing <b>' + start + '\\u2013' + end + '</b> of <b>' + totalCount + '</b></span>' +
      '<div class="sp"></div>' +
      '<span>Rows per page 25 ▾</span>' +
      '<span><a class="lnk" id="gamifPrev" style="cursor:pointer' + (window.__gamifPage <= 1 ? ';opacity:.4;pointer-events:none' : '') + '">‹</a> ' +
      '<a class="lnk" id="gamifNext" style="cursor:pointer' + (window.__gamifPage >= totalPages ? ';opacity:.4;pointer-events:none' : '') + '">›</a></span>';
    var prev = document.getElementById('gamifPrev');
    var next = document.getElementById('gamifNext');
    if (prev) prev.onclick = function() { if (window.__gamifPage > 1) { window.__gamifPage--; applyGamifPage(); } };
    if (next) next.onclick = function() { if (window.__gamifPage < totalPages) { window.__gamifPage++; applyGamifPage(); } };
  }

  function applyGamifPage() {
    // Rows correspond 1:1, in order, to DB.gamification (origRender never
    // filters/paginates itself), so filtering/paging here just hides the
    // rows outside the current filter+page rather than re-rendering them.
    var all = DB.gamification || [];
    var filtered = filteredProfiles();
    var filteredIds = {};
    filtered.forEach(function(p) { filteredIds[p.id] = true; });
    var start = (window.__gamifPage - 1) * PAGE_SIZE;
    var pageIds = {};
    filtered.slice(start, start + PAGE_SIZE).forEach(function(p) { pageIds[p.id] = true; });

    var tbody = document.getElementById('tb');
    if (tbody) {
      var trs = tbody.querySelectorAll('tr');
      trs.forEach(function(tr, i) {
        var p = all[i];
        if (!p) return;
        tr.style.display = (filteredIds[p.id] && pageIds[p.id]) ? '' : 'none';
      });
    }
    applyColumnVisibility();
    renderPagination(filtered.length);
  }

  function closeColsPopover() {
    var existing = document.getElementById('gamifColsPopover');
    if (existing) existing.remove();
  }

  function injectToolbarAndFooter() {
    var cnt = document.getElementById('cnt');
    if (!cnt) return;
    var tbar = cnt.querySelector('.tbar');
    if (!tbar) return;

    if (!tbar.getAttribute('data-gamif-enhanced')) {
      tbar.setAttribute('data-gamif-enhanced', '1');

      var divOpts = '<option value="">Division: All</option>' + DIVISIONS.map(function(d) {
        return '<option value="' + d.code + '"' + (window.__gamifDiv === d.code ? ' selected' : '') + '>' + d.label + '</option>';
      }).join('');
      var statusOpts = ['Active', 'Pilot', 'Inactive'].map(function(s) {
        return '<option value="' + s + '"' + (window.__gamifStatus === s ? ' selected' : '') + '>' + s + '</option>';
      }).join('');

      // The shared .tbar input.s rule is flex:1 1 200px, so with nothing
      // else constraining it the search box grows to fill whatever space
      // the Division/Status/Columns chips don't use — much wider than the
      // prototype's toolbar. Pin it to a fixed width here instead, scoped
      // to just this page, matching the prototype's proportions.
      var searchInput = tbar.querySelector('input.s');
      if (searchInput) searchInput.style.flex = '0 1 260px';

      var wrap = document.createElement('div');
      wrap.style.display = 'contents';
      wrap.innerHTML =
        '<select class="chip" id="gamifDivFilter" style="cursor:pointer">' + divOpts + '</select>' +
        '<select class="chip" id="gamifStatusFilter" style="cursor:pointer"><option value="">Status: Any</option>' + statusOpts + '</select>';

      var sp = tbar.querySelector('.sp');
      while (wrap.firstChild) tbar.insertBefore(wrap.firstChild, sp);

      // Columns sits after the spacer, right next to Refresh — matches the
      // prototype's toolbar order (search, Division, Status, [space],
      // Columns, Refresh) instead of grouping it with the left-side filters.
      var colsWrap = document.createElement('div');
      colsWrap.style.cssText = 'position:relative;display:inline-block';
      colsWrap.innerHTML = '<div class="chip" id="gamifColsBtn" style="cursor:pointer">⚙ Columns</div>';
      tbar.insertBefore(colsWrap, sp.nextSibling);

      document.getElementById('gamifDivFilter').onchange = function(e) {
        window.__gamifDiv = e.target.value; window.__gamifPage = 1; applyGamifPage();
      };
      document.getElementById('gamifStatusFilter').onchange = function(e) {
        window.__gamifStatus = e.target.value; window.__gamifPage = 1; applyGamifPage();
      };
      document.getElementById('gamifColsBtn').onclick = function(e) {
        e.stopPropagation();
        if (document.getElementById('gamifColsPopover')) { closeColsPopover(); return; }
        var pop = document.createElement('div');
        pop.id = 'gamifColsPopover';
        pop.style.cssText = 'position:absolute;right:0;top:36px;z-index:150;background:#fff;border:1px solid #dde3ec;border-radius:6px;box-shadow:0 6px 20px rgba(16,30,60,.14);padding:10px;width:190px';
        var cols = [['appliesTo', 'Applies to'], ['metrics', 'Metrics'], ['target', 'Target'], ['points', 'Points'], ['leaderboard', 'Leaderboard'], ['status', 'Status']];
        pop.innerHTML = cols.map(function(c) {
          var checked = window.__gamifCols[c[0]] !== false;
          return '<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;padding:4px 2px;cursor:pointer"><input type="checkbox" data-col="' + c[0] + '"' + (checked ? ' checked' : '') + '>' + c[1] + '</label>';
        }).join('') + '<div style="margin-top:8px;text-align:right"><button class="btn sec" id="gamifColsDone" style="height:26px;font-size:11.5px">Done</button></div>';
        e.target.parentElement.appendChild(pop);
        pop.querySelectorAll('input[type=checkbox]').forEach(function(cb) {
          cb.onchange = function() { window.__gamifCols[cb.getAttribute('data-col')] = cb.checked; applyColumnVisibility(); };
        });
        document.getElementById('gamifColsDone').onclick = closeColsPopover;
        setTimeout(function() {
          document.addEventListener('click', function closeOnOutside(ev) {
            if (!pop.contains(ev.target) && ev.target.id !== 'gamifColsBtn') { closeColsPopover(); document.removeEventListener('click', closeOnOutside); }
          });
        }, 0);
      };
    }

    // Export — placed right after "+ Create Profile", matching the
    // prototype's own static markup order for this page.
    var rt = cnt.querySelector('.tt .rt');
    if (rt && !document.getElementById('gamifExportBtn')) {
      var exportBtn = document.createElement('button');
      exportBtn.className = 'btn sec';
      exportBtn.id = 'gamifExportBtn';
      exportBtn.textContent = 'Export';
      exportBtn.onclick = exportGamifCsv;
      rt.appendChild(exportBtn);
    }

    // Pagination footer — .pgr is already styled in mcm.css, just never
    // used by the real render function.
    var tblw = cnt.querySelector('.tblw');
    if (tblw && !document.getElementById('gamifPagination')) {
      var footer = document.createElement('div');
      footer.id = 'gamifPagination';
      tblw.parentNode.insertBefore(footer, tblw.nextSibling);
    }

    applyGamifPage();
  }

  // The original render function's own fromBackendGamif() (a closure it
  // doesn't expose) never copies the API's division field onto the client
  // objects it builds — it predates this field existing at all. Rather
  // than fight that closure, this backfills division separately by dbId
  // once per session, so the Division filter has real data to work with
  // without needing to touch the original hydration logic.
  var divisionsBackfilled = false;
  function backfillDivisions() {
    if (divisionsBackfilled || !window.__authToken) return;
    divisionsBackfilled = true;
    fetch(SUBS_API_BASE + '/api/gamification-profiles?limit=500', { headers: { 'Authorization': 'Bearer ' + window.__authToken } })
      .then(function(r) { return r.json(); })
      .then(function(rows) {
        if (!Array.isArray(rows)) return;
        var byDbId = {};
        rows.forEach(function(r) { byDbId[r.id] = r.division || ''; });
        (DB.gamification || []).forEach(function(p) {
          if (p.dbId && byDbId.hasOwnProperty(p.dbId)) p.division = byDbId[p.dbId];
        });
        applyGamifPage();
      }).catch(function() { divisionsBackfilled = false; });
  }

  var origRenderGamif = window.renderGamif;
  if (origRenderGamif) window.renderGamif = function() {
    origRenderGamif();
    injectToolbarAndFooter();
    backfillDivisions();
  };

  // ---- editGamif / saveGamif: add a Division field ----
  // Full reimplementation (not a wrap) since the division value needs to
  // land inside the same POST/PUT payload the original builds internally
  // — there's no seam to hook a wrap into partway through that function.
  var origEditGamif = window.editGamif;
  if (origEditGamif) window.editGamif = function(id) {
    var p = id ? gamifById(id) : null; var isNew = !p;
    p = p || { id: '', name: '', appliesTo: 'Division', target: '', m1: 'Service level', t1: 85, w1: 300, m2: '', t2: 90, w2: 300, leaderboard: true, badges: true, challenges: true, reset: 'Weekly', division: '' };
    var m1Opts = ['Service level', 'Average handle time', 'Quality score', 'CSAT', 'Adherence', 'Occupancy'].map(function(m) { return '<option' + (p.m1 === m ? ' selected' : '') + '>' + m + '</option>'; }).join('');
    var m2Opts = ['— none —', 'Quality score', 'CSAT', 'Transfer rate', 'First contact resolution'].map(function(m) { var val = (m === '— none —') ? '' : m; return '<option' + ((p.m2 || '') === val ? ' selected' : '') + '>' + m + '</option>'; }).join('');
    var applyOpts = ['Division', 'Group', 'Queue', 'Individual'].map(function(a) { return '<option' + (p.appliesTo === a ? ' selected' : '') + '>' + a + '</option>'; }).join('');
    var divOpts = '<option value="">— none —</option>' + DIVISIONS.map(function(d) { return '<option value="' + d.code + '"' + ((p.division || '') === d.code ? ' selected' : '') + '>' + d.label + '</option>'; }).join('');
    gOpenDrawerHTML('<div id="drw"><div class="dh"><h2>' + (isNew ? 'Create Profile' : 'Edit — ' + gEsc(p.name)) + '</h2><div class="x" onclick="closeDrawer()">×</div></div>' +
      '<div class="db"><div id="gferr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
      '<div class="sect">Metric profile</div>' +
      '<div class="fld"><label>Name *</label><input id="gf_name" value="' + gEsc(p.name) + '"></div>' +
      '<div class="fld"><label>Division</label><select id="gf_division">' + divOpts + '</select></div>' +
      '<div class="fld"><label>Applies to</label><select id="gf_applies">' + applyOpts + '</select></div>' +
      '<div class="fld"><label>Target group</label><input id="gf_target" value="' + gEsc(p.target) + '" placeholder="e.g. Retail Billing"></div>' +
      '<div class="sect">Metrics</div>' +
      '<div class="fld"><label>Metric 1 *</label><select id="gf_m1">' + m1Opts + '</select></div>' +
      '<div class="fld"><label>Target</label><input id="gf_t1" type="number" value="' + p.t1 + '"></div>' +
      '<div class="fld"><label>Weight (points)</label><input id="gf_w1" type="number" value="' + p.w1 + '"></div>' +
      '<div class="fld"><label>Metric 2</label><select id="gf_m2">' + m2Opts + '</select></div>' +
      '<div class="fld"><label>Target 2</label><input id="gf_t2" type="number" value="' + p.t2 + '"></div>' +
      '<div class="fld"><label>Weight 2 (points)</label><input id="gf_w2" type="number" value="' + p.w2 + '"></div>' +
      '<div class="sect">Recognition</div>' +
      '<div class="tgl"><div class="sw' + (p.leaderboard ? ' on' : '') + '" id="gf_lb" onclick="this.classList.toggle(\\'on\\')"></div>Show on team leaderboard</div>' +
      '<div class="tgl"><div class="sw' + (p.badges ? ' on' : '') + '" id="gf_bg" onclick="this.classList.toggle(\\'on\\')"></div>Award badges at 100% of target</div>' +
      '<div class="tgl"><div class="sw' + (p.challenges ? ' on' : '') + '" id="gf_ch" onclick="this.classList.toggle(\\'on\\')"></div>Enable weekly challenges</div>' +
      '<div class="fld"><label>Reset period</label><select id="gf_reset"><option' + (p.reset === 'Daily' ? ' selected' : '') + '>Daily</option><option' + (p.reset === 'Weekly' ? ' selected' : '') + '>Weekly</option><option' + (p.reset === 'Monthly' ? ' selected' : '') + '>Monthly</option></select></div>' +
      (isNew ? '' : '<div style="margin-top:10px"><button class="btn gh" onclick="delGamif(\\'' + p.id + '\\')">Delete profile</button></div>') +
      '</div><div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="saveGamif(\\'' + (p.id || '') + '\\')">Save</button></div></div>');
  };

  var origSaveGamif = window.saveGamif;
  if (origSaveGamif) window.saveGamif = function(id) {
    var name = document.getElementById('gf_name').value.trim();
    var errs = [];
    if (name.length < 2) errs.push('Name is required.');
    var w1 = parseInt(document.getElementById('gf_w1').value, 10) || 0;
    var w2 = parseInt(document.getElementById('gf_w2').value, 10) || 0;
    if (w1 <= 0) errs.push('Metric 1 weight must be greater than 0.');
    if (errs.length) { gErrBox('gferr', errs); return; }

    var p = id ? gamifById(id) : null; var isNew = !p;
    if (!p) { p = { id: gUid(), status: 'Active' }; DB.gamification.push(p); }
    p.name = name;
    p.division = document.getElementById('gf_division').value;
    p.appliesTo = document.getElementById('gf_applies').value;
    p.target = document.getElementById('gf_target').value.trim();
    p.m1 = document.getElementById('gf_m1').value;
    p.t1 = parseInt(document.getElementById('gf_t1').value, 10) || 0;
    p.w1 = w1;
    var m2sel = document.getElementById('gf_m2').value;
    p.m2 = (m2sel === '— none —') ? '' : m2sel;
    p.t2 = p.m2 ? (parseInt(document.getElementById('gf_t2').value, 10) || 0) : 0;
    p.w2 = p.m2 ? w2 : 0;
    p.leaderboard = document.getElementById('gf_lb').classList.contains('on');
    p.badges = document.getElementById('gf_bg').classList.contains('on');
    p.challenges = document.getElementById('gf_ch').classList.contains('on');
    p.reset = document.getElementById('gf_reset').value;

    gAudit((isNew ? 'Create' : 'Edit') + ' gamification profile', name);
    window.closeDrawer(); window.toast('Metric profile saved'); window.renderGamif();

    if (!window.__authToken) return;
    var payload = {
      name: p.name, applies_to: p.appliesTo, target: p.target, m1: p.m1, t1: p.t1, w1: p.w1,
      m2: p.m2 || null, t2: p.t2, w2: p.w2, leaderboard: p.leaderboard, badges: p.badges, challenges: p.challenges,
      reset_period: p.reset, status: p.status, division: p.division || ''
    };
    var req = p.dbId ?
      fetch(SUBS_API_BASE + '/api/gamification-profiles/' + p.dbId, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + window.__authToken }, body: JSON.stringify(payload) }) :
      fetch(SUBS_API_BASE + '/api/gamification-profiles', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + window.__authToken }, body: JSON.stringify(payload) });
    req.then(function(r) { return r.json(); }).then(function(d) { if (d && d.id) { p.dbId = d.id; } }).catch(function() {});
  };

  // ---- Leaderboards / Badges / Challenges tabs lose the footer ----
  // scripts.ts's generic "Tab switch handler for static pages" (Engine
  // v9's TT map) fully replaces #cnt .pbody's innerHTML with just the
  // bare stub table for every tab except the first, then restores the
  // original snapshot when the first tab (Profiles) is clicked again.
  // That wholesale replacement drops the toolbar and the Help & Resources
  // footer along with it — Profiles keeps its footer only because
  // clicking back to it restores the pre-switch snapshot verbatim.
  // Registered after scripts.ts's own listener (this script tag runs
  // later — see routes/index.tsx), so it fires second on the same click
  // and can append the footer back in once the generic handler is done.
  document.addEventListener('click', function(e) {
    var tb = e.target.closest && e.target.closest('.tb');
    if (!tb || !tb.closest('#cnt')) return;
    if (!window.APP || window.APP.page !== 'gamif') return;
    var firstTab = tb.parentElement && tb.parentElement.children[0];
    if (tb === firstTab) return; // Profiles restores its own snapshot, footer included
    var pb = document.querySelector('#cnt .pbody');
    if (!pb || pb.querySelector('.help')) return;
    if (window.renderHelp) pb.insertAdjacentHTML('beforeend', window.renderHelp('gamif'));
  });
})();
`;
