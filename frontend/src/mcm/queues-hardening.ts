/* ============================================================
   MCM Cloud CX — Queues Backend Sync Fixes
   scripts.ts already has a real-backend round trip for the Contact Center >
   Queues page: hydrate() loads rows from GET /api/queues, and a later
   window.saveQueue/window.delQueue wrapper (search scripts.ts for
   queueConfigOf) already POSTs/PUTs/DELETEs to the real endpoint. Two real
   gaps remained in that existing wrapper, both fixed here without touching
   the create/delete paths that already work correctly.

   1) Crash on incomplete real rows — hydrate()'s row mapper for 'queues'
      spreads a real row's config straight onto the local queue object
      (plus id/dbId/name/division) with no defaults. Any queue whose config
      doesn't carry every field the tabbed editor's renderQueues()/drawQ()
      read unconditionally (q.members.length, q.media.Voice, ...) throws.
      That throw happens inside hydrate()'s unguarded .then() redraw
      callback, so it's silent: the page keeps showing whatever rendered
      before hydrate() ran and never reflects the real row, and any later
      manual renderQueues()/editQueue() call on that record throws too. The
      seeded demo queue (config: {media: {Voice: {slaSec: 45}}}) hits this
      today. Fixed by filling in the same defaults editQueue() already uses
      for a brand-new queue.

   2) Edits never reach the backend — the existing wrapper detects a save
      as "new" vs. "existing" with `DB.queues[0] !== beforeFirst`: true only
      when a brand-new queue was unshifted onto the front of the array.
      Editing an *existing* queue mutates that queue's object in place
      (Object.keys(copy).forEach(k => q[k] = copy[k])), so the array
      reference at whatever index it already occupied never changes —
      `DB.queues[0] !== beforeFirst` is always false for an edit, the
      lookup resolves to null, and the wrapper silently returns without
      ever calling PUT. Create worked; only edit was broken. Fixed by
      re-wrapping window.saveQueue once more, using window.QED.id (captured
      before the existing wrapper runs) to find the edited record directly
      instead of an index/reference heuristic — but only acting on the
      *edit* case (wasNew false), since the create case is already handled
      correctly by the existing wrapper and redoing it here would
      double-POST.

   (Delete used to be broken here too, via window.__armConfirmDelete — that
   turned out to be a systemic bug shared by 18 delXxx() functions app-wide,
   not specific to Queues, so it's fixed once for all of them in
   mcm/confirm-delete-fix.ts instead of here.)
   ============================================================ */

export const QUEUES_HARDENING_SCRIPT: string = `
(function() {
  'use strict';
  if (window.__queuesHardened) return;
  window.__queuesHardened = true;

  function queuesApiFetch(path, init) {
    if (typeof window.apiFetch === 'function') return window.apiFetch(path, init);
    var token = window.__authToken;
    var base = window.SUBS_API_BASE || '';
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(base + path, Object.assign({ headers: headers }, init || {})).then(function(res) {
      if (!res.ok) {
        return res.json().catch(function() { return {}; }).then(function(body) {
          throw new Error(body.error || ('Request failed: ' + res.status));
        });
      }
      return res.json();
    });
  }

  function localQueueById(id) {
    var list = (window.DB && window.DB.queues) || [];
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
    return null;
  }

  /* ─── Fix 1: defensive normalization ─── */
  var QUEUE_MEDIA_DEFAULTS = {
    Voice: { alert: 12, slaPct: 80, slaSec: 20, auto: false },
    Callback: { alert: 30, slaPct: 80, slaSec: 60, auto: false },
    Chat: { alert: 24, slaPct: 80, slaSec: 40, auto: false },
    Email: { alert: 300, slaPct: 90, slaSec: 3600, auto: false },
    Message: { alert: 60, slaPct: 80, slaSec: 120, auto: false }
  };

  function normalizeQueueRecord(q) {
    if (!q) return q;
    if (!Array.isArray(q.members)) q.members = [];
    if (typeof q.desc !== 'string') q.desc = '';
    if (!q.routing) q.routing = 'Standard';
    if (!q.evalm) q.evalm = 'All Skills Matching';
    if (!Array.isArray(q.rings) || !q.rings.length) q.rings = [{ timeout: 20, drop: [] }];
    if (!q.acw) q.acw = 'Optional';
    if (typeof q.acwSec !== 'number') q.acwSec = 30;
    if (!q.media || typeof q.media !== 'object') q.media = {};
    Object.keys(QUEUE_MEDIA_DEFAULTS).forEach(function(ch) {
      q.media[ch] = Object.assign({}, QUEUE_MEDIA_DEFAULTS[ch], q.media[ch] || {});
    });
    if (!Array.isArray(q.wrapup)) q.wrapup = [];
    if (!Array.isArray(q.wrapupCodeIds)) q.wrapupCodeIds = [];
    if (!Array.isArray(q.requiredSkills)) q.requiredSkills = [];
    if (!q.music) q.music = 'MCM Default Hold';
    return q;
  }

  var prevRenderQueues = window.renderQueues;
  window.renderQueues = function() {
    ((window.DB && window.DB.queues) || []).forEach(normalizeQueueRecord);
    return prevRenderQueues();
  };

  var prevEditQueue = window.editQueue;
  window.editQueue = function(id) {
    if (id) normalizeQueueRecord(localQueueById(id));
    return prevEditQueue(id);
  };

  /* ─── Fix 2: edits never persisting ───
     Same field split as scripts.ts's own queueConfigOf() (everything
     except id/dbId/name/division/wrapupCodeIds/requiredSkills goes into
     config), kept in sync with it deliberately rather than trying to call
     it directly — it's a closure-local function in scripts.ts, not exposed
     on window. */
  function queueConfigOf(q) {
    var cfg = {};
    Object.keys(q).forEach(function(k) {
      if (k !== 'id' && k !== 'dbId' && k !== 'name' && k !== 'division' && k !== 'wrapupCodeIds' && k !== 'requiredSkills') cfg[k] = q[k];
    });
    return cfg;
  }

  var prevSaveQueueForEdit = window.saveQueue;
  window.saveQueue = function() {
    var QED = window.QED;
    var wasNew = QED && QED._isNew;
    var capturedId = QED && QED.id;

    prevSaveQueueForEdit(); // local mutation always; backend POST too, if this was a create

    if (wasNew) return; // create already persisted correctly above
    if (document.getElementById('drw')) return; // validation failed, nothing was saved
    if (!window.__authToken) return;

    var q = localQueueById(capturedId);
    if (!q || !q.dbId) return;

    var payload = {
      name: q.name,
      division: q.division,
      config: queueConfigOf(q),
      wrapup_code_ids: q.wrapupCodeIds || [],
      required_skills: q.requiredSkills || []
    };
    queuesApiFetch('/api/queues/' + q.dbId, { method: 'PUT', body: JSON.stringify(payload) }).catch(function() {
      if (window.toast) window.toast('\\u2717 Saved locally, but the server update failed \\u2014 please retry');
    });
  };
})();
`;
