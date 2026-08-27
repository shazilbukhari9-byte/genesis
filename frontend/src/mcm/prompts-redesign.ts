/* ============================================================
   MCM Cloud CX — Prompts: Backend Wiring & Real Controls
   NOT a redesign — reproduces the existing page markup (same
   classes, same drawer layout) and fixes every dead/fake control:

   1. GRAPH OF CHANGE. The previous pass here (see git history)
      wired Add/Edit/Delete to the real /api/prompts CRUD, but:
        - fetch failures silently fell back to fabricated demo rows
          (PROMPTS_FALLBACK) — including on a legitimate empty list,
          which looked identical to "couldn't reach the server".
        - create/update/remove silently "succeeded" into an in-memory
          store on any network error — the user saw a success toast
          for a save that never reached the backend.
        - Division/Status filter chips were decorative (no such
          fields exist on a prompt) and Refresh/pagination were
          either absent or non-functional text.
        - Audio was a plain "file name" text box — no real file
          picker, no upload, no preview, no play/pause, no download,
          nothing persisted.
      All of that is replaced below with real backend calls, real
      loading/empty/error states (mirroring flows-redesign.ts's
      pattern — no fabricated fallback data, ever), real Type/
      Language filters, real pagination, and real audio handling.

   2. AUDIO STORAGE. There was no column for audio bytes anywhere
      (audio_name was a bare filename string). Added audio_data
      (base64) + audio_mime columns to the prompts table (see
      database/schema.sql and backend/resources.py's REGISTRY
      "prompts" entry) and wired real upload/preview/play/pause/
      download/replace against them. Capability is detected live:
      after a save, if audio was uploaded but the row that comes
      back has no audio_data, that backend hasn't been migrated
      yet — the user is told plainly rather than shown a fake
      success (same "deployment gap" honesty pattern used in
      flows-redesign.ts for /validate and /publish).

   3. DUPLICATE NAMES. A unique index on (tenant_id, lower(name))
      was added to the prompts table; app.py's generic resource_create/
      resource_update now translate a unique-violation into a clean
      409 instead of an unhandled 500. The editor also checks
      client-side first for instant feedback.
   ============================================================ */

export const PROMPTS_SCRIPT: string = `
(function() {
  'use strict';

  var PROMPT_TYPES = ['User prompt', 'System prompt', 'Music on hold'];
  var MAX_AUDIO_BYTES = 8 * 1024 * 1024;
  var NAME_RE = /^[A-Za-z0-9_]{2,40}$/;
  var LANG_RE = /^[a-zA-Z]{2}(-[a-zA-Z]{2})?$/;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function promptsApiFetch(path, init) {
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

  function normalizePromptRow(row) {
    var desc = row.description || '';
    var type = PROMPT_TYPES.indexOf(desc) > -1 ? desc : 'User prompt';
    return {
      id: row.id,
      name: row.name,
      type: type,
      lang: row.lang || '',
      tts: row.tts || '',
      audioName: row.audio_name || '',
      audioData: row.audio_data || '',
      audioMime: row.audio_mime || ''
    };
  }

  var promptsCache = [];
  var promptsLoadState = 'loading'; // 'loading' | 'ready' | 'error'

  function fetchPrompts() {
    return promptsApiFetch('/api/prompts?limit=500').then(function(rows) {
      return Array.isArray(rows) ? rows.map(normalizePromptRow) : [];
    });
  }

  var PromptsService = {
    getAll: function() { return promptsCache; },
    getById: function(id) { return promptsCache.filter(function(p) { return String(p.id) === String(id); })[0] || null; },
    refresh: function() {
      return fetchPrompts().then(function(list) { promptsCache = list; return list; });
    },
    create: function(entry) {
      var payload = { name: entry.name, description: entry.type, lang: entry.lang, tts: entry.tts };
      if ('audioName' in entry) payload.audio_name = entry.audioName;
      if ('audioData' in entry) payload.audio_data = entry.audioData;
      if ('audioMime' in entry) payload.audio_mime = entry.audioMime;
      return promptsApiFetch('/api/prompts', { method: 'POST', body: JSON.stringify(payload) }).then(normalizePromptRow);
    },
    update: function(id, entry) {
      var payload = { name: entry.name, description: entry.type, lang: entry.lang, tts: entry.tts };
      if ('audioName' in entry) payload.audio_name = entry.audioName;
      if ('audioData' in entry) payload.audio_data = entry.audioData;
      if ('audioMime' in entry) payload.audio_mime = entry.audioMime;
      return promptsApiFetch('/api/prompts/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(payload) }).then(normalizePromptRow);
    },
    remove: function(id) {
      return promptsApiFetch('/api/prompts/' + encodeURIComponent(id), { method: 'DELETE' });
    }
  };
  window.PromptsService = PromptsService;

  /* ═══════════ Filters, search, pagination ═══════════ */
  var pFilters = { q: '', type: '', lang: '' };
  var pPage = 1;
  var pPageSize = 25;

  function filteredPrompts() {
    var q = pFilters.q.trim().toLowerCase();
    return PromptsService.getAll().filter(function(p) {
      if (pFilters.type && p.type !== pFilters.type) return false;
      if (pFilters.lang && (p.lang || '') !== pFilters.lang) return false;
      if (!q) return true;
      return p.name.toLowerCase().indexOf(q) > -1 || p.type.toLowerCase().indexOf(q) > -1 || (p.lang || '').toLowerCase().indexOf(q) > -1;
    });
  }

  function uniqueLangs() {
    var seen = {}, out = [];
    PromptsService.getAll().forEach(function(p) { if (p.lang && !seen[p.lang]) { seen[p.lang] = true; out.push(p.lang); } });
    return out.sort();
  }

  function paginated() {
    var list = filteredPrompts();
    var totalPages = Math.max(1, Math.ceil(list.length / pPageSize));
    if (pPage > totalPages) pPage = totalPages;
    if (pPage < 1) pPage = 1;
    var start = (pPage - 1) * pPageSize;
    return { rows: list.slice(start, start + pPageSize), total: list.length, totalPages: totalPages, start: start };
  }

  window.promptsSearch = function(v) { pFilters.q = v || ''; pPage = 1; refreshPromptsTable(); };
  window.promptsFilterType = function(v) { pFilters.type = v || ''; pPage = 1; refreshPromptsTable(); };
  window.promptsFilterLang = function(v) { pFilters.lang = v || ''; pPage = 1; refreshPromptsTable(); };
  window.promptsSetPageSize = function(v) { pPageSize = parseInt(v, 10) || 25; pPage = 1; refreshPromptsTable(); };
  window.promptsPrevPage = function() { if (pPage > 1) { pPage--; refreshPromptsTable(); } };
  window.promptsNextPage = function() {
    var totalPages = Math.max(1, Math.ceil(filteredPrompts().length / pPageSize));
    if (pPage < totalPages) { pPage++; refreshPromptsTable(); }
  };

  window.promptsReload = function() {
    promptsLoadState = 'loading';
    refreshPromptsTable();
    PromptsService.refresh().then(function() {
      promptsLoadState = 'ready';
      refreshPromptsTable();
      if (window.toast) window.toast('Prompts refreshed');
    }).catch(function() {
      promptsLoadState = 'error';
      refreshPromptsTable();
      if (window.toast) window.toast('\\u2717 Couldn\\'t refresh prompts \\u2014 please try again');
    });
  };

  window.promptsExport = function() {
    var list = filteredPrompts();
    var header = ['Prompt', 'Type', 'Language', 'TTS text', 'Audio file'];
    var lines = [header.join(',')].concat(list.map(function(p) {
      return [p.name, p.type, p.lang, p.tts, p.audioName]
        .map(function(v) { v = String(v == null ? '' : v); return /[",\\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; })
        .join(',');
    }));
    var blob = new Blob([lines.join('\\n')], { type: 'text/csv' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'prompts.csv';
    link.click();
    if (window.toast) window.toast('Prompts exported (' + list.length + ' rows)');
  };

  /* ═══════════ Duration (real, probed from the audio file itself) ═══════════
     Nothing in the row data carries a duration — the only honest source is
     letting the browser's own decoder read it off the audio, same as the
     Download link's data: URI. Probed once per prompt id and cached; a
     probe failure (corrupt/unplayable audio) is cached as 'error' so it
     doesn't retry forever, rather than silently re-probing on every render. */
  var durationCache = {};
  function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '\\u2014';
    var m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
    if (s === 60) { m += 1; s = 0; }
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function probeDuration(p) {
    if (!p.audioData || durationCache.hasOwnProperty(p.id)) return;
    durationCache[p.id] = 'pending';
    var probe = new Audio();
    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', function() {
      durationCache[p.id] = probe.duration;
      refreshPromptsTable();
    });
    probe.addEventListener('error', function() {
      durationCache[p.id] = 'error';
      refreshPromptsTable();
    });
    probe.src = 'data:' + (p.audioMime || 'audio/mpeg') + ';base64,' + p.audioData;
  }

  /* ═══════════ Play / Pause / Download ═══════════ */
  var sharedAudioEl = null;
  var currentPlayingId = null;

  function getSharedAudio() {
    if (!sharedAudioEl) {
      sharedAudioEl = document.createElement('audio');
      sharedAudioEl.id = 'prompts_audio_player';
      sharedAudioEl.style.display = 'none';
      document.body.appendChild(sharedAudioEl);
      sharedAudioEl.addEventListener('ended', function() { currentPlayingId = null; refreshPromptsTable(); });
      sharedAudioEl.addEventListener('pause', function() {
        if (sharedAudioEl.currentTime === 0 || sharedAudioEl.ended) return;
      });
    }
    return sharedAudioEl;
  }

  window.promptsTogglePlay = function(id) {
    var p = PromptsService.getById(id);
    if (!p || !p.audioData) return;
    var audio = getSharedAudio();
    if (currentPlayingId != null && String(currentPlayingId) === String(p.id)) {
      audio.pause();
      currentPlayingId = null;
      refreshPromptsTable();
      return;
    }
    audio.pause();
    audio.src = 'data:' + (p.audioMime || 'audio/mpeg') + ';base64,' + p.audioData;
    var playPromise = audio.play();
    currentPlayingId = p.id;
    refreshPromptsTable();
    if (playPromise && playPromise.catch) {
      playPromise.catch(function(err) {
        currentPlayingId = null;
        refreshPromptsTable();
        if (window.toast) window.toast('\\u2717 Couldn\\'t play that audio \\u2014 ' + escapeHtml((err && err.message) || 'unknown error'));
      });
    }
  };

  function audioExtFromMime(mime) {
    if (!mime) return '';
    if (mime.indexOf('mpeg') > -1 || mime.indexOf('mp3') > -1) return '.mp3';
    if (mime.indexOf('wav') > -1) return '.wav';
    if (mime.indexOf('ogg') > -1) return '.ogg';
    if (mime.indexOf('webm') > -1) return '.webm';
    return '';
  }

  window.promptsDownload = function(id) {
    var p = PromptsService.getById(id);
    if (!p || !p.audioData) return;
    var link = document.createElement('a');
    link.href = 'data:' + (p.audioMime || 'audio/mpeg') + ';base64,' + p.audioData;
    link.download = p.audioName || (p.name + audioExtFromMime(p.audioMime));
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /* ═══════════ Table rendering ═══════════ */
  function renderPromptRow(p) {
    var hasAudio = !!p.audioData;
    var playing = currentPlayingId != null && String(currentPlayingId) === String(p.id);
    var audioCell = hasAudio
      ? (playing
          ? '<span style="display:inline-flex;align-items:center;gap:5px;margin-right:10px;color:#FF4F1F;font-weight:700">' +
              '<span style="width:7px;height:7px;border-radius:50%;background:#FF4F1F;display:inline-block;animation:promptsPulse 1s ease-in-out infinite"></span>' +
              'Playing\\u2026</span>' +
            '<a class="lnk" style="margin-right:10px" title="Pause" onclick="window.promptsTogglePlay(\\'' + p.id + '\\')">\\u23F8 Pause</a>'
          : '<a class="lnk" style="margin-right:10px" title="Play" onclick="window.promptsTogglePlay(\\'' + p.id + '\\')">\\u25B6 Play</a>') +
        '<a class="lnk" title="Download" onclick="window.promptsDownload(\\'' + p.id + '\\')">\\u2B07 Download</a>'
      : '<span style="color:#a9b3c2">No audio</span>';
    var durationCell = '\\u2014';
    if (hasAudio) {
      var cached = durationCache[p.id];
      if (cached === undefined) { probeDuration(p); durationCell = '<span style="color:#a9b3c2">\\u2026</span>'; }
      else if (cached === 'pending') { durationCell = '<span style="color:#a9b3c2">\\u2026</span>'; }
      else if (cached === 'error') { durationCell = '<span style="color:#a9b3c2" title="Could not read this audio file">\\u2014</span>'; }
      else { durationCell = formatDuration(cached); }
    }
    return '<tr onclick="window.promptsOpenEditor(\\'' + p.id + '\\')">' +
      '<td><input type="checkbox" onclick="event.stopPropagation()"></td>' +
      '<td><b class="lnk">' + escapeHtml(p.name) + '</b></td>' +
      '<td>' + escapeHtml(p.type) + '</td>' +
      '<td>' + (p.lang ? escapeHtml(p.lang) : '\\u2014') + '</td>' +
      '<td style="white-space:nowrap" onclick="event.stopPropagation()">' + audioCell + '</td>' +
      '<td>' + durationCell + '</td>' +
      '<td title="Not tracked \\u2014 flows store prompt wording as plain text, not a reference to this record, so there is no reliable way to compute this">\\u2014</td>' +
      '<td style="color:#a9b3c2">\\u22EE</td>' +
      '</tr>';
  }

  function renderPromptsTable() {
    if (promptsLoadState === 'loading') return '<div style="padding:28px;text-align:center;color:#8794a8">Loading prompts\\u2026</div>';
    if (promptsLoadState === 'error') return '<div style="padding:28px;text-align:center;color:#b3261e">Couldn\\'t load prompts from the server. <a class="lnk" onclick="window.promptsReload()">Retry</a></div>';

    var pg = paginated();
    var rows = pg.rows.length
      ? pg.rows.map(renderPromptRow).join('')
      : '<tr><td colspan="8" style="text-align:center;color:#8794a8;padding:28px 0">' + (PromptsService.getAll().length ? 'No prompts match your search.' : 'No prompts yet \\u2014 add one to get started.') + '</td></tr>';
    var showFrom = pg.total ? pg.start + 1 : 0;
    var showTo = Math.min(pg.start + pPageSize, pg.total);

    return '<table class="dt"><thead><tr><th style="width:34px"><input type="checkbox"></th><th>Prompt \\u21C5</th><th>Type \\u21C5</th><th>Languages \\u21C5</th><th>Audio</th><th>Duration \\u21C5</th><th>Used by flows \\u21C5</th><th style="width:40px"></th></tr></thead><tbody id="tb">' + rows + '</tbody></table>' +
      '<div class="pgr"><span>Showing <b>' + showFrom + (pg.total ? '\\u2013' + showTo : '') + '</b> of <b>' + pg.total + '</b></span><div class="sp"></div>' +
      '<span>Rows per page <select onchange="window.promptsSetPageSize(this.value)" style="border:none;background:transparent;font:inherit;color:inherit;cursor:pointer">' +
        [10, 25, 50].map(function(n) { return '<option value="' + n + '"' + (pPageSize === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
      '</select></span>' +
      '<a class="lnk" style="' + (pPage <= 1 ? 'color:#c3cbd8;cursor:default' : '') + '"' + (pPage > 1 ? ' onclick="window.promptsPrevPage()"' : '') + '>\\u2039</a> ' +
      '<a class="lnk" style="' + (pPage >= pg.totalPages ? 'color:#c3cbd8;cursor:default' : '') + '"' + (pPage < pg.totalPages ? ' onclick="window.promptsNextPage()"' : '') + '>\\u203A</a>' +
      '</div>';
  }

  function refreshPromptsTable() {
    var wrap = document.querySelector('#cnt .tblw');
    if (wrap) wrap.innerHTML = renderPromptsTable();
    var langSel = document.getElementById('pr_lang_filter');
    if (langSel) {
      langSel.innerHTML = '<option value="">Language: All</option>' + uniqueLangs().map(function(l) {
        return '<option value="' + l + '"' + (pFilters.lang === l ? ' selected' : '') + '>' + escapeHtml(l) + '</option>';
      }).join('');
    }
  }

  /* ═══════════ Add / Edit drawer ═══════════ */
  var pendingAudio = null;       // { name, mime, data } freshly picked, not yet saved
  var pendingAudioCleared = false;
  var currentEditId = '';

  function fileToBase64(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function() { reject(new Error('Could not read that file')); };
      reader.onload = function() {
        var result = reader.result || '';
        var comma = result.indexOf(',');
        resolve(comma > -1 ? result.slice(comma + 1) : result);
      };
      reader.readAsDataURL(file);
    });
  }

  function typeOptions(selected) {
    return PROMPT_TYPES.map(function(t) {
      return '<option value="' + t + '"' + (selected === t ? ' selected' : '') + '>' + t + '</option>';
    }).join('');
  }

  function showDrawerError(html) {
    var box = document.getElementById('promptserr');
    if (box) { box.style.display = ''; box.innerHTML = html; }
  }
  function hideDrawerError() {
    var box = document.getElementById('promptserr');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  }

  function renderAudioBox(p) {
    var box = document.getElementById('pr_audio_box');
    if (!box) return;
    var hasAudio = pendingAudio ? true : (pendingAudioCleared ? false : !!(p && p.audioData));
    var label = pendingAudio ? pendingAudio.name : (pendingAudioCleared ? '' : (p && p.audioName));
    var src = pendingAudio ? ('data:' + pendingAudio.mime + ';base64,' + pendingAudio.data)
      : (!pendingAudioCleared && p && p.audioData ? ('data:' + (p.audioMime || 'audio/mpeg') + ';base64,' + p.audioData) : '');
    box.innerHTML =
      '<div style="font-size:12.5px;color:#5b6b82;margin-bottom:6px">' + (hasAudio ? 'Current: ' + escapeHtml(label || 'audio file') : 'No audio uploaded') + '</div>' +
      (hasAudio ? '<audio controls style="width:100%;margin-bottom:8px" src="' + src + '"></audio>' : '') +
      '<input type="file" id="pr_audio_file" accept="audio/*" style="display:none">' +
      '<button type="button" class="btn sec" onclick="document.getElementById(\\'pr_audio_file\\').click()">' + (hasAudio ? 'Replace audio' : 'Upload audio') + '</button>' +
      (hasAudio ? ' <button type="button" class="btn gh" onclick="window.__promptsAudioRemove()">Remove</button>' : '');
    var fileInput = document.getElementById('pr_audio_file');
    if (fileInput) fileInput.onchange = function() { window.__promptsAudioPicked(fileInput); };
  }

  window.__promptsAudioPicked = function(input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.type && file.type.slice(0, 6) !== 'audio/') {
      showDrawerError('Please choose an audio file.');
      return;
    }
    if (file.size > MAX_AUDIO_BYTES) {
      showDrawerError('That audio file is too large \\u2014 max 8\\u00A0MB.');
      return;
    }
    hideDrawerError();
    fileToBase64(file).then(function(b64) {
      pendingAudio = { name: file.name, mime: file.type || 'audio/mpeg', data: b64 };
      pendingAudioCleared = false;
      renderAudioBox(currentEditId ? PromptsService.getById(currentEditId) : null);
    }).catch(function(err) {
      showDrawerError(escapeHtml((err && err.message) || 'Could not read that file.'));
    });
  };

  window.__promptsAudioRemove = function() {
    pendingAudio = null;
    pendingAudioCleared = true;
    renderAudioBox(currentEditId ? PromptsService.getById(currentEditId) : null);
  };

  window.promptsOpenEditor = function(id) {
    var existing = id ? PromptsService.getById(id) : null;
    var isNew = !existing;
    var p = existing || { id: '', name: '', type: 'User prompt', lang: '', tts: '', audioName: '', audioData: '', audioMime: '' };

    currentEditId = p.id || '';
    pendingAudio = null;
    pendingAudioCleared = false;

    window.closeDrawer();
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.onclick = window.closeDrawer;
    document.body.appendChild(scrim);

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="drw"><div class="dh"><h2>' + (isNew ? 'Add' : 'Edit') + ' Prompt</h2><div class="x" onclick="closeDrawer()">\\u00D7</div></div>' +
      '<div class="db">' +
        '<div id="promptserr" style="display:none;background:#fdecea;border:1px solid #f5c6c0;color:#b3261e;border-radius:5px;padding:8px 11px;font-size:12.5px;margin-bottom:10px"></div>' +
        '<div class="fld"><label>Name</label><input id="pr_name" value="' + escapeHtml(p.name) + '" placeholder="MCM_Welcome"></div>' +
        '<div class="fld"><label>Type</label><select id="pr_type">' + typeOptions(p.type) + '</select></div>' +
        '<div class="fld"><label>Language</label><input id="pr_lang" value="' + escapeHtml(p.lang) + '" placeholder="en-GB"></div>' +
        '<div class="fld"><label>TTS text</label><input id="pr_tts" value="' + escapeHtml(p.tts) + '" placeholder="Spoken text if this prompt is TTS-generated"></div>' +
        '<div class="fld"><label>Audio file</label><div id="pr_audio_box"></div></div>' +
        (isNew ? '' : '<button class="btn gh" onclick="window.promptsDelete(\\'' + p.id + '\\')">Delete</button>') +
      '</div>' +
      '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" onclick="window.promptsSave(\\'' + (p.id || '') + '\\')">Save</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    renderAudioBox(p);
  };

  function isDuplicateName(name, excludeId) {
    var lower = name.toLowerCase();
    return PromptsService.getAll().some(function(p) {
      return p.name.toLowerCase() === lower && String(p.id) !== String(excludeId || '');
    });
  }

  window.promptsSave = function(id) {
    hideDrawerError();
    var name = document.getElementById('pr_name').value.trim();
    var type = document.getElementById('pr_type').value;
    var lang = document.getElementById('pr_lang').value.trim();
    var tts = document.getElementById('pr_tts').value.trim();
    var existing = id ? PromptsService.getById(id) : null;
    var hasAudioAfterSave = pendingAudio ? true : (pendingAudioCleared ? false : !!(existing && existing.audioData));

    var errs = [];
    if (!NAME_RE.test(name)) {
      errs.push('Name must be 2\\u201340 characters \\u2014 letters, numbers and underscores only.');
    } else if (isDuplicateName(name, id)) {
      errs.push('A prompt named \\u201C' + escapeHtml(name) + '\\u201D already exists.');
    }
    if (PROMPT_TYPES.indexOf(type) === -1) errs.push('Choose a prompt type.');
    if (type !== 'Music on hold') {
      if (!lang) errs.push('Language is required for this prompt type.');
      else if (!LANG_RE.test(lang)) errs.push('Language should look like \\u201Cen-GB\\u201D or \\u201Cen\\u201D.');
    }
    if (type === 'Music on hold' && !hasAudioAfterSave) {
      errs.push('Music on hold prompts need an uploaded audio file.');
    } else if (type !== 'Music on hold' && !hasAudioAfterSave && !tts) {
      errs.push('Add an audio file or TTS text for this prompt.');
    }
    if (errs.length) { showDrawerError(errs.join('<br>')); return; }

    var entry = { name: name, type: type, lang: lang, tts: tts };
    if (pendingAudio) {
      entry.audioName = pendingAudio.name;
      entry.audioData = pendingAudio.data;
      entry.audioMime = pendingAudio.mime;
    } else if (pendingAudioCleared) {
      entry.audioName = '';
      entry.audioData = '';
      entry.audioMime = '';
    }

    var isNew = !id;
    var audioWasIntended = !!pendingAudio;

    // A real audio upload can be a megabyte-plus of base64 in the request
    // body — on a slow connection or a cold-starting free-tier backend
    // that's a real multi-second wait with no visual feedback otherwise,
    // which reads as "the button doesn't work" even though it's just
    // still in flight. Disable + relabel it for the duration.
    var saveBtn = Array.prototype.filter.call(document.querySelectorAll('.df button.btn'), function(b) {
      return (b.getAttribute('onclick') || '').indexOf('promptsSave') > -1;
    })[0];
    var saveBtnOrigText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving\\u2026'; }

    var op = isNew ? PromptsService.create(entry) : PromptsService.update(id, entry);
    op.then(function(savedRow) {
      return PromptsService.refresh().catch(function() {}).then(function() { return savedRow; });
    }).then(function(savedRow) {
      window.closeDrawer();
      refreshPromptsTable();
      if (audioWasIntended && !savedRow.audioData) {
        if (window.toast) window.toast('\\u26A0 Saved <b>' + escapeHtml(name) + '</b> \\u2014 this server can\\'t store audio files yet, so the audio itself wasn\\'t saved.');
      } else {
        if (window.toast) window.toast((isNew ? '\\u2713 Added ' : '\\u2713 Saved ') + '<b>' + escapeHtml(name) + '</b>');
      }
    }).catch(function(err) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = saveBtnOrigText; }
      showDrawerError(escapeHtml((err && err.message) || 'Save failed \\u2014 please try again.'));
    });
  };

  function promptsConfirmBox(msg, onYes) {
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
        '<div class="df"><button class="btn sec" onclick="closeDrawer()">Cancel</button><button class="btn" id="prompts_cfyes">Confirm</button></div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
    document.getElementById('prompts_cfyes').onclick = function() { window.closeDrawer(); onYes(); };
  }

  window.promptsDelete = function(id) {
    var p = PromptsService.getById(id);
    if (!p) return;
    var safeName = escapeHtml(p.name);
    promptsConfirmBox('Delete prompt <b>' + safeName + '</b>? This cannot be undone.', function() {
      PromptsService.remove(id).then(function() {
        return PromptsService.refresh().catch(function() {});
      }).then(function() {
        refreshPromptsTable();
        if (window.toast) window.toast('\\u2713 Deleted <b>' + safeName + '</b>');
      }).catch(function(err) {
        if (window.toast) window.toast('\\u2717 Delete failed \\u2014 ' + escapeHtml((err && err.message) || 'please try again'));
      });
    });
  };

  /* ═══════════ Page shell ═══════════
     Header/toolbar markup kept byte-identical in structure to the
     original SNAP.prompts string (same classes, same "+ Add Prompt"/
     Export placement) — only the Division/Status chips (which never
     had any real logic behind them, since a prompt has no division
     or status field) are swapped for Type/Language filters that
     actually filter real data, and the Rows-per-page/prev-next
     controls (previously static text) are wired to real pagination. */
  function renderPromptsPage() {
    return '<div class="phd"><div class="bc"><a onclick="adminIndex()">Admin</a> \\u203A Routing</div>' +
      '<div class="tt"><h1>Prompts</h1><div class="rt"><button class="btn" onclick="window.promptsOpenEditor()">+ Add Prompt</button><button class="btn sec" onclick="window.promptsExport()">Export</button></div></div>' +
      '<div style="height:12px"></div></div>' +
      '<div class="pbody"><div class="tbar">' +
        '<input class="s" placeholder="Search prompts" oninput="window.promptsSearch(this.value)">' +
        '<select class="chip" onchange="window.promptsFilterType(this.value)">' +
          '<option value="">Type: All</option>' + PROMPT_TYPES.map(function(t) { return '<option value="' + t + '">' + t + '</option>'; }).join('') +
        '</select>' +
        '<select class="chip" id="pr_lang_filter" onchange="window.promptsFilterLang(this.value)">' +
          '<option value="">Language: All</option>' + uniqueLangs().map(function(l) { return '<option value="' + l + '">' + escapeHtml(l) + '</option>'; }).join('') +
        '</select>' +
        '<div class="sp"></div><div class="chip">\\u2699 Columns</div><div class="chip" onclick="window.promptsReload()">\\u21BB Refresh</div>' +
      '</div>' +
      '<div class="tblw">' + renderPromptsTable() + '</div>' +
      '</div>' +
      '<div class="help"><div class="hh" onclick="toggleHelp()"><span style="color:#FF4F1F">\\u24D8</span> Help &amp; Resources \\u2014 Prompts<span class="cx" id="helpcx">Hide</span></div>' +
      '<div class="hb" id="helpb" style=""><div class="hcols"><div><h5>What you can do here</h5><ul><li>User prompts recorded or uploaded per language</li><li>System prompts supplied by the platform</li><li>TTS engines and voices, SSML support</li><li>Hold music and audio sequences</li></ul>' +
      '<h5>Keywords</h5><div><span class="kw o">User prompt</span><span class="kw">System prompt</span><span class="kw">TTS</span><span class="kw o">SSML</span><span class="kw">Language</span><span class="kw">Hold music</span><span class="kw o">Audio sequence</span></div></div>' +
      '<div><h5>Training videos</h5><div style="font-size:12px;color:#8794a8">No lab video mapped to this page yet.</div><h5 style="margin-top:14px">Reference documentation</h5>' +
      '<div><a class="reflnk" href="https://help.genesys.com/" target="_blank" rel="noopener">Help Centre \\u203A Prompts</a><a class="reflnk" href="https://help.genesys.com/?q=Prompts" target="_blank" rel="noopener">Search docs for \\u201CPrompts\\u201D</a><a class="reflnk" href="https://www.genesys.com/pricing" target="_blank" rel="noopener">Licence requirements</a></div></div></div></div></div>';
  }

  /* ─── Wire into the router ───
     scripts.ts's own DYN9 router hook captures whatever
     window.renderPromptsFx *was* at definition time — reassigning
     it here would never be picked up. Same fix as elsewhere in this
     app: wrap window.openPage itself. */
  function mountPromptsPage() {
    var cnt = document.getElementById('cnt');
    if (cnt) cnt.innerHTML = renderPromptsPage();
  }

  function loadPromptsPage() {
    promptsLoadState = 'loading';
    mountPromptsPage();
    PromptsService.refresh().then(function() {
      promptsLoadState = 'ready';
      if (window.APP && window.APP.page === 'prompts') refreshPromptsTable();
    }).catch(function() {
      promptsLoadState = 'error';
      if (window.APP && window.APP.page === 'prompts') refreshPromptsTable();
    });
  }

  var prevOpenPageForPrompts = window.openPage;
  window.openPage = function(id) {
    if (id === 'prompts') {
      window.closeDrawer();
      window.restoreAdmin();
      window.navMark('admin');
      window.APP.page = 'prompts';
      loadPromptsPage();
      var links = document.querySelectorAll('#anav .lk');
      links.forEach(function(el) { el.classList.remove('on'); });
      for (var i = 0; i < links.length; i++) {
        var onclick = links[i].getAttribute('onclick') || '';
        if (onclick.indexOf("'prompts'") > -1) { links[i].classList.add('on'); break; }
      }
      window.scrollTo(0, 0);
      return;
    }
    return prevOpenPageForPrompts(id);
  };

  /* Handles a hard reload while already on the Prompts page (script
     re-runs, but window.openPage('prompts') is never re-invoked by
     anything else in that case). */
  function initPromptsIfActive() {
    if (window.APP && window.APP.page === 'prompts' && document.getElementById('cnt')) loadPromptsPage();
  }
  initPromptsIfActive();
  setTimeout(initPromptsIfActive, 100);
  setTimeout(initPromptsIfActive, 400);

})();
`;
