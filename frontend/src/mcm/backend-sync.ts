/* ============================================================
   MCM Cloud CX — Backend Sync for Alert Rules & Adherence/WFM
   Runs after MCM_SCRIPT so DB.*, window.* functions exist.
   Same IIFE-wrap pattern used by the Flows sync in scripts.ts.
   ============================================================ */

export const BACKEND_SYNC_SCRIPT: string = `
(function() {
  'use strict';

  var SUBS_API_BASE = window.SUBS_API_BASE || window.__GENESIS_API_BASE || 'https://genesis-yysv.onrender.com';
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

  /* ================= Prompts — real backend sync ================= */
  (function() {
    var loaded = false;
    function fromApi(r) {
      return {
        id: String(r.id), dbId: r.id,
        name: r.name, desc: r.description || '',
        tts: r.tts || '', lang: r.lang || 'en-GB',
        audio: r.audio_name ? { name: r.audio_name } : null
      };
    }
    function toApi(p) {
      return {
        name: p.name, description: p.desc || '',
        tts: p.tts || '', lang: p.lang || 'en-GB',
        audio_name: p.audio && p.audio.name ? p.audio.name : null
      };
    }
    var origRender = window.renderPromptsFx;
    if (origRender) window.renderPromptsFx = function() {
      origRender();
      if (loaded || !window.__authToken) return;
      loaded = true;
      fetch(SUBS_API_BASE + '/api/prompts', { headers: authH() })
        .then(function(r) { return r.json(); })
        .then(function(rows) {
          if (!Array.isArray(rows) || !rows.length) return;
          DB.prompts = rows.map(fromApi);
          origRender();
        }).catch(function() {});
    };
    var origSave = window.savePromptFx;
    if (origSave) window.savePromptFx = function(id) {
      var existing = id ? DB.prompts.filter(function(x) { return x.id === id; })[0] : null;
      var existingDbId = existing ? existing.dbId : null;
      var before = DB.prompts.length;
      origSave(id);
      if (!window.__authToken) return;
      if (!id && DB.prompts.length > before) {
        var p = DB.prompts[DB.prompts.length - 1];
        fetch(SUBS_API_BASE + '/api/prompts', {
          method: 'POST', headers: authHJson(), body: JSON.stringify(toApi(p))
        }).then(function(r) { return r.json(); })
          .then(function(d) { if (d && d.id) { p.dbId = d.id; p.id = String(d.id); } })
          .catch(function() {});
      } else if (existingDbId) {
        var updated = DB.prompts.filter(function(x) { return x.dbId === existingDbId; })[0];
        if (updated) fetch(SUBS_API_BASE + '/api/prompts/' + existingDbId, {
          method: 'PUT', headers: authHJson(), body: JSON.stringify(toApi(updated))
        }).catch(function() {});
      }
    };
    var origDel = window.delPromptFx;
    if (origDel) window.delPromptFx = function(id) {
      var p = DB.prompts.filter(function(x) { return x.id === id; })[0];
      var dbId = p && p.dbId;
      origDel(id);
      if (dbId && window.__authToken) {
        fetch(SUBS_API_BASE + '/api/prompts/' + dbId, {
          method: 'DELETE', headers: authH()
        }).catch(function() {});
      }
    };
  })();

  /* ================= Phone Base Settings — real backend sync ================= */
  (function() {
    var loaded = false;
    function fromApi(r) {
      return {
        id: String(r.id), dbId: r.id,
        name: r.name, model: r.model || '',
        codec: r.codec || '', port: r.rtp_port || 16384
      };
    }
    function toApi(b) {
      return {
        name: b.name, model: b.model || '',
        codec: b.codec || '', rtp_port: b.port || 16384
      };
    }
    var origRender = window.renderBasesetsFx;
    if (origRender) window.renderBasesetsFx = function() {
      origRender();
      if (loaded || !window.__authToken) return;
      loaded = true;
      fetch(SUBS_API_BASE + '/api/base-settings', { headers: authH() })
        .then(function(r) { return r.json(); })
        .then(function(rows) {
          if (!Array.isArray(rows) || !rows.length) return;
          DB.baseSettings = rows.map(fromApi);
          origRender();
        }).catch(function() {});
    };
    var origSave = window.saveBaseFx;
    if (origSave) window.saveBaseFx = function() {
      var before = DB.baseSettings.length;
      origSave();
      if (!window.__authToken || DB.baseSettings.length <= before) return;
      var b = DB.baseSettings[DB.baseSettings.length - 1];
      fetch(SUBS_API_BASE + '/api/base-settings', {
        method: 'POST', headers: authHJson(), body: JSON.stringify(toApi(b))
      }).then(function(r) { return r.json(); })
        .then(function(d) { if (d && d.id) { b.dbId = d.id; b.id = String(d.id); } })
        .catch(function() {});
    };
    var origDel = window.delBaseFx;
    if (origDel) window.delBaseFx = function(id) {
      var b = DB.baseSettings.filter(function(x) { return x.id === id; })[0];
      var dbId = b && b.dbId;
      origDel(id);
      if (dbId && window.__authToken) {
        fetch(SUBS_API_BASE + '/api/base-settings/' + dbId, {
          method: 'DELETE', headers: authH()
        }).catch(function() {});
      }
    };
  })();

  /* ================= Phone Management — real backend sync ================= */
  (function() {
    var loaded = false;
    function fromApi(r) {
      var baseId = '';
      if (r.base_name && DB.baseSettings) {
        var bs = DB.baseSettings.filter(function(x) { return x.name === r.base_name; })[0];
        if (bs) baseId = bs.id;
      }
      var siteId = '';
      if (r.site_name && DB.sites) {
        var s = DB.sites.filter(function(x) { return x.name === r.site_name; })[0];
        if (s) siteId = s.id;
      }
      return {
        id: String(r.id), dbId: r.id,
        name: r.name, base: baseId, site: siteId,
        user: r.assigned_user || '', mac: r.mac || '',
        status: r.status || 'Not registered'
      };
    }
    function toApi(p) {
      var baseName = '';
      if (p.base && DB.baseSettings) {
        var bs = DB.baseSettings.filter(function(x) { return x.id === p.base; })[0];
        if (bs) baseName = bs.name;
      }
      var siteName = '';
      if (p.site && DB.sites) {
        var s = DB.sites.filter(function(x) { return x.id === p.site; })[0];
        if (s) siteName = s.name;
      }
      return {
        name: p.name, base_name: baseName,
        site_name: siteName, assigned_user: p.user || '',
        mac: p.mac || '', status: p.status || 'Not registered'
      };
    }
    var origRender = window.renderPhonesFx;
    if (origRender) window.renderPhonesFx = function() {
      origRender();
      if (loaded || !window.__authToken) return;
      loaded = true;
      fetch(SUBS_API_BASE + '/api/phones', { headers: authH() })
        .then(function(r) { return r.json(); })
        .then(function(rows) {
          if (!Array.isArray(rows) || !rows.length) return;
          DB.phones = rows.map(fromApi);
          origRender();
        }).catch(function() {});
    };
    var origSave = window.savePhoneFx;
    if (origSave) window.savePhoneFx = function(id) {
      var existing = id ? DB.phones.filter(function(x) { return x.id === id; })[0] : null;
      var existingDbId = existing ? existing.dbId : null;
      var before = DB.phones.length;
      origSave(id);
      if (!window.__authToken) return;
      if (!id && DB.phones.length > before) {
        var p = DB.phones[DB.phones.length - 1];
        fetch(SUBS_API_BASE + '/api/phones', {
          method: 'POST', headers: authHJson(), body: JSON.stringify(toApi(p))
        }).then(function(r) { return r.json(); })
          .then(function(d) { if (d && d.id) { p.dbId = d.id; p.id = String(d.id); } })
          .catch(function() {});
      } else if (existingDbId) {
        var updated = DB.phones.filter(function(x) { return x.dbId === existingDbId; })[0];
        if (updated) fetch(SUBS_API_BASE + '/api/phones/' + existingDbId, {
          method: 'PUT', headers: authHJson(), body: JSON.stringify(toApi(updated))
        }).catch(function() {});
      }
    };
    var origDel = window.delPhoneFx;
    if (origDel) window.delPhoneFx = function(id) {
      var p = DB.phones.filter(function(x) { return x.id === id; })[0];
      var dbId = p && p.dbId;
      origDel(id);
      if (dbId && window.__authToken) {
        fetch(SUBS_API_BASE + '/api/phones/' + dbId, {
          method: 'DELETE', headers: authH()
        }).catch(function() {});
      }
    };
    /* Provision — set status to In service */
    var origProv = window.provPhone;
    if (origProv) window.provPhone = function(id) {
      origProv(id);
      var p = DB.phones.filter(function(x) { return x.id === id; })[0];
      if (p && p.dbId && window.__authToken) {
        fetch(SUBS_API_BASE + '/api/phones/' + p.dbId, {
          method: 'PUT', headers: authHJson(),
          body: JSON.stringify({ status: p.status })
        }).catch(function() {});
      }
    };
  })();

  /* ================= Number Plans — real backend sync ================= */
  (function() {
    var loaded = {};
    function siteById(id) {
      return DB.sites ? DB.sites.filter(function(x) { return x.id === id; })[0] : null;
    }
    function fromApi(r) {
      return {
        id: String(r.id), dbId: r.id,
        name: r.name,
        match: r.match_type || 'Regex',
        spec: r.match_spec || {},
        cls: r.classification || 'National',
        norm: r.normalisation || ''
      };
    }
    function toApi(p, siteName) {
      return {
        site_name: siteName, name: p.name,
        match_type: p.match, match_spec: p.spec || {},
        classification: p.cls, normalisation: p.norm || '',
        sort_order: 0
      };
    }
    var origRender = window.renderNumplan;
    if (origRender) window.renderNumplan = function() {
      origRender();
      var siteId = window.TELSITE;
      if (!siteId || !window.__authToken) return;
      var site = siteById(siteId);
      if (!site || loaded[site.name]) return;
      loaded[site.name] = true;
      fetch(SUBS_API_BASE + '/api/number-plans?site_name=' + encodeURIComponent(site.name), { headers: authH() })
        .then(function(r) { return r.json(); })
        .then(function(rows) {
          if (!Array.isArray(rows) || !rows.length) return;
          site.plans = rows.map(fromApi);
          origRender();
        }).catch(function() {});
    };
    var origSave = window.savePlan;
    if (origSave) window.savePlan = function(id) {
      var siteId = window.TELSITE;
      var site = siteId ? siteById(siteId) : null;
      var existing = id && site ? site.plans.filter(function(x) { return x.id === id; })[0] : null;
      var existingDbId = existing ? existing.dbId : null;
      var before = site ? site.plans.length : 0;
      origSave(id);
      if (!window.__authToken || !site) return;
      if (!id && site.plans.length > before) {
        var p = site.plans[0];
        fetch(SUBS_API_BASE + '/api/number-plans', {
          method: 'POST', headers: authHJson(), body: JSON.stringify(toApi(p, site.name))
        }).then(function(r) { return r.json(); })
          .then(function(d) { if (d && d.id) { p.dbId = d.id; p.id = String(d.id); } })
          .catch(function() {});
      } else if (existingDbId) {
        var updated = site.plans.filter(function(x) { return x.dbId === existingDbId; })[0];
        if (updated) fetch(SUBS_API_BASE + '/api/number-plans/' + existingDbId, {
          method: 'PUT', headers: authHJson(), body: JSON.stringify(toApi(updated, site.name))
        }).catch(function() {});
      }
    };
    var origDel = window.delPlan;
    if (origDel) window.delPlan = function(id) {
      var siteId = window.TELSITE;
      var site = siteId ? siteById(siteId) : null;
      var p = site ? site.plans.filter(function(x) { return x.id === id; })[0] : null;
      var dbId = p && p.dbId;
      origDel(id);
      if (dbId && window.__authToken) {
        fetch(SUBS_API_BASE + '/api/number-plans/' + dbId, {
          method: 'DELETE', headers: authH()
        }).catch(function() {});
      }
    };
  })();

  /* ================= Outbound Routes — real backend sync ================= */
  (function() {
    var loaded = {};
    function siteById(id) {
      return DB.sites ? DB.sites.filter(function(x) { return x.id === id; })[0] : null;
    }
    function fromApi(r) {
      return {
        id: String(r.id), dbId: r.id,
        name: r.name,
        cls: r.classifications || [],
        trunks: r.trunk_ids || [],
        dist: r.distribution || 'Sequential',
        on: r.enabled !== false
      };
    }
    function toApi(r, siteName) {
      return {
        site_name: siteName, name: r.name,
        classifications: r.cls || [],
        trunk_ids: r.trunks || [],
        distribution: r.dist || 'Sequential',
        enabled: r.on !== false
      };
    }
    var origRender = window.renderOutroute;
    if (origRender) window.renderOutroute = function() {
      origRender();
      var siteId = window.TELSITE;
      if (!siteId || !window.__authToken) return;
      var site = siteById(siteId);
      if (!site || loaded[site.name]) return;
      loaded[site.name] = true;
      fetch(SUBS_API_BASE + '/api/outbound-routes?site_name=' + encodeURIComponent(site.name), { headers: authH() })
        .then(function(r) { return r.json(); })
        .then(function(rows) {
          if (!Array.isArray(rows) || !rows.length) return;
          site.routes = rows.map(fromApi);
          origRender();
        }).catch(function() {});
    };
    var origSave = window.saveRoute;
    if (origSave) window.saveRoute = function(id) {
      var siteId = window.TELSITE;
      var site = siteId ? siteById(siteId) : null;
      var existing = id && site ? site.routes.filter(function(x) { return x.id === id; })[0] : null;
      var existingDbId = existing ? existing.dbId : null;
      var before = site ? site.routes.length : 0;
      origSave(id);
      if (!window.__authToken || !site) return;
      if (!id && site.routes.length > before) {
        var r = site.routes[site.routes.length - 1];
        fetch(SUBS_API_BASE + '/api/outbound-routes', {
          method: 'POST', headers: authHJson(), body: JSON.stringify(toApi(r, site.name))
        }).then(function(res) { return res.json(); })
          .then(function(d) { if (d && d.id) { r.dbId = d.id; r.id = String(d.id); } })
          .catch(function() {});
      } else if (existingDbId) {
        var updated = site.routes.filter(function(x) { return x.dbId === existingDbId; })[0];
        if (updated) fetch(SUBS_API_BASE + '/api/outbound-routes/' + existingDbId, {
          method: 'PUT', headers: authHJson(), body: JSON.stringify(toApi(updated, site.name))
        }).catch(function() {});
      }
    };
    var origDel = window.delRoute;
    if (origDel) window.delRoute = function(id) {
      var siteId = window.TELSITE;
      var site = siteId ? siteById(siteId) : null;
      var r = site ? site.routes.filter(function(x) { return x.id === id; })[0] : null;
      var dbId = r && r.dbId;
      origDel(id);
      if (dbId && window.__authToken) {
        fetch(SUBS_API_BASE + '/api/outbound-routes/' + dbId, {
          method: 'DELETE', headers: authH()
        }).catch(function() {});
      }
    };
    var origTog = window.togRoute;
    if (origTog) window.togRoute = function(id) {
      origTog(id);
      var siteId = window.TELSITE;
      var site = siteId ? siteById(siteId) : null;
      var r = site ? site.routes.filter(function(x) { return x.id === id; })[0] : null;
      if (r && r.dbId && window.__authToken) {
        fetch(SUBS_API_BASE + '/api/outbound-routes/' + r.dbId, {
          method: 'PUT', headers: authHJson(),
          body: JSON.stringify({ enabled: r.on })
        }).catch(function() {});
      }
    };
  })();

  /* ================= Message Routing — real backend sync ================= */
  (function() {
    var loaded = false;
    function ensureMsg() {
      if (!DB.msgcfg) return false;
      return true;
    }
    var origRender = window.renderMsgFx;
    if (origRender) window.renderMsgFx = function() {
      origRender();
      if (loaded || !window.__authToken || !ensureMsg()) return;
      loaded = true;
      fetch(SUBS_API_BASE + '/api/message-channels', { headers: authH() })
        .then(function(r) { return r.json(); })
        .then(function(rows) {
          if (!Array.isArray(rows) || !rows.length) return;
          rows.forEach(function(r) {
            var cfg = r.config || {};
            if (r.channel_type === 'widget') {
              DB.msgcfg.widget.dbId = r.id;
              if (cfg.name) DB.msgcfg.widget.name = cfg.name;
              if (cfg.color) DB.msgcfg.widget.color = cfg.color;
              if (cfg.greeting) DB.msgcfg.widget.greeting = cfg.greeting;
              if (cfg.position) DB.msgcfg.widget.position = cfg.position;
              if (cfg.offline) DB.msgcfg.widget.offline = cfg.offline;
              DB.msgcfg.widget.enabled = r.enabled;
              if (r.queue_id) DB.msgcfg.widget.queue = r.queue_id;
            } else if (r.channel_type === 'sms') {
              var found = false;
              DB.msgcfg.sms.forEach(function(s) {
                if (s.label === r.name || s.num === (cfg.num || '')) {
                  s.dbId = r.id; found = true;
                  s.enabled = r.enabled;
                  if (r.queue_id) s.queue = r.queue_id;
                }
              });
              if (!found) DB.msgcfg.sms.push({
                id: String(r.id), dbId: r.id, num: cfg.num || '',
                label: r.name, queue: r.queue_id || '', enabled: r.enabled
              });
            } else if (r.channel_type === 'whatsapp') {
              DB.msgcfg.wa.dbId = r.id;
              if (cfg.name) DB.msgcfg.wa.name = cfg.name;
              if (cfg.num) DB.msgcfg.wa.num = cfg.num;
              if (cfg.status) DB.msgcfg.wa.status = cfg.status;
              DB.msgcfg.wa.enabled = r.enabled;
              if (r.queue_id) DB.msgcfg.wa.queue = r.queue_id;
            }
          });
          origRender();
        }).catch(function() {});
    };
    /* Widget save */
    var origSaveWidget = window.msgSaveWidget;
    if (origSaveWidget) window.msgSaveWidget = function() {
      origSaveWidget();
      if (!window.__authToken || !ensureMsg()) return;
      var w = DB.msgcfg.widget;
      var body = {
        channel_type: 'widget', name: w.name,
        config: { name: w.name, color: w.color, greeting: w.greeting, position: w.position, offline: w.offline },
        queue_id: w.queue || '', enabled: w.enabled !== false
      };
      if (w.dbId) {
        fetch(SUBS_API_BASE + '/api/message-channels/' + w.dbId, {
          method: 'PUT', headers: authHJson(), body: JSON.stringify(body)
        }).catch(function() {});
      } else {
        fetch(SUBS_API_BASE + '/api/message-channels', {
          method: 'POST', headers: authHJson(), body: JSON.stringify(body)
        }).then(function(r) { return r.json(); })
          .then(function(d) { if (d && d.id) w.dbId = d.id; })
          .catch(function() {});
      }
    };
    /* SMS save */
    var origSaveSms = window.msgSaveSms;
    if (origSaveSms) window.msgSaveSms = function(id) {
      origSaveSms(id);
      if (!window.__authToken || !ensureMsg()) return;
      var s = DB.msgcfg.sms.filter(function(x) { return x.id === id; })[0];
      if (!s) return;
      var body = {
        channel_type: 'sms', name: s.label,
        config: { num: s.num },
        queue_id: s.queue || '', enabled: s.enabled !== false
      };
      if (s.dbId) {
        fetch(SUBS_API_BASE + '/api/message-channels/' + s.dbId, {
          method: 'PUT', headers: authHJson(), body: JSON.stringify(body)
        }).catch(function() {});
      } else {
        fetch(SUBS_API_BASE + '/api/message-channels', {
          method: 'POST', headers: authHJson(), body: JSON.stringify(body)
        }).then(function(r) { return r.json(); })
          .then(function(d) { if (d && d.id) s.dbId = d.id; })
          .catch(function() {});
      }
    };
    /* WhatsApp save */
    var origSaveWa = window.msgSaveWa;
    if (origSaveWa) window.msgSaveWa = function() {
      origSaveWa();
      if (!window.__authToken || !ensureMsg()) return;
      var w = DB.msgcfg.wa;
      var body = {
        channel_type: 'whatsapp', name: w.name,
        config: { num: w.num, name: w.name, status: w.status },
        queue_id: w.queue || '', enabled: w.enabled !== false
      };
      if (w.dbId) {
        fetch(SUBS_API_BASE + '/api/message-channels/' + w.dbId, {
          method: 'PUT', headers: authHJson(), body: JSON.stringify(body)
        }).catch(function() {});
      } else {
        fetch(SUBS_API_BASE + '/api/message-channels', {
          method: 'POST', headers: authHJson(), body: JSON.stringify(body)
        }).then(function(r) { return r.json(); })
          .then(function(d) { if (d && d.id) w.dbId = d.id; })
          .catch(function() {});
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

      /* Forecasts — gates the "Generate Schedule" button (genSchedule's
         DB.forecasts.length check) and feeds schedGrid()'s coverage row
         (reads DB.forecasts[0].data). DB.forecasts was always seeded as a
         permanently-empty local array (ensureWFM's DB.forecasts=[]) with
         nothing else in the legacy script ever populating it — real
         forecasts only ever existed in Postgres via the migrated React
         Forecasts page (features/quality/ForecastsPage.tsx), which the
         legacy script has no visibility into. That's why the button was
         always stuck on "Generate a forecast first" (→ click routes to the
         Forecasts page) regardless of how many real forecasts existed. The
         raw /api/forecasts row shape (id, tenant_id, week, status,
         generated_at, data) already matches what schedGrid() reads
         directly — data is the same {[planningGroupId]: {vol, aht, days}}
         JSONB genForecast() writes — so no per-field mapping is needed. */
      fetch(SUBS_API_BASE + '/api/forecasts?limit=1', { headers: authH() })
        .then(function(r) { return r.json(); })
        .then(function(rows) {
          if (!Array.isArray(rows) || !rows.length) return;
          DB.forecasts = rows;
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
