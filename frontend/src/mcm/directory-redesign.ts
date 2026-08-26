/* ============================================================
   MCM Cloud CX — Directory Redesign Module
   Drop-in replacement for BOTH Directory surfaces:
     • Top-nav workspace  go('directory')
     • Admin ▸ Directory  openPage('locations' | 'profflds' | 'extcontacts' | 'docws')

   Same integration pattern as authorg-redesign.ts: this file exports a
   script string that is injected AFTER MCM_SCRIPT, so window.SNAP,
   window.go and window.openPage already exist and can be wrapped.

   Backend integration: everything data-related lives in the DirectoryService
   section below. Flip USE_API to true (or set window.MCM_DIRECTORY_API) and
   each method hits the REST endpoint listed above it; when a request fails it
   falls back to the local store so the prototype never dead-ends.
   ============================================================ */

export const DIRECTORY_SCRIPT: string = `
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════
     0 · TOKENS + ICONS  (palette lifted from mcm.css)
     ══════════════════════════════════════════════════════════ */
  var C = {
    accent: '#FF4F1F', accentDk: '#e8441a', accentSoft: '#fff2ec',
    navy: '#152550', ink: '#20303f', body: '#3c4a5c', mute: '#7b8798',
    faint: '#93a0b3', line: '#dde3ec', hair: '#f1f4f8', panel: '#fff',
    bg: '#eef1f5', head: '#f7f9fc'
  };
  var PRES = {
    'Available': { dot: '#2eab6b', bg: '#eaf7f0', fg: '#1c7a4c', bd: '#c6e9d6' },
    'On queue': { dot: '#2b6cb0', bg: '#eaf1fa', fg: '#215a94', bd: '#c9dcf1' },
    'Busy': { dot: '#d64545', bg: '#fdecec', fg: '#a92f2f', bd: '#f6cfcf' },
    'Away': { dot: '#d98324', bg: '#fdf3e7', fg: '#a3611a', bd: '#f4dcbd' },
    'Offline': { dot: '#97a3b4', bg: '#f2f4f7', fg: '#6b7787', bd: '#e0e5ec' }
  };
  var TINTS = ['#FF4F1F','#2b6cb0','#7a4fb5','#0f9d8c','#c1440e','#8a6d3b','#5b6a7d','#a0522d','#4a5a6e'];

  function svg(p, s) {
    return '<svg width="' + (s || 14) + '" height="' + (s || 14) + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  }
  var I = {
    search: svg('<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.6-3.6"></path>'),
    phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"></path>'),
    mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path>'),
    chat: svg('<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"></path>'),
    edit: svg('<path d="M12 20h9"></path><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>'),
    trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"></path>'),
    star: svg('<path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5-4.7-4.6 6.5-.9z"></path>', 15),
    down: svg('<path d="M12 3v12M7 10l5 5 5-5M4 21h16"></path>'),
    plus: svg('<path d="M12 5v14M5 12h14"></path>'),
    bldg: svg('<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"></path>', 12),
    users: svg('<path d="M17 20v-1.5A3.5 3.5 0 0 0 13.5 15h-5A3.5 3.5 0 0 0 5 18.5V20"></path><circle cx="11" cy="8" r="3.5"></circle><path d="M19 20v-1.5a3.5 3.5 0 0 0-2.6-3.4"></path>'),
    x: svg('<path d="M18 6 6 18M6 6l12 12"></path>', 16),
    up: svg('<path d="M12 19V5M5 12l7-7 7 7"></path>', 12),
    dn: svg('<path d="M12 5v14M5 12l7 7 7-7"></path>', 12),
    grid: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"></rect><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"></rect><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"></rect><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"></rect></svg>',
    list: svg('<path d="M4 6h16M4 12h16M4 18h16"></path>', 15)
  };

  /* ══════════════════════════════════════════════════════════
     1 · DirectoryService — THE ONLY PLACE THAT TOUCHES DATA
     ------------------------------------------------------------
     Endpoints (mirror backend/resources.py REGISTRY style):
       GET/POST      \\/api/directory/people              PUT/DELETE  :id
       GET/POST      \\/api/directory/groups              PUT/DELETE  :id
       GET/POST      \\/api/directory/locations           PUT/DELETE  :id
       GET/POST      \\/api/directory/profile-fields      PUT/DELETE  :id
       GET/POST      \\/api/directory/external-contacts   PUT/DELETE  :id
       GET/POST      \\/api/directory/workspaces          PUT/DELETE  :id
       GET           \\/api/directory/favourites          PUT :id { favourite }
       GET/POST      \\/api/directory/threads/:id/messages
       POST          \\/api/directory/calls · \\/emails
     ══════════════════════════════════════════════════════════ */
  var API_BASE = window.MCM_DIRECTORY_API || ((window.__GENESIS_API_BASE || 'https://genesis-yysv.onrender.com') + '/api/directory');
  var USE_API = true;   // API is live — data stored in PostgreSQL
  var KEY = 'mcm_directory_v5';

  function uid(p) { return p + Math.random().toString(36).slice(2, 9); }
  function initialsOf(n) {
    return (n || '').trim().split(/\\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || '??';
  }
  function today() {
    return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function clock() {
    return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function request(path, init) {
    var token = (window.APP && window.APP.token) || window.__authToken || localStorage.getItem('mcm_token');
    var h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return fetch(API_BASE + path, Object.assign({ headers: h }, init || {})).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (b) {
          var err = new Error(b.error || (r.status + ' ' + r.statusText));
          err.status = r.status;
          throw err;
        });
      }
      return r.status === 204 ? null : r.json();
    });
  }
  /* Every read/write goes through this: try the API when enabled, otherwise
     (or on failure) resolve from the local store. One place to change. --
     except a 4xx: that's the backend actively rejecting the request (e.g.
     _validate_title_dept in backend/directory.py), not an outage, so
     falling back to "succeed locally anyway" would silently persist data
     the API just refused and show a false "Saved" toast. Only network/5xx
     failures fall back; a real rejection propagates so the caller can
     show the actual reason. */
  function via(path, init, local) {
    if (!USE_API) return Promise.resolve(local());
    return request(path, init).catch(function (e) {
      if (e.status >= 400 && e.status < 500) throw e;
      console.warn('[directory] API fallback for ' + path, e.message);
      return local();
    });
  }

  /* Job titles/departments share the same managed picklist (simple_entities,
     kind='title'|'dept') as the People & Permissions module -- see that
     module's TitlesPage/DepartmentsPage and store.ts's SimpleEntityKind.
     That's a plain /api/simple-entities route, not one of this file's own
     /api/directory/* endpoints, so it needs the API root rather than
     request()'s directory-prefixed API_BASE. */
  function requestCore(path, init) {
    var base = window.__GENESIS_API_BASE || 'https://genesis-yysv.onrender.com';
    var token = (window.APP && window.APP.token) || window.__authToken || localStorage.getItem('mcm_token');
    var h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return fetch(base + path, Object.assign({ headers: h }, init || {})).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (b) { throw new Error(b.error || (r.status + ' ' + r.statusText)); });
      return r.status === 204 ? null : r.json();
    });
  }
  function fetchPicklistNames(kind) {
    return requestCore('/api/simple-entities?kind=' + kind)
      .then(function (rows) { return rows.map(function (r) { return r.name; }); })
      .catch(function () { return []; });
  }
  function createPicklistEntry(kind, name) {
    return requestCore('/api/simple-entities', {
      method: 'POST',
      body: JSON.stringify({ kind: kind, name: name, description: '' }),
    });
  }

  function seed() {
    return {
      me: { id: 'u_fkhan', presence: 'Available' },
      favourites: [], threads: {}, activity: [],
      people: [
        { id: 'u_fkhan', name: 'Faisal Khan', title: 'Platform Owner', dept: 'IT', division: 'HQ (London)', location: 'London HQ', email: 'fkhan@mcmgroup.com', phone: '+44 20 7946 1001', ext: '1001', presence: 'Available', station: 'WebRTC softphone', manager: '—', licence: 'CX 3', tz: 'Europe/London', started: '04 Jan 2024', skills: ['Billing'], langs: ['English'], queues: [] },
        { id: 'u_arahman', name: 'Aisha Rahman', title: 'Contact Centre Manager', dept: 'Operations', division: 'UK Retail', location: 'Manchester', email: 'arahman@mcmgroup.com', phone: '+44 161 496 7100', ext: '7100', presence: 'On queue', station: 'WebRTC softphone', manager: 'Faisal Khan', licence: 'CX 3', tz: 'Europe/London', started: '03 Feb 2024', skills: ['Retention', 'Complaints'], langs: ['English'], queues: ['Retail Voice', 'Escalations'] },
        { id: 'u_dmoore', name: 'Daniel Moore', title: 'Team Leader', dept: 'Customer Care', division: 'UK Retail', location: 'Manchester', email: 'dmoore@mcmgroup.com', phone: '+44 161 496 7112', ext: '7112', presence: 'Busy', station: 'WebRTC softphone', manager: 'Aisha Rahman', licence: 'CX 2', tz: 'Europe/London', started: '19 Mar 2024', skills: ['Billing', 'Retention'], langs: ['English'], queues: ['Retail Voice'] },
        { id: 'u_spetrova', name: 'Sofia Petrova', title: 'Advisor', dept: 'Customer Care', division: 'UK Retail', location: 'Manchester', email: 'spetrova@mcmgroup.com', phone: '+44 161 496 7141', ext: '7141', presence: 'On queue', station: 'WebRTC softphone', manager: 'Daniel Moore', licence: 'CX 2', tz: 'Europe/London', started: '12 Jan 2025', skills: ['Technical Support'], langs: ['English', 'Spanish'], queues: ['Retail Voice', 'Tech Support'] },
        { id: 'u_joneill', name: 'James O’Neill', title: 'Advisor', dept: 'Customer Care', division: 'UK Retail', location: 'Manchester', email: 'joneill@mcmgroup.com', phone: '+44 161 496 7148', ext: '7148', presence: 'Available', station: 'Desk phone', manager: 'Daniel Moore', licence: 'CX 2', tz: 'Europe/London', started: '02 Feb 2025', skills: ['Billing'], langs: ['English'], queues: ['Retail Voice'] },
        { id: 'u_mkapoor', name: 'Meera Kapoor', title: 'Advisor', dept: 'Collections', division: 'UK Collections', location: 'Mumbai Hub', email: 'mkapoor@mcmgroup.com', phone: '+91 22 6100 2001', ext: '2001', presence: 'Away', station: 'Remote number', manager: 'Aisha Rahman', licence: 'CX 1', tz: 'Asia/Kolkata', started: '20 Jan 2025', skills: ['Collections'], langs: ['English', 'Hindi'], queues: ['Collections'] },
        { id: 'u_twright', name: 'Tom Wright', title: 'Telephony Engineer', dept: 'IT', division: 'HQ (London)', location: 'London HQ', email: 'twright@mcmgroup.com', phone: '+44 20 7946 7000', ext: '7000', presence: 'Available', station: 'WebRTC softphone', manager: 'Faisal Khan', licence: 'CX 1', tz: 'Europe/London', started: '14 Jan 2024', skills: ['Technical Support'], langs: ['English'], queues: [] },
        { id: 'u_lbennett', name: 'Lucy Bennett', title: 'WFM Analyst', dept: 'Planning', division: 'HQ (London)', location: 'London HQ', email: 'lbennett@mcmgroup.com', phone: '+44 20 7946 7311', ext: '7311', presence: 'Busy', station: 'WebRTC softphone', manager: 'Faisal Khan', licence: 'CX 3', tz: 'Europe/London', started: '04 Apr 2024', skills: ['Forecasting'], langs: ['English'], queues: [] },
        { id: 'u_rsharma', name: 'Ravi Sharma', title: 'Advisor', dept: 'Digital', division: 'UK Digital', location: 'Mumbai Hub', email: 'rsharma@mcmgroup.com', phone: '+91 22 6100 2044', ext: '2044', presence: 'Offline', station: 'Remote number', manager: 'Aisha Rahman', licence: 'CX 2', tz: 'Asia/Kolkata', started: '11 Jun 2026', skills: ['Technical Support'], langs: ['English', 'Hindi'], queues: ['Digital Chat'] },
        { id: 'u_hchase', name: 'Helen Chase', title: 'Receptionist', dept: 'Facilities', division: 'HQ (London)', location: 'London HQ', email: 'hchase@mcmgroup.com', phone: '+44 20 7946 1000', ext: '1000', presence: 'Offline', station: 'Desk phone', manager: 'Faisal Khan', licence: 'Communicate', tz: 'Europe/London', started: '22 Feb 2024', skills: [], langs: ['English'], queues: [] }
      ],
      groups: [
        { id: 'g_ccsup', name: 'Customer Care Supervisors', type: 'Official', ext: '7100', ring: 'Broadcast', owner: 'Aisha Rahman', memberIds: ['u_arahman', 'u_dmoore', 'u_lbennett'], voicemail: true },
        { id: 'g_retail', name: 'Retail Advisors', type: 'Official', ext: '—', ring: 'Sequential', owner: 'Daniel Moore', memberIds: ['u_spetrova', 'u_joneill', 'u_dmoore'], voicemail: false },
        { id: 'g_collect', name: 'Collections Team', type: 'Official', ext: '7200', ring: 'Rotary', owner: 'Meera Kapoor', memberIds: ['u_mkapoor'], voicemail: true },
        { id: 'g_spanish', name: 'Spanish Speakers', type: 'Skill expression', ext: '—', ring: 'Broadcast', owner: 'System', memberIds: ['u_spetrova'], voicemail: false },
        { id: 'g_itsd', name: 'IT Service Desk', type: 'Official', ext: '7000', ring: 'Sequential', owner: 'Tom Wright', memberIds: ['u_twright', 'u_fkhan'], voicemail: true },
        { id: 'g_social', name: 'Social Committee', type: 'Social', ext: '—', ring: 'Broadcast', owner: 'Helen Chase', memberIds: ['u_hchase', 'u_joneill'], voicemail: false }
      ],
      locations: [
        { id: 'l_london', name: 'London HQ', type: 'Head office', address: '18 Finsbury Circus, London EC2M 7EA', country: 'United Kingdom', tz: 'Europe/London', hours: '08:00 – 18:30', floors: ['Ground — Reception', '3rd — CX Operations', '4th — IT & Planning'], emergency: '+44 20 7946 1099', site: 'Site-EU-LON-01', status: 'Operational' },
        { id: 'l_manchester', name: 'Manchester', type: 'Contact centre', address: 'Kestrel House, 12 Deansgate, Manchester M3 2BW', country: 'United Kingdom', tz: 'Europe/London', hours: '07:00 – 22:00', floors: ['1st — Retail Voice', '2nd — Collections'], emergency: '+44 161 496 7099', site: 'Site-EU-MAN-02', status: 'Operational' },
        { id: 'l_mumbai', name: 'Mumbai Hub', type: 'Delivery centre', address: 'Tower B, Nirlon Knowledge Park, Goregaon, Mumbai 400063', country: 'India', tz: 'Asia/Kolkata', hours: '24 / 7', floors: ['7th — Digital', '8th — Collections'], emergency: '+91 22 6100 2099', site: 'Site-AP-BOM-01', status: 'Operational' },
        { id: 'l_manila', name: 'Partner — Manila', type: 'Outsourced overflow', address: 'Cyber Sigma, Lawton Ave, Taguig 1630', country: 'Philippines', tz: 'Asia/Manila', hours: '24 / 7', floors: ['12th — Overflow voice'], emergency: '+63 2 8555 0099', site: 'Site-AP-MNL-03', status: 'Limited' }
      ],
      external: [
        { id: 'x_bt', name: 'Priya Nair', org: 'BT Wholesale', role: 'SIP carrier account manager', email: 'priya.nair@btwholesale.com', phone: '+44 20 7356 4410', relationship: 'Carrier', lastContact: '12 Aug 2026', owner: 'Tom Wright' },
        { id: 'x_gs', name: 'Mark Ellis', org: 'Northstar BPO', role: 'Delivery director', email: 'mellis@northstarbpo.com', phone: '+63 2 8555 0121', relationship: 'Partner', lastContact: '05 Aug 2026', owner: 'Aisha Rahman' },
        { id: 'x_cl', name: 'Sara Duarte', org: 'Cloudline Partners', role: 'Implementation lead', email: 'sduarte@cloudline.io', phone: '+353 1 545 8890', relationship: 'Vendor', lastContact: '28 Jul 2026', owner: 'Faisal Khan' },
        { id: 'x_vx', name: 'Ian Whitfield', org: 'Vertex Consulting', role: 'WFM consultant', email: 'ian.w@vertexconsulting.co.uk', phone: '+44 113 322 7761', relationship: 'Vendor', lastContact: '14 Jun 2026', owner: 'Lucy Bennett' },
        { id: 'x_rt', name: 'Elena Rossi', org: 'MCM Retail Ireland', role: 'Ops manager (trustee org)', email: 'erossi@mcmretail.ie', phone: '+353 1 902 3344', relationship: 'Group company', lastContact: '02 Aug 2026', owner: 'Aisha Rahman' }
      ],
      fields: [
        { id: 'f_title', label: 'Job title', key: 'title', type: 'Text', section: 'Work', visibility: 'Everyone', required: true, system: true },
        { id: 'f_dept', label: 'Department', key: 'department', type: 'Select', section: 'Work', visibility: 'Everyone', required: true, system: true },
        { id: 'f_ext', label: 'Extension', key: 'extension', type: 'Number', section: 'Contact', visibility: 'Everyone', required: true, system: true },
        { id: 'f_mob', label: 'Mobile', key: 'mobile', type: 'Phone', section: 'Contact', visibility: 'Managers only', required: false, system: false },
        { id: 'f_start', label: 'Start date', key: 'start_date', type: 'Date', section: 'Work', visibility: 'Managers only', required: false, system: false },
        { id: 'f_lang', label: 'Languages', key: 'languages', type: 'Multi-select', section: 'Skills', visibility: 'Everyone', required: false, system: false },
        { id: 'f_cert', label: 'Certifications', key: 'certifications', type: 'Multi-select', section: 'Skills', visibility: 'Everyone', required: false, system: false },
        { id: 'f_emerg', label: 'Emergency contact', key: 'emergency_contact', type: 'Text', section: 'Private', visibility: 'HR only', required: false, system: false },
        { id: 'f_bio', label: 'About me', key: 'bio', type: 'Long text', section: 'Personal', visibility: 'Everyone', required: false, system: false }
      ],
      workspaces: [
        { id: 'w_cc', name: 'Contact Centre Playbooks', type: 'Team', owner: 'Aisha Rahman', access: 'Customer Care Supervisors', docs: 128, size: '1.4 GB', updated: '14 Aug 2026', retention: '3 years' },
        { id: 'w_it', name: 'Telephony Runbooks', type: 'Team', owner: 'Tom Wright', access: 'IT Service Desk', docs: 64, size: '820 MB', updated: '11 Aug 2026', retention: '5 years' },
        { id: 'w_hr', name: 'HR & Onboarding', type: 'Restricted', owner: 'Helen Chase', access: 'HR only', docs: 212, size: '3.1 GB', updated: '09 Aug 2026', retention: '7 years' },
        { id: 'w_qa', name: 'Quality Calibration', type: 'Team', owner: 'Lucy Bennett', access: 'Quality Evaluators', docs: 47, size: '410 MB', updated: '02 Aug 2026', retention: '2 years' },
        { id: 'w_pub', name: 'Company Announcements', type: 'Public', owner: 'Faisal Khan', access: 'Everyone', docs: 39, size: '190 MB', updated: '18 Aug 2026', retention: '1 year' }
      ]
    };
  }

  var PICKLIST_CACHE = { title: [], dept: [] };
  var cache = null;
  function db() {
    if (cache) return cache;
    try { var raw = localStorage.getItem(KEY); cache = raw ? JSON.parse(raw) : seed(); }
    catch (e) { cache = seed(); }
    return cache;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) {} }
  function log(text) {
    var d = db();
    d.activity.unshift({ id: uid('a_'), text: text, time: clock() });
    d.activity = d.activity.slice(0, 40);
  }

  /* Generic collection CRUD so every entity reads the same way. */
  function coll(name, path, decorate) {
    return {
      list: function (q) {
        return via('/' + path + (q ? '?q=' + encodeURIComponent(q) : ''), null, function () {
          var n = (q || '').trim().toLowerCase();
          var rows = db()[name].filter(function (r) {
            if (!n) return true;
            return Object.keys(r).some(function (k) {
              return typeof r[k] === 'string' && r[k].toLowerCase().indexOf(n) > -1;
            });
          });
          return decorate ? rows.map(decorate) : rows;
        });
      },
      get: function (id) {
        return via('/' + path + '/' + id, null, function () {
          var r = db()[name].filter(function (x) { return x.id === id; })[0] || null;
          return r && decorate ? decorate(r) : r;
        });
      },
      upsert: function (rec) {
        var body = JSON.stringify(rec);
        return via('/' + path + (rec.id ? '/' + rec.id : ''), { method: rec.id ? 'PUT' : 'POST', body: body }, function () {
          var d = db(), i;
          if (rec.id) {
            i = d[name].map(function (x) { return x.id; }).indexOf(rec.id);
            d[name][i] = Object.assign({}, d[name][i], rec);
            log('Updated ' + path + ' ' + (rec.name || rec.label || rec.id));
          } else {
            rec.id = uid(path.slice(0, 1) + '_');
            d[name].push(rec);
            log('Created ' + path + ' ' + (rec.name || rec.label || rec.id));
          }
          save();
          return rec;
        }).then(function (r) { apiCountsCache = null; refreshApiCounts(); return r; });
      },
      remove: function (id) {
        return via('/' + path + '/' + id, { method: 'DELETE' }, function () {
          var d = db();
          var gone = d[name].filter(function (x) { return x.id === id; })[0];
          d[name] = d[name].filter(function (x) { return x.id !== id; });
          d.favourites = d.favourites.filter(function (f) { return f !== id; });
          if (name === 'people') d.groups.forEach(function (g) { g.memberIds = g.memberIds.filter(function (m) { return m !== id; }); });
          log('Deleted ' + path + ' ' + ((gone && (gone.name || gone.label)) || id));
          save();
          return true;
        }).then(function (r) { apiCountsCache = null; refreshApiCounts(); return r; });
      }
    };
  }

  var SVC = {
    people: coll('people', 'people'),
    groups: coll('groups', 'groups'),
    locations: coll('locations', 'locations', function (l) {
      return Object.assign({}, l, { headcount: db().people.filter(function (p) { return p.location === l.name; }).length });
    }),
    fields: coll('fields', 'profile-fields'),
    external: coll('external', 'external-contacts'),
    workspaces: coll('workspaces', 'workspaces'),

    listPeople: function (f) {
      f = f || {};
      var qs = Object.keys(f).filter(function (k) { return f[k]; }).map(function (k) { return k + '=' + encodeURIComponent(f[k]); }).join('&');
      return via('/people' + (qs ? '?' + qs : ''), null, function () {
        var n = (f.q || '').trim().toLowerCase();
        var rows = db().people.filter(function (p) {
          if (n) {
            var hay = (p.name + ' ' + p.title + ' ' + p.dept + ' ' + p.email + ' ' + p.ext + ' ' + (p.skills || []).join(' ')).toLowerCase();
            if (hay.indexOf(n) === -1) return false;
          }
          if (f.dept && p.dept !== f.dept) return false;
          if (f.loc && p.location !== f.loc) return false;
          if (f.pres && p.presence !== f.pres) return false;
          return true;
        });
        var rank = { 'Available': 0, 'On queue': 1, 'Busy': 2, 'Away': 3, 'Offline': 4 };
        return rows.slice().sort(function (a, b) {
          if (f.sort === 'presence') return (rank[a.presence] - rank[b.presence]) || a.name.localeCompare(b.name);
          if (f.sort === 'department') return a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name);
          if (f.sort === 'location') return a.location.localeCompare(b.location) || a.name.localeCompare(b.name);
          return a.name.localeCompare(b.name);
        });
      });
    },
    favourites: function () {
      return via('/favourites', null, function () {
        var d = db();
        return {
          people: d.people.filter(function (p) { return d.favourites.indexOf(p.id) > -1; }),
          groups: d.groups.filter(function (g) { return d.favourites.indexOf(g.id) > -1; }),
          contacts: d.external.filter(function (c) { return d.favourites.indexOf(c.id) > -1; })
        };
      });
    },
    setFavourite: function (id, on) {
      return via('/favourites/' + id, { method: 'PUT', body: JSON.stringify({ favourite: on }) }, function () {
        var d = db();
        d.favourites = d.favourites.filter(function (x) { return x !== id; });
        if (on) d.favourites.push(id);
        save();
        return d.favourites.slice();
      });
    },
    favIds: function () { return db().favourites.slice(); },
    thread: function (id) {
      return via('/threads/' + id + '/messages', null, function () { return (db().threads[id] || []).slice(); });
    },
    sendMessage: function (id, text, name) {
      return via('/threads/' + id + '/messages', { method: 'POST', body: JSON.stringify({ text: text }) }, function () {
        var d = db(), list = d.threads[id] || [];
        list.push({ id: uid('m_'), from: 'me', text: text, time: clock() });
        d.threads[id] = list; log('Message sent to ' + (name || id)); save();
        setTimeout(function () {
          var cur = db().threads[id] || [];
          var t = text.toLowerCase(), reply;
          if (t.indexOf('?') > -1) reply = 'Good question — checking now, give me two minutes.';
          else if (t.indexOf('call') > -1) reply = 'Sure, ring my extension whenever you are ready.';
          else if (t.indexOf('thank') > -1) reply = 'Any time.';
          else reply = 'Got it, thanks for the heads-up.';
          cur.push({ id: uid('m_'), from: 'them', text: reply, time: clock() });
          db().threads[id] = cur; save();
          window.dispatchEvent(new CustomEvent('mcm-thread-update', { detail: { id: id } }));
        }, 1400);
        return list.slice();
      });
    },
    startCall: function (t) {
      return via('/calls', { method: 'POST', body: JSON.stringify({ targetId: t.id }) }, function () {
        log('Call started with ' + t.name); save(); return { callId: uid('c_') };
      });
    },
    endCall: function (cid, secs, t) {
      return via('/calls/' + cid, { method: 'PUT', body: JSON.stringify({ seconds: secs }) }, function () {
        log('Call ended with ' + ((t && t.name) || 'contact') + ' · ' + secs + 's'); save(); return true;
      });
    },
    sendEmail: function (m) {
      return via('/emails', { method: 'POST', body: JSON.stringify(m) }, function () {
        log('Email sent to ' + m.to + ' — "' + m.subject + '"'); save(); return true;
      });
    },
    setPresence: function (p) {
      return via('/me/presence', { method: 'PUT', body: JSON.stringify({ presence: p }) }, function () {
        var d = db(); d.me.presence = p;
        var me = d.people.filter(function (x) { return x.id === d.me.id; })[0];
        if (me) me.presence = p;
        log('Presence set to ' + p); save(); return p;
      });
    },
    activity: function () { return db().activity.slice(); },
    departments: function () {
      var out = [];
      db().people.forEach(function (p) { if (out.indexOf(p.dept) === -1) out.push(p.dept); });
      return out.sort();
    },
    locationNames: function () { return db().locations.map(function (l) { return l.name; }); },
    peopleById: function (ids) {
      return ids.map(function (id) { return db().people.filter(function (p) { return p.id === id; })[0]; })
        .filter(function (x) { return x; });
    },
    counts: function () {
      var d = db();
      return { people: d.people.length, groups: d.groups.length, locations: d.locations.length, external: d.external.length, fav: d.favourites.length };
    },
    reset: function () { cache = seed(); save(); return true; }
  };
  window.MCMDirectory = { service: SVC, useApi: function (on) { USE_API = on !== false; } };

  /* ══════════════════════════════════════════════════════════
     2 · STYLES
     ══════════════════════════════════════════════════════════ */
  if (!document.getElementById('dxr_css')) {
    var st = document.createElement('style');
    st.id = 'dxr_css';
    st.textContent = [
      '.dxr{background:' + C.bg + ';min-height:100%;color:' + C.ink + '}',
      '.dxr *{box-sizing:border-box}',
      '.dxr-hd{background:#fff;border-bottom:1px solid ' + C.line + ';padding:16px 28px 0}',
      '.dxr-eyebrow{font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:' + C.faint + ';font-weight:700;margin-bottom:6px}',
      '.dxr-h1{margin:0;font-size:23px;font-weight:600;color:' + C.navy + ';letter-spacing:-.2px}',
      '.dxr-sub{font-size:12.5px;color:' + C.mute + '}',
      '.dxr-top{display:flex;align-items:flex-end;gap:20px}',
      '.dxr-acts{display:flex;align-items:center;gap:8px;padding-bottom:2px}',
      '.dxr-btn{height:34px;padding:0 14px;border-radius:5px;border:1px solid #ccd4e0;background:#fff;color:#2b3a4d;font-size:12.5px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;transition:background .12s,border-color .12s}',
      '.dxr-btn:hover{background:#f4f6fa;border-color:#a9b3c2}',
      '.dxr-btn.pri{background:' + C.accent + ';border-color:' + C.accent + ';color:#fff;font-weight:600;box-shadow:0 1px 2px rgba(255,79,31,.4)}',
      '.dxr-btn.pri:hover{background:' + C.accentDk + ';border-color:' + C.accentDk + '}',
      '.dxr-btn.danger{color:#b03030;border-color:#f0cccc}.dxr-btn.danger:hover{background:#fdecec;border-color:#e2a9a9}',
      '.dxr-btn.sm{height:28px;padding:0 10px;font-size:12px}',
      '.dxr-tabs{display:flex;align-items:center;gap:2px;margin-top:14px}',
      '.dxr-tb{display:flex;align-items:center;gap:7px;padding:0 14px;height:38px;font-size:13px;cursor:pointer;white-space:nowrap;border-bottom:3px solid transparent;color:' + C.mute + '}',
      '.dxr-tb:hover{color:' + C.navy + '}',
      '.dxr-tb.on{border-bottom-color:' + C.accent + ';color:' + C.navy + ';font-weight:600}',
      '.dxr-cnt{font-size:11px;font-weight:600;min-width:20px;height:18px;padding:0 6px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;background:#eef1f6;color:' + C.mute + '}',
      '.dxr-tb.on .dxr-cnt{background:' + C.accentSoft + ';color:#c9401a}',
      '.dxr-bar{background:#fff;border-bottom:1px solid ' + C.line + ';padding:11px 28px;display:flex;align-items:center;gap:9px;flex-wrap:wrap}',
      '.dxr-sw{position:relative;display:flex;align-items:center}',
      '.dxr-sw>span{position:absolute;left:11px;color:' + C.faint + ';display:flex;pointer-events:none}',
      '.dxr-in{height:34px;border:1px solid #d5dce7;border-radius:5px;padding:0 11px;font-size:12.8px;color:' + C.ink + ';outline:none;background:#fff;width:100%}',
      '.dxr-in:focus{border-color:' + C.accent + ';box-shadow:0 0 0 3px rgba(255,79,31,.12)}',
      '.dxr-sw .dxr-in{width:320px;padding-left:33px}',
      '.dxr-sel{height:34px;border:1px solid #d5dce7;background:#fff;border-radius:5px;padding:0 9px;font-size:12.5px;color:' + C.body + ';cursor:pointer;outline:none}',
      '.dxr-clear{height:34px;display:flex;align-items:center;gap:6px;padding:0 11px;border-radius:5px;border:1px solid #ffd9c9;background:' + C.accentSoft + ';color:#c9401a;font-size:12.2px;font-weight:600;cursor:pointer}',
      '.dxr-seg{display:flex;border:1px solid #d5dce7;border-radius:5px;overflow:hidden;height:34px;background:#fff}',
      '.dxr-seg>div{width:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:' + C.mute + '}',
      '.dxr-seg>div+div{border-left:1px solid #e4e9f0}',
      '.dxr-seg>div.on{background:' + C.accentSoft + ';color:' + C.accent + '}',
      '.dxr-body{padding:20px 28px 40px}',
      '.dxr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(272px,1fr));gap:14px}',
      '.dxr-card{position:relative;background:#fff;border:1px solid #e4e9f0;border-radius:9px;padding:16px 16px 12px;cursor:pointer;transition:box-shadow .14s,border-color .14s,transform .14s}',
      '.dxr-card:hover{border-color:#ffd0bd;box-shadow:0 8px 22px rgba(21,37,80,.10);transform:translateY(-1px)}',
      '.dxr-av{border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;letter-spacing:.3px;flex:none}',
      '.dxr-dot{position:absolute;right:-1px;bottom:-1px;border-radius:50%;border:2.5px solid #fff}',
      '.dxr-name{font-size:14px;font-weight:600;color:' + C.navy + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dxr-role{font-size:12.3px;color:#5b6a7d;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dxr-pill{font-size:11px;font-weight:600;padding:2px 7px;border-radius:10px;white-space:nowrap;border:1px solid transparent;display:inline-block}',
      '.dxr-meta{font-size:11.8px;color:' + C.mute + ';display:flex;align-items:center;gap:6px;min-width:0}',
      '.dxr-meta span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dxr-foot{display:flex;align-items:center;gap:6px;margin-top:12px;padding-top:11px;border-top:1px solid ' + C.hair + '}',
      '.dxr-ico{width:30px;height:30px;border-radius:6px;border:1px solid #e2e8f1;display:flex;align-items:center;justify-content:center;color:#5b6a7d;cursor:pointer;background:#fff}',
      '.dxr-ico:hover{border-color:' + C.accent + ';color:' + C.accent + ';background:#fff8f5}',
      '.dxr-ico.fav{border-color:transparent;background:transparent}.dxr-ico.fav.on{color:' + C.accent + '}',
      '.dxr-tblw{background:#fff;border:1px solid ' + C.line + ';border-radius:8px;overflow:hidden}',
      '.dxr-thead,.dxr-tr{display:grid;gap:12px;align-items:center;padding:11px 18px}',
      '.dxr-thead{background:' + C.head + ';border-bottom:1px solid #e4e9f0;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:' + C.mute + ';padding:10px 18px}',
      '.dxr-thead>div{cursor:pointer;user-select:none}',
      '.dxr-tr{border-bottom:1px solid ' + C.hair + ';cursor:pointer;font-size:12.5px;color:' + C.body + '}',
      '.dxr-tr:last-child{border-bottom:none}.dxr-tr:hover{background:#fafcff}',
      '.dxr-tr b{color:' + C.navy + ';font-weight:600;font-size:13px}',
      '.dxr-right{display:flex;justify-content:flex-end;gap:6px}',
      '.dxr-empty{background:#fff;border:1px solid ' + C.line + ';border-radius:8px;padding:54px 30px;text-align:center}',
      '.dxr-empty .ic{width:46px;height:46px;border-radius:12px;background:' + C.accentSoft + ';color:' + C.accent + ';display:flex;align-items:center;justify-content:center;margin:0 auto 14px}',
      '.dxr-empty h4{margin:0 0 5px;font-size:14.5px;color:' + C.navy + '}',
      '.dxr-empty p{margin:0 auto 16px;font-size:12.8px;color:' + C.mute + ';line-height:1.6;max-width:400px}',
      '.dxr-skel{background:#fff;border:1px solid #e4e9f0;border-radius:8px;height:150px;animation:dxrShim 1.4s ease-in-out infinite}',
      '@keyframes dxrShim{0%,100%{opacity:.45}50%{opacity:.85}}',
      '@keyframes dxrIn{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}',
      '@keyframes dxrPop{from{transform:translateY(8px) scale(.985);opacity:0}to{transform:none;opacity:1}}',
      '.dxr-scrim{position:fixed;inset:0;background:rgba(16,26,48,.42);z-index:9000;display:flex;justify-content:flex-end}',
      '.dxr-scrim.mid{align-items:center;justify-content:center}',
      '.dxr-drw{width:520px;max-width:94vw;background:#fff;height:100%;display:flex;flex-direction:column;box-shadow:-18px 0 46px rgba(10,20,40,.24);animation:dxrIn .16s ease-out}',
      '.dxr-modal{width:460px;max-width:94vw;background:#fff;border-radius:10px;box-shadow:0 24px 60px rgba(10,20,40,.3);animation:dxrPop .14s ease-out;overflow:hidden}',
      '.dxr-dh{padding:16px 20px;border-bottom:1px solid ' + C.line + ';display:flex;align-items:flex-start;gap:12px}',
      '.dxr-dh h3{margin:0;font-size:16px;color:' + C.navy + ';font-weight:600}',
      '.dxr-dh .s{font-size:12.3px;color:' + C.mute + ';margin-top:3px}',
      '.dxr-dx{margin-left:auto;width:30px;height:30px;border-radius:6px;border:none;background:transparent;color:' + C.faint + ';cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none}',
      '.dxr-dx:hover{background:#f2f4f8;color:' + C.ink + '}',
      '.dxr-db{padding:18px 20px;overflow-y:auto;flex:1}',
      '.dxr-df{padding:12px 20px;border-top:1px solid ' + C.line + ';display:flex;gap:8px;justify-content:flex-end;background:#fafbfd}',
      '.dxr-fld{margin-bottom:13px}',
      '.dxr-fld label{display:block;font-size:11.5px;font-weight:600;color:' + C.mute + ';margin-bottom:5px}',
      '.dxr-fld .dxr-in,.dxr-fld .dxr-sel,.dxr-fld textarea{width:100%}',
      '.dxr-fld textarea{border:1px solid #d5dce7;border-radius:5px;padding:9px 11px;font-size:12.8px;min-height:74px;outline:none;resize:vertical}',
      '.dxr-fld textarea:focus{border-color:' + C.accent + '}',
      '.dxr-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.dxr-sec{font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:' + C.faint + ';font-weight:700;margin:18px 0 9px}',
      '.dxr-kv{display:grid;grid-template-columns:132px 1fr;gap:7px 12px;font-size:12.6px}',
      '.dxr-kv dt{color:' + C.faint + '}.dxr-kv dd{margin:0;color:' + C.body + '}',
      '.dxr-chipset{display:flex;flex-wrap:wrap;gap:6px}',
      '.dxr-chip{font-size:11.5px;background:#f2f5f9;border:1px solid #e4e9f0;color:' + C.body + ';border-radius:12px;padding:3px 9px}',
      '.dxr-thread{display:flex;flex-direction:column;gap:9px}',
      '.dxr-msg{max-width:78%;padding:9px 12px;border-radius:11px;font-size:12.8px;line-height:1.5}',
      '.dxr-msg.me{align-self:flex-end;background:' + C.accent + ';color:#fff;border-bottom-right-radius:3px}',
      '.dxr-msg.them{align-self:flex-start;background:#f1f4f8;color:' + C.ink + ';border-bottom-left-radius:3px}',
      '.dxr-msg .t{display:block;font-size:10.5px;opacity:.7;margin-top:4px}',
      '.dxr-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,10px);background:' + C.navy + ';color:#fff;font-size:12.8px;padding:10px 16px;border-radius:7px;box-shadow:0 12px 30px rgba(10,20,40,.3);z-index:9500;opacity:0;transition:opacity .2s,transform .2s}',
      '.dxr-toast.on{opacity:1;transform:translate(-50%,0)}',
      '.dxr-callav{width:74px;height:74px;font-size:25px;margin:0 auto 12px;animation:dxrRing 1.6s infinite}',
      '@keyframes dxrRing{0%{box-shadow:0 0 0 0 rgba(46,171,107,.5)}70%{box-shadow:0 0 0 14px rgba(46,171,107,0)}100%{box-shadow:0 0 0 0 rgba(46,171,107,0)}}',
      '.dxr-stat{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;margin-bottom:16px}',
      '.dxr-stat>div{background:#fff;border:1px solid #e4e9f0;border-radius:8px;padding:13px 15px}',
      '.dxr-stat b{display:block;font-size:21px;color:' + C.navy + ';font-weight:600;line-height:1.2}',
      '.dxr-stat span{font-size:11.5px;color:' + C.mute + '}'
    ].join('\\n');
    document.head.appendChild(st);
  }

  /* ══════════════════════════════════════════════════════════
     3 · SMALL UI PRIMITIVES
     ══════════════════════════════════════════════════════════ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function toast(msg) {
    if (window.toast && window.toast !== toast) { try { window.toast(msg); return; } catch (e) {} }
    var old = document.getElementById('dxr_toast'); if (old) old.remove();
    var t = document.createElement('div');
    t.id = 'dxr_toast'; t.className = 'dxr-toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('on'); }, 10);
    setTimeout(function () { t.classList.remove('on'); setTimeout(function () { t.remove(); }, 260); }, 2600);
  }
  function closeOverlay() {
    var s = document.getElementById('dxr_overlay'); if (s) s.remove();
    document.removeEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') closeOverlay(); }
  function overlay(centered, inner) {
    closeOverlay();
    var s = document.createElement('div');
    s.id = 'dxr_overlay';
    s.className = 'dxr-scrim' + (centered ? ' mid' : '');
    s.onclick = function (e) { if (e.target === s) closeOverlay(); };
    s.innerHTML = inner;
    document.body.appendChild(s);
    document.addEventListener('keydown', escClose);
    var f = s.querySelector('input,textarea,select'); if (f) f.focus();
    return s;
  }
  function shell(centered, title, sub, bodyHtml, footHtml) {
    return overlay(centered,
      '<div class="' + (centered ? 'dxr-modal' : 'dxr-drw') + '">' +
        '<div class="dxr-dh"><div><h3>' + esc(title) + '</h3>' + (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</div>' +
        '<button class="dxr-dx" aria-label="Close" onclick="MCMDirectory.ui.close()">' + I.x + '</button></div>' +
        '<div class="dxr-db">' + bodyHtml + '</div>' +
        (footHtml ? '<div class="dxr-df">' + footHtml + '</div>' : '') +
      '</div>');
  }
  function confirmDelete(title, msg, onYes) {
    shell(true, title, null, '<p style="margin:0;font-size:13px;line-height:1.6;color:' + C.body + '">' + esc(msg) + '</p>',
      '<button class="dxr-btn" onclick="MCMDirectory.ui.close()">Cancel</button>' +
      '<button class="dxr-btn pri" id="dxr_yes" style="background:#c53030;border-color:#c53030;box-shadow:none">Delete</button>');
    document.getElementById('dxr_yes').onclick = function () { closeOverlay(); onYes(); };
  }
  function field(label, name, value, type, opts) {
    var id = 'dxr_f_' + name;
    if (type === 'select') {
      return '<div class="dxr-fld"><label for="' + id + '">' + esc(label) + '</label><select class="dxr-sel" id="' + id + '" data-f="' + name + '">' +
        opts.map(function (o) { return '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
        '</select></div>';
    }
    if (type === 'textarea') {
      return '<div class="dxr-fld"><label for="' + id + '">' + esc(label) + '</label><textarea id="' + id + '" data-f="' + name + '">' + esc(value) + '</textarea></div>';
    }
    return '<div class="dxr-fld"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input class="dxr-in" id="' + id + '" data-f="' + name + '" type="' + (type || 'text') + '" value="' + esc(value) + '"></div>';
  }
  function readForm() {
    var out = {};
    (document.querySelectorAll('#dxr_overlay [data-f]') || []).forEach(function (el) {
      out[el.getAttribute('data-f')] = el.type === 'checkbox' ? el.checked : el.value.trim();
    });
    return out;
  }
  function avatar(name, tint, size, presence) {
    var s = size || 44;
    var d = presence ? '<span class="dxr-dot" style="width:' + Math.round(s / 3.4) + 'px;height:' + Math.round(s / 3.4) + 'px;background:' + PRES[presence].dot + '"></span>' : '';
    return '<div style="position:relative;flex:none"><div class="dxr-av" style="width:' + s + 'px;height:' + s + 'px;font-size:' + Math.round(s / 3) + 'px;background:' + tintFor(name) + '">' + esc(initialsOf(name)) + '</div>' + d + '</div>';
  }
  function tintFor(name) {
    var h = 0; for (var i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
    return TINTS[h % TINTS.length];
  }
  function presPill(p) {
    var s = PRES[p] || PRES.Offline;
    return '<span class="dxr-pill" style="background:' + s.bg + ';color:' + s.fg + ';border-color:' + s.bd + '">' + esc(p) + '</span>';
  }
  function statusPill(text, tone) {
    var m = { ok: PRES.Available, warn: PRES.Away, off: PRES.Offline, info: PRES['On queue'] }[tone || 'ok'];
    return '<span class="dxr-pill" style="background:' + m.bg + ';color:' + m.fg + ';border-color:' + m.bd + '">' + esc(text) + '</span>';
  }
  function downloadCsv(filename, rows, cols) {
    var esq = function (v) { v = String(v == null ? '' : v); return /[",\\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = [cols.map(function (c) { return c.label; }).join(',')]
      .concat(rows.map(function (r) { return cols.map(function (c) { return esq(c.get(r)); }).join(','); })).join('\\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = filename; a.click(); URL.revokeObjectURL(a.href);
    toast('Exported ' + rows.length + ' rows to ' + filename);
  }
  function busy(host) {
    host.innerHTML = '<div class="dxr-grid">' + new Array(8).join().split(',')
      .map(function () { return '<div class="dxr-skel"></div>'; }).join('') + '</div>';
  }
  function emptyState(title, msg, btnLabel, btnAction) {
    return '<div class="dxr-empty"><div class="ic">' + I.search + '</div><h4>' + esc(title) + '</h4><p>' + esc(msg) + '</p>' +
      (btnLabel ? '<button class="dxr-btn" onclick="' + btnAction + '">' + esc(btnLabel) + '</button>' : '') + '</div>';
  }
  window.MCMDirectory.ui = { close: closeOverlay, toast: toast };

  /* ══════════════════════════════════════════════════════════
     4 · WORKSPACE — top-nav Directory
     ══════════════════════════════════════════════════════════ */
  var S = { tab: 'People', q: '', dept: '', loc: '', pres: '', sort: 'name', view: 'grid' };
  var TABS = ['People', 'Groups', 'Locations', 'External', 'Favourites'];
  var A = 'MCMDirectory.act.';

  var apiCountsCache = null, apiCountsPending = false;
  function counts() {
    if (apiCountsCache) return apiCountsCache;
    var c = SVC.counts(); return { People: c.people, Groups: c.groups, Locations: c.locations, External: c.external, Favourites: c.fav };
  }
  function refreshApiCounts() {
    if (!USE_API || apiCountsPending) return;
    apiCountsPending = true;
    Promise.all([SVC.people.list(), SVC.groups.list(), SVC.locations.list(), SVC.external.list()]).then(function (r) {
      apiCountsCache = { People: r[0].length, Groups: r[1].length, Locations: r[2].length, External: r[3].length, Favourites: SVC.favIds().length };
      apiCountsPending = false;
      var head = document.getElementById('dxr_head');
      if (head) head.innerHTML = headHtml();
    }).catch(function () { apiCountsPending = false; });
  }
  function filtersOn() { return !!(S.q || S.dept || S.loc || S.pres); }

  function headHtml() {
    var c = counts();
    var addLabel = { People: 'Add person', Groups: 'Add group', Locations: 'Add location', External: 'Add contact', Favourites: '' }[S.tab];
    return '<div class="dxr-hd">' +
      '<div class="dxr-top"><div>' +
        '<div class="dxr-eyebrow">Collaborate</div>' +
        '<div style="display:flex;align-items:baseline;gap:11px"><h1 class="dxr-h1">Directory</h1>' +
        '<span class="dxr-sub">' + c.People + ' people · ' + c.Groups + ' groups · ' + c.Locations + ' locations · ' + c.External + ' external</span></div>' +
      '</div><div style="flex:1"></div><div class="dxr-acts">' +
        '<button class="dxr-btn" onclick="' + A + 'exportTab()">' + I.down + 'Export CSV</button>' +
        (addLabel ? '<button class="dxr-btn" onclick="' + A + 'add()">' + I.plus + esc(addLabel) + '</button>' : '') +
        '<button class="dxr-btn pri" onclick="' + A + 'newChat()">' + I.chat + 'New chat</button>' +
      '</div></div>' +
      '<div class="dxr-tabs">' + TABS.map(function (t) {
        return '<div class="dxr-tb' + (t === S.tab ? ' on' : '') + '" onclick="' + A + 'tab(\\'' + t + '\\')">' + t +
          '<span class="dxr-cnt">' + c[t] + '</span></div>';
      }).join('') + '</div></div>';
  }

  function barHtml() {
    var ph = { People: 'Search people, titles, extensions…', Groups: 'Search groups', Locations: 'Search locations', External: 'Search external contacts', Favourites: 'Search favourites' }[S.tab];
    var h = '<div class="dxr-bar" id="dxr_bar">' +
      '<div class="dxr-sw"><span>' + I.search + '</span>' +
      '<input class="dxr-in" id="dxr_q" placeholder="' + esc(ph) + '" value="' + esc(S.q) + '" aria-label="' + esc(ph) + '"></div>';
    if (S.tab === 'People') {
      h += '<select class="dxr-sel" id="dxr_dept" aria-label="Department"><option value="">Department: All</option>' +
        SVC.departments().map(function (d) { return '<option' + (d === S.dept ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select>' +
        '<select class="dxr-sel" id="dxr_loc" aria-label="Location"><option value="">Location: All</option>' +
        SVC.locationNames().map(function (l) { return '<option' + (l === S.loc ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') + '</select>' +
        '<select class="dxr-sel" id="dxr_pres" aria-label="Presence"><option value="">Presence: Any</option>' +
        Object.keys(PRES).map(function (p) { return '<option' + (p === S.pres ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select>';
    }
    if (filtersOn()) h += '<div class="dxr-clear" onclick="' + A + 'clear()">Clear filters ×</div>';
    h += '<div style="flex:1"></div>';
    if (S.tab === 'People') {
      h += '<select class="dxr-sel" id="dxr_sort" aria-label="Sort">' +
        [['name', 'Sort: Name A–Z'], ['presence', 'Sort: Presence'], ['department', 'Sort: Department'], ['location', 'Sort: Location']]
          .map(function (o) { return '<option value="' + o[0] + '"' + (S.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
        '<div class="dxr-seg"><div class="' + (S.view === 'grid' ? 'on' : '') + '" title="Card view" onclick="' + A + 'view(\\'grid\\')">' + I.grid + '</div>' +
        '<div class="' + (S.view === 'list' ? 'on' : '') + '" title="List view" onclick="' + A + 'view(\\'list\\')">' + I.list + '</div></div>';
    }
    return h + '</div>';
  }

  function wireBar() {
    var q = document.getElementById('dxr_q');
    if (q) {
      var t;
      q.oninput = function () { S.q = q.value; clearTimeout(t); t = setTimeout(loadRows, 130); };
    }
    [['dxr_dept', 'dept'], ['dxr_loc', 'loc'], ['dxr_pres', 'pres'], ['dxr_sort', 'sort']].forEach(function (p) {
      var el = document.getElementById(p[0]);
      if (el) el.onchange = function () { S[p[1]] = el.value; refresh(); };
    });
  }

  function host() { return document.getElementById('dxr_ws'); }
  function renderWorkspace() {
    var h = host(); if (!h) return;
    h.innerHTML = '<div id="dxr_head">' + headHtml() + '</div>' + barHtml() + '<div class="dxr-body" id="dxr_rows"></div>';
    wireBar();
    loadRows();
    refreshApiCounts();
  }
  function refresh() {
    var h = host(); if (!h) return;
    document.getElementById('dxr_head').innerHTML = headHtml();
    var bar = document.getElementById('dxr_bar');
    var tmp = document.createElement('div'); tmp.innerHTML = barHtml();
    bar.replaceWith(tmp.firstChild);
    wireBar();
    loadRows();
  }

  function loadRows() {
    var box = document.getElementById('dxr_rows'); if (!box) return;
    busy(box);
    var fav = SVC.favIds();
    if (S.tab === 'People') {
      SVC.listPeople({ q: S.q, dept: S.dept, loc: S.loc, pres: S.pres, sort: S.sort }).then(function (rows) {
        box.innerHTML = rows.length ? (S.view === 'grid' ? peopleCards(rows, fav) : peopleList(rows, fav))
          : emptyState('No people match', 'Nothing here matches the current search and filters.', 'Clear search and filters', A + 'clear()');
      });
    } else if (S.tab === 'Groups') {
      SVC.groups.list(S.q).then(function (rows) {
        box.innerHTML = rows.length ? groupCards(rows, fav) : emptyState('No groups match', 'Try a different search, or create a group.', 'Add group', A + 'add()');
      });
    } else if (S.tab === 'Locations') {
      SVC.locations.list(S.q).then(function (rows) {
        box.innerHTML = rows.length ? locationCards(rows) : emptyState('No locations match', 'Try a different search, or add a site.', 'Add location', A + 'add()');
      });
    } else if (S.tab === 'External') {
      SVC.external.list(S.q).then(function (rows) {
        box.innerHTML = rows.length ? contactCards(rows, fav) : emptyState('No external contacts match', 'Try a different search, or add a contact.', 'Add contact', A + 'add()');
      });
    } else {
      SVC.favourites().then(function (f) {
        var n = f.people.length + f.groups.length + f.contacts.length;
        if (!n) { box.innerHTML = emptyState('No favourites yet', 'Star anyone in People, Groups or External and they pin here for one-click reach.', 'Browse people', A + 'tab(\\'People\\')'); return; }
        var out = '';
        if (f.people.length) out += '<div class="dxr-sec">People</div>' + peopleCards(f.people, SVC.favIds());
        if (f.groups.length) out += '<div class="dxr-sec">Groups</div>' + groupCards(f.groups, SVC.favIds());
        if (f.contacts.length) out += '<div class="dxr-sec">External contacts</div>' + contactCards(f.contacts, SVC.favIds());
        box.innerHTML = out;
      });
    }
  }

  function favBtn(id, fav) {
    var on = fav.indexOf(id) > -1;
    return '<div class="dxr-ico fav' + (on ? ' on' : '') + '" title="' + (on ? 'Remove favourite' : 'Add favourite') + '" ' +
      'aria-label="Favourite" onclick="event.stopPropagation();' + A + 'fav(\\'' + id + '\\',' + (on ? 'false' : 'true') + ')">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="' + (on ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5-4.7-4.6 6.5-.9z"></path></svg></div>';
  }

  function peopleCards(rows, fav) {
    return '<div class="dxr-grid">' + rows.map(function (p) {
      return '<div class="dxr-card" onclick="' + A + 'person(\\'' + p.id + '\\')">' +
        '<div style="display:flex;gap:12px;align-items:flex-start">' + avatar(p.name, p.tint, 44, p.presence) +
        '<div style="min-width:0;flex:1"><div class="dxr-name">' + esc(p.name) + '</div><div class="dxr-role">' + esc(p.title) + '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;margin-top:7px">' + presPill(p.presence) +
        '<span style="font-size:11.5px;color:' + C.faint + '">ext ' + esc(p.ext) + '</span></div></div></div>' +
        '<div style="margin-top:12px;display:flex;flex-direction:column;gap:4px">' +
        '<div class="dxr-meta">' + I.bldg + '<span>' + esc(p.dept + ' · ' + p.location) + '</span></div>' +
        '<div class="dxr-meta">' + svg('<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path>', 12) + '<span>' + esc(p.email) + '</span></div></div>' +
        '<div class="dxr-foot">' +
        iconBtn('Call', I.phone, A + 'call(\\'' + p.id + '\\')') +
        iconBtn('Email', I.mail, A + 'email(\\'' + p.id + '\\')') +
        iconBtn('Chat', I.chat, A + 'chat(\\'' + p.id + '\\')') +
        iconBtn('Edit person', I.edit, A + 'edit(\\'people\\',\\'' + p.id + '\\')') +
        '<div style="flex:1"></div>' + favBtn(p.id, fav) + '</div></div>';
    }).join('') + '</div>';
  }
  function iconBtn(title, icon, action) {
    return '<div class="dxr-ico" title="' + esc(title) + '" aria-label="' + esc(title) + '" onclick="event.stopPropagation();' + action + '">' + icon + '</div>';
  }

  function peopleList(rows, fav) {
    var cols = '2.2fr 1.2fr 1.1fr 1fr .9fr 176px';
    return '<div class="dxr-tblw">' +
      '<div class="dxr-thead" style="grid-template-columns:' + cols + '">' +
      ['Name', 'Title', 'Department', 'Location', 'Presence'].map(function (l, i) {
        var key = ['name', 'title', 'department', 'location', 'presence'][i];
        return '<div onclick="' + A + 'sort(\\'' + key + '\\')">' + l + '</div>';
      }).join('') + '<div style="text-align:right">Actions</div></div>' +
      rows.map(function (p) {
        return '<div class="dxr-tr" style="grid-template-columns:' + cols + '" onclick="' + A + 'person(\\'' + p.id + '\\')">' +
          '<div style="display:flex;align-items:center;gap:10px;min-width:0">' + avatar(p.name, p.tint, 30, p.presence) +
          '<div style="min-width:0"><b>' + esc(p.name) + '</b><div style="font-size:11.3px;color:' + C.faint + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.email) + '</div></div></div>' +
          '<div>' + esc(p.title) + '</div><div>' + esc(p.dept) + '</div><div>' + esc(p.location) + '</div><div>' + presPill(p.presence) + '</div>' +
          '<div class="dxr-right">' + iconBtn('Call', I.phone, A + 'call(\\'' + p.id + '\\')') +
          iconBtn('Chat', I.chat, A + 'chat(\\'' + p.id + '\\')') +
          iconBtn('Edit person', I.edit, A + 'edit(\\'people\\',\\'' + p.id + '\\')') + favBtn(p.id, fav) + '</div></div>';
      }).join('') + '</div>';
  }

  function groupCards(rows, fav) {
    return '<div class="dxr-grid">' + rows.map(function (g) {
      var members = SVC.peopleById(g.memberIds || []);
      var live = members.filter(function (m) { return m.presence === 'Available' || m.presence === 'On queue'; }).length;
      return '<div class="dxr-card" onclick="' + A + 'group(\\'' + g.id + '\\')">' +
        '<div style="display:flex;gap:12px;align-items:flex-start">' +
        '<div class="dxr-av" style="width:44px;height:44px;border-radius:10px;font-size:13px;background:' + C.navy + '">' + esc(initialsOf(g.name)) + '</div>' +
        '<div style="min-width:0;flex:1"><div class="dxr-name">' + esc(g.name) + '</div>' +
        '<div class="dxr-role">' + esc(g.type) + ' · ' + esc(g.ring) + ' ring</div>' +
        '<div style="display:flex;align-items:center;gap:6px;margin-top:7px">' + statusPill(live + ' of ' + members.length + ' reachable', live ? 'ok' : 'off') +
        '<span style="font-size:11.5px;color:' + C.faint + '">ext ' + esc(g.ext) + '</span></div></div></div>' +
        '<div style="margin-top:12px" class="dxr-meta">' + I.users + '<span>' + esc(members.map(function (m) { return m.name; }).join(', ') || 'No members yet') + '</span></div>' +
        '<div class="dxr-foot">' + iconBtn('Ring group', I.phone, A + 'ring(\\'' + g.id + '\\')') +
        iconBtn('Message group', I.chat, A + 'chat(\\'' + g.id + '\\')') +
        iconBtn('Edit group', I.edit, A + 'edit(\\'groups\\',\\'' + g.id + '\\')') +
        '<div style="flex:1"></div>' + favBtn(g.id, fav) + '</div></div>';
    }).join('') + '</div>';
  }

  function locationCards(rows) {
    return '<div class="dxr-grid">' + rows.map(function (l) {
      return '<div class="dxr-card" onclick="' + A + 'location(\\'' + l.id + '\\')">' +
        '<div style="display:flex;gap:12px;align-items:flex-start">' +
        '<div class="dxr-av" style="width:44px;height:44px;border-radius:10px;font-size:13px;background:#2b6cb0">' + esc(initialsOf(l.name)) + '</div>' +
        '<div style="min-width:0;flex:1"><div class="dxr-name">' + esc(l.name) + '</div><div class="dxr-role">' + esc(l.type) + '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;margin-top:7px">' + statusPill(l.status, l.status === 'Operational' ? 'ok' : 'warn') +
        '<span style="font-size:11.5px;color:' + C.faint + '">' + (l.headcount || 0) + ' on site</span></div></div></div>' +
        '<div style="margin-top:12px;display:flex;flex-direction:column;gap:4px">' +
        '<div class="dxr-meta">' + I.bldg + '<span>' + esc(l.address) + '</span></div>' +
        '<div class="dxr-meta">' + svg('<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l4 2"></path>', 12) + '<span>' + esc(l.hours + ' · ' + l.tz) + '</span></div></div>' +
        '<div class="dxr-foot">' + iconBtn('Call reception', I.phone, A + 'dial(\\'' + esc(l.emergency) + '\\')') +
        iconBtn('Edit location', I.edit, A + 'edit(\\'locations\\',\\'' + l.id + '\\')') +
        iconBtn('Delete location', I.trash, A + 'del(\\'locations\\',\\'' + l.id + '\\')') + '</div></div>';
    }).join('') + '</div>';
  }

  function contactCards(rows, fav) {
    return '<div class="dxr-grid">' + rows.map(function (c) {
      return '<div class="dxr-card" onclick="' + A + 'contact(\\'' + c.id + '\\')">' +
        '<div style="display:flex;gap:12px;align-items:flex-start">' + avatar(c.name, c.tint, 44) +
        '<div style="min-width:0;flex:1"><div class="dxr-name">' + esc(c.name) + '</div><div class="dxr-role">' + esc(c.role) + '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;margin-top:7px">' + statusPill(c.relationship, 'info') +
        '<span style="font-size:11.5px;color:' + C.faint + '">' + esc(c.org) + '</span></div></div></div>' +
        '<div style="margin-top:12px;display:flex;flex-direction:column;gap:4px">' +
        '<div class="dxr-meta">' + svg('<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path>', 12) + '<span>' + esc(c.email) + '</span></div>' +
        '<div class="dxr-meta">' + svg('<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l4 2"></path>', 12) + '<span>Last contact ' + esc(c.lastContact) + '</span></div></div>' +
        '<div class="dxr-foot">' + iconBtn('Call', I.phone, A + 'call(\\'' + c.id + '\\')') +
        iconBtn('Email', I.mail, A + 'email(\\'' + c.id + '\\')') +
        iconBtn('Edit contact', I.edit, A + 'edit(\\'external\\',\\'' + c.id + '\\')') +
        '<div style="flex:1"></div>' + favBtn(c.id, fav) + '</div></div>';
    }).join('') + '</div>';
  }

  /* ══════════════════════════════════════════════════════════
     5 · DETAIL / FORM / CALL / CHAT / EMAIL
     ══════════════════════════════════════════════════════════ */
  function kv(pairs) {
    return '<dl class="dxr-kv">' + pairs.filter(function (p) { return p[1]; })
      .map(function (p) { return '<dt>' + esc(p[0]) + '</dt><dd>' + p[1] + '</dd>'; }).join('') + '</dl>';
  }
  function chips(list) {
    return (list && list.length) ? '<div class="dxr-chipset">' + list.map(function (x) { return '<span class="dxr-chip">' + esc(x) + '</span>'; }).join('') + '</div>' : '<span style="color:' + C.faint + '">—</span>';
  }

  function personDrawer(p) {
    var fav = SVC.favIds().indexOf(p.id) > -1;
    shell(false, p.name, p.title + ' · ' + p.dept,
      '<div style="display:flex;gap:14px;align-items:center;margin-bottom:16px">' + avatar(p.name, p.tint, 58, p.presence) +
      '<div>' + presPill(p.presence) + '<div style="font-size:12.4px;color:' + C.mute + ';margin-top:6px">' + esc(p.station) + ' · ext ' + esc(p.ext) + '</div></div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
      '<button class="dxr-btn pri" onclick="' + A + 'call(\\'' + p.id + '\\')">' + I.phone + 'Call</button>' +
      '<button class="dxr-btn" onclick="' + A + 'chat(\\'' + p.id + '\\')">' + I.chat + 'Chat</button>' +
      '<button class="dxr-btn" onclick="' + A + 'email(\\'' + p.id + '\\')">' + I.mail + 'Email</button>' +
      '<button class="dxr-btn" onclick="' + A + 'fav(\\'' + p.id + '\\',' + (fav ? 'false' : 'true') + ')">' + I.star + (fav ? 'Unstar' : 'Favourite') + '</button></div>' +
      '<div class="dxr-sec">Contact</div>' + kv([['Email', esc(p.email)], ['Direct dial', esc(p.phone)], ['Extension', esc(p.ext)], ['Station', esc(p.station)], ['Time zone', esc(p.tz)]]) +
      '<div class="dxr-sec">Organisation</div>' + kv([['Job title', esc(p.title)], ['Department', esc(p.dept)], ['Division', esc(p.division)], ['Location', esc(p.location)], ['Manager', esc(p.manager)], ['Licence', esc(p.licence)], ['Started', esc(p.started)]]) +
      '<div class="dxr-sec">Skills</div>' + chips(p.skills) +
      '<div class="dxr-sec">Languages</div>' + chips(p.langs) +
      '<div class="dxr-sec">Queues</div>' + chips(p.queues),
      '<button class="dxr-btn danger" onclick="' + A + 'del(\\'people\\',\\'' + p.id + '\\')">' + I.trash + 'Delete</button>' +
      '<div style="flex:1"></div><button class="dxr-btn" onclick="MCMDirectory.ui.close()">Close</button>' +
      '<button class="dxr-btn pri" onclick="' + A + 'edit(\\'people\\',\\'' + p.id + '\\')">Edit person</button>');
  }

  function groupDrawer(g) {
    var members = SVC.peopleById(g.memberIds || []);
    shell(false, g.name, g.type + ' group · owner ' + g.owner,
      '<div style="display:flex;gap:8px;margin-bottom:14px">' +
      '<button class="dxr-btn pri" onclick="' + A + 'ring(\\'' + g.id + '\\')">' + I.phone + 'Ring group</button>' +
      '<button class="dxr-btn" onclick="' + A + 'chat(\\'' + g.id + '\\')">' + I.chat + 'Message group</button></div>' +
      kv([['Extension', esc(g.ext)], ['Ring strategy', esc(g.ring)], ['Group voicemail', g.voicemail ? statusPill('Enabled', 'ok') : statusPill('Off', 'off')], ['Members', String(members.length)]]) +
      '<div class="dxr-sec">Members</div>' +
      (members.length ? '<div class="dxr-tblw">' + members.map(function (m) {
        return '<div class="dxr-tr" style="grid-template-columns:1fr auto" onclick="' + A + 'person(\\'' + m.id + '\\')">' +
          '<div style="display:flex;align-items:center;gap:10px">' + avatar(m.name, m.tint, 28, m.presence) +
          '<div><b>' + esc(m.name) + '</b><div style="font-size:11.3px;color:' + C.faint + '">' + esc(m.title) + '</div></div></div>' +
          '<div class="dxr-right">' + iconBtn('Call', I.phone, A + 'call(\\'' + m.id + '\\')') + '</div></div>';
      }).join('') + '</div>' : '<span style="color:' + C.faint + '">No members yet.</span>'),
      '<button class="dxr-btn danger" onclick="' + A + 'del(\\'groups\\',\\'' + g.id + '\\')">' + I.trash + 'Delete</button>' +
      '<div style="flex:1"></div><button class="dxr-btn pri" onclick="' + A + 'edit(\\'groups\\',\\'' + g.id + '\\')">Edit group</button>');
  }

  function locationDrawer(l) {
    shell(false, l.name, l.type + ' · ' + l.country,
      kv([['Status', statusPill(l.status, l.status === 'Operational' ? 'ok' : 'warn')], ['Address', esc(l.address)], ['Open hours', esc(l.hours)],
        ['Time zone', esc(l.tz)], ['Emergency line', esc(l.emergency)], ['Telephony site', esc(l.site)], ['On site', String(l.headcount || 0) + ' people']]) +
      '<div class="dxr-sec">Floors</div>' + chips(l.floors),
      '<button class="dxr-btn danger" onclick="' + A + 'del(\\'locations\\',\\'' + l.id + '\\')">' + I.trash + 'Delete</button>' +
      '<div style="flex:1"></div><button class="dxr-btn pri" onclick="' + A + 'edit(\\'locations\\',\\'' + l.id + '\\')">Edit location</button>');
  }

  function contactDrawer(c) {
    shell(false, c.name, c.role + ' · ' + c.org,
      '<div style="display:flex;gap:8px;margin-bottom:14px">' +
      '<button class="dxr-btn pri" onclick="' + A + 'call(\\'' + c.id + '\\')">' + I.phone + 'Call</button>' +
      '<button class="dxr-btn" onclick="' + A + 'email(\\'' + c.id + '\\')">' + I.mail + 'Email</button></div>' +
      kv([['Organisation', esc(c.org)], ['Relationship', statusPill(c.relationship, 'info')], ['Email', esc(c.email)], ['Phone', esc(c.phone)],
        ['Relationship owner', esc(c.owner)], ['Last contact', esc(c.lastContact)]]),
      '<button class="dxr-btn danger" onclick="' + A + 'del(\\'external\\',\\'' + c.id + '\\')">' + I.trash + 'Delete</button>' +
      '<div style="flex:1"></div><button class="dxr-btn pri" onclick="' + A + 'edit(\\'external\\',\\'' + c.id + '\\')">Edit contact</button>');
  }

  var FORMS = {
    people: function (r) {
      // Options come from PICKLIST_CACHE, populated by openForm() just
      // before this runs (see there) -- the same managed list People &
      // Permissions' Titles/Departments admin pages manage, not free text.
      // "+ Add new…" is a sentinel: selecting it swaps the <select> for an
      // inline text input (see wirePicklistField, below openForm) rather
      // than a native prompt() or a second nested overlay, since this
      // module can only ever have one overlay open at a time.
      var titleOpts = (r.title && PICKLIST_CACHE.title.indexOf(r.title) === -1 ? [r.title] : []).concat(PICKLIST_CACHE.title, ['+ Add new…']);
      var deptOpts = (r.dept && PICKLIST_CACHE.dept.indexOf(r.dept) === -1 ? [r.dept] : []).concat(PICKLIST_CACHE.dept, ['+ Add new…']);
      return field('Full name', 'name', r.name || '') +
        '<div class="dxr-two">' + field('Job title', 'title', r.title || '', 'select', titleOpts) + field('Department', 'dept', r.dept || '', 'select', deptOpts) + '</div>' +
        '<div class="dxr-two">' + field('Email', 'email', r.email || '', 'email') + field('Extension', 'ext', r.ext || '') + '</div>' +
        '<div class="dxr-two">' + field('Direct dial', 'phone', r.phone || '') + field('Location', 'location', r.location || SVC.locationNames()[0], 'select', SVC.locationNames()) + '</div>' +
        '<div class="dxr-two">' + field('Presence', 'presence', r.presence || 'Available', 'select', Object.keys(PRES)) +
        field('Station', 'station', r.station || 'WebRTC softphone', 'select', ['WebRTC softphone', 'Desk phone', 'Remote number', 'None']) + '</div>' +
        '<div class="dxr-two">' + field('Division', 'division', r.division || '') + field('Licence', 'licence', r.licence || 'CX 2', 'select', ['Communicate', 'CX 1', 'CX 2', 'CX 3', 'CX 4']) + '</div>' +
        field('Manager', 'manager', r.manager || '');
    },
    groups: function (r) {
      return field('Group name', 'name', r.name || '') +
        '<div class="dxr-two">' + field('Type', 'type', r.type || 'Official', 'select', ['Official', 'Social', 'Skill expression']) +
        field('Ring strategy', 'ring', r.ring || 'Broadcast', 'select', ['Broadcast', 'Sequential', 'Rotary', 'Round robin']) + '</div>' +
        '<div class="dxr-two">' + field('Extension', 'ext', r.ext || '—') + field('Owner', 'owner', r.owner || 'Faisal Khan') + '</div>';
    },
    locations: function (r) {
      return field('Location name', 'name', r.name || '') +
        '<div class="dxr-two">' + field('Type', 'type', r.type || 'Contact centre', 'select', ['Head office', 'Contact centre', 'Delivery centre', 'Outsourced overflow', 'Remote']) +
        field('Status', 'status', r.status || 'Operational', 'select', ['Operational', 'Limited', 'Closed']) + '</div>' +
        field('Address', 'address', r.address || '') +
        '<div class="dxr-two">' + field('Country', 'country', r.country || '') + field('Time zone', 'tz', r.tz || 'Europe/London') + '</div>' +
        '<div class="dxr-two">' + field('Open hours', 'hours', r.hours || '') + field('Emergency line', 'emergency', r.emergency || '') + '</div>' +
        field('Floors (one per line)', 'floorsText', (r.floors || []).join('\\n'), 'textarea');
    },
    external: function (r) {
      return field('Contact name', 'name', r.name || '') +
        '<div class="dxr-two">' + field('Organisation', 'org', r.org || '') + field('Role', 'role', r.role || '') + '</div>' +
        '<div class="dxr-two">' + field('Email', 'email', r.email || '', 'email') + field('Phone', 'phone', r.phone || '') + '</div>' +
        '<div class="dxr-two">' + field('Relationship', 'relationship', r.relationship || 'Vendor', 'select', ['Carrier', 'Partner', 'Vendor', 'Group company', 'Regulator']) +
        field('Relationship owner', 'owner', r.owner || 'Faisal Khan') + '</div>';
    },
    fields: function (r) {
      return field('Field label', 'label', r.label || '') +
        '<div class="dxr-two">' + field('API key', 'key', r.key || '') +
        field('Type', 'type', r.type || 'Text', 'select', ['Text', 'Long text', 'Number', 'Phone', 'Date', 'Select', 'Multi-select', 'URL']) + '</div>' +
        '<div class="dxr-two">' + field('Section', 'section', r.section || 'Work', 'select', ['Work', 'Contact', 'Skills', 'Personal', 'Private']) +
        field('Visibility', 'visibility', r.visibility || 'Everyone', 'select', ['Everyone', 'Managers only', 'HR only', 'Admins only']) + '</div>' +
        field('Required', 'requiredText', r.required ? 'Required' : 'Optional', 'select', ['Optional', 'Required']);
    },
    workspaces: function (r) {
      return field('Workspace name', 'name', r.name || '') +
        '<div class="dxr-two">' + field('Type', 'type', r.type || 'Team', 'select', ['Team', 'Public', 'Restricted', 'Personal']) +
        field('Owner', 'owner', r.owner || 'Faisal Khan') + '</div>' +
        '<div class="dxr-two">' + field('Who can access', 'access', r.access || 'Everyone') +
        field('Retention', 'retention', r.retention || '3 years', 'select', ['1 year', '2 years', '3 years', '5 years', '7 years', 'Indefinite']) + '</div>';
    }
  };
  var TITLES = {
    people: ['person', 'Person'], groups: ['group', 'Group'], locations: ['location', 'Location'],
    external: ['contact', 'External contact'], fields: ['field', 'Profile field'], workspaces: ['workspace', 'Document workspace']
  };

  // Selecting "+ Add new…" swaps that one field's <select> for an inline
  // text input + Add/Cancel, all inside the still-open form (this module's
  // overlay() can only ever hold one overlay at a time — a second shell()
  // for the "add" step would tear down the person form underneath it and
  // lose whatever else was typed). Confirming creates the entry via the
  // real /api/simple-entities picklist immediately, then swaps back to the
  // <select> with the new value selected.
  function wirePicklistField(kind, fieldName) {
    var select = document.getElementById('dxr_f_' + fieldName);
    if (!select) return;
    var fld = select.closest('.dxr-fld');
    var label = fieldName === 'title' ? 'Job title' : 'Department';

    function selectMarkup(value) {
      var opts = (kind === 'title' ? PICKLIST_CACHE.title : PICKLIST_CACHE.dept).concat(['+ Add new…']);
      return '<label for="dxr_f_' + fieldName + '">' + esc(label) + '</label>' +
        '<select class="dxr-sel" id="dxr_f_' + fieldName + '" data-f="' + fieldName + '">' +
        opts.map(function (o) { return '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
        '</select>';
    }

    select.onchange = function () {
      if (select.value !== '+ Add new…') return;
      fld.innerHTML = '<label>' + esc(label) + '</label>' +
        '<div style="display:flex;gap:6px">' +
        '<input class="dxr-in" id="dxr_new_' + fieldName + '" placeholder="New ' + esc(label.toLowerCase()) + '" style="flex:1">' +
        '<button class="dxr-btn" id="dxr_new_' + fieldName + '_ok">Add</button>' +
        '<button class="dxr-btn" id="dxr_new_' + fieldName + '_cancel">Cancel</button></div>' +
        '<div id="dxr_new_' + fieldName + '_err" style="display:none;color:#c53030;font-size:11.5px;margin-top:4px"></div>';
      var input = document.getElementById('dxr_new_' + fieldName);
      var errEl = document.getElementById('dxr_new_' + fieldName + '_err');
      input.focus();
      function cancel() {
        fld.innerHTML = selectMarkup('');
        wirePicklistField(kind, fieldName);
      }
      function confirmAdd() {
        var name = input.value.trim();
        if (name.length < 2) { errEl.style.display = ''; errEl.textContent = label + ' must be at least 2 characters.'; return; }
        createPicklistEntry(kind, name).then(function () {
          if (kind === 'title') { if (PICKLIST_CACHE.title.indexOf(name) === -1) PICKLIST_CACHE.title.push(name); }
          else { if (PICKLIST_CACHE.dept.indexOf(name) === -1) PICKLIST_CACHE.dept.push(name); }
          fld.innerHTML = selectMarkup(name);
          wirePicklistField(kind, fieldName);
        }).catch(function (e) {
          errEl.style.display = '';
          errEl.textContent = e.message || ('Could not add that ' + label.toLowerCase() + '.');
        });
      }
      document.getElementById('dxr_new_' + fieldName + '_ok').onclick = confirmAdd;
      document.getElementById('dxr_new_' + fieldName + '_cancel').onclick = cancel;
      input.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); confirmAdd(); } if (e.key === 'Escape') cancel(); };
    };
  }

  function openForm(entity, rec) {
    rec = rec || {};
    var t = TITLES[entity];
    function render() {
      shell(false, (rec.id ? 'Edit ' : 'New ') + t[0], t[1] + (rec.id ? ' · ' + (rec.name || rec.label) : ' — fields marked in the API map to your backend payload'),
        FORMS[entity](rec),
        '<button class="dxr-btn" onclick="MCMDirectory.ui.close()">Cancel</button>' +
        '<button class="dxr-btn pri" id="dxr_save">' + (rec.id ? 'Save changes' : 'Create') + '</button>');
      if (entity === 'people') {
        wirePicklistField('title', 'title');
        wirePicklistField('dept', 'dept');
      }
      document.getElementById('dxr_save').onclick = function () {
        var data = readForm();
        var nameKey = entity === 'fields' ? 'label' : 'name';
        if (!data[nameKey]) { toast('Give it a name first'); return; }
        if (data.floorsText != null) { data.floors = data.floorsText.split('\\n').filter(Boolean); delete data.floorsText; }
        if (data.requiredText != null) { data.required = data.requiredText === 'Required'; delete data.requiredText; }
        if (entity === 'workspaces' && !rec.id) { data.docs = 0; data.size = '0 MB'; data.updated = today(); }
        if (entity === 'external' && !rec.id) data.lastContact = today();
        if (entity === 'people' && !rec.id) { data.started = today(); data.skills = []; data.langs = ['English']; data.queues = []; }
        if (rec.id) data.id = rec.id;
        SVC[entity].upsert(data).then(function () {
          closeOverlay();
          toast((rec.id ? 'Saved ' : 'Created ') + (data[nameKey]));
          rerenderCurrent();
        }).catch(function (e) {
          toast(e.message || 'Could not save.');
        });
      };
    }
    if (entity === 'people') {
      Promise.all([fetchPicklistNames('title'), fetchPicklistNames('dept')]).then(function (res) {
        PICKLIST_CACHE.title = res[0];
        PICKLIST_CACHE.dept = res[1];
        render();
      });
      return;
    }
    render();
  }

  function chatDrawer(target) {
    var name = target.name;
    shell(false, name, 'Direct message',
      '<div class="dxr-thread" id="dxr_thread"></div>',
      '<input class="dxr-in" id="dxr_msg" placeholder="Write a message…" aria-label="Message" style="flex:1">' +
      '<button class="dxr-btn pri" id="dxr_send">Send</button>');
    var box = document.getElementById('dxr_thread');
    function paint() {
      SVC.thread(target.id).then(function (msgs) {
        box.innerHTML = msgs.length ? msgs.map(function (m) {
          return '<div class="dxr-msg ' + (m.from === 'me' ? 'me' : 'them') + '">' + esc(m.text) + '<span class="t">' + esc(m.time) + '</span></div>';
        }).join('') : '<div style="text-align:center;color:' + C.faint + ';font-size:12.5px;padding:26px 0">No messages yet — say hello.</div>';
        box.scrollTop = box.scrollHeight;
      });
    }
    paint();
    window.addEventListener('mcm-thread-update', paint);
    function send() {
      var el = document.getElementById('dxr_msg');
      if (!el.value.trim()) return;
      SVC.sendMessage(target.id, el.value.trim(), name).then(function () { el.value = ''; paint(); });
    }
    document.getElementById('dxr_send').onclick = send;
    document.getElementById('dxr_msg').onkeydown = function (e) { if (e.key === 'Enter') send(); };
  }

  function callModal(target, groupSize) {
    var secs = 0, muted = false, held = false, callId = null;
    shell(true, groupSize ? 'Ringing ' + target.name : target.name, groupSize ? groupSize + ' members · broadcast ring' : (target.phone || target.ext),
      '<div style="text-align:center">' +
      '<div class="dxr-av dxr-callav" style="background:' + tintFor(target.name) + '">' + esc(initialsOf(target.name)) + '</div>' +
      '<div style="font-size:14.5px;font-weight:600;color:' + C.navy + '">' + esc(target.name) + '</div>' +
      '<div id="dxr_calls" style="font-size:12.5px;color:' + C.mute + ';margin-top:4px">Connecting…</div>' +
      '<div style="display:flex;justify-content:center;gap:8px;margin-top:18px">' +
      '<button class="dxr-btn" id="dxr_mute">Mute</button><button class="dxr-btn" id="dxr_hold">Hold</button>' +
      '<button class="dxr-btn pri" id="dxr_hang" style="background:#c53030;border-color:#c53030;box-shadow:none">End call</button></div></div>', null);
    SVC.startCall(target).then(function (c) { callId = c.callId; });
    var lbl = document.getElementById('dxr_calls');
    var timer = setInterval(function () {
      secs++;
      if (!lbl || !document.body.contains(lbl)) { clearInterval(timer); return; }
      var m = String(Math.floor(secs / 60)).padStart(2, '0'), s = String(secs % 60).padStart(2, '0');
      lbl.textContent = (held ? 'On hold · ' : 'In call · ') + m + ':' + s + (muted ? ' · muted' : '');
    }, 1000);
    document.getElementById('dxr_mute').onclick = function () { muted = !muted; this.classList.toggle('pri', muted); };
    document.getElementById('dxr_hold').onclick = function () { held = !held; this.classList.toggle('pri', held); };
    document.getElementById('dxr_hang').onclick = function () {
      clearInterval(timer);
      SVC.endCall(callId, secs, target).then(function () { closeOverlay(); toast('Call ended · ' + secs + 's with ' + target.name); });
    };
  }

  function emailModal(target) {
    shell(true, 'New email', 'To ' + target.email,
      field('Subject', 'subject', '') +
      '<div class="dxr-fld"><label for="dxr_f_body">Message</label><textarea id="dxr_f_body" data-f="body"></textarea></div>',
      '<button class="dxr-btn" onclick="MCMDirectory.ui.close()">Cancel</button>' +
      '<button class="dxr-btn pri" id="dxr_esend">Send email</button>');
    document.getElementById('dxr_esend').onclick = function () {
      var f = readForm();
      if (!f.subject) { toast('Add a subject first'); return; }
      SVC.sendEmail({ to: target.email, subject: f.subject, body: f.body }).then(function () {
        closeOverlay(); toast('Email sent to ' + target.name);
      });
    };
  }

  function newChatPicker() {
    shell(false, 'New chat', 'Pick someone or a group to message',
      '<input class="dxr-in" id="dxr_pick" placeholder="Search people and groups…" aria-label="Search" style="margin-bottom:12px">' +
      '<div id="dxr_pickres"></div>');
    var res = document.getElementById('dxr_pickres');
    function paint(q) {
      var n = (q || '').toLowerCase();
      var rows = db().people.filter(function (p) { return !n || p.name.toLowerCase().indexOf(n) > -1 || p.title.toLowerCase().indexOf(n) > -1; })
        .map(function (p) { return { id: p.id, name: p.name, sub: p.title, pres: p.presence, tint: p.tint }; })
        .concat(db().groups.filter(function (g) { return !n || g.name.toLowerCase().indexOf(n) > -1; })
          .map(function (g) { return { id: g.id, name: g.name, sub: g.memberIds.length + ' members' }; }));
      res.innerHTML = '<div class="dxr-tblw">' + rows.map(function (r) {
        return '<div class="dxr-tr" style="grid-template-columns:1fr" onclick="' + A + 'chat(\\'' + r.id + '\\')">' +
          '<div style="display:flex;align-items:center;gap:10px">' + avatar(r.name, r.tint, 30, r.pres) +
          '<div><b>' + esc(r.name) + '</b><div style="font-size:11.3px;color:' + C.faint + '">' + esc(r.sub) + '</div></div></div></div>';
      }).join('') + '</div>';
    }
    paint('');
    document.getElementById('dxr_pick').oninput = function () { paint(this.value); };
  }

  /* ══════════════════════════════════════════════════════════
     6 · ADMIN ▸ DIRECTORY pages
     ══════════════════════════════════════════════════════════ */
  var AS = { locations: '', profflds: '', extcontacts: '', docws: '' };
  var ADMIN_META = {
    locations: { entity: 'locations', title: 'Locations', add: 'Add location' },
    profflds: { entity: 'fields', title: 'Profile Fields', add: 'Add field' },
    extcontacts: { entity: 'external', title: 'External Contacts', add: 'Add contact' },
    docws: { entity: 'workspaces', title: 'Document Workspaces', add: 'Add workspace' }
  };
  var currentAdmin = null;

  function adminShell(page, statsHtml, tableHtml) {
    var m = ADMIN_META[page];
    return '<div class="dxr">' +
      '<div class="dxr-hd"><div class="dxr-eyebrow"><a href="#" onclick="adminIndex();return false" style="color:inherit">Admin</a> › Directory</div>' +
      '<div class="dxr-top"><div><h1 class="dxr-h1">' + m.title + '</h1></div><div style="flex:1"></div>' +
      '<div class="dxr-acts"><button class="dxr-btn" onclick="' + A + 'exportAdmin(\\'' + page + '\\')">' + I.down + 'Export CSV</button>' +
      '<button class="dxr-btn pri" onclick="' + A + 'add(\\'' + m.entity + '\\')">' + I.plus + m.add + '</button></div></div>' +
      '<div style="height:14px"></div></div>' +
      '<div class="dxr-bar"><div class="dxr-sw"><span>' + I.search + '</span>' +
      '<input class="dxr-in" id="dxr_aq" placeholder="Search ' + m.title.toLowerCase() + '" value="' + esc(AS[page]) + '" aria-label="Search"></div></div>' +
      '<div class="dxr-body">' + statsHtml + '<div id="dxr_atbl">' + tableHtml + '</div></div></div>';
  }

  function stats(items) {
    return '<div class="dxr-stat">' + items.map(function (i) {
      return '<div><b>' + esc(i[0]) + '</b><span>' + esc(i[1]) + '</span></div>';
    }).join('') + '</div>';
  }

  function adminTable(cols, rows, rowFn) {
    if (!rows.length) return emptyState('Nothing to show', 'No records match this search.', 'Clear search', A + 'clearAdmin()');
    var grid = cols.map(function (c) { return c.w; }).join(' ');
    return '<div class="dxr-tblw"><div class="dxr-thead" style="grid-template-columns:' + grid + '">' +
      cols.map(function (c) { return '<div' + (c.right ? ' style="text-align:right"' : '') + '>' + c.label + '</div>'; }).join('') + '</div>' +
      rows.map(function (r) { return '<div class="dxr-tr" style="grid-template-columns:' + grid + '">' + rowFn(r) + '</div>'; }).join('') + '</div>';
  }

  function renderAdmin(page, mount) {
    currentAdmin = page;
    var q = AS[page];
    var m = ADMIN_META[page];
    SVC[m.entity].list(q).catch(function (e) { console.error('[directory] admin list failed', e); return []; }).then(function (rows) {
      try {
      var statsHtml = '', table = '';
      if (page === 'locations') {
        statsHtml = stats([[String(rows.length), 'Sites'], [String(rows.reduce(function (a, r) { return a + (r.headcount || 0); }, 0)), 'People on site'],
          [String(rows.filter(function (r) { return r.status === 'Operational'; }).length), 'Operational'],
          [String(new Set(rows.map(function (r) { return r.country; })).size), 'Countries']]);
        table = adminTable([{ label: 'Location', w: '1.6fr' }, { label: 'Type', w: '1.1fr' }, { label: 'Address', w: '2fr' },
          { label: 'Hours', w: '1fr' }, { label: 'People', w: '.6fr' }, { label: 'Status', w: '.9fr' }, { label: 'Actions', w: '116px', right: true }],
          rows, function (r) {
            return '<div onclick="' + A + 'location(\\'' + r.id + '\\')"><b>' + esc(r.name) + '</b><div style="font-size:11.3px;color:' + C.faint + '">' + esc(r.site) + '</div></div>' +
              '<div>' + esc(r.type) + '</div><div>' + esc(r.address) + '</div><div>' + esc(r.hours) + '</div><div>' + (r.headcount || 0) + '</div>' +
              '<div>' + statusPill(r.status, r.status === 'Operational' ? 'ok' : 'warn') + '</div>' +
              '<div class="dxr-right">' + iconBtn('Edit', I.edit, A + 'edit(\\'locations\\',\\'' + r.id + '\\')') +
              iconBtn('Delete', I.trash, A + 'del(\\'locations\\',\\'' + r.id + '\\')') + '</div>';
          });
      } else if (page === 'profflds') {
        statsHtml = stats([[String(rows.length), 'Fields'], [String(rows.filter(function (r) { return r.required; }).length), 'Required'],
          [String(rows.filter(function (r) { return r.visibility !== 'Everyone'; }).length), 'Restricted visibility'],
          [String(new Set(rows.map(function (r) { return r.section; })).size), 'Sections']]);
        table = adminTable([{ label: 'Field', w: '1.5fr' }, { label: 'API key', w: '1.2fr' }, { label: 'Type', w: '1fr' },
          { label: 'Section', w: '.9fr' }, { label: 'Visibility', w: '1.1fr' }, { label: 'Required', w: '.9fr' }, { label: 'Actions', w: '150px', right: true }],
          rows, function (r) {
            return '<div><b>' + esc(r.label) + '</b>' + (r.system ? '<div style="font-size:11.3px;color:' + C.faint + '">System field</div>' : '') + '</div>' +
              '<div style="font-family:ui-monospace,Menlo,monospace;font-size:11.8px">' + esc(r.key) + '</div>' +
              '<div>' + esc(r.type) + '</div><div>' + esc(r.section) + '</div><div>' + esc(r.visibility) + '</div>' +
              '<div>' + (r.required ? statusPill('Required', 'ok') : statusPill('Optional', 'off')) + '</div>' +
              '<div class="dxr-right">' + iconBtn('Move up', I.up, A + 'move(\\'' + r.id + '\\',-1)') + iconBtn('Move down', I.dn, A + 'move(\\'' + r.id + '\\',1)') +
              iconBtn('Edit', I.edit, A + 'edit(\\'fields\\',\\'' + r.id + '\\')') +
              (r.system ? '' : iconBtn('Delete', I.trash, A + 'del(\\'fields\\',\\'' + r.id + '\\')')) + '</div>';
          });
      } else if (page === 'extcontacts') {
        statsHtml = stats([[String(rows.length), 'Contacts'], [String(new Set(rows.map(function (r) { return r.org; })).size), 'Organisations'],
          [String(rows.filter(function (r) { return r.relationship === 'Vendor'; }).length), 'Vendors'],
          [String(rows.filter(function (r) { return r.relationship === 'Carrier'; }).length), 'Carriers']]);
        table = adminTable([{ label: 'Contact', w: '1.6fr' }, { label: 'Organisation', w: '1.3fr' }, { label: 'Relationship', w: '1fr' },
          { label: 'Email', w: '1.6fr' }, { label: 'Owner', w: '1fr' }, { label: 'Actions', w: '150px', right: true }],
          rows, function (r) {
            return '<div style="display:flex;align-items:center;gap:10px" onclick="' + A + 'contact(\\'' + r.id + '\\')">' + avatar(r.name, r.tint, 30) +
              '<div><b>' + esc(r.name) + '</b><div style="font-size:11.3px;color:' + C.faint + '">' + esc(r.role) + '</div></div></div>' +
              '<div>' + esc(r.org) + '</div><div>' + statusPill(r.relationship, 'info') + '</div><div>' + esc(r.email) + '</div><div>' + esc(r.owner) + '</div>' +
              '<div class="dxr-right">' + iconBtn('Call', I.phone, A + 'call(\\'' + r.id + '\\')') + iconBtn('Email', I.mail, A + 'email(\\'' + r.id + '\\')') +
              iconBtn('Edit', I.edit, A + 'edit(\\'external\\',\\'' + r.id + '\\')') + iconBtn('Delete', I.trash, A + 'del(\\'external\\',\\'' + r.id + '\\')') + '</div>';
          });
      } else {
        statsHtml = stats([[String(rows.length), 'Workspaces'], [String(rows.reduce(function (a, r) { return a + r.docs; }, 0)), 'Documents'],
          [String(rows.filter(function (r) { return r.type === 'Restricted'; }).length), 'Restricted'],
          [String(rows.filter(function (r) { return r.type === 'Public'; }).length), 'Public']]);
        table = adminTable([{ label: 'Workspace', w: '1.7fr' }, { label: 'Type', w: '.9fr' }, { label: 'Owner', w: '1.1fr' },
          { label: 'Access', w: '1.5fr' }, { label: 'Docs', w: '.6fr' }, { label: 'Size', w: '.7fr' }, { label: 'Actions', w: '116px', right: true }],
          rows, function (r) {
            return '<div><b>' + esc(r.name) + '</b><div style="font-size:11.3px;color:' + C.faint + '">Updated ' + esc(r.updated) + ' · retention ' + esc(r.retention) + '</div></div>' +
              '<div>' + statusPill(r.type, r.type === 'Restricted' ? 'warn' : r.type === 'Public' ? 'info' : 'ok') + '</div>' +
              '<div>' + esc(r.owner) + '</div><div>' + esc(r.access) + '</div><div>' + r.docs + '</div><div>' + esc(r.size) + '</div>' +
              '<div class="dxr-right">' + iconBtn('Edit', I.edit, A + 'edit(\\'workspaces\\',\\'' + r.id + '\\')') +
              iconBtn('Delete', I.trash, A + 'del(\\'workspaces\\',\\'' + r.id + '\\')') + '</div>';
          });
      }
      if (mount) {
        mount.innerHTML = adminShell(page, statsHtml, table);
        var q2 = document.getElementById('dxr_aq');
        var t;
        if (q2) q2.oninput = function () { AS[page] = q2.value; clearTimeout(t); t = setTimeout(function () { renderAdminRows(page); }, 130); };
      } else {
        var tbl = document.getElementById('dxr_atbl');
        if (tbl) tbl.innerHTML = table;
      }
      } catch (err) { console.error('[directory] admin render failed', err); }
    });
  }
  function renderAdminRows(page) { renderAdmin(page, null); }

  function rerenderCurrent() {
    if (host()) { refresh(); return; }
    if (currentAdmin) {
      var mount = document.getElementById('dxr_admin');
      renderAdmin(currentAdmin, mount || null);
    }
  }

  /* ══════════════════════════════════════════════════════════
     7 · ACTIONS (inline-handler surface)
     ══════════════════════════════════════════════════════════ */
  function findAny(id) {
    var d = db();
    return d.people.filter(function (x) { return x.id === id; })[0] ||
      d.groups.filter(function (x) { return x.id === id; })[0] ||
      d.external.filter(function (x) { return x.id === id; })[0] ||
      d.locations.filter(function (x) { return x.id === id; })[0] || null;
  }
  var ENTITY_OF = { u: 'people', g: 'groups', l: 'locations', x: 'external', f: 'fields', w: 'workspaces' };

  window.MCMDirectory.act = {
    tab: function (t) { S.tab = t; S.q = ''; S.dept = ''; S.loc = ''; S.pres = ''; renderWorkspace(); },
    view: function (v) { S.view = v; refresh(); },
    sort: function (k) { S.sort = k; refresh(); },
    clear: function () { S.q = ''; S.dept = ''; S.loc = ''; S.pres = ''; refresh(); },
    clearAdmin: function () { if (currentAdmin) { AS[currentAdmin] = ''; renderAdmin(currentAdmin, document.getElementById('dxr_admin')); } },
    person: function (id) { SVC.people.get(id).then(function (p) { if (p) personDrawer(p); }); },
    group: function (id) { SVC.groups.get(id).then(function (g) { if (g) groupDrawer(g); }); },
    location: function (id) { SVC.locations.get(id).then(function (l) { if (l) locationDrawer(l); }); },
    contact: function (id) { SVC.external.get(id).then(function (c) { if (c) contactDrawer(c); }); },
    add: function (entity) {
      if (!entity) entity = { People: 'people', Groups: 'groups', Locations: 'locations', External: 'external' }[S.tab];
      if (!entity) { toast('Star records from the other tabs to build favourites'); return; }
      openForm(entity, {});
    },
    edit: function (entity, id) { SVC[entity].get(id).then(function (r) { if (r) openForm(entity, r); }); },
    del: function (entity, id) {
      SVC[entity].get(id).then(function (r) {
        if (!r) return;
        confirmDelete('Delete ' + TITLES[entity][0] + '?', '"' + (r.name || r.label) + '" will be removed from the directory. This cannot be undone.', function () {
          SVC[entity].remove(id).then(function () { toast('Deleted ' + (r.name || r.label)); rerenderCurrent(); });
        });
      });
    },
    fav: function (id, on) {
      SVC.setFavourite(id, on).then(function () { toast(on ? 'Added to favourites' : 'Removed from favourites'); rerenderCurrent(); });
    },
    call: function (id) { var t = findAny(id); if (t) callModal(t); },
    dial: function (num) { callModal({ id: 'ext', name: num, phone: num }); },
    ring: function (id) {
      var g = db().groups.filter(function (x) { return x.id === id; })[0];
      if (g) callModal(g, (g.memberIds || []).length);
    },
    email: function (id) { var t = findAny(id); if (t && t.email) emailModal(t); else toast('No email address on this record'); },
    chat: function (id) { var t = findAny(id); if (t) chatDrawer(t); },
    newChat: newChatPicker,
    move: function (id, dir) {
      var d = db(), i = d.fields.map(function (f) { return f.id; }).indexOf(id), j = i + dir;
      if (i < 0 || j < 0 || j >= d.fields.length) return;
      var tmp = d.fields[i]; d.fields[i] = d.fields[j]; d.fields[j] = tmp;
      save(); rerenderCurrent();
    },
    exportTab: function () {
      if (S.tab === 'People') {
        SVC.listPeople({ q: S.q, dept: S.dept, loc: S.loc, pres: S.pres, sort: S.sort }).then(function (rows) {
          downloadCsv('directory-people.csv', rows, [
            { label: 'Name', get: function (r) { return r.name; } }, { label: 'Title', get: function (r) { return r.title; } },
            { label: 'Department', get: function (r) { return r.dept; } }, { label: 'Location', get: function (r) { return r.location; } },
            { label: 'Email', get: function (r) { return r.email; } }, { label: 'Extension', get: function (r) { return r.ext; } },
            { label: 'Presence', get: function (r) { return r.presence; } }]);
        });
      } else if (S.tab === 'Groups') {
        SVC.groups.list(S.q).then(function (rows) {
          downloadCsv('directory-groups.csv', rows, [
            { label: 'Group', get: function (r) { return r.name; } }, { label: 'Type', get: function (r) { return r.type; } },
            { label: 'Extension', get: function (r) { return r.ext; } }, { label: 'Owner', get: function (r) { return r.owner; } },
            { label: 'Members', get: function (r) { return (r.memberIds || []).length; } }]);
        });
      } else if (S.tab === 'Locations') {
        window.MCMDirectory.act.exportAdmin('locations');
      } else if (S.tab === 'External') {
        window.MCMDirectory.act.exportAdmin('extcontacts');
      } else {
        SVC.favourites().then(function (f) {
          var rows = f.people.concat(f.groups, f.contacts);
          downloadCsv('directory-favourites.csv', rows, [
            { label: 'Name', get: function (r) { return r.name; } },
            { label: 'Detail', get: function (r) { return r.title || r.org || r.type || ''; } }]);
        });
      }
    },
    exportAdmin: function (page) {
      var m = ADMIN_META[page];
      SVC[m.entity].list(AS[page]).then(function (rows) {
        var cols = {
          locations: [{ label: 'Location', get: function (r) { return r.name; } }, { label: 'Type', get: function (r) { return r.type; } },
            { label: 'Address', get: function (r) { return r.address; } }, { label: 'Country', get: function (r) { return r.country; } },
            { label: 'Hours', get: function (r) { return r.hours; } }, { label: 'Headcount', get: function (r) { return r.headcount || 0; } },
            { label: 'Status', get: function (r) { return r.status; } }],
          profflds: [{ label: 'Field', get: function (r) { return r.label; } }, { label: 'Key', get: function (r) { return r.key; } },
            { label: 'Type', get: function (r) { return r.type; } }, { label: 'Section', get: function (r) { return r.section; } },
            { label: 'Visibility', get: function (r) { return r.visibility; } }, { label: 'Required', get: function (r) { return r.required ? 'Yes' : 'No'; } }],
          extcontacts: [{ label: 'Name', get: function (r) { return r.name; } }, { label: 'Organisation', get: function (r) { return r.org; } },
            { label: 'Role', get: function (r) { return r.role; } }, { label: 'Relationship', get: function (r) { return r.relationship; } },
            { label: 'Email', get: function (r) { return r.email; } }, { label: 'Phone', get: function (r) { return r.phone; } },
            { label: 'Owner', get: function (r) { return r.owner; } }],
          docws: [{ label: 'Workspace', get: function (r) { return r.name; } }, { label: 'Type', get: function (r) { return r.type; } },
            { label: 'Owner', get: function (r) { return r.owner; } }, { label: 'Access', get: function (r) { return r.access; } },
            { label: 'Docs', get: function (r) { return r.docs; } }, { label: 'Size', get: function (r) { return r.size; } },
            { label: 'Retention', get: function (r) { return r.retention; } }]
        }[page];
        downloadCsv('directory-' + page + '.csv', rows, cols);
      });
    },
    presence: function (p) { SVC.setPresence(p).then(function () { toast('Presence set to ' + p); rerenderCurrent(); }); },
    reset: function () { SVC.reset(); toast('Prototype data reset'); rerenderCurrent(); }
  };

  /* ══════════════════════════════════════════════════════════
     8 · ROUTER INTEGRATION
     ══════════════════════════════════════════════════════════ */
  function mountWorkspace() {
    var cnt = document.getElementById('cnt');
    if (!cnt) return;
    cnt.style.display = '';
    cnt.innerHTML = '<div class="dxr" id="dxr_ws"></div>';
    currentAdmin = null;
    renderWorkspace();
  }

  function patch() {
    if (!window.SNAP || typeof window.openPage !== 'function') { setTimeout(patch, 60); return; }

    /* Admin ▸ Directory pages: SNAP holds only a mount point; we own the render. */
    Object.keys(ADMIN_META).forEach(function (k) { window.SNAP[k] = '<div id="dxr_admin"></div>'; });

    var _openPage = window.openPage;
    window.openPage = function (id) {
      var r = _openPage.apply(this, arguments);
      if (ADMIN_META[id]) {
        var mount = document.getElementById('dxr_admin');
        if (mount) renderAdmin(id, mount);
      } else { currentAdmin = null; }
      return r;
    };

    if (typeof window.go === 'function') {
      var _go = window.go;
      window.go = function (page) {
        var r = _go.apply(this, arguments);
        if (page === 'directory') setTimeout(mountWorkspace, 0);
        return r;
      };
    }

    window.MCMDirectory.open = mountWorkspace;
    window.MCMDirectory.openAdmin = function (id) { window.openPage(id); };
  }
  patch();
})();
`;
