/* ============================================================
   MCM Cloud CX — Digital Certificates Backend Wiring
   NOT a redesign — reproduces the existing page markup exactly
   (same classes, same columns, same drawer layout) and replaces
   only what was dead: Search/Division/Status filters called a
   dirFilterSet() that doesn't exist anywhere in this codebase,
   "+ Upload Certificate" and every row opened a drawer whose Save
   button did nothing but toast('Saved — prototype only'), and
   there was no Delete action at all. Trust Store / Expiry Monitor
   (the page's other two tabs) are untouched — still the original
   static reference tables from scripts.ts.
   ============================================================ */

export const CERTS_SCRIPT: string = `
(function() {
  'use strict';

  var DIVISIONS = [
    { code: 'd_home', label: 'Home' },
    { code: 'd_ret', label: 'UK Retail' },
    { code: 'd_dig', label: 'UK Digital' },
    { code: 'd_col', label: 'UK Collections' },
    { code: 'd_man', label: 'Partner \\u2014 Manila' }
  ];

  function divisionLabel(code) {
    var m = DIVISIONS.filter(function(d) { return d.code === code; })[0];
    return m ? m.label : '';
  }

  var PURPOSES = ['BYOC trunk', 'Edge SIP TLS', 'SAML signing', 'Mutual TLS', 'Root CA'];

  /* ─── Backend-ready certificate data structure (fallback/seed data) ───
     Shape: { id, name, purpose, issuedTo, issuer, division, validFrom,
              expiresAt, alertBeforeDays, emailAlert, autoRenew }
     status/daysLeft are never stored here — see statusFor() — same "derive,
     don't duplicate" rule as canned-redesign.ts's substitutionFields.
     Exactly the 7 certificates the page's static prototype HTML used to
     hardcode. */
  var CERTIFICATES_FALLBACK = [
    { id: 'cert-byoc-sbc-2026', name: 'byoc-sbc-2026.pem', purpose: 'BYOC trunk', issuedTo: 'sbc.mcmgroup.example', issuer: 'DigiCert TLS RSA', division: 'd_home', validFrom: '2026-02-14', expiresAt: '2027-02-14', alertBeforeDays: 30, emailAlert: true, autoRenew: false },
    { id: 'cert-edge-hq-lon-01', name: 'edge-hq-lon-01.pem', purpose: 'Edge SIP TLS', issuedTo: 'edge-hq-lon-01.mcm.local', issuer: 'MCM Internal CA', division: 'd_home', validFrom: '2026-01-02', expiresAt: '2027-01-02', alertBeforeDays: 30, emailAlert: true, autoRenew: false },
    { id: 'cert-edge-hq-lon-02', name: 'edge-hq-lon-02.pem', purpose: 'Edge SIP TLS', issuedTo: 'edge-hq-lon-02.mcm.local', issuer: 'MCM Internal CA', division: 'd_home', validFrom: '2026-01-02', expiresAt: '2027-01-02', alertBeforeDays: 30, emailAlert: true, autoRenew: false },
    { id: 'cert-entra-signing-2026', name: 'entra-signing-2026.cer', purpose: 'SAML signing', issuedTo: 'sts.windows.net', issuer: 'Microsoft', division: '', validFrom: '2026-02-14', expiresAt: '2027-02-14', alertBeforeDays: 30, emailAlert: true, autoRenew: false },
    { id: 'cert-partner-mtls-northstar', name: 'partner-mtls-northstar.pem', purpose: 'Mutual TLS', issuedTo: 'api.northstarbpo.example', issuer: 'Sectigo', division: 'd_man', validFrom: '2025-08-30', expiresAt: '2026-08-30', alertBeforeDays: 30, emailAlert: true, autoRenew: false },
    { id: 'cert-legacy-pbx-2024', name: 'legacy-pbx-2024.pem', purpose: 'PBX trunk', issuedTo: 'pbx.mcm.local', issuer: 'MCM Internal CA', division: 'd_ret', validFrom: '2024-11-11', expiresAt: '2025-11-11', alertBeforeDays: 30, emailAlert: true, autoRenew: false },
    { id: 'cert-mcm-internal-root', name: 'mcm-internal-root.pem', purpose: 'Root CA', issuedTo: 'MCM Internal CA', issuer: 'Self-signed', division: '', validFrom: '2024-01-01', expiresAt: '2034-01-01', alertBeforeDays: 30, emailAlert: true, autoRenew: false }
  ];

  function statusFor(expiresAt, alertBeforeDays) {
    if (!expiresAt) return { status: 'Valid', daysLeft: null };
    var exp = new Date(expiresAt + 'T00:00:00');
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var daysLeft = Math.round((exp.getTime() - today.getTime()) / 86400000);
    if (daysLeft < 0) return { status: 'Expired', daysLeft: daysLeft };
    if (daysLeft <= (alertBeforeDays || 30)) return { status: 'Expiring', daysLeft: daysLeft };
    return { status: 'Valid', daysLeft: daysLeft };
  }

  /* ─── Backend row \u2192 frontend shape ───
     backend/certs.py (RealDictCursor) returns snake_case columns plus a
     server-computed status/days_left. This maps those onto the camelCase
     shape the rest of this module uses, same job normalizeCannedRow() does
     in canned-redesign.ts. Safe to call on already-camelCase local/fallback
     objects too (the || fallback is a no-op when already set). */
  function normalizeCertRow(row) {
    return {
      id: row.id,
      name: row.name,
      purpose: row.purpose,
      issuedTo: row.issuedTo || row.issued_to,
      issuer: row.issuer,
      division: row.division || '',
      validFrom: row.validFrom || row.valid_from,
      expiresAt: row.expiresAt || row.expires_at,
      alertBeforeDays: row.alertBeforeDays || row.alert_before_days || 30,
      emailAlert: row.emailAlert !== undefined ? row.emailAlert : (row.email_alert !== undefined ? row.email_alert : true),
      autoRenew: row.autoRenew !== undefined ? row.autoRenew : (row.auto_renew !== undefined ? row.auto_renew : false)
    };
  }

  /* ─── REST helper compatible with the shared window.apiFetch contract ───
     Same base URL / Authorization: Bearer <window.__authToken> contract as
     canned-redesign.ts's cannedApiFetch / apps-redesign.ts's appsApiFetch —
     kept as a local copy here, same reasoning as those modules. */
  function certsApiFetch(path, init) {
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

  /* Local-first mutable store — same reasoning as canned-redesign.ts's
     localCannedStore: a fresh CERTIFICATES_FALLBACK.slice() on every
     refresh() would silently discard a create/update/delete that only
     succeeded locally (backend unreachable). */
  var localCertStore = CERTIFICATES_FALLBACK.slice();

  function fetchCertificates() {
    if (window.CertsAPI && typeof window.CertsAPI.list === 'function') {
      try {
        var res = window.CertsAPI.list();
        if (res && typeof res.then === 'function') {
          return res.then(function(list) {
            return (Array.isArray(list) && list.length) ? list.map(normalizeCertRow) : localCertStore;
          }).catch(function() { return localCertStore; });
        }
        if (Array.isArray(res) && res.length) return Promise.resolve(res.map(normalizeCertRow));
      } catch (e) { /* fall through to REST */ }
    }
    return certsApiFetch('/api/certs').then(function(rows) {
      return (Array.isArray(rows) && rows.length) ? rows.map(normalizeCertRow) : localCertStore;
    }).catch(function() { return localCertStore; });
  }

  var certsCache = CERTIFICATES_FALLBACK.slice();

  var CertsService = {
    getAll: function() { return certsCache; },
    getById: function(id) { return certsCache.filter(function(c) { return c.id === id; })[0] || null; },
    refresh: function() {
      return fetchCertificates().then(function(list) {
        if (Array.isArray(list) && list.length) certsCache = list;
        return certsCache;
      });
    },
    create: function(entry) {
      var hook = window.CertsAPI && window.CertsAPI.create;
      if (typeof hook === 'function') {
        try {
          var hookRes = hook(entry);
          return (hookRes && typeof hookRes.then === 'function') ? hookRes : Promise.resolve(hookRes);
        } catch (e) { /* fall through */ }
      }
      return certsApiFetch('/api/certs', { method: 'POST', body: JSON.stringify(entry) }).then(normalizeCertRow).catch(function() {
        var created = Object.assign({ id: 'cert-' + Math.random().toString(36).slice(2, 10) }, entry);
        localCertStore.push(created);
        return created;
      });
    },
    update: function(id, entry) {
      var hook = window.CertsAPI && window.CertsAPI.update;
      if (typeof hook === 'function') {
        try {
          var hookRes = hook(id, entry);
          return (hookRes && typeof hookRes.then === 'function') ? hookRes : Promise.resolve(hookRes);
        } catch (e) { /* fall through */ }
      }
      return certsApiFetch('/api/certs/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(entry) }).then(normalizeCertRow).catch(function() {
        var idx = -1;
        for (var i = 0; i < localCertStore.length; i++) { if (localCertStore[i].id === id) { idx = i; break; } }
        var existing = idx > -1 ? localCertStore[idx] : (CertsService.getById(id) || {});
        var updated = Object.assign({}, existing, entry, { id: id });
        if (idx > -1) { localCertStore[idx] = updated; } else { localCertStore.push(updated); }
        return updated;
      });
    },
    remove: function(id) {
      var hook = window.CertsAPI && window.CertsAPI.remove;
      if (typeof hook === 'function') {
        try {
          var hookRes = hook(id);
          return (hookRes && typeof hookRes.then === 'function') ? hookRes : Promise.resolve(hookRes);
        } catch (e) { /* fall through */ }
      }
      return certsApiFetch('/api/certs/' + encodeURIComponent(id), { method: 'DELETE' }).catch(function() {
        localCertStore = localCertStore.filter(function(c) { return c.id !== id; });
        return { ok: true };
      });
    }
  };
  window.CertsService = CertsService;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatDate(iso) {
    if (!iso) return '\\u2014';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return '\\u2014';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /* ─── Filter state (search text + division + status) — same three
     controls the toolbar always had, now actually wired. ─── */
  var certFilters = { q: '', division: '', status: '' };

  function filteredCerts() {
    var q = certFilters.q.trim().toLowerCase();
    return CertsService.getAll().filter(function(c) {
      if (certFilters.division && c.division !== certFilters.division) return false;
      if (certFilters.status && statusFor(c.expiresAt, c.alertBeforeDays).status !== certFilters.status) return false;
      if (!q) return true;
      return c.name.toLowerCase().indexOf(q) > -1 ||
        (c.issuedTo || '').toLowerCase().indexOf(q) > -1 ||
        (c.issuer || '').toLowerCase().indexOf(q) > -1;
    });
  }

  function statusBadge(expiresAt, alertBeforeDays) {
    var s = statusFor(expiresAt, alertBeforeDays);
    if (s.status === 'Expired') return '<span class="st er"><span class="d"></span>Expired</span>';
    if (s.status === 'Expiring') return '<span class="st wn"><span class="d"></span>Expires in ' + s.daysLeft + ' day' + (s.daysLeft === 1 ? '' : 's') + '</span>';
    return '<span class="st ok"><span class="d"></span>Valid</span>';
  }

  function renderCertRow(c) {
    return '<tr data-div="' + c.division + '" data-status="' + statusFor(c.expiresAt, c.alertBeforeDays).status + '"' +
      ' onclick="window.certsOpenEditor(\\'' + c.id + '\\')">' +
      '<td><input type="checkbox" onclick="event.stopPropagation()"></td>' +
      '<td><b class="lnk">' + escapeHtml(c.name) + '</b></td>' +
      '<td>' + escapeHtml(c.purpose) + '</td>' +
      '<td>' + escapeHtml(c.issuedTo) + '</td>' +
      '<td>' + escapeHtml(c.issuer) + '</td>' +
      '<td>' + formatDate(c.validFrom) + '</td>' +
      '<td>' + formatDate(c.expiresAt) + '</td>' +
      '<td>' + statusBadge(c.expiresAt, c.alertBeforeDays) + '</td>' +
      '<td style="color:#a9b3c2">\\u22EE</td>' +
      '</tr>';
  }

  function renderCertsTable() {
    var list = filteredCerts();
    var rows = list.length
      ? list.map(renderCertRow).join('')
      : '<tr><td colspan="9" style="text-align:center;color:#8794a8;padding:28px 0">No certificates match your search.</td></tr>';
    return '<div class="tblw"><table class="dt"><thead><tr><th style="width:34px"><input type="checkbox"></th><th>Certificate \\u21C5</th><th>Purpose \\u21C5</th><th>Issued to \\u21C5</th><th>Issuer \\u21C5</th><th>Valid from \\u21C5</th><th>Expires \\u21C5</th><th>Status \\u21C5</th><th style="width:40px"></th></tr></thead><tbody id="tb">' + rows + '</tbody></table>' +
      '<div class="pgr"><span>Showing <b>' + (list.length ? '1\\u2013' + list.length : '0') + '</b> of <b>' + list.length + '</b></span><div class="sp"></div><span>Rows per page 25 \\u25be</span><span>\\u2039 \\u203A</span></div></div>';
  }

  function refreshCertsTable() {
    var wrap = document.getElementById('cert_table_wrap');
    if (!wrap) return;
    wrap.innerHTML = renderCertsTable();
  }

  window.certsSearch = function(value) {
    certFilters.q = value || '';
    refreshCertsTable();
  };
  window.certsFilterDivision = function(value) {
    certFilters.division = value || '';
    refreshCertsTable();
  };
  window.certsFilterStatus = function(value) {
    certFilters.status = value || '';
    refreshCertsTable();
  };
  window.certsReload = function() {
    CertsService.refresh().then(function() {
      refreshCertsTable();
      if (window.toast) window.toast('Certificates refreshed');
    });
  };

  function divisionOptions(selected) {
    var opts = '<option value="">Division: All</option>';
    DIVISIONS.forEach(function(d) {
      opts += '<option value="' + d.code + '"' + (selected === d.code ? ' selected' : '') + '>' + escapeHtml(d.label) + '</option>';
    });
    return opts;
  }

  function divisionFieldOptions(selected) {
    var opts = '<option value=""' + (selected === '' ? ' selected' : '') + '>\\u2014 (not division-scoped)</option>';
    DIVISIONS.forEach(function(d) {
      opts += '<option value="' + d.code + '"' + (selected === d.code ? ' selected' : '') + '>' + escapeHtml(d.label) + '</option>';
    });
    return opts;
  }

  function purposeOptions(selected) {
    return PURPOSES.map(function(p) {
      return '<option' + (selected === p ? ' selected' : '') + '>' + escapeHtml(p) + '</option>';
    }).join('');
  }

  /* Exact original page markup — header, tabs, toolbar, table, pagination,
     help panel all unchanged from scripts.ts's static SNAP.certs string,
     just table rows and filter wiring made real. Trust Store / Expiry
     Monitor tabs are untouched (still window.TT.certs in scripts.ts). */
  function renderCertsPage() {
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A Telephony</div>' +
      '<div class="tt"><h1>Digital Certificates</h1><div class="rt"><button class="btn" onclick="window.certsOpenEditor()">+ Upload Certificate</button><button class="btn sec">Export</button></div></div>' +
      '<div class="tabs"><div class="tb on" onclick="tabClick(this)">Certificates</div><div class="tb" onclick="tabClick(this)">Trust Store</div><div class="tb" onclick="tabClick(this)">Expiry Monitor</div></div></div>' +
      '<div class="pbody"><div class="tbar">' +
        '<input class="s" placeholder="Search digital certificates" oninput="window.certsSearch(this.value)">' +
        '<select class="chip" style="cursor:pointer" onchange="window.certsFilterDivision(this.value)">' + divisionOptions('') + '</select>' +
        '<select class="chip" style="cursor:pointer" onchange="window.certsFilterStatus(this.value)"><option value="">Status: Any</option><option value="Valid">Valid</option><option value="Expiring">Expiring</option><option value="Expired">Expired</option></select>' +
        '<div class="sp"></div><div class="chip">\\u2699 Columns</div><div class="chip" onclick="window.certsReload()">\\u21BB Refresh</div>' +
      '</div>' +
      '<div id="cert_table_wrap">' + renderCertsTable() + '</div>' +
      '</div>' +
      '<div class="help"><div class="hh" onclick="toggleHelp()"><span style="color:#FF4F1F">\\u24D8</span> Help &amp; Resources \\u2014 Digital Certificates<span class="cx" id="helpcx">Hide</span></div>' +
      '<div class="hb" id="helpb" style=""><div class="hcols"><div><h5>What you can do here</h5><ul><li>Upload and renew TLS certificates for BYOC and edges</li><li>Certificate authority chain and expiry monitoring</li><li>Mutual TLS for secure SIP</li></ul>' +
      '<h5>Keywords</h5><div><span class="kw o">TLS</span><span class="kw">Certificate chain</span><span class="kw">Expiry</span><span class="kw o">mTLS</span><span class="kw">SRTP</span></div></div>' +
      '<div><h5>Training videos</h5><div style="font-size:12px;color:#8794a8">No lab video mapped to this page yet.</div><h5 style="margin-top:14px">Reference documentation</h5>' +
      '<div><a class="reflnk" href="https://help.genesys.com/" target="_blank" rel="noopener">Help Centre \\u203A Digital Certificates</a><a class="reflnk" href="https://help.genesys.com/?q=Digital%20Certificates" target="_blank" rel="noopener">Search docs for \\u201CDigital Certificates\\u201D</a><a class="reflnk" href="https://www.genesys.com/pricing" target="_blank" rel="noopener">Licence requirements</a></div></div></div></div>';
  }

  /* ─── Upload / Edit drawer ───
     Same #drw/.dh/.db/.df/.sect/.fld/.tgl structure as the original
     SNAPDRW.certs drawer (and every other drawer in this app) — the file
     picker fields were always decorative (Save never touched real file
     bytes even before this module existed) and stay that way; Issued to /
     Issuer / Division / Valid from / Expires are new fields, added because
     without them there was no way to specify what a real certificate
     actually is — same style (.fld/label/input), not a new component. ─── */
  window.certsOpenEditor = function(id) {
    var existing = id ? CertsService.getById(id) : null;
    var isNew = !existing;
    var c = existing || { id: '', name: '', purpose: PURPOSES[0], issuedTo: '', issuer: '', division: '', validFrom: '', expiresAt: '', alertBeforeDays: 30, emailAlert: true, autoRenew: false };

    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw"><div class="dh"><h2>' + (isNew ? 'Upload' : 'Edit') + ' Certificate</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db">' +
        '<div id="certerr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
        '<div class="sect">Certificate</div>' +
        '<div class="fld"><label>Name</label><input id="cert_name" value="' + escapeHtml(c.name) + '"></div>' +
        '<div class="fld"><label>Purpose</label><select id="cert_purpose">' + purposeOptions(c.purpose) + '</select></div>' +
        '<div class="fld"><label>Certificate file (PEM)</label><input value="Choose file\\u2026" disabled></div>' +
        '<div class="fld"><label>Private key</label><input value="Choose file\\u2026" disabled></div>' +
        '<div class="fld"><label>Chain / intermediate</label><input value="Choose file\\u2026" disabled></div>' +
        '<div class="fld"><label>Issued to</label><input id="cert_issued_to" value="' + escapeHtml(c.issuedTo) + '" placeholder="host.example.com"></div>' +
        '<div class="fld"><label>Issuer</label><input id="cert_issuer" value="' + escapeHtml(c.issuer) + '"></div>' +
        '<div class="fld"><label>Division</label><select id="cert_division">' + divisionFieldOptions(c.division) + '</select></div>' +
        '<div class="fld"><label>Valid from</label><input id="cert_valid_from" type="date" value="' + escapeHtml(c.validFrom) + '"></div>' +
        '<div class="fld"><label>Expires *</label><input id="cert_expires" type="date" value="' + escapeHtml(c.expiresAt) + '"></div>' +
        '<div class="sect">Monitoring</div>' +
        '<div class="fld"><label>Alert before expiry (days)</label><input id="cert_alert_days" value="' + escapeHtml(String(c.alertBeforeDays)) + '"></div>' +
        '<div class="tgl"><div class="sw' + (c.emailAlert ? ' on' : '') + '" id="cert_email_alert" onclick="this.classList.toggle(\\'on\\')"></div>Email alert to telephony admins</div>' +
        '<div class="tgl"><div class="sw' + (c.autoRenew ? ' on' : '') + '" id="cert_auto_renew" onclick="this.classList.toggle(\\'on\\')"></div>Auto-renew via ACME</div>' +
        (isNew ? '' : '<button class="btn gh" onclick="window.certsDelete(\\'' + c.id + '\\')">Delete</button>') +
      '</div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.certsSave(\\'' + (c.id || '') + '\\')">Save</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
  };

  window.certsSave = function(id) {
    var name = document.getElementById('cert_name').value.trim();
    var expiresAt = document.getElementById('cert_expires').value;
    var errs = [];
    if (name.length < 2) errs.push('Name is required.');
    if (!expiresAt) errs.push('Expiry date is required.');
    if (errs.length) {
      var box = document.getElementById('certerr');
      box.style.display = '';
      box.innerHTML = errs.join('<br>');
      return;
    }

    var entry = {
      name: name,
      purpose: document.getElementById('cert_purpose').value,
      issued_to: document.getElementById('cert_issued_to').value.trim(),
      issuer: document.getElementById('cert_issuer').value.trim(),
      division: document.getElementById('cert_division').value,
      valid_from: document.getElementById('cert_valid_from').value || null,
      expires_at: expiresAt,
      alert_before_days: parseInt(document.getElementById('cert_alert_days').value, 10) || 30,
      email_alert: document.getElementById('cert_email_alert').classList.contains('on'),
      auto_renew: document.getElementById('cert_auto_renew').classList.contains('on')
    };

    var isNew = !id;
    var op = isNew ? CertsService.create(entry) : CertsService.update(id, entry);
    op.then(function() {
      return CertsService.refresh();
    }).then(function() {
      window.closeDrawer();
      refreshCertsTable();
      if (window.toast) window.toast((isNew ? '\\u2713 Uploaded ' : '\\u2713 Saved ') + '<b>' + escapeHtml(name) + '</b>');
    }).catch(function(err) {
      var box = document.getElementById('certerr');
      if (box) {
        box.style.display = '';
        box.innerHTML = escapeHtml((err && err.message) || 'Save failed \\u2014 please try again.');
      }
    });
  };

  /* scripts.ts's own confirmBox()/openDrawerHTML() are local to its
     closure, not exposed on window — self-contained equivalent using the
     same #drw/.dh/.db/.df drawer classes, same as canned-redesign.ts's
     cannedConfirmBox(). */
  function certsConfirmBox(msg, onYes) {
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
        '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" id="cert_cfyes">Confirm</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    document.getElementById('cert_cfyes').onclick = function() { window.closeDrawer(); onYes(); };
  }

  window.certsDelete = function(id) {
    var c = CertsService.getById(id);
    if (!c) return;
    var safeName = escapeHtml(c.name);
    certsConfirmBox('Delete certificate <b>' + safeName + '</b>?', function() {
      CertsService.remove(id).then(function() {
        return CertsService.refresh();
      }).then(function() {
        window.closeDrawer();
        refreshCertsTable();
        if (window.toast) window.toast('\\u2713 Deleted <b>' + safeName + '</b>');
      }).catch(function(err) {
        if (window.toast) window.toast('\\u2717 Delete failed \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
      });
    });
  };

  /* ─── Apply — patches window.SNAP.certs, same mechanism
     authorg-redesign.ts/apps-redesign.ts use. 'certs' is plain SNAP-based
     routing (unlike 'canned', which needed an openPage() wrapper — certs
     was never in any DYN dispatcher object), so a direct SNAP overwrite is
     enough for window.openPage('certs') to pick this up. ─── */
  function applyCertsRedesign() {
    CertsService.refresh().then(function() {
      if (window.SNAP) window.SNAP.certs = renderCertsPage();
      if (window.APP && window.APP.page === 'certs') {
        var cnt = document.getElementById('cnt');
        if (cnt) cnt.innerHTML = renderCertsPage();
      }
    });
  }

  applyCertsRedesign();
  setTimeout(applyCertsRedesign, 100);
  setTimeout(applyCertsRedesign, 400);

})();
`;
