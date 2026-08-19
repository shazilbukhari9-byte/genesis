/* ============================================================
   MCM Cloud CX — Backend Sync for Alert Rules & Adherence/WFM
   Runs after MCM_SCRIPT so DB.*, window.* functions exist.
   Same IIFE-wrap pattern used by the Flows sync in scripts.ts.
   ============================================================ */

export const BACKEND_SYNC_SCRIPT: string = `
(function() {
  'use strict';

  var SUBS_API_BASE = window.SUBS_API_BASE || 'https://genesis-yysv.onrender.com';
  var DB = window.DB;
  if (!DB) return;

  function authH() {
    return window.__authToken
      ? { 'Authorization': 'Bearer ' + window.__authToken }
      : {};
  }
  function authHJson() {
    var h = authH();
    h['Content-Type'] = 'application/json';
    return h;
  }

  /* ================= Alert Rules — real backend sync ================= */
  (function() {
    var loaded = false;

    function fromApi(r) {
      return {
        id: String(r.id), dbId: r.id,
        name: r.name, metric: r.metric, cond: r.cond,
        threshold: r.threshold, dur: r.dur,
        notify: r.notify || [], on: r.enabled !== false
      };
    }
    function toApi(a) {
      return {
        name: a.name, metric: a.metric, cond: a.cond,
        threshold: a.threshold, dur: a.dur,
        notify: a.notify, enabled: a.on !== false
      };
    }

    /* Hydrate on first render */
    var origRender = window.renderAlertsFx;
    if (origRender) window.renderAlertsFx = function() {
      origRender();
      if (loaded || !window.__authToken) return;
      loaded = true;
      fetch(SUBS_API_BASE + '/api/alerts/rules', { headers: authH() })
        .then(function(r) { return r.json(); })
        .then(function(rows) {
          if (!Array.isArray(rows) || !rows.length) return;
          DB.alertRules = rows.map(fromApi);
          origRender();
        }).catch(function() {});
    };

    /* Create / Update */
    var origSave = window.saveAlertFx;
    if (origSave) window.saveAlertFx = function(id) {
      var existing = id ? DB.alertRules.filter(function(x) { return x.id === id; })[0] : null;
      var existingDbId = existing ? existing.dbId : null;
      var before = DB.alertRules.length;
      origSave(id);
      if (!window.__authToken) return;
      if (!id && DB.alertRules.length > before) {
        var a = DB.alertRules[DB.alertRules.length - 1];
        fetch(SUBS_API_BASE + '/api/alerts/rules', {
          method: 'POST', headers: authHJson(), body: JSON.stringify(toApi(a))
        }).then(function(r) { return r.json(); })
          .then(function(d) { if (d && d.id) { a.dbId = d.id; a.id = String(d.id); } })
          .catch(function() {});
      } else if (existingDbId) {
        var updated = DB.alertRules.filter(function(x) { return x.dbId === existingDbId; })[0];
        if (updated) fetch(SUBS_API_BASE + '/api/alerts/rules/' + existingDbId, {
          method: 'PUT', headers: authHJson(), body: JSON.stringify(toApi(updated))
        }).catch(function() {});
      }
    };

    /* Delete */
    var origDel = window.delAlertFx;
    if (origDel) window.delAlertFx = function(id) {
      var a = DB.alertRules.filter(function(x) { return x.id === id; })[0];
      var dbId = a && a.dbId;
      origDel(id);
      if (dbId && window.__authToken) {
        fetch(SUBS_API_BASE + '/api/alerts/rules/' + dbId, {
          method: 'DELETE', headers: authH()
        }).catch(function() {});
      }
    };
  })();

  /* ================= Adherence / WFM — real backend sync ================= */
  (function() {
    var loaded = false;

    /* Hydrate all three collections on first WFM render */
    var origRender = window.renderSchedFx;
    if (origRender) window.renderSchedFx = function() {
      origRender();
      if (loaded || !window.__authToken) return;
      loaded = true;

      /* Activity codes */
      fetch(SUBS_API_BASE + '/api/wfm/activity-codes', { headers: authH() })
        .then(function(r) { return r.json(); })
        .then(function(rows) {
          if (!Array.isArray(rows) || !rows.length) return;
          DB.actCodes = rows.map(function(r) {
            return { id: String(r.id), dbId: r.id, name: r.name, cat: r.category, paid: r.paid, adh: r.adherence_rule };
          });
          origRender();
        }).catch(function() {});

      /* Management units */
      fetch(SUBS_API_BASE + '/api/wfm/management-units', { headers: authH() })
        .then(function(r) { return r.json(); })
        .then(function(rows) {
          if (!Array.isArray(rows) || !rows.length) return;
          DB.wfm.mus = rows.map(function(r) {
            return { id: String(r.id), dbId: r.id, name: r.name, agents: r.agents || [] };
          });
          origRender();
        }).catch(function() {});

      /* Schedules */
      fetch(SUBS_API_BASE + '/api/wfm/schedules', { headers: authH() })
        .then(function(r) { return r.json(); })
        .then(function(rows) {
          if (!Array.isArray(rows) || !rows.length) return;
          DB.wfmSchedules = rows.map(function(r) {
            return { id: String(r.id), dbId: r.id, week: r.week, status: r.status, entries: r.entries || {} };
          });
          origRender();
        }).catch(function() {});
    };

    /* ── Activity Code create ── */
    var origSaveAC = window.saveAC;
    if (origSaveAC) window.saveAC = function() {
      var before = DB.actCodes.length;
      origSaveAC();
      if (!window.__authToken || DB.actCodes.length <= before) return;
      var a = DB.actCodes[DB.actCodes.length - 1];
      fetch(SUBS_API_BASE + '/api/wfm/activity-codes', {
        method: 'POST', headers: authHJson(),
        body: JSON.stringify({ name: a.name, category: a.cat, paid: a.paid, adherence_rule: a.adh })
      }).then(function(r) { return r.json(); })
        .then(function(d) { if (d && d.id) { a.dbId = d.id; a.id = String(d.id); } })
        .catch(function() {});
    };

    /* ── Activity Code delete ── */
    var origDelAC = window.delAC;
    if (origDelAC) window.delAC = function(id) {
      var a = DB.actCodes.filter(function(x) { return x.id === id; })[0];
      var dbId = a && a.dbId;
      origDelAC(id);
      if (dbId && window.__authToken) {
        fetch(SUBS_API_BASE + '/api/wfm/activity-codes/' + dbId, {
          method: 'DELETE', headers: authH()
        }).catch(function() {});
      }
    };

    /* ── Management Unit create/update ── */
    var origSaveMU = window.saveMU;
    if (origSaveMU) window.saveMU = function(id) {
      var existing = id ? DB.wfm.mus.filter(function(x) { return x.id === id; })[0] : null;
      var existingDbId = existing ? existing.dbId : null;
      var before = DB.wfm.mus.length;
      origSaveMU(id);
      if (!window.__authToken) return;
      if (!id && DB.wfm.mus.length > before) {
        var m = DB.wfm.mus[DB.wfm.mus.length - 1];
        fetch(SUBS_API_BASE + '/api/wfm/management-units', {
          method: 'POST', headers: authHJson(),
          body: JSON.stringify({ name: m.name, agents: m.agents })
        }).then(function(r) { return r.json(); })
          .then(function(d) { if (d && d.id) { m.dbId = d.id; m.id = String(d.id); } })
          .catch(function() {});
      } else if (existingDbId) {
        var updated = DB.wfm.mus.filter(function(x) { return x.dbId === existingDbId; })[0];
        if (updated) fetch(SUBS_API_BASE + '/api/wfm/management-units/' + existingDbId, {
          method: 'PUT', headers: authHJson(),
          body: JSON.stringify({ name: updated.name, agents: updated.agents })
        }).catch(function() {});
      }
    };

    /* ── Management Unit delete ── */
    var origDelMU = window.delMU;
    if (origDelMU) window.delMU = function(id) {
      var m = DB.wfm.mus.filter(function(x) { return x.id === id; })[0];
      var dbId = m && m.dbId;
      origDelMU(id);
      if (dbId && window.__authToken) {
        fetch(SUBS_API_BASE + '/api/wfm/management-units/' + dbId, {
          method: 'DELETE', headers: authH()
        }).catch(function() {});
      }
    };

    /* ── Schedule generate (create) ── */
    var origGen = window.genSchedule;
    if (origGen) window.genSchedule = function() {
      var before = DB.wfmSchedules.length;
      origGen();
      if (!window.__authToken || DB.wfmSchedules.length <= before) return;
      var s = DB.wfmSchedules[0]; /* genSchedule uses unshift */
      fetch(SUBS_API_BASE + '/api/wfm/schedules', {
        method: 'POST', headers: authHJson(),
        body: JSON.stringify({ week: s.week, status: s.status, entries: s.entries })
      }).then(function(r) { return r.json(); })
        .then(function(d) { if (d && d.id) { s.dbId = d.id; s.id = String(d.id); } })
        .catch(function() {});
    };

    /* ── Schedule delete ── */
    var origDelSched = window.delSchedule;
    if (origDelSched) window.delSchedule = function(id) {
      var s = DB.wfmSchedules.filter(function(x) { return x.id === id; })[0];
      var dbId = s && s.dbId;
      origDelSched(id);
      if (dbId && window.__authToken) {
        fetch(SUBS_API_BASE + '/api/wfm/schedules/' + dbId, {
          method: 'DELETE', headers: authH()
        }).catch(function() {});
      }
    };

    /* ── Schedule publish ── */
    var origPub = window.pubSchedule;
    if (origPub) window.pubSchedule = function(id) {
      var s = DB.wfmSchedules.filter(function(x) { return x.id === id; })[0];
      var dbId = s && s.dbId;
      origPub(id);
      if (dbId && window.__authToken) {
        fetch(SUBS_API_BASE + '/api/wfm/schedules/' + dbId, {
          method: 'PUT', headers: authHJson(),
          body: JSON.stringify({ status: 'Published' })
        }).catch(function() {});
      }
    };
  })();

})();
`;
