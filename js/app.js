/* ============================================================
   app.js - CCPD Home Treatment Record
   All data lives in this browser (localStorage). Nothing is
   sent anywhere; the only export paths are the PDF you share
   and the JSON backup you download.
   ============================================================ */
(function () {
  'use strict';

  var APP_VERSION = 'v4';      /* shown in the More menu, to identify a build */

  var KEY_PATIENT = 'ccpd.patient.v1';
  var KEY_ENTRIES = 'ccpd.entries.v1';
  var KEY_VIEW    = 'ccpd.view.v1';
  var KEY_SW_CLEARED = 'ccpd.swCleared';   /* session flag, guards a one-time reload */

  var BP_THRESHOLD = 130;          /* systolic at/above this -> 2.5% */

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

  /* ---------- tiny helpers ---------- */
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function uid() {
    if (global_crypto() && global_crypto().randomUUID) return global_crypto().randomUUID();
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function global_crypto() { return window.crypto; }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function todayISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function nowHM(d) {
    d = d || new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function prettyDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    if (p.length !== 3) return iso;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function prettyTime(t) {
    if (!t) return '';
    var p = t.split(':');
    if (p.length < 2) return t;
    var h = +p[0], ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + p[1] + ' ' + ap;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function has(v) { return v !== '' && v !== null && v !== undefined; }

  /* ---------- storage ---------- */
  var store = {
    read: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (err) { return fallback; }
    },
    write: function (key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (err) {
        toast('Could not save - device storage is full or blocked.');
        return false;
      }
    },
    remove: function (key) { try { localStorage.removeItem(key); } catch (err) {} }
  };

  /* ---------- app state ---------- */
  var state = {
    patient: store.read(KEY_PATIENT, { first: '', last: '', dob: '' }),
    entries: store.read(KEY_ENTRIES, []),
    view: store.read(KEY_VIEW, 'cards'),
    filterMonth: 'all',
    filterYear: 'all',
    /* wizard */
    draft: null,
    step: 1,
    editingId: null,
    dirty: false
  };

  /* ============================================================
     Domain rules
     ============================================================ */

  /** Which dextrose bag the BP calls for. Returns '' when no BP yet. */
  function autoDextrose(sys) {
    if (!has(sys) || isNaN(+sys)) return '';
    return (+sys >= BP_THRESHOLD) ? '2.5' : '1.5';
  }

  /** 1 = pre-dialysis only, 2 = drain pending, 3 = post pending, 4 = complete. */
  function stageOf(e) {
    var postDone = has(e.effluentClear) || has(e.totalUF) || has(e.postWt) ||
                   has(e.postHR) || has(e.postSys) || has(e.avgDwell);
    if (postDone) return 4;
    if (has(e.initialDrain)) return 3;
    if (has(e.dextrose)) return 2;
    return 1;
  }

  var STAGE_LABEL = { 1: 'Phase 1 done', 2: 'Phase 2 started', 3: 'Phase 3 open', 4: 'Complete' };

  function dexClass(d) {
    return d === '1.5' ? 'dex-15' : d === '2.5' ? 'dex-25' : d === 'ICO' ? 'dex-ico' : '';
  }
  function dexPill(d) {
    return d === '1.5' ? 'pill-15' : d === '2.5' ? 'pill-25' : d === 'ICO' ? 'pill-ico' : 'pill-phase';
  }
  function dexText(d) {
    return d === 'ICO' ? 'ICO' : d ? d + '%' : '--';
  }

  function sortEntries(list) {
    return list.slice().sort(function (a, b) {
      var ka = (a.date || '') + 'T' + (a.time || '00:00');
      var kb = (b.date || '') + 'T' + (b.time || '00:00');
      return ka < kb ? 1 : ka > kb ? -1 : 0;   /* newest first */
    });
  }
  function chronological(list) { return sortEntries(list).reverse(); }

  function filtered() {
    return sortEntries(state.entries).filter(function (e) {
      if (!e.date) return state.filterMonth === 'all' && state.filterYear === 'all';
      var p = e.date.split('-');
      if (state.filterYear !== 'all' && p[0] !== state.filterYear) return false;
      if (state.filterMonth !== 'all' && p[1] !== state.filterMonth) return false;
      return true;
    });
  }

  function periodLabel() {
    var m = state.filterMonth, y = state.filterYear;
    if (m === 'all' && y === 'all') return 'Complete record';
    if (m === 'all') return 'Year ' + y;
    if (y === 'all') return MONTHS[+m - 1] + ' (all years)';
    return MONTHS[+m - 1] + ' ' + y;
  }

  /* ============================================================
     Rendering
     ============================================================ */

  function renderPatientChip() {
    var p = state.patient;
    var name = [p.first, p.last].filter(Boolean).join(' ');
    $('#patientChipName').textContent = name
      ? name + (p.dob ? '  ·  DOB ' + p.dob : '')
      : 'Set patient';
  }

  function renderFilters() {
    var mSel = $('#filterMonth'), ySel = $('#filterYear');
    if (!mSel.options.length) {
      mSel.appendChild(new Option('All', 'all'));
      MONTHS.forEach(function (m, i) { mSel.appendChild(new Option(m, pad(i + 1))); });
    }
    var years = {};
    state.entries.forEach(function (e) { if (e.date) years[e.date.slice(0, 4)] = 1; });
    var list = Object.keys(years).sort().reverse();
    var current = new Date().getFullYear().toString();
    if (list.indexOf(current) === -1) list.unshift(current);

    var prev = ySel.value;
    ySel.innerHTML = '';
    ySel.appendChild(new Option('All', 'all'));
    list.forEach(function (y) { ySel.appendChild(new Option(y, y)); });
    ySel.value = (prev && (prev === 'all' || list.indexOf(prev) > -1)) ? prev : state.filterYear;
    state.filterYear = ySel.value;
    mSel.value = state.filterMonth;
  }

  function renderSummary(rows) {
    var complete = 0, ico = 0, cloudy = 0, uf = 0, ufN = 0;
    rows.forEach(function (e) {
      if (stageOf(e) === 4) complete++;
      if (e.dextrose === 'ICO') ico++;
      if (e.effluentClear === 'N') cloudy++;
      if (has(e.totalUF) && !isNaN(+e.totalUF)) { uf += +e.totalUF; ufN++; }
    });
    var html =
      stat(rows.length, 'Treatments') +
      stat(complete, 'Complete') +
      stat(ufN ? Math.round(uf / ufN) + ' mL' : '--', 'Avg total UF') +
      (cloudy ? stat(cloudy, 'Cloudy effluent') : '') +
      (ico ? stat(ico, 'ICO days') : '');
    $('#summary').innerHTML = rows.length ? html : '';
  }
  function stat(v, label) {
    return '<div class="stat"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>';
  }

  function renderCards(rows) {
    var box = $('#cardsView');
    if (!rows.length) {
      box.innerHTML = '<div class="empty"><p><strong>No treatments logged for this period.</strong></p>' +
        '<p>Tap the <strong>+</strong> button to start a new record.</p></div>';
      return;
    }
    box.innerHTML = rows.map(function (e) {
      var stage = stageOf(e);
      var cells = [
        cell('Pre BP', bpText(e.preSys, e.preDia)),
        cell('Pre Wt', has(e.preWt) ? e.preWt + ' kg' : '--'),
        cell('Initial drain', has(e.initialDrain) ? e.initialDrain + ' mL' : '--'),
        cell('Total UF', has(e.totalUF) ? e.totalUF + ' mL' : '--'),
        cell('Clear?', e.effluentClear === 'Y' ? 'Yes' : e.effluentClear === 'N' ? 'No' : '--'),
        cell('Post Wt', has(e.postWt) ? e.postWt + ' kg' : '--')
      ].join('');
      return '<button class="card ' + dexClass(e.dextrose) + '" type="button" data-id="' + esc(e.id) + '">' +
          '<div class="card-top">' +
            '<span class="card-date">' + esc(prettyDate(e.date)) + '</span>' +
            '<span class="card-time">' + esc(prettyTime(e.time)) + '</span>' +
            '<span class="spacer"></span>' +
            '<span class="pill ' + dexPill(e.dextrose) + '">' + esc(dexText(e.dextrose)) + '</span>' +
            '<span class="pill ' + (stage === 4 ? 'pill-done' : 'pill-phase') + '">' + STAGE_LABEL[stage] + '</span>' +
          '</div>' +
          (e.dextrose === 'ICO'
            ? '<p class="card-ico">ICO - patient needs a hospital ASAP.</p>' : '') +
          '<div class="card-grid">' + cells + '</div>' +
          (e.comments ? '<p class="card-comment">' + esc(e.comments) + '</p>' : '') +
        '</button>';
    }).join('');
  }
  function cell(label, value) {
    return '<div><b>' + esc(label) + '</b>' + esc(value) + '</div>';
  }
  function bpText(s, d) {
    return (has(s) || has(d)) ? (has(s) ? s : '?') + '/' + (has(d) ? d : '?') : '--';
  }

  function renderTable(rows) {
    var body = $('#tableBody');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="16" style="padding:28px;color:#5b6872">No treatments logged for this period.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (e) {
      var dcls = e.dextrose === '1.5' ? 'd15' : e.dextrose === '2.5' ? 'd25' : e.dextrose === 'ICO' ? 'dico' : '';
      return '<tr data-id="' + esc(e.id) + '">' +
        td(e.date) + td(prettyTime(e.time)) + td(e.preWt) + td(e.preHR) +
        td(bpText(e.preSys, e.preDia)) + td(e.preTemp) +
        '<td class="dex-cell ' + dcls + '">' + esc(dexText(e.dextrose)) + '</td>' +
        td(e.initialDrain) + td(e.effluentClear || '') + td(e.totalUF) +
        td(e.avgDwell) + td(e.lostDwell) + td(e.postHR) +
        td(bpText(e.postSys, e.postDia)) + td(e.postWt) +
        '<td class="c-comment">' + esc(e.comments || '') + '</td>' +
      '</tr>';
    }).join('');
  }
  function td(v) { return '<td>' + esc(has(v) ? v : '') + '</td>'; }

  function render() {
    renderPatientChip();
    renderFilters();
    var rows = filtered();
    renderSummary(rows);
    var cards = state.view === 'cards';
    $('#cardsView').hidden = !cards;
    $('#tableView').hidden = cards;
    $$('.view-toggle button').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.view === state.view);
    });
    if (cards) renderCards(rows); else renderTable(rows);
  }

  /* ============================================================
     Entry wizard
     ============================================================ */

  var form = $('#entryForm');

  function blankEntry() {
    return {
      id: uid(), date: todayISO(), time: nowHM(),
      preWt: '', preHR: '', preSys: '', preDia: '', preTemp: '',
      dextrose: '', dexManual: false, initialDrain: '',
      effluentClear: '', totalUF: '', avgDwell: '', lostDwell: '',
      postHR: '', postSys: '', postDia: '', postWt: '', comments: '',
      createdAt: new Date().toISOString()
    };
  }

  function readForm() {
    var d = state.draft;
    var fd = new FormData(form);
    ['date', 'time', 'preWt', 'preHR', 'preSys', 'preDia', 'preTemp',
     'initialDrain', 'totalUF', 'avgDwell', 'lostDwell',
     'postHR', 'postSys', 'postDia', 'postWt', 'comments'].forEach(function (k) {
      d[k] = (fd.get(k) || '').toString().trim();
    });
    d.dextrose = (fd.get('dextrose') || '').toString();
    d.effluentClear = (fd.get('effluentClear') || '').toString();
    return d;
  }

  function fillForm(e) {
    Object.keys(e).forEach(function (k) {
      var field = form.elements[k];
      if (!field) return;
      if (field.length && field[0] && field[0].type === 'radio') {
        $$('input[name="' + k + '"]', form).forEach(function (r) { r.checked = (r.value === e[k]); });
      } else if (field.type === 'radio') {
        field.checked = (field.value === e[k]);
      } else {
        field.value = e[k] == null ? '' : e[k];
      }
    });
  }

  function openEntry(id) {
    var existing = id && state.entries.filter(function (e) { return e.id === id; })[0];
    state.editingId = existing ? id : null;
    state.draft = existing ? Object.assign(blankEntry(), existing) : blankEntry();
    state.dirty = false;
    $('#entryTitle').textContent = existing ? 'Edit Treatment' : 'New Treatment';
    $('#btnDelete').hidden = !existing;
    fillForm(state.draft);
    /* resume an in-progress record at the phase that still needs work */
    var stage = existing ? stageOf(state.draft) : 1;
    goStep(existing ? Math.min(stage === 4 ? 3 : stage, 3) : 1);
    applyDextroseAuto();
    syncPhase3Lock();
    showModal($('#entryModal'));
  }

  function goStep(n) {
    state.step = Math.max(1, Math.min(3, n));
    $$('.phase', form).forEach(function (fs) {
      fs.classList.toggle('is-current', +fs.dataset.phase === state.step);
    });
    $$('#steps li').forEach(function (li) {
      var s = +li.dataset.step;
      li.classList.toggle('is-active', s === state.step);
      li.classList.toggle('is-done', s < state.step);
      li.classList.toggle('is-locked', s === 3 && !has(state.draft.initialDrain));
    });
    $('#btnBack').disabled = state.step === 1;
    $('#btnNext').hidden = state.step === 3;
    $('#btnSave').hidden = false;
    $('#btnSave').textContent = state.step === 3 ? 'Save' : 'Save & close';
    $('#btnSave').className = 'btn ' + (state.step === 3 ? 'btn-primary' : 'btn-ghost');
    hideError();
    $('.sheet-body').scrollTop = 0;
  }

  /** Pick the bag from BP unless the user has overridden it by hand. */
  function applyDextroseAuto() {
    var d = state.draft;
    var sys = (form.elements.preSys.value || '').trim();
    var auto = autoDextrose(sys);
    var note = $('#autoPickNote');

    if (!d.dexManual) {
      if (auto) {
        d.dextrose = auto;
        $$('input[name="dextrose"]', form).forEach(function (r) { r.checked = (r.value === auto); });
      }
    }
    var chosen = (new FormData(form).get('dextrose') || '').toString();

    if (d.dexManual) {
      note.innerHTML = 'Chosen by hand: <strong>' + esc(dexText(chosen)) + '</strong>. ' +
        '<button type="button" class="linkish" id="btnAuto">Use the BP recommendation</button>';
      var btn = $('#btnAuto');
      if (btn) btn.addEventListener('click', function () {
        state.draft.dexManual = false;
        applyDextroseAuto();
        markDirty();
      });
    } else if (auto) {
      note.innerHTML = 'Auto-selected <strong>' + esc(dexText(auto)) + '</strong> - pre-dialysis BP ' +
        esc(sys) + ' is ' + (auto === '2.5' ? '130 or higher' : 'under 130') + '.';
    } else {
      note.innerHTML = 'Enter a pre-dialysis systolic BP in Phase 1 and the bag is chosen for you ' +
        '(under 130 &rarr; 1.5%, 130 or higher &rarr; 2.5%).';
    }

    $('#icoAlert').hidden = chosen !== 'ICO';
    var hint = $('#bpHint');
    if (auto) {
      hint.textContent = 'BP ' + sys + ' selects the ' + dexText(auto) + ' bag in Phase 2.';
    } else {
      hint.textContent = '';
    }
  }

  /** Phase 3 stays read-only until an initial drain is recorded. */
  function syncPhase3Lock() {
    var unlocked = has((form.elements.initialDrain.value || '').trim());
    var fs = $('.phase[data-phase="3"]', form);
    fs.classList.toggle('is-unlocked', unlocked);
    $$('#phase3Grid input, #phase3Grid textarea', form).forEach(function (el) {
      el.disabled = !unlocked;
    });
    $$('#steps li').forEach(function (li) {
      if (+li.dataset.step === 3) li.classList.toggle('is-locked', !unlocked);
    });
  }

  function markDirty() { state.dirty = true; }

  function showError(msg) {
    var el = $('#formError');
    el.textContent = msg;
    el.hidden = false;
  }
  function hideError() { $('#formError').hidden = true; }

  function validate() {
    var d = readForm();
    if (!d.date) { goStep(1); showError('A date is required.'); return false; }
    if (!d.time) { goStep(1); showError('A time is required.'); return false; }
    var ranges = [
      ['preSys', 50, 300, 'Pre-dialysis systolic BP'],
      ['preDia', 20, 200, 'Pre-dialysis diastolic BP'],
      ['postSys', 50, 300, 'Post-dialysis systolic BP'],
      ['postDia', 20, 200, 'Post-dialysis diastolic BP'],
      ['preHR', 20, 250, 'Pre-dialysis heart rate'],
      ['postHR', 20, 250, 'Post-dialysis heart rate']
    ];
    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i], v = d[r[0]];
      if (has(v) && (isNaN(+v) || +v < r[1] || +v > r[2])) {
        showError(r[3] + ' looks out of range (' + r[1] + '-' + r[2] + '). Please check it.');
        goStep(r[0].indexOf('pre') === 0 && r[0] !== 'preTemp' ? 1 : 3);
        return false;
      }
    }
    return true;
  }

  function saveEntry() {
    if (!validate()) return;
    var d = readForm();
    d.updatedAt = new Date().toISOString();
    if (state.editingId) {
      state.entries = state.entries.map(function (e) { return e.id === state.editingId ? d : e; });
    } else {
      state.entries.push(d);
    }
    store.write(KEY_ENTRIES, state.entries);
    state.dirty = false;
    closeModal($('#entryModal'));
    render();
    toast(state.editingId ? 'Treatment updated.' : 'Treatment saved.');
    state.editingId = null;
  }

  function deleteEntry() {
    if (!state.editingId) return;
    if (!confirm('Delete this treatment record? This cannot be undone.')) return;
    state.entries = state.entries.filter(function (e) { return e.id !== state.editingId; });
    store.write(KEY_ENTRIES, state.entries);
    state.editingId = null;
    state.dirty = false;
    closeModal($('#entryModal'));
    render();
    toast('Treatment deleted.');
  }

  /* ============================================================
     Patient label
     ============================================================ */

  function openPatient() {
    var f = $('#patientForm');
    f.elements.first.value = state.patient.first || '';
    f.elements.last.value = state.patient.last || '';
    f.elements.dob.value = state.patient.dob || '';
    $('#patientError').hidden = true;
    showModal($('#patientModal'));
  }

  function savePatient() {
    var f = $('#patientForm');
    var first = f.elements.first.value.trim();
    var last = f.elements.last.value.trim();
    var err = $('#patientError');

    if (!first || !last) {
      err.textContent = 'Enter both a first and last name, or close this without saving.';
      err.hidden = false;
      (first ? f.elements.last : f.elements.first).focus();
      return;
    }
    err.hidden = true;
    state.patient = { first: first, last: last, dob: f.elements.dob.value };
    store.write(KEY_PATIENT, state.patient);
    closeModal($('#patientModal'));
    render();
    toast('Patient label saved.');
  }

  /* ============================================================
     Modals & toast
     ============================================================ */

  var lastFocus = null;

  function showModal(m) {
    lastFocus = document.activeElement;
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    var first = m.querySelector('input, select, textarea, button');
    if (first) setTimeout(function () { first.focus(); }, 30);
  }
  function closeModal(m) {
    m.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
  }

  /* ============================================================
     PDF share / download
     ============================================================ */

  function fileName(scope) {
    var p = state.patient;
    var who = [p.last, p.first].filter(Boolean).join('-').replace(/[^A-Za-z0-9-]/g, '') || 'patient';
    var when = scope.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    return 'ccpd-record-' + who + '-' + when + '.pdf';
  }

  function makePdf(rows, label) {
    return buildRecordPdf({
      patient: state.patient,
      entries: chronological(rows),
      periodLabel: label
    });
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function sharePdf(scope) {
    var rows = scope === 'month' ? filtered() : sortEntries(state.entries);
    var label = scope === 'month' ? periodLabel() : 'Complete record';

    if (!rows.length) { toast('Nothing to share yet - log a treatment first.'); return; }

    var doc, blob;
    try {
      doc = makePdf(rows, label);
      blob = doc.blob();
    } catch (err) {
      toast('Could not build the PDF.');
      return;
    }

    var name = fileName(label);
    var p = state.patient;
    var who = [p.first, p.last].filter(Boolean).join(' ') || 'Patient';
    var text = 'CCPD Home Treatment Record - ' + who + ' - ' + label +
               ' (' + rows.length + ' treatment' + (rows.length === 1 ? '' : 's') + ').';

    var file = null;
    try {
      file = new File([blob], name, { type: 'application/pdf' });
    } catch (err) { /* older browsers: no File constructor */ }

    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      navigator.share({ files: [file], title: 'CCPD Treatment Record', text: text })
        .then(function () { toast('Shared.'); })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          downloadBlob(blob, name);
          toast('Sharing unavailable - PDF downloaded instead.');
        });
    } else {
      downloadBlob(blob, name);
      toast('PDF downloaded.');
    }
  }

  /* ============================================================
     Backup / restore
     ============================================================ */

  function exportJson() {
    var payload = {
      app: 'ccpd-home-treatment-record',
      version: 1,
      exportedAt: new Date().toISOString(),
      patient: state.patient,
      entries: state.entries
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'ccpd-backup-' + todayISO() + '.json');
    toast('Backup downloaded.');
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); }
      catch (err) { toast('That file is not a valid backup.'); return; }
      if (!data || !Array.isArray(data.entries)) { toast('That file is not a valid backup.'); return; }
      if (!confirm('Import ' + data.entries.length + ' treatment record(s)? Existing records with the same id are replaced.')) return;

      var byId = {};
      state.entries.forEach(function (e) { byId[e.id] = e; });
      data.entries.forEach(function (e) {
        if (!e || typeof e !== 'object') return;
        if (!e.id) e.id = uid();
        byId[e.id] = Object.assign(blankEntry(), e);
      });
      state.entries = Object.keys(byId).map(function (k) { return byId[k]; });
      if (data.patient && (data.patient.first || data.patient.last)) {
        state.patient = Object.assign({ first: '', last: '', dob: '' }, data.patient);
        store.write(KEY_PATIENT, state.patient);
      }
      store.write(KEY_ENTRIES, state.entries);
      render();
      toast('Backup imported.');
    };
    reader.readAsText(file);
  }

  function wipe() {
    if (!confirm('Erase the patient label and every treatment record stored on this device?')) return;
    if (!confirm('This is permanent and cannot be undone. Erase everything?')) return;
    store.remove(KEY_ENTRIES);
    store.remove(KEY_PATIENT);
    state.entries = [];
    state.patient = { first: '', last: '', dob: '' };
    render();
    toast('All data erased.');
  }

  /* ============================================================
     Wiring
     ============================================================ */

  function bind() {
    /* view + filters */
    $$('.view-toggle button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.view = b.dataset.view;
        store.write(KEY_VIEW, state.view);
        render();
      });
    });
    $('#filterMonth').addEventListener('change', function (e) { state.filterMonth = e.target.value; render(); });
    $('#filterYear').addEventListener('change', function (e) { state.filterYear = e.target.value; render(); });

    /* open entries */
    $('#cardsView').addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      if (card) openEntry(card.dataset.id);
    });
    $('#tableBody').addEventListener('click', function (e) {
      var row = e.target.closest('tr[data-id]');
      if (row) openEntry(row.dataset.id);
    });
    $('#btnNew').addEventListener('click', function () { openEntry(null); });

    /* wizard nav */
    $('#btnNext').addEventListener('click', function () {
      readForm();
      if (state.step === 1) {
        if (!form.elements.date.value || !form.elements.time.value) {
          showError('Enter the date and time before moving on.');
          return;
        }
        applyDextroseAuto();
      }
      if (state.step === 2) syncPhase3Lock();
      goStep(state.step + 1);
    });
    $('#btnBack').addEventListener('click', function () { readForm(); goStep(state.step - 1); });
    $('#btnSave').addEventListener('click', saveEntry);
    $('#btnDelete').addEventListener('click', deleteEntry);

    /* live rules */
    form.addEventListener('input', function (e) {
      markDirty();
      if (e.target.name === 'preSys') applyDextroseAuto();
      if (e.target.name === 'initialDrain') syncPhase3Lock();
    });
    form.addEventListener('change', function (e) {
      markDirty();
      if (e.target.name === 'dextrose') {
        state.draft.dexManual = true;
        state.draft.dextrose = e.target.value;
        applyDextroseAuto();
      }
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); saveEntry(); });

    /* modals */
    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = b.closest('.modal');
        if (m.id === 'entryModal' && state.dirty &&
            !confirm('Discard the changes to this treatment?')) return;
        state.dirty = false;
        closeModal(m);
      });
    });
    /* Tapping the backdrop closes the patient sheet; the entry sheet stays put
       so a half-filled treatment is never lost to a stray tap. */
    $('#patientModal').addEventListener('click', function (e) {
      if (e.target === this) closeModal(this);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var open = $$('.modal').filter(function (m) { return !m.hidden; })[0];
      if (!open) { $('#menu').hidden = true; return; }
      if (open.id === 'entryModal' && state.dirty && !confirm('Discard the changes to this treatment?')) return;
      state.dirty = false;
      closeModal(open);
    });

    /* patient */
    $('#patientChip').addEventListener('click', openPatient);
    $('#btnPatientSave').addEventListener('click', savePatient);
    /* Enter inside the form saves it - without this the browser submits the
       form for real, reloading the page and losing what was typed. */
    $('#patientForm').addEventListener('submit', function (e) {
      e.preventDefault();
      savePatient();
    });

    /* share + menu */
    $('#btnShare').addEventListener('click', function () { sharePdf('all'); });
    $('#btnMenu').addEventListener('click', function (e) {
      e.stopPropagation();
      var m = $('#menu');
      m.hidden = !m.hidden;
      $('#btnMenu').setAttribute('aria-expanded', String(!m.hidden));
    });
    document.addEventListener('click', function () { $('#menu').hidden = true; });
    $('#menu').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-action]');
      if (!b) return;
      $('#menu').hidden = true;
      switch (b.dataset.action) {
        case 'shareMonth': sharePdf('month'); break;
        case 'print':      window.print(); break;
        case 'export':     exportJson(); break;
        case 'import':     $('#importFile').click(); break;
        case 'install':    promptInstall(); break;
        case 'wipe':       wipe(); break;
      }
    });
    $('#importFile').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) importJson(e.target.files[0]);
      e.target.value = '';
    });

    window.addEventListener('beforeunload', function (e) {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  /* ---------- install prompt ---------- */
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    $('#menuInstall').hidden = false;
  });
  function promptInstall() {
    if (!deferredPrompt) { toast('Use your browser menu: "Add to Home Screen".'); return; }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () {
      deferredPrompt = null;
      $('#menuInstall').hidden = true;
    });
  }

  /* ---------- offline support (production only) ---------- */

  /** Live Server, `node serve.js`, a phone on the LAN, or a file:// page. */
  function isDevHost() {
    var h = location.hostname;
    return location.protocol === 'file:' ||
           h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' ||
           /\.local$/i.test(h) ||
           /^192\.168\./.test(h) ||
           /^10\./.test(h) ||
           /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  }

  /** Unregister any service worker and drop its caches, then reload once if a
      stale worker was still controlling this page. */
  function clearOfflineCaches(tag) {
    var jobs = [];

    if ('serviceWorker' in navigator) {
      jobs.push(
        navigator.serviceWorker.getRegistrations()
          .then(function (regs) {
            if (regs.length) console.log(tag + ' removing ' + regs.length + ' service worker(s)');
            return Promise.all(regs.map(function (r) { return r.unregister(); }));
          })
          .catch(function () {})
      );
    }
    if (window.caches && caches.keys) {
      jobs.push(
        caches.keys()
          .then(function (keys) {
            if (keys.length) console.log(tag + ' clearing caches: ' + keys.join(', '));
            return Promise.all(keys.map(function (k) { return caches.delete(k); }));
          })
          .catch(function () {})
      );
    }

    return Promise.all(jobs).then(function () {
      var controlled = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
      var alreadyReloaded;
      try { alreadyReloaded = sessionStorage.getItem(KEY_SW_CLEARED); } catch (err) { alreadyReloaded = '1'; }
      if (controlled && !alreadyReloaded) {
        try { sessionStorage.setItem(KEY_SW_CLEARED, '1'); } catch (err) {}
        console.log(tag + ' a stale worker was in control - reloading once for fresh files');
        location.reload();
      }
    });
  }

  /* ---------- boot ---------- */
  function init() {
    bind();
    render();
    $('#menuVersion').textContent = 'Version ' + APP_VERSION +
      (isDevHost() ? ' - dev, caching off' : '');
    if (!state.patient.first && !state.patient.last) {
      setTimeout(function () {
        if (!state.patient.first && !state.patient.last) openPatient();
      }, 400);
    }
    console.log('CCPD Home Treatment Record ' + APP_VERSION +
                ' (' + location.protocol + '//' + location.host + ', ' +
                (isDevHost() ? 'development - no caching' : 'production') + ')');

    if (location.protocol === 'file:') {
      toast('Open this through a web address, not the file itself - saving is blocked on file:// pages.');
    }

    /* Nothing is cached while developing: a service worker sitting in front of
       Live Server would keep serving yesterday's app.js and quietly undo edits.
       Any worker left over from an earlier run is removed here too. */
    if (isDevHost()) {
      clearOfflineCaches('[dev]');
      return;
    }

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        /* updateViaCache:'none' keeps the browser's HTTP cache from pinning an
           old sw.js, so a new deploy is actually noticed. */
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
          .then(function (reg) {
            reg.update();
            /* A newer worker means newer code: take it and reload once. */
            reg.addEventListener('updatefound', function () {
              var sw = reg.installing;
              if (!sw) return;
              sw.addEventListener('statechange', function () {
                if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                  sw.postMessage('skip-waiting');
                }
              });
            });
          })
          .catch(function () { /* offline support is optional */ });

        var reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          if (reloaded) return;
          reloaded = true;
          location.reload();
        });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
