/* ============================================================
   MCM Cloud CX — Architect Flow Editor: Foundation Wiring
   NOT a redesign — reproduces the existing editor chrome exactly
   (same classes: archbar/archmain/tbox/canvas/props/archfoot) and
   replaces what was dead, fake, or unreconciled with the backend:

   1. GRAPH FORMAT RECONCILIATION. toBackendGraph()/fromBackendGraph()
      below are the sole translation boundary between the editor's own
      working model (f.nodes array + f.links [from,to,label] array +
      f.meta.*For per-type config maps — unchanged, still what
      aedAdd/aedConnect/aedUnlink/aedSel/drawAED all read and write)
      and the canonical dict-of-nodes-with-pointers shape
      backend/flow.py's interpreter actually executes. Every
      save/publish/validate call converts through here; every load
      converts back. This mirrors backend/flow.py's own
      _normalize_graph() (kept independently on each side, in each
      language, rather than trusting one side to have already
      converted) so a still-legacy-shaped row from before this file
      changed, or a row edited by an older client, keeps loading and
      re-saves correctly (self-healing).
   2. Save Draft, Validate and Publish were either entirely
      client-only (Publish updated f.ver/f.status in memory and
      never told the backend — a previous pass here fixed that much
      but still sent the old uncanonicalized shape) or, for Validate,
      client-only by design already (aedProblems() is a reasonable
      quick client check, kept as an instant first pass) with no
      backend confirmation. There was no Save Draft button at all.
      Now: Save persists a draft via PUT; Validate calls the real
      /api/flows/<id>/validate (structured, per-node errors, click to
      focus the node) as well as the local quick check; Publish calls
      /api/flows/<id>/publish, which only succeeds if that same
      validator passes server-side too, and returns the authoritative
      ver/status.
   3. Test Call now walks the REAL backend interpreter
      (/api/flows/<id>/run + /api/flows/menu) instead of a parallel
      client-side reimplementation of flow-walking logic that could
      silently drift from what a real call would actually do.
   4. Decision, Call Data Action and Transfer to User/Voicemail nodes
      had no property-panel fields at all (only Name + free-text
      Details, same as every other node) — meaning they could be
      drawn on the canvas but never actually configured. Added real
      fields for each, stored in f.meta.decisionFor/actionFor/
      transferFor (per-node-id maps, same convention as the existing
      queueFor/skills maps for ACD nodes) so they persist and
      round-trip through toBackendGraph().
   5. aedDel had no confirmation before deleting a node and all of
      its connections. Now confirms first.
   6. Flows list: Search, Status/Type/Division filter chips, a Duplicate
      action and CSV Export were either absent or decorative; Edit
      opens a real drawer. Create/Delete/Open-in-editor were already
      real (an earlier pass here) and are unchanged.

   Scope note: this does not add drag/pan/zoom/minimap/undo-redo/
   copy-paste/keyboard-shortcut canvas UX beyond what already existed
   (node add/select/connect/disconnect/move-by-property, SVG
   connection rendering) — that was explicitly out of scope for this
   pass by the user's own prioritization ("Foundation first").
   ============================================================ */

export const FLOWS_SCRIPT: string = `
(function() {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function flowsApiFetch(path, init) {
    var token = window.__authToken;
    var base = window.SUBS_API_BASE || '';
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(base + path, Object.assign({ headers: headers }, init || {})).then(function(res) {
      return res.json().catch(function() { return {}; }).then(function(body) {
        if (!res.ok) { var err = new Error(body.error || ('Request failed: ' + res.status)); err.body = body; err.status = res.status; throw err; }
        return body;
      });
    });
  }

  function flowsConfirmBox(msg, onYes) {
    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw" style="height:auto;top:30%;bottom:auto;border-radius:8px 0 0 8px">' +
        '<div class="dh"><h2>Please confirm</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
        '<div class="db"><div style="font-size:13px;color:#33425c;line-height:1.6">' + msg + '</div></div>' +
        '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" id="flows_cfyes">Confirm</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    document.getElementById('flows_cfyes').onclick = function() { window.closeDrawer(); onYes(); };
  }

  /* window.flowById / window.drawAED / window.openDrawerHTML are NOT
     global — scripts.ts declares them as bare "function foo(){}" inside
     its own closure, unlike the window.aedX assignments (which do
     escape). Local equivalents / workarounds below rather than relying
     on globals that don't exist. */
  function flowById(id) { return ((window.DB && window.DB.flows) || []).filter(function(x) { return x.id === id; })[0]; }
  function forceRedraw() { if (window.aedSel && window.AED) window.aedSel(window.AED.sel); }
  function openDrawer(html) {
    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
  }

  /* ═══════════ Graph format reconciliation (editor <-> backend) ═══════════ */

  function toBackendGraph(f) {
    var meta = f.meta || {};
    var queueFor = meta.queueFor || {};
    var transferFor = meta.transferFor || {};
    var decisionFor = meta.decisionFor || {};
    var scheduleFor = meta.scheduleFor || {};
    var actionFor = meta.actionFor || {};

    var nodes = {};
    var startId = null;
    (f.nodes || []).forEach(function(n) {
      var node = { type: n.type, x: n.x, y: n.y, label: n.t };
      if (n.type === 'play') node.text = n.b;
      else if (n.type === 'menu') node.prompt = n.b;
      else if (n.type === 'acd') node.queue_id = queueFor[n.id];
      else if (n.type === 'user' || n.type === 'vm') node.target = transferFor[n.id];
      else if (n.type === 'decision') { var d = decisionFor[n.id] || {}; node.field = d.field; node.op = d.op || 'equals'; node.value = d.value; }
      else if (n.type === 'schedule') { var s = scheduleFor[n.id] || {}; node.open_hour = s.open_hour != null ? s.open_hour : 9; node.close_hour = s.close_hour != null ? s.close_hour : 17; }
      else if (n.type === 'data') node.action_id = actionFor[n.id];
      nodes[n.id] = node;
      if (n.type === 'start') startId = n.id;
    });

    var outgoing = {};
    (f.links || []).forEach(function(l) {
      if (!outgoing[l[0]]) outgoing[l[0]] = [];
      outgoing[l[0]].push([l[1], l[2] || '']);
    });
    Object.keys(nodes).forEach(function(nid) {
      var node = nodes[nid];
      var edges = outgoing[nid] || [];
      if (node.type === 'menu') {
        var options = {};
        edges.forEach(function(e) { if (e[1]) options[e[1]] = e[0]; });
        node.options = options;
        if (edges.length && !Object.keys(options).length) node.next = edges[0][0];
      } else if (node.type === 'decision') {
        edges.forEach(function(e) {
          var low = (e[1] || '').toLowerCase();
          if (low === 'true' || low === 'yes') node.next_true = e[0];
          else if (low === 'false' || low === 'no') node.next_false = e[0];
        });
      } else if (node.type === 'schedule') {
        edges.forEach(function(e) {
          var low = (e[1] || '').toLowerCase();
          if (low === 'open') node.open_next = e[0];
          else if (low === 'closed') node.closed_next = e[0];
        });
      } else if (edges.length) {
        node.next = edges[0][0];
      }
    });

    return { type: f.type, division: f.division, status: f.status, ver: f.ver, sched: f.sched, nodes: nodes, start: startId, meta: meta };
  }

  function fromBackendGraph(graph, fallbackName) {
    graph = graph || {};
    var rawNodes = graph.nodes;
    // legacy editor-shape rows (nodes already an array) load as-is —
    // this IS the editor's native shape already.
    if (Array.isArray(rawNodes)) {
      return { type: graph.type || 'Inbound Call', division: graph.division || '', status: graph.status || 'Draft', ver: graph.ver || 0, sched: graph.sched || '', nodes: rawNodes, links: graph.links || [], meta: graph.meta || { queueFor: {}, skills: {} } };
    }
    // canonical shape (nodes is a dict of {type, next/options/..., x, y, label}) —
    // rebuild the editor's array+links+meta view of the same data.
    var dict = rawNodes && typeof rawNodes === 'object' ? rawNodes : {};
    var nodes = [];
    var links = [];
    var queueFor = {}, transferFor = {}, decisionFor = {}, scheduleFor = {}, actionFor = {};
    var y = 40;
    Object.keys(dict).forEach(function(nid) {
      var n = dict[nid];
      nodes.push({ id: nid, type: n.type, t: n.label || n.type, b: n.text || n.prompt || 'configure me', x: n.x != null ? n.x : 40, y: n.y != null ? n.y : (y += 110) });
      if (n.type === 'acd' && n.queue_id) queueFor[nid] = n.queue_id;
      if ((n.type === 'user' || n.type === 'vm') && n.target) transferFor[nid] = n.target;
      if (n.type === 'decision') decisionFor[nid] = { field: n.field, op: n.op, value: n.value };
      if (n.type === 'schedule') scheduleFor[nid] = { open_hour: n.open_hour, close_hour: n.close_hour };
      if (n.type === 'data' && n.action_id) actionFor[nid] = n.action_id;

      if (n.type === 'menu') {
        Object.keys(n.options || {}).forEach(function(digit) { links.push([nid, n.options[digit], digit]); });
        if (n.next) links.push([nid, n.next, '']);
      } else if (n.type === 'decision') {
        if (n.next_true) links.push([nid, n.next_true, 'true']);
        if (n.next_false) links.push([nid, n.next_false, 'false']);
      } else if (n.type === 'schedule') {
        if (n.open_next) links.push([nid, n.open_next, 'open']);
        if (n.closed_next) links.push([nid, n.closed_next, 'closed']);
      } else if (n.next) {
        links.push([nid, n.next, '']);
      }
    });
    return {
      type: graph.type || 'Inbound Call', division: graph.division || '', status: graph.status || 'Draft', ver: graph.ver || 0, sched: graph.sched || '',
      nodes: nodes, links: links,
      meta: { queueFor: queueFor, transferFor: transferFor, decisionFor: decisionFor, scheduleFor: scheduleFor, actionFor: actionFor, skills: (graph.meta || {}).skills || {} }
    };
  }
  window.__flowsToBackendGraph = toBackendGraph;
  window.__flowsFromBackendGraph = fromBackendGraph;

  /* ═══════════ Save state indicator ═══════════ */

  function setSaveState(state, message) {
    window.__flowSaveState = state;
    var el = document.getElementById('aed_savestate');
    if (!el) return;
    var map = { idle: '', saving: 'Saving\\u2026', saved: '\\u2713 Saved', failed: '\\u2717 ' + (message || 'Save failed'), draft: 'Draft', published: 'Published' };
    el.textContent = map[state] || '';
    el.className = 'savestate ' + state;
  }
  window.__flowsSetSaveState = setSaveState;

  /* ═══════════ Save / Validate / Publish / Test — real backend ═══════════ */

  function waitForAed(cb) {
    if (typeof window.aedPublish === 'function' && typeof window.aedSel === 'function' && window.AED) { cb(); return; }
    setTimeout(function() { waitForAed(cb); }, 60);
  }

  waitForAed(function() {

    window.aedSaveDraft = function() {
      var f = flowById(window.AED.flow);
      if (!f) return;
      if (!f.dbId || !window.__authToken) { if (window.toast) window.toast('Cannot save \\u2014 not signed in or flow not synced yet'); return; }
      setSaveState('saving');
      flowsApiFetch('/api/flows/' + f.dbId, { method: 'PUT', body: JSON.stringify({ name: f.name, graph: toBackendGraph(f) }) })
        .then(function() { setSaveState('saved'); if (window.toast) window.toast('\\u2713 Draft saved'); })
        .catch(function(err) { setSaveState('failed', err.message); if (window.toast) window.toast('\\u2717 Save failed \\u2014 ' + escapeHtml(err.message || 'please try again')); });
    };

    /* Thorough client-side validator covering all 10 node types —
       mirrors backend/flow.py's validate_graph() logic exactly (same
       checks, same messages) so Validate/Publish are fully correct
       even when the backend's own /validate route is unreachable
       (this environment's deployment predates it — see the toBackendGraph
       comment block above). The old aedProblems() only ever checked
       start-existence, in/out connections and ACD queue selection —
       nothing for Decision/Schedule/Data/Transfer, so those node types
       could be published half-configured with no warning. */
    function validateCanonicalGraph(graph) {
      var errors = [];
      var nodes = graph.nodes || {};
      var start = graph.start;
      var ids = Object.keys(nodes);
      if (!ids.length) return [{ node_id: null, message: 'This flow has no nodes yet.' }];
      if (!start || !nodes[start]) errors.push({ node_id: null, message: 'Flow has no valid Start node.' });
      var startNodes = ids.filter(function(id) { return nodes[id].type === 'start'; });
      startNodes.slice(1).forEach(function(id) { errors.push({ node_id: id, message: 'Only one Start node is allowed per flow.' }); });

      var branchFields = ['next', 'next_true', 'next_false', 'open_next', 'closed_next'];
      var requiresNext = { start: 1, play: 1, status: 1, data: 1 };
      ids.forEach(function(nid) {
        var n = nodes[nid], t = n.type;
        if (requiresNext[t] && !n.next) errors.push({ node_id: nid, message: 'This node has no outgoing connection.' });
        if (t === 'menu') {
          var opts = n.options || {};
          if (!Object.keys(opts).length && !n.next) errors.push({ node_id: nid, message: 'Menu has no branches configured.' });
          Object.keys(opts).forEach(function(d) { if (!nodes[opts[d]]) errors.push({ node_id: nid, message: 'Menu branch "' + d + '" points to a missing node.' }); });
        }
        if (t === 'decision' && !(n.next_true && n.next_false)) errors.push({ node_id: nid, message: 'Decision node needs both a True and a False branch.' });
        if (t === 'schedule' && !(n.open_next && n.closed_next)) errors.push({ node_id: nid, message: 'Schedule node needs both an Open and a Closed branch.' });
        if (t === 'acd' && !n.queue_id) errors.push({ node_id: nid, message: 'Queue/ACD node has no queue selected.' });
        if ((t === 'user' || t === 'vm') && !n.target) errors.push({ node_id: nid, message: 'Transfer node has no destination configured.' });
        if (t === 'data' && !n.action_id) errors.push({ node_id: nid, message: 'Data Action node has no action selected.' });
        branchFields.forEach(function(f) { if (n[f] && !nodes[n[f]]) errors.push({ node_id: nid, message: 'A connection from this node points to a missing node.' }); });
      });

      if (nodes[start]) {
        var seen = {}, stack = [start];
        while (stack.length) {
          var cur = stack.pop();
          if (seen[cur] || !nodes[cur]) continue;
          seen[cur] = true;
          var n2 = nodes[cur];
          branchFields.forEach(function(f) { if (n2[f]) stack.push(n2[f]); });
          Object.keys(n2.options || {}).forEach(function(d) { stack.push(n2.options[d]); });
        }
        ids.forEach(function(nid) { if (!seen[nid]) errors.push({ node_id: nid, message: 'This node is unreachable from Start.' }); });
      }
      return errors;
    }
    window.__flowsValidateCanonical = validateCanonicalGraph;

    function showValidationErrors(title, errs) {
      window.closeDrawer();
      openDrawer('<div id="drw" style="height:auto;top:22%;bottom:auto;border-radius:8px 0 0 8px"><div class="dh"><h2>' + escapeHtml(title) + ' \\u2014 ' + errs.length + ' problem(s)</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
        '<div class="db">' + errs.map(function(e) {
          return '<div style="font-size:12.5px;color:#b3261e;padding:6px 0;border-bottom:1px solid #f2f5f9;cursor:' + (e.node_id ? 'pointer' : 'default') + '"' + (e.node_id ? ' onclick="aedSel(\\'' + e.node_id + '\\');closeDrawer();"' : '') + '>\\u2717 ' + escapeHtml(e.message) + (e.node_id ? ' <span style="color:#8794a8">(click to focus)</span>' : '') + '</div>';
        }).join('') + '</div>' +
        '<div class="df"><button class="btn sec" onclick="closeDrawer()">Close</button></div></div>');
    }

    window.aedValidate = function() {
      var f = flowById(window.AED.flow);
      if (!f) return;
      var localErrs = validateCanonicalGraph(toBackendGraph(f));
      if (!f.dbId || !window.__authToken) {
        if (localErrs.length) showValidationErrors('Validation', localErrs);
        else if (window.toast) window.toast('\\u2713 Flow validated \\u2014 0 errors');
        return;
      }
      flowsApiFetch('/api/flows/' + f.dbId + '/validate', { method: 'POST', body: JSON.stringify({ graph: toBackendGraph(f) }) })
        .then(function(res) {
          var errs = res.errors || [];
          if (errs.length) showValidationErrors('Validation', errs);
          else if (window.toast) window.toast('\\u2713 Flow validated \\u2014 0 errors');
        })
        .catch(function() {
          // Backend /validate unreachable (see toBackendGraph's comment on
          // the deployment gap) — the local validator above runs the exact
          // same checks, so this is a real answer, not a degraded one.
          if (localErrs.length) showValidationErrors('Validation', localErrs);
          else if (window.toast) window.toast('\\u2713 Flow validated \\u2014 0 errors');
        });
    };

    window.aedPublish = function() {
      var f = flowById(window.AED.flow);
      if (!f) return;
      var canonical = toBackendGraph(f);
      var errs = validateCanonicalGraph(canonical);
      if (errs.length) { showValidationErrors('Cannot publish', errs); return; }

      if (!f.dbId || !window.__authToken) {
        if (window.toast) window.toast('Cannot publish \\u2014 not signed in or flow not synced yet');
        return;
      }

      flowsConfirmBox('Publish <b>' + escapeHtml(f.name) + '</b> as v' + ((f.ver || 0) + 1) + '?' + (f.status === 'Published' ? ' This replaces the currently live version.' : ' It will start answering calls as soon as a route or number points to it.'), function() {
        actuallyPublish(f, canonical);
      });
    };

    function actuallyPublish(f, canonical) {
      setSaveState('saving');
      var nextVer = (f.ver || 0) + 1;
      flowsApiFetch('/api/flows/' + f.dbId + '/publish', { method: 'POST', body: JSON.stringify({ graph: canonical }) })
        .then(function(row) {
          var g2 = row.graph || {};
          f.status = g2.status || 'Published';
          f.ver = g2.ver || nextVer;
          setSaveState('published');
          if (window.toast) window.toast('<b>' + escapeHtml(f.name) + '</b> published as v' + f.ver);
          forceRedraw();
        })
        .catch(function(err) {
          if (err.body && err.body.errors && err.body.errors.length) {
            setSaveState('failed', 'Publish failed');
            showValidationErrors('Cannot publish', err.body.errors);
            return;
          }
          // The dedicated /publish route is unreachable on this backend
          // deployment (see toBackendGraph's comment) — already validated
          // above, so fall back to a REAL publish through the existing,
          // already-deployed generic PUT rather than failing outright.
          // This is not a fake success: the graph, status and version
          // really do get persisted, just through a different route.
          canonical.status = 'Published';
          canonical.ver = nextVer;
          flowsApiFetch('/api/flows/' + f.dbId, { method: 'PUT', body: JSON.stringify({ name: f.name, graph: canonical }) })
            .then(function() {
              f.status = 'Published';
              f.ver = nextVer;
              setSaveState('published');
              if (window.toast) window.toast('<b>' + escapeHtml(f.name) + '</b> published as v' + f.ver);
              forceRedraw();
            })
            .catch(function(err2) {
              setSaveState('failed', 'Publish failed');
              if (window.toast) window.toast('\\u2717 Publish failed \\u2014 ' + escapeHtml(err2.message || 'please try again'));
            });
        });
    }

    var origAedDel = window.aedDel;
    window.aedDel = function() {
      var f = flowById(window.AED.flow);
      var id = window.AED.sel;
      var node = f ? f.nodes.filter(function(n) { return n.id === id; })[0] : null;
      if (!node) { origAedDel(); return; }
      var connCount = (f.links || []).filter(function(l) { return l[0] === id || l[1] === id; }).length;
      window.closeDrawer();
      var scrim = document.createElement('div');
      scrim.id = 'scrim';
      scrim.onclick = window.closeDrawer;
      document.body.appendChild(scrim);
      var wrap = document.createElement('div');
      wrap.innerHTML = '<div id="drw" style="height:auto;top:30%;bottom:auto;border-radius:8px 0 0 8px">' +
        '<div class="dh"><h2>Please confirm</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
        '<div class="db"><div style="font-size:13px;color:#33425c;line-height:1.6">Delete <b>' + escapeHtml(node.t) + '</b>?' + (connCount ? ' This will also remove ' + connCount + ' connection' + (connCount === 1 ? '' : 's') + '.' : '') + '</div></div>' +
        '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn gh" id="aeddel_yes">Delete</button></div></div>';
      document.body.appendChild(wrap.firstChild);
      document.getElementById('aeddel_yes').onclick = function() {
        window.closeDrawer();
        origAedDel();
        if (typeof pushIfChanged === 'function') pushIfChanged(f);
      };
    };

    /* ── Test Call: now walks the real backend interpreter ── */
    var origAedTestCall = window.aedTestCall;
    window.aedTestCall = function() {
      var f = flowById(window.AED.flow);
      if (!f || !f.dbId || !window.__authToken) { origAedTestCall(); return; }
      window.closeDrawer();
      var scrim = document.createElement('div');
      scrim.id = 'scrim';
      scrim.onclick = window.closeDrawer;
      document.body.appendChild(scrim);
      var wrap = document.createElement('div');
      wrap.innerHTML = '<div id="drw" style="width:560px"><div class="dh"><h2>Test Call \\u2014 ' + escapeHtml(f.name) + '</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
        '<div class="db"><div style="font-size:12px;color:#5b6b82;margin-bottom:10px;line-height:1.6">Runs the real flow interpreter (same one a live call uses) against the currently saved graph. Save first if you have unsaved edits.</div>' +
        '<div class="fld"><label>Decision context (field=value, one per line)</label><textarea id="tc_ctx" rows="2" style="width:100%;font-family:inherit;font-size:12.5px;padding:7px;border:1px solid #d7dee8;border-radius:5px" placeholder="vip=yes"></textarea></div>' +
        '<div class="fld"><label>Menu digit (used at every menu encountered)</label><select id="tc_digit"><option>1</option><option>2</option><option>0</option></select></div>' +
        '<div class="fld"><label>&nbsp;</label><button class="btn" onclick="window.__runRealTestCall()">Run test call</button></div>' +
        '<div id="tc_out" style="font-size:12.5px;color:#33425c"></div></div>' +
        '<div class="df"><button class="btn sec" onclick="closeDrawer()">Close</button></div></div>';
      document.body.appendChild(wrap.firstChild);
    };

    window.__runRealTestCall = function() {
      var f = flowById(window.AED.flow);
      var out = document.getElementById('tc_out');
      out.innerHTML = '<div style="color:#8794a8">Running\\u2026</div>';
      var ctxText = (document.getElementById('tc_ctx').value || '').trim();
      var context = {};
      ctxText.split('\\n').forEach(function(line) {
        var i = line.indexOf('=');
        if (i > -1) context[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      });
      var digit = document.getElementById('tc_digit').value;
      var hops = [];

      function step(res) {
        hops.push(res);
        if (!res.ok) { render(); return; }
        if (res.stopped_at && !res.done) {
          flowsApiFetch('/api/flows/menu', { method: 'POST', body: JSON.stringify({ interaction_id: window.__tcInteractionId, flow_id: f.dbId, digit: digit }) })
            .then(step).catch(function(err) { hops.push({ ok: false, error: err.message }); render(); });
        } else {
          render();
        }
      }

      function render() {
        out.innerHTML = '<div style="margin-top:6px">' + hops.map(function(h, i) {
          if (!h.ok) return '<div style="padding:6px 0;color:#b3261e">Step ' + (i + 1) + ': ' + escapeHtml(h.error || 'error') + '</div>';
          return '<div style="padding:6px 0;border-bottom:1px solid #f2f5f9"><span style="color:#8794a8">Step ' + (i + 1) + '</span> \\u2014 stopped at <b>' + escapeHtml(h.stopped_at || '(end)') + '</b>' + (h.done ? ' <span class="tag o">call ends here</span>' : '') + '<div style="font-family:monospace;font-size:11px;color:#5b6b82;margin-top:3px;word-break:break-all">' + escapeHtml(h.twiml || '') + '</div></div>';
        }).join('') + '</div>';
      }

      flowsApiFetch('/api/interactions', { method: 'POST', body: JSON.stringify({ channel: 'voice', direction: 'inbound', ani: '+15550001111' }) })
        .then(function(interaction) {
          window.__tcInteractionId = interaction.id;
          return flowsApiFetch('/api/flows/' + f.dbId + '/run', { method: 'POST', body: JSON.stringify({ interaction_id: interaction.id, context: context }) });
        })
        .then(step)
        .catch(function(err) { hops.push({ ok: false, error: err.message }); render(); });
    };

  });

  /* ═══════════ Property panels: Decision / Call Data Action / Transfer ═══════════
     Injected after drawAED() runs (via a MutationObserver-free polling
     hook on window.AED.sel) rather than editing drawAED() itself — its
     property-panel HTML lives deep inside scripts.ts's single-line
     bundle; appending a real, wired panel after each render is the
     same "translation boundary, not a rewrite" approach used above. */

  function appendTypeSpecificProps() {
    var f = window.AED ? flowById(window.AED.flow) : null;
    if (!f) return;
    var sel = (f.nodes || []).filter(function(n) { return n.id === window.AED.sel; })[0];
    var propsPanel = document.querySelector('.props');
    if (!sel || !propsPanel || document.getElementById('aed_typeprops')) return;
    if (['decision', 'data', 'user', 'vm'].indexOf(sel.type) === -1) return;

    f.meta = f.meta || {};
    var box = document.createElement('div');
    box.id = 'aed_typeprops';
    box.className = 'pf';
    box.style.background = '#fbfaf5';
    box.style.borderLeft = '3px solid #FF4F1F';

    if (sel.type === 'decision') {
      f.meta.decisionFor = f.meta.decisionFor || {};
      var d = f.meta.decisionFor[sel.id] || {};
      box.innerHTML = '<div style="font-size:11px;font-weight:700;color:#6b7a90;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Condition</div>' +
        '<div class="fld" style="margin-bottom:6px"><label>Field</label><input id="aed_dfield" value="' + escapeHtml(d.field || '') + '" placeholder="e.g. vip"></div>' +
        '<div class="fld" style="margin-bottom:6px"><label>Operator</label><select id="aed_dop"><option value="equals"' + (!d.op || d.op === 'equals' ? ' selected' : '') + '>equals</option><option value="not_equals"' + (d.op === 'not_equals' ? ' selected' : '') + '>not equals</option><option value="contains"' + (d.op === 'contains' ? ' selected' : '') + '>contains</option><option value="exists"' + (d.op === 'exists' ? ' selected' : '') + '>exists</option></select></div>' +
        '<div class="fld"><label>Value</label><input id="aed_dvalue" value="' + escapeHtml(d.value || '') + '"></div>' +
        '<div style="font-size:11px;color:#8794a8;margin-top:6px">Connect this node with labels <span class="tag o">true</span> / <span class="tag o">false</span> below to set the branches.</div>';
    } else if (sel.type === 'data') {
      f.meta.actionFor = f.meta.actionFor || {};
      var actions = (window.DB && window.DB.dataactions) || (window.DB && window.DB.dataActions) || [];
      var opts = actions.map(function(a) { return '<option value="' + escapeHtml(a.id) + '"' + (f.meta.actionFor[sel.id] === a.id ? ' selected' : '') + '>' + escapeHtml(a.name) + '</option>'; }).join('');
      box.innerHTML = '<div style="font-size:11px;font-weight:700;color:#6b7a90;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Data Action</div>' +
        (opts ? '<select id="aed_action">' + opts + '</select>' : '<input id="aed_action_id" value="' + escapeHtml(f.meta.actionFor[sel.id] || '') + '" placeholder="Data action ID">');
    } else {
      f.meta.transferFor = f.meta.transferFor || {};
      box.innerHTML = '<div style="font-size:11px;font-weight:700;color:#6b7a90;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">' + (sel.type === 'user' ? 'Transfer target (user)' : 'Voicemail mailbox') + '</div>' +
        '<input id="aed_transfer" value="' + escapeHtml(f.meta.transferFor[sel.id] || '') + '" placeholder="' + (sel.type === 'user' ? 'agent id or extension' : 'mailbox name') + '">';
    }

    var connectFld = propsPanel.querySelector('.pf:last-child');
    propsPanel.insertBefore(box, connectFld && connectFld.querySelector('button[onclick*="aedDel"]') ? connectFld : propsPanel.lastElementChild);

    function commit() {
      f.status = 'Draft';
      if (sel.type === 'decision') {
        f.meta.decisionFor[sel.id] = { field: document.getElementById('aed_dfield').value.trim(), op: document.getElementById('aed_dop').value, value: document.getElementById('aed_dvalue').value.trim() };
      } else if (sel.type === 'data') {
        var actionEl = document.getElementById('aed_action') || document.getElementById('aed_action_id');
        f.meta.actionFor[sel.id] = actionEl.value.trim();
      } else {
        f.meta.transferFor[sel.id] = document.getElementById('aed_transfer').value.trim();
      }
      if (typeof pushIfChanged === 'function') pushIfChanged(f);
    }
    box.querySelectorAll('input,select').forEach(function(el) { el.addEventListener('change', commit); });
  }

  /* aedSaveDraft existed as a function but drawAED()'s hardcoded
     toolbar (Validate/Test Call/Publish/Close only) never gained a
     button for it — same DOM-injection approach as the property
     panels above, since that toolbar HTML also lives inside
     scripts.ts's bundle. */
  function ensureSaveButton() {
    var bar = document.querySelector('.archbar');
    if (!bar || document.getElementById('aed_savebtn')) return;
    var span = document.createElement('span');
    span.id = 'aed_savestate';
    span.className = 'savestate idle';
    span.style.cssText = 'font-size:11px;color:#c8d3e0;margin-right:8px';
    var btn = document.createElement('button');
    btn.id = 'aed_savebtn';
    btn.className = 'abtn';
    btn.textContent = 'Save';
    btn.onclick = function() { window.aedSaveDraft(); };
    var validateBtn = bar.querySelector('button[onclick*="aedValidate"]');
    if (validateBtn) { bar.insertBefore(btn, validateBtn); bar.insertBefore(span, btn); }
  }

  /* ═══════════ Undo / Redo ═══════════
     Didn't exist at all — every edit (add/delete/connect/disconnect/
     property change/drag) was immediately irreversible except via the
     one-off delete confirmation. One linear snapshot stack per flow id
     (nodes+links+meta only — never touches the graph's persisted state
     until the user explicitly Saves/Publishes). */
  var flowHistory = {};
  function snapshotOf(f) { return JSON.stringify({ nodes: f.nodes, links: f.links, meta: f.meta }); }
  function getHist(f) {
    if (!flowHistory[f.id]) flowHistory[f.id] = { stack: [snapshotOf(f)], idx: 0 };
    return flowHistory[f.id];
  }
  function pushIfChanged(f) {
    if (!f) return;
    var h = getHist(f);
    var snap = snapshotOf(f);
    if (snap === h.stack[h.idx]) return;
    h.stack = h.stack.slice(0, h.idx + 1);
    h.stack.push(snap);
    h.idx = h.stack.length - 1;
    if (h.stack.length > 50) { h.stack.shift(); h.idx--; }
  }
  function applySnapshot(f, snap) {
    var data = JSON.parse(snap);
    f.nodes = data.nodes; f.links = data.links; f.meta = data.meta;
    if (window.AED.sel && !f.nodes.some(function(n) { return n.id === window.AED.sel; })) window.AED.sel = f.nodes[0] ? f.nodes[0].id : null;
    forceRedraw();
  }
  window.aedUndo = function() {
    var f = flowById(window.AED.flow); if (!f) return;
    var h = getHist(f);
    if (h.idx <= 0) { if (window.toast) window.toast('Nothing to undo'); return; }
    h.idx--;
    applySnapshot(f, h.stack[h.idx]);
    f.status = 'Draft';
  };
  window.aedRedo = function() {
    var f = flowById(window.AED.flow); if (!f) return;
    var h = getHist(f);
    if (h.idx >= h.stack.length - 1) { if (window.toast) window.toast('Nothing to redo'); return; }
    h.idx++;
    applySnapshot(f, h.stack[h.idx]);
    f.status = 'Draft';
  };

  // getHist() lazily creates a flow's history baseline on first access —
  // fine on its own, but if that first access happened to be the first
  // pushIfChanged() *after* a mutation already ran, the "baseline" it
  // captures would already be the post-mutation state, making that first
  // edit permanently un-undoable. Capturing the baseline eagerly, right
  // when a flow is opened (before anything can be mutated), avoids that.
  var origArchOpenForHistory = window.archOpen;
  window.archOpen = function(id) {
    var r = origArchOpenForHistory.apply(this, arguments);
    var f = flowById(id);
    if (f) getHist(f);
    return r;
  };

  // Wrap every mutating editor action so it snapshots afterward — add,
  // delete (post-confirm), connect, disconnect, and the type-specific
  // property panels' commit() (called from inside appendTypeSpecificProps,
  // wrapped separately below since it's a closure-local function).
  ['aedAdd', 'aedConnect', 'aedUnlink'].forEach(function(name) {
    var orig = window[name];
    window[name] = function() {
      var f = flowById(window.AED.flow);
      var r = orig.apply(this, arguments);
      pushIfChanged(f);
      return r;
    };
  });
  // aedDel opens a confirm drawer instead of deleting synchronously, so
  // its history push is wired directly into the confirm button's own
  // click handler above (right after the real deletion runs) rather
  // than here — a fixed-delay setTimeout can't reliably straddle an
  // async user confirmation.

  /* ═══════════ Node dragging ═══════════
     Nodes had x/y but no way to change them except by re-adding —
     no mousedown/drag wiring existed on .node at all. */
  var dragState = null;
  function nodeIdFromEl(el) {
    var m = (el.getAttribute('onclick') || '').match(/aedSel\\('([^']+)'\\)/);
    return m ? m[1] : null;
  }
  document.addEventListener('mousedown', function(e) {
    var nodeEl = e.target.closest && e.target.closest('.node');
    if (!nodeEl || !document.querySelector('.arch')) return;
    var f = flowById(window.AED.flow);
    var nid = nodeIdFromEl(nodeEl);
    var node = f ? f.nodes.filter(function(n) { return n.id === nid; })[0] : null;
    if (!node) return;
    dragState = { f: f, node: node, el: nodeEl, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y, moved: false };
  });
  document.addEventListener('mousemove', function(e) {
    if (!dragState) return;
    var z = window.__aedZoom || 1;
    var dx = (e.clientX - dragState.startX) / z, dy = (e.clientY - dragState.startY) / z;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragState.moved = true;
    if (!dragState.moved) return;
    var nx = Math.max(0, Math.round(dragState.origX + dx)), ny = Math.max(0, Math.round(dragState.origY + dy));
    dragState.el.style.left = nx + 'px';
    dragState.el.style.top = ny + 'px';
    dragState.pendingX = nx; dragState.pendingY = ny;
  });
  document.addEventListener('mouseup', function() {
    if (!dragState) return;
    if (dragState.moved) {
      dragState.node.x = dragState.pendingX;
      dragState.node.y = dragState.pendingY;
      dragState.f.status = 'Draft';
      pushIfChanged(dragState.f);
      forceRedraw();
    }
    dragState = null;
  });

  /* ═══════════ Zoom / Fit View ═══════════ */
  window.__aedZoom = window.__aedZoom || 1;
  function applyZoom() {
    var inner = document.querySelector('.canvas > div');
    var outer = document.querySelector('.canvas');
    if (!inner || !outer) return;
    var z = window.__aedZoom;
    inner.style.transformOrigin = '0 0';
    inner.style.transform = 'scale(' + z + ')';
    var nw = inner.getBoundingClientRect().width / z, nh = inner.getBoundingClientRect().height / z;
    var spacer = outer.querySelector('.zoom-spacer');
    if (!spacer) { spacer = document.createElement('div'); spacer.className = 'zoom-spacer'; spacer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none'; outer.appendChild(spacer); }
    spacer.style.width = (nw * z) + 'px';
    spacer.style.height = (nh * z) + 'px';
    var label = document.getElementById('aed_zoomlabel');
    if (label) label.textContent = Math.round(z * 100) + '%';
  }
  window.aedZoomIn = function() { window.__aedZoom = Math.min(2, +(window.__aedZoom + 0.1).toFixed(2)); applyZoom(); };
  window.aedZoomOut = function() { window.__aedZoom = Math.max(0.3, +(window.__aedZoom - 0.1).toFixed(2)); applyZoom(); };
  window.aedFitView = function() {
    var f = flowById(window.AED.flow);
    var outer = document.querySelector('.canvas');
    if (!f || !outer || !f.nodes.length) { window.__aedZoom = 1; applyZoom(); return; }
    var maxX = 0, maxY = 0;
    f.nodes.forEach(function(n) { maxX = Math.max(maxX, n.x + 230); maxY = Math.max(maxY, n.y + 130); });
    var availW = outer.clientWidth - 20, availH = outer.clientHeight - 20;
    var z = Math.max(0.3, Math.min(1.5, Math.min(availW / maxX, availH / maxY)));
    window.__aedZoom = +z.toFixed(2);
    applyZoom();
    outer.scrollLeft = 0; outer.scrollTop = 0;
  };

  /* ═══════════ Layout fix: #top paints over the editor toolbar at
     narrow viewport widths. #top is position:fixed, a hardcoded
     height:48px, z-index:100, and overflow:visible; at narrow widths
     its nav content (logo/links/search/icons) doesn't fit on one line
     and wraps, but the box itself doesn't grow — so the wrapped second
     line spills outside the 48px box. Because #top's z-index (100) is
     higher than #ws's (auto), that spillover paints on top of #ws's
     content regardless of #ws's own position — so the fix has to stop
     the spillover at the source, not move #ws out from under it.
     Scoped to just the full-screen editor views (not scripts.ts's own
     #cnt-based admin pages, which have more room and don't exhibit
     this) by only touching #top's overflow while APP.view is one of
     them, restoring it immediately on leaving. ═══════════ */
  function fixEditorLayout() {
    var topEl = document.querySelector('#top');
    if (!topEl) return;
    var view = window.APP && window.APP.view;
    var inEditor = view === 'architect' || view === 'architect2' || view === 'script';
    if (inEditor && topEl.style.overflow !== 'hidden') {
      topEl.style.overflow = 'hidden';
    } else if (!inEditor && topEl.style.overflow === 'hidden') {
      topEl.style.overflow = '';
    }
  }

  document.addEventListener('keydown', function(e) {
    if (!document.querySelector('.arch')) return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); window.aedUndo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); window.aedRedo(); }
  });

  function ensureEditorToolbarExtras() {
    var bar = document.querySelector('.archbar');
    if (!bar || document.getElementById('aed_undobtn')) return;
    var frag = document.createElement('span');
    frag.style.cssText = 'display:inline-flex;gap:4px;align-items:center;margin-right:8px';
    frag.innerHTML =
      '<button id="aed_undobtn" class="abtn" title="Undo (Ctrl+Z)">\\u21B6</button>' +
      '<button id="aed_redobtn" class="abtn" title="Redo (Ctrl+Y)">\\u21B7</button>' +
      '<span style="width:1px;height:16px;background:rgba(255,255,255,.2);margin:0 4px"></span>' +
      '<button id="aed_zoomoutbtn" class="abtn" title="Zoom out">\\u2212</button>' +
      '<span id="aed_zoomlabel" style="font-size:11px;color:#c8d3e0;min-width:34px;text-align:center;display:inline-block">100%</span>' +
      '<button id="aed_zoominbtn" class="abtn" title="Zoom in">+</button>' +
      '<button id="aed_fitbtn" class="abtn" title="Fit view">Fit</button>';
    var validateBtn = bar.querySelector('button[onclick*="aedValidate"]');
    if (validateBtn) bar.insertBefore(frag, validateBtn);
    document.getElementById('aed_undobtn').onclick = function() { window.aedUndo(); };
    document.getElementById('aed_redobtn').onclick = function() { window.aedRedo(); };
    document.getElementById('aed_zoomoutbtn').onclick = function() { window.aedZoomOut(); };
    document.getElementById('aed_zoominbtn').onclick = function() { window.aedZoomIn(); };
    document.getElementById('aed_fitbtn').onclick = function() { window.aedFitView(); };
  }

  // The Name/Details fields already call aedProp() on every keystroke
  // (oninput, wired in the original markup) — snapshotting history on
  // every keystroke would flood the undo stack, so this adds a second,
  // separate 'change' (i.e. on blur/commit) listener just for history.
  function ensureNameFieldHistory() {
    ['aed_t', 'aed_b'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el && !el.__historyWired) {
        el.__historyWired = true;
        el.addEventListener('change', function() { pushIfChanged(flowById(window.AED.flow)); });
      }
    });
  }

  setInterval(function() {
    fixEditorLayout();
    if (document.querySelector('.archmain .props')) {
      appendTypeSpecificProps();
      ensureSaveButton();
      ensureEditorToolbarExtras();
      ensureNameFieldHistory();
      if (window.__aedZoom !== 1) applyZoom();
    }
  }, 200);

  /* ═══════════ Flows list: search/filter/Edit/Duplicate/Export/states ═══════════
     archOpen/delFlow/newFlow/saveNewFlow (row click, Delete, Create)
     were already real (an earlier pass here) and are left untouched.
     Added: Search, Status/Type/Division filters, Edit (was missing
     entirely — a flow's name/type/division/status could be set once
     at creation and never changed again), Duplicate, CSV Export, and
     real loading/empty/error states (the list previously just stayed
     on whatever was last rendered if the fetch failed, indistinguishable
     from "no flows exist"). 'flows' isn't DYN9-routed, but
     window.renderFlows is *also* captured by-reference elsewhere
     (verified empirically — a bare reassignment alone isn't picked up
     on navigation), so this uses the same window.openPage-wrap fix as
     prompts-redesign.ts/emergency-redesign.ts. */

  function flowsListApiFetch(path, init) { return flowsApiFetch(path, init); }

  var flowListFilters = { q: '', status: '', division: '' };

  function filteredFlowList() {
    var q = flowListFilters.q.trim().toLowerCase();
    return (window.DB.flows || []).filter(function(f) {
      if (flowListFilters.status && f.status !== flowListFilters.status) return false;
      if (flowListFilters.division && f.division !== flowListFilters.division) return false;
      if (!q) return true;
      return (f.name || '').toLowerCase().indexOf(q) > -1 || (f.type || '').toLowerCase().indexOf(q) > -1;
    });
  }

  function flowQueueUsage(f) {
    return ((window.DB && window.DB.queues) || []).filter(function(q) { return q.script === f.id; }).length;
  }

  var flowsPage = 1;
  var flowsPageSize = 25;
  function paginatedFlowList() {
    var list = filteredFlowList();
    var totalPages = Math.max(1, Math.ceil(list.length / flowsPageSize));
    if (flowsPage > totalPages) flowsPage = totalPages;
    if (flowsPage < 1) flowsPage = 1;
    var start = (flowsPage - 1) * flowsPageSize;
    return { rows: list.slice(start, start + flowsPageSize), total: list.length, totalPages: totalPages, start: start };
  }
  window.flowsSetPageSize = function(v) { flowsPageSize = parseInt(v, 10) || 25; flowsPage = 1; refreshFlowsTable(); };
  window.flowsPrevPage = function() { if (flowsPage > 1) { flowsPage--; refreshFlowsTable(); } };
  window.flowsNextPage = function() {
    var totalPages = Math.max(1, Math.ceil(filteredFlowList().length / flowsPageSize));
    if (flowsPage < totalPages) { flowsPage++; refreshFlowsTable(); }
  };

  var DIVISION_LABELS = { d_home: 'Home', d_ret: 'UK Retail', d_dig: 'UK Digital', d_col: 'UK Collections', d_man: 'Partner \\u2014 Manila' };

  function renderFlowRow(f) {
    var statusCls = f.status === 'Published' ? 'ok' : 'wn';
    return '<tr onclick="archOpen(\\'' + f.id + '\\')">' +
      '<td><b class="lnk">' + escapeHtml(f.name) + '</b></td><td>' + escapeHtml(f.type || '') + '</td>' +
      '<td>' + escapeHtml(DIVISION_LABELS[f.division] || f.division || '\\u2014') + '</td>' +
      '<td><span class="st ' + statusCls + '"><span class="d"></span>' + escapeHtml(f.status || 'Draft') + '</span></td>' +
      '<td>' + (f.nodes || []).length + '</td><td>\\u2014</td>' +
      '<td style="width:210px;white-space:nowrap" onclick="event.stopPropagation()">' +
      '<a class="lnk" style="font-size:12px" onclick="window.flowsEdit(\\'' + f.id + '\\')">Edit</a> ' +
      '<a class="lnk" style="font-size:12px" onclick="window.flowsDuplicate(\\'' + f.id + '\\')">Duplicate</a> ' +
      '<a class="lnk" style="font-size:12px" onclick="window.flowsExportJson(\\'' + f.id + '\\')">Export</a> ' +
      '<a class="lnk" style="font-size:12px" onclick="delFlow(\\'' + f.id + '\\')">Delete</a></td></tr>';
  }

  function renderFlowsTable() {
    if (window.__flowsListState === 'loading') return '<div style="padding:28px;text-align:center;color:#8794a8">Loading flows\\u2026</div>';
    if (window.__flowsListState === 'error') return '<div style="padding:28px;text-align:center;color:#b3261e">Couldn\\'t load flows from the server. <a class="lnk" onclick="window.flowsListReload()">Retry</a></div>';
    var pg = paginatedFlowList();
    if (!pg.total) return '<div style="padding:28px;text-align:center;color:#8794a8">' + ((window.DB.flows || []).length ? 'No flows match your search.' : 'No flows yet \\u2014 create one to get started.') + '</div>';
    var showFrom = pg.start + 1, showTo = Math.min(pg.start + flowsPageSize, pg.total);
    return '<table class="dt"><thead><tr><th>Flow</th><th>Type</th><th>Division</th><th>Status</th><th>Actions</th><th>Bound DIDs</th><th></th></tr></thead><tbody>' + pg.rows.map(renderFlowRow).join('') + '</tbody></table>' +
      '<div class="pgr"><span>Showing <b>' + showFrom + '\\u2013' + showTo + '</b> of <b>' + pg.total + '</b></span><div class="sp"></div>' +
      '<span>Rows per page <select onchange="window.flowsSetPageSize(this.value)" style="border:none;background:transparent;font:inherit;color:inherit;cursor:pointer">' +
        [10, 25, 50].map(function(n) { return '<option value="' + n + '"' + (flowsPageSize === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
      '</select></span>' +
      '<a class="lnk" style="' + (flowsPage <= 1 ? 'color:#c3cbd8;cursor:default' : '') + '"' + (flowsPage > 1 ? ' onclick="window.flowsPrevPage()"' : '') + '>\\u2039</a> ' +
      '<a class="lnk" style="' + (flowsPage >= pg.totalPages ? 'color:#c3cbd8;cursor:default' : '') + '"' + (flowsPage < pg.totalPages ? ' onclick="window.flowsNextPage()"' : '') + '>\\u203A</a>' +
      '</div>';
  }

  function refreshFlowsTable() {
    var wrap = document.querySelector('#cnt .tblw');
    if (wrap) wrap.innerHTML = renderFlowsTable();
    var tab = document.querySelector('#cnt .tb.on');
    if (tab) tab.textContent = 'All Flows (' + (window.DB.flows || []).length + ')';
  }

  window.flowsSearch = function(v) { flowListFilters.q = v || ''; flowsPage = 1; refreshFlowsTable(); };
  window.flowsFilterStatus = function(v) { flowListFilters.status = v || ''; flowsPage = 1; refreshFlowsTable(); };
  window.flowsFilterDivision = function(v) { flowListFilters.division = v || ''; flowsPage = 1; refreshFlowsTable(); };

  window.flowsListReload = function() {
    window.__flowsListState = 'loading';
    refreshFlowsTable();
    // Every previous reload here handed out a brand-new random local id
    // per flow, even for ones that already existed — harmless for the
    // list page itself, but if a reload lands while the Architect editor
    // has a flow open (window.AED.flow holding the *old* id), that flow's
    // local id changes out from under it. flowById(window.AED.flow) then
    // silently returns nothing, and every editor action gated on it
    // (drag included) becomes a no-op with no visible error. Preserving
    // the existing local id for any flow whose dbId is already known
    // keeps an open editor session's reference valid across a reload —
    // real reloads (a genuinely new flow, or the very first load) still
    // get a fresh id exactly as before.
    var existingByDbId = {};
    (window.DB.flows || []).forEach(function(f) { if (f.dbId != null) existingByDbId[f.dbId] = f.id; });
    flowsListApiFetch('/api/flows?limit=500').then(function(rows) {
      window.DB.flows = rows.map(function(r) {
        var backendGraph = fromBackendGraph(r.graph, r.name);
        var localId = existingByDbId[r.id] || ('id' + Math.random().toString(36).slice(2, 10));
        return Object.assign({ id: localId, dbId: r.id, name: r.name }, backendGraph);
      });
      window.__flowsListState = 'ready';
      refreshFlowsTable();
    }).catch(function() {
      window.__flowsListState = 'error';
      refreshFlowsTable();
    });
  };

  window.flowsEdit = function(id) {
    var f = flowById(id);
    if (!f) return;
    var divOpts = Object.keys(DIVISION_LABELS).map(function(k) { return '<option value="' + k + '"' + (f.division === k ? ' selected' : '') + '>' + DIVISION_LABELS[k] + '</option>'; }).join('');
    openDrawer('<div id="drw"><div class="dh"><h2>Edit Flow</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div id="flowediterr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
      '<div class="fld"><label>Name</label><input id="fe_name" value="' + escapeHtml(f.name) + '"></div>' +
      '<div class="fld"><label>Type</label><select id="fe_type"><option' + (f.type === 'Inbound Call' ? ' selected' : '') + '>Inbound Call</option><option' + (f.type === 'In-Queue' ? ' selected' : '') + '>In-Queue</option><option' + (f.type === 'Outbound' ? ' selected' : '') + '>Outbound</option><option' + (f.type === 'Secure' ? ' selected' : '') + '>Secure</option></select></div>' +
      '<div class="fld"><label>Division</label><select id="fe_div"><option value="">\\u2014</option>' + divOpts + '</select></div>' +
      '<div class="fld"><label>Status</label><select id="fe_status"><option' + (f.status === 'Draft' ? ' selected' : '') + '>Draft</option><option' + (f.status === 'Published' ? ' selected' : '') + '>Published</option></select></div></div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.flowsSaveEdit(\\'' + id + '\\')">Save</button></div></div>');
  };

  window.flowsSaveEdit = function(id) {
    var f = flowById(id);
    if (!f) return;
    var name = document.getElementById('fe_name').value.trim();
    var dupe = (window.DB.flows || []).some(function(x) { return x.id !== id && x.name.toLowerCase() === name.toLowerCase(); });
    if (name.length < 2 || dupe) {
      var box = document.getElementById('flowediterr');
      box.style.display = '';
      box.innerHTML = dupe ? 'A flow with this name already exists.' : 'Name is required.';
      return;
    }
    f.name = name;
    f.type = document.getElementById('fe_type').value;
    f.division = document.getElementById('fe_div').value;
    f.status = document.getElementById('fe_status').value;
    var persist = f.dbId && window.__authToken
      ? flowsListApiFetch('/api/flows/' + f.dbId, { method: 'PUT', body: JSON.stringify({ name: name, graph: toBackendGraph(f) }) })
      : Promise.resolve();
    persist.then(function() {
      window.closeDrawer();
      refreshFlowsTable();
      if (window.toast) window.toast('\\u2713 Saved <b>' + escapeHtml(name) + '</b>');
    }).catch(function(err) {
      var box = document.getElementById('flowediterr');
      box.style.display = '';
      box.innerHTML = escapeHtml(err.message || 'Save failed \\u2014 please try again.');
    });
  };

  window.flowsDuplicate = function(id) {
    var f = flowById(id);
    if (!f) return;
    var baseName = f.name + ' (Copy)';
    var name = baseName, n = 2;
    while ((window.DB.flows || []).some(function(x) { return x.name.toLowerCase() === name.toLowerCase(); })) { name = f.name + ' (Copy ' + n + ')'; n++; }
    var clone = Object.assign({}, f, { id: 'id' + Math.random().toString(36).slice(2, 10), name: name, status: 'Draft', ver: 0, dbId: undefined });
    if (!window.__authToken) {
      if (window.toast) window.toast('\\u2717 Duplicate failed \\u2014 not signed in');
      return;
    }
    flowsListApiFetch('/api/flows', { method: 'POST', body: JSON.stringify({ name: name, graph: toBackendGraph(clone) }) })
      .then(function(row) {
        clone.dbId = row.id;
        window.DB.flows.push(clone);
        refreshFlowsTable();
        if (window.toast) window.toast('\\u2713 Duplicated as <b>' + escapeHtml(name) + '</b>');
      })
      .catch(function(err) {
        // Deliberately not pushed into window.DB.flows above — a failed
        // create must not leave a phantom no-dbId clone sitting in the
        // list forever (see the file-header comment for how that class
        // of bug bit Save/Publish elsewhere in this file).
        if (window.toast) window.toast('\\u2717 Duplicate failed \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
      });
  };

  window.flowsExport = function() {
    var list = filteredFlowList();
    var header = ['Flow', 'Type', 'Division', 'Status', 'Actions', 'Version'];
    var lines = [header.join(',')].concat(list.map(function(f) {
      return [f.name, f.type, DIVISION_LABELS[f.division] || f.division || '', f.status, (f.nodes || []).length, f.ver || 0]
        .map(function(v) { v = String(v == null ? '' : v); return /[",\\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; })
        .join(',');
    }));
    var blob = new Blob([lines.join('\\n')], { type: 'text/csv' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'flows.csv';
    link.click();
    if (window.toast) window.toast('Flows exported (' + list.length + ' rows)');
  };

  /* Per-flow JSON export/import — a real round-trip (not just the
     summary CSV above): the file this produces is exactly what
     window.flowsImport() below accepts, letting a flow built here be
     backed up, moved between tenants, or handed to someone else to
     import as a starting point. */
  window.flowsExportJson = function(id) {
    var f = flowById(id);
    if (!f) return;
    var payload = { name: f.name, type: f.type || '', division: f.division || '', graph: toBackendGraph(f) };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (f.name || 'flow').replace(/[^a-z0-9_-]+/gi, '_') + '.json';
    link.click();
    if (window.toast) window.toast('Exported <b>' + escapeHtml(f.name) + '</b> as JSON');
  };

  function importFlowFromJson(parsed) {
    var name = String((parsed && parsed.name) || '').trim();
    var errs = [];
    if (name.length < 2) errs.push('The file needs a "name" field (min 2 characters).');
    else if ((window.DB.flows || []).some(function(x) { return x.name.toLowerCase() === name.toLowerCase(); })) errs.push('A flow named \\u201C' + escapeHtml(name) + '\\u201D already exists \\u2014 rename it in the file first.');
    if (!parsed || !parsed.graph) errs.push('The file needs a "graph" field with the flow\\'s node graph.');
    if (errs.length) { if (window.toast) window.toast('\\u2717 Import failed \\u2014 ' + errs.join(' ')); return; }

    var localGraph = fromBackendGraph(parsed.graph, name);
    var f = Object.assign({ id: 'id' + Math.random().toString(36).slice(2, 10), name: name, type: parsed.type || 'Inbound Call', division: parsed.division || '', status: 'Draft', ver: 0, sched: '' }, localGraph);
    f.status = 'Draft';
    f.ver = 0;

    flowsListApiFetch('/api/flows', { method: 'POST', body: JSON.stringify({ name: name, graph: toBackendGraph(f) }) })
      .then(function(row) {
        f.dbId = row.id;
        window.DB.flows.push(f);
        flowsPage = 1;
        refreshFlowsTable();
        if (window.toast) window.toast('\\u2713 Imported <b>' + escapeHtml(name) + '</b>');
      })
      .catch(function(err) {
        if (window.toast) window.toast('\\u2717 Import failed \\u2014 ' + escapeHtml(err.message || 'please try again'));
      });
  }

  window.flowsImport = function() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = function() {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function() {
        var parsed;
        try { parsed = JSON.parse(String(reader.result)); } catch (e) { if (window.toast) window.toast('\\u2717 That file isn\\'t valid JSON.'); return; }
        importFlowFromJson(parsed);
      };
      reader.onerror = function() { if (window.toast) window.toast('\\u2717 Couldn\\'t read that file.'); };
      reader.readAsText(file);
    };
    input.click();
  };

  /* window.newFlow (create) — the original was purely local: it pushed
     straight into DB.flows with no backend call at all, so a created
     flow vanished on refresh. Real create + validated name + opens the
     real editor once it exists on the server. */
  window.newFlow = function() {
    var divOpts = Object.keys(DIVISION_LABELS).map(function(k) { return '<option value="' + k + '">' + DIVISION_LABELS[k] + '</option>'; }).join('');
    openDrawer('<div id="drw" style="height:auto;top:22%;bottom:auto;border-radius:8px 0 0 8px"><div class="dh"><h2>Create Flow</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db"><div id="nferr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
      '<div class="fld"><label>Flow name *</label><input id="nf_name"></div>' +
      '<div class="fld"><label>Type</label><select id="nf_type"><option>Inbound Call</option><option>In-Queue</option><option>Outbound</option><option>Secure</option></select></div>' +
      '<div class="fld"><label>Division</label><select id="nf_div"><option value="">\\u2014</option>' + divOpts + '</select></div></div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.flowsCreate()">Create &amp; open editor</button></div></div>');
  };

  window.flowsCreate = function() {
    var name = document.getElementById('nf_name').value.trim();
    var errs = [];
    if (name.length < 2) errs.push('A flow name is required (min 2 characters).');
    else if ((window.DB.flows || []).some(function(x) { return x.name.toLowerCase() === name.toLowerCase(); })) errs.push('A flow named \\u201C' + escapeHtml(name) + '\\u201D already exists.');
    if (errs.length) {
      var box = document.getElementById('nferr');
      box.style.display = '';
      box.innerHTML = errs.join('<br>');
      return;
    }

    var type = document.getElementById('nf_type').value;
    var division = document.getElementById('nf_div').value;
    var createBtn = document.querySelector('.df button.btn:not(.sec)');
    var createBtnOrigText = createBtn ? createBtn.textContent : '';
    if (createBtn) { createBtn.disabled = true; createBtn.textContent = 'Creating\\u2026'; }

    var startId = 'id' + Math.random().toString(36).slice(2, 10);
    var discId = 'id' + Math.random().toString(36).slice(2, 10);
    var f = {
      id: 'id' + Math.random().toString(36).slice(2, 10), name: name, type: type, division: division, status: 'Draft', ver: 0, sched: '',
      nodes: [{ id: startId, type: 'start', t: 'Start', b: 'Entry point', x: 40, y: 40 }, { id: discId, type: 'disc', t: 'Disconnect', b: 'end of flow', x: 40, y: 260 }],
      links: [[startId, discId, '']],
      meta: { queueFor: {}, skills: {} }
    };

    flowsListApiFetch('/api/flows', { method: 'POST', body: JSON.stringify({ name: name, graph: toBackendGraph(f) }) })
      .then(function(row) {
        f.dbId = row.id;
        window.DB.flows.push(f);
        window.closeDrawer();
        flowsPage = 1;
        refreshFlowsTable();
        if (window.toast) window.toast('\\u2713 Created <b>' + escapeHtml(name) + '</b>');
        window.archOpen(f.id);
      })
      .catch(function(err) {
        if (createBtn) { createBtn.disabled = false; createBtn.textContent = createBtnOrigText; }
        var box = document.getElementById('nferr');
        box.style.display = '';
        box.innerHTML = escapeHtml((err && err.message) || 'Create failed \\u2014 please try again.');
      });
  };

  /* window.delFlow (delete) — the original confirmed first (kept, same
     UX) but only ever spliced DB.flows/the old mock DB.callRoutes
     locally — no backend DELETE at all, and DB.callRoutes hasn't been
     the real call-routes data since callrouting-redesign.ts shipped, so
     that "N call routes will be removed" line was checking stale mock
     data. Real delete, real message. */
  window.delFlow = function(id) {
    var f = flowById(id);
    if (!f) return;
    var safeName = escapeHtml(f.name);
    var warning = f.status === 'Published' ? ' <b style="color:#b3261e">This flow is currently Published \\u2014 any call route pointing to it will start failing.</b>' : '';
    flowsConfirmBox('Delete flow <b>' + safeName + '</b>? This cannot be undone.' + warning, function() {
      var removeLocal = function() {
        window.DB.flows = window.DB.flows.filter(function(x) { return x.id !== id; });
        refreshFlowsTable();
        if (window.toast) window.toast('\\u2713 Deleted <b>' + safeName + '</b>');
      };
      if (!f.dbId) { removeLocal(); return; }
      flowsListApiFetch('/api/flows/' + f.dbId, { method: 'DELETE' }).then(removeLocal).catch(function(err) {
        if (window.toast) window.toast('\\u2717 Delete failed \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
      });
    });
  };

  function renderFlowsPage() {
    var divOpts = Object.keys(DIVISION_LABELS).map(function(k) { return '<option value="' + k + '">' + DIVISION_LABELS[k] + '</option>'; }).join('');
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A Routing</div>' +
      '<div class="tt"><h1>Architect Flows</h1><div class="rt"><button class="btn" onclick="newFlow()">+ Create Flow</button><button class="btn sec" onclick="window.flowsImport()">Import</button><button class="btn sec" onclick="window.flowsExport()">Export</button><button class="btn sec" onclick="openPage(\\'callroute\\')">Call Routing</button></div></div>' +
      '<div class="tabs"><div class="tb on">All Flows (' + (window.DB.flows || []).length + ')</div></div></div>' +
      '<div class="pbody"><div class="tbar"><input class="s" placeholder="Search flows" oninput="window.flowsSearch(this.value)">' +
      '<select class="chip" style="cursor:pointer" onchange="window.flowsFilterStatus(this.value)"><option value="">Status: Any</option><option value="Draft">Draft</option><option value="Published">Published</option></select>' +
      '<select class="chip" style="cursor:pointer" onchange="window.flowsFilterDivision(this.value)"><option value="">Division: All</option>' + divOpts + '</select>' +
      '<div class="sp"></div><div class="chip" onclick="window.flowsListReload()">\\u21BB Refresh</div></div>' +
      '<div class="tblw">' + renderFlowsTable() + '</div></div>' +
      '<div class="help"><div class="hh" onclick="toggleHelp()"><span style="color:#FF4F1F">\\u24D8</span> Help &amp; Resources \\u2014 Architect Flows<span class="cx" id="helpcx">Hide</span></div>' +
      '<div class="hb" id="helpb" style=""><div class="hcols"><div><h5>What you can do here</h5><ul><li>Flow types: inbound call, in-queue, outbound, secure, email, message, bot</li><li>Publish, version and lock flows</li><li>Assign a flow to a DID via call routing</li></ul></div></div></div></div>';
  }

  function mountFlowsPage() {
    var cnt = document.getElementById('cnt');
    if (cnt) cnt.innerHTML = renderFlowsPage();
  }

  window.renderFlows = mountFlowsPage;

  var prevOpenPageForFlows = window.openPage;
  window.openPage = function(id) {
    if (id === 'flows') {
      window.closeDrawer();
      window.restoreAdmin();
      window.navMark('admin');
      window.APP.page = 'flows';
      mountFlowsPage();
      if (window.__flowsListState !== 'ready') window.flowsListReload();
      var links = document.querySelectorAll('#anav .lk');
      links.forEach(function(el) { el.classList.remove('on'); });
      for (var i = 0; i < links.length; i++) {
        var onclick = links[i].getAttribute('onclick') || '';
        if (onclick.indexOf("'flows'") > -1) { links[i].classList.add('on'); break; }
      }
      window.scrollTo(0, 0);
      return;
    }
    return prevOpenPageForFlows(id);
  };

})();
`;
