/* =====================================================================
   ACTOM Apprenticeship Portal — form setup (admin)

   Editing model, deliberately blunt:
     draft  → fully editable
     open   → frozen. Only the closing date and closing message move.
     closed → frozen.

   To change a published form you clone it. The original stays exactly as
   its applicants experienced it, which is what makes a shortlisting
   decision defensible six months later.

   The lock is enforced by database triggers. Everything this file does
   with disabled inputs is courtesy, not security.
   ===================================================================== */
(function () {
  'use strict';

  var FS = { intakes: [], intake: null, trades: [], subjects: [],
             itrades: [], its: [], idocs: [], trade: null, dirty: false };

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var sb, content, toast;
  window.ACTOM_FORMSETUP = {
    init: function (client, contentEl, toastFn) {
      sb = client; content = contentEl; toast = toastFn;
    },
    load: loadIntakes
  };

  function locked() { return !FS.intake || FS.intake.status !== 'draft'; }
  function dis() { return locked() ? ' disabled' : ''; }

  /* ------------------------------------------------------- intake list */
  function loadIntakes() {
    FS.intake = null; FS.trade = null;
    Promise.all([
      sb.from('intakes').select('*').order('created_at', { ascending: false }),
      sb.from('trades').select('*').order('sort_order'),
      sb.from('subjects').select('*').eq('active', true).order('sort_order')
    ]).then(function (r) {
      if (r[0].error) { content.innerHTML = err(r[0].error.message); return; }
      FS.intakes = r[0].data || [];
      FS.trades = r[1].data || [];
      FS.subjects = r[2].data || [];
      renderIntakeList();
    });
  }

  function err(m) {
    return '<div class="notice notice-err"><strong>Could not load</strong>' + esc(m) + '</div>';
  }

  function statusTag(s) {
    var map = { draft: 'tag-draft', open: 'tag-shortlisted', closed: 'tag-withdrawn', archived: 'tag-draft' };
    var label = { draft: 'draft — editable', open: 'open — locked',
                  closed: 'closed — locked', archived: 'archived' }[s] || s;
    return '<span class="tag ' + (map[s] || '') + '">' + esc(label) + '</span>';
  }

  function renderIntakeList() {
    content.innerHTML =
      '<div class="card"><div class="card-head"><div class="eyebrow">Form setup</div>' +
      '<h2>Intakes</h2><p>An intake holds one version of the application form. ' +
      'Once you publish it, the form is frozen — clone it to build the next one.</p></div>' +

      '<div style="overflow-x:auto"><table class="data"><thead><tr>' +
      '<th>Name</th><th>Opens</th><th>Closes</th><th>Trades</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' +
      (FS.intakes.length ? FS.intakes.map(function (i) {
        return '<tr><td>' + esc(i.name) + '</td>' +
          '<td class="small">' + new Date(i.opens_at).toLocaleDateString('en-ZA') + '</td>' +
          '<td class="small">' + new Date(i.closes_at).toLocaleDateString('en-ZA') + '</td>' +
          '<td class="small" data-count="' + esc(i.id) + '">—</td>' +
          '<td>' + statusTag(i.status) + '</td>' +
          '<td><button class="btn btn-ghost btn-sm" data-edit="' + esc(i.id) + '">' +
          (i.status === 'draft' ? 'Edit' : 'View') + '</button>' +
          '<button class="btn btn-ghost btn-sm" data-clone="' + esc(i.id) + '" ' +
          'style="margin-left:.3rem">Clone</button></td></tr>';
      }).join('') : '<tr><td colspan="6" class="center muted" style="padding:1.5rem">' +
        'No intakes yet.</td></tr>') +
      '</tbody></table></div>' +
      '<div class="btn-row"><button class="btn" id="newIntakeBtn">New intake</button></div></div>';

    sb.from('intake_trades').select('intake_id,active').then(function (r) {
      var c = {};
      (r.data || []).forEach(function (t) { if (t.active) c[t.intake_id] = (c[t.intake_id] || 0) + 1; });
      Object.keys(c).forEach(function (k) {
        var el = content.querySelector('[data-count="' + k + '"]');
        if (el) el.textContent = c[k];
      });
    });

    content.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () { openIntake(b.dataset.edit); });
    });
    content.querySelectorAll('[data-clone]').forEach(function (b) {
      b.addEventListener('click', function () {
        var name = prompt('Name for the new intake', 'Apprenticeship Intake ' +
                          (new Date().getFullYear() + 1));
        if (!name) return;
        sb.rpc('clone_intake', { p_intake: b.dataset.clone, p_name: name })
          .then(function (r) {
            if (r.error) return alert(r.error.message);
            toast('Cloned as a new draft');
            openIntake(r.data);
          });
      });
    });
    $('newIntakeBtn').addEventListener('click', function () {
      if (!FS.intakes.length) {
        return alert('Create the first intake in SQL, then clone it here.');
      }
      var name = prompt('Name for the new intake', 'Apprenticeship Intake ' +
                        (new Date().getFullYear() + 1));
      if (!name) return;
      sb.rpc('clone_intake', { p_intake: FS.intakes[0].id, p_name: name })
        .then(function (r) {
          if (r.error) return alert(r.error.message);
          toast('Created from the most recent intake');
          openIntake(r.data);
        });
    });
  }

  /* ------------------------------------------------------ intake editor */
  function openIntake(id) {
    Promise.all([
      sb.from('intakes').select('*').eq('id', id).single(),
      sb.from('intake_trades').select('*').eq('intake_id', id),
      sb.from('intake_trade_subjects').select('*').eq('intake_id', id),
      sb.from('intake_documents').select('*').eq('intake_id', id).order('sort_order')
    ]).then(function (r) {
      if (r[0].error) { content.innerHTML = err(r[0].error.message); return; }
      FS.intake = r[0].data;
      FS.itrades = r[1].data || [];
      FS.its = r[2].data || [];
      FS.idocs = r[3].data || [];
      FS.trade = null;
      renderEditor();
    });
  }

  function renderEditor() {
    var i = FS.intake;
    var isDraft = i.status === 'draft';

    content.innerHTML =
      '<div class="btn-row" style="margin-top:0">' +
      '<button class="btn btn-ghost btn-sm" id="backList">Back to intakes</button>' +
      '<span class="spacer"></span>' + statusTag(i.status) + '</div>' +

      (isDraft
        ? '<div class="notice"><strong>This intake is a draft</strong>' +
          'Applicants cannot see it. Publishing opens it and freezes the form.</div>'
        : '<div class="notice notice-warn"><strong>This form is locked</strong>' +
          'It was published on ' + new Date(i.published_at || i.opens_at).toLocaleDateString('en-ZA') +
          '. Applications are in progress against these exact rules, so the form can no longer change. ' +
          'Clone it to build the next intake. Only the closing date and closing message are still editable.</div>') +

      '<div class="card"><div class="card-head"><div class="eyebrow">Basics</div>' +
      '<h2>' + esc(i.name) + '</h2></div>' +
      '<div class="grid grid-2">' +
      fld('Name', '<input type="text" id="f_name" value="' + esc(i.name) + '"' + dis() + '>') +
      fld('Consent wording version',
          '<input type="text" id="f_consent" value="' + esc(i.consent_version) + '"' + dis() + '>') +
      '</div><div class="grid grid-3">' +
      fld('Opens', '<input type="date" id="f_opens" value="' +
          String(i.opens_at).slice(0, 10) + '"' + dis() + '>') +
      fld('Closes', '<input type="date" id="f_closes" value="' +
          String(i.closes_at).slice(0, 10) + '">') +
      fld('Keep applications for',
          '<input type="number" id="f_retention" min="1" max="60" value="' +
          esc(i.retention_months) + '"' + dis() + '>') +
      '</div>' +
      '<p class="hint" style="margin-top:-.4rem">Months after closing, then applications and their ' +
      'documents are deleted automatically.</p>' +

      '<div class="grid grid-2">' +
      fld('Maximum upload size (MB)',
          '<input type="number" id="f_upload" min="1" max="20" value="' +
          esc(i.max_upload_mb) + '"' + dis() + '>') +
      fld('Steps shown',
          '<label class="choice"><input type="checkbox" id="f_further"' +
          (i.show_further_study ? ' checked' : '') + dis() + '>' +
          '<span class="choice-body"><strong>Further qualifications step</strong></span></label>' +
          '<label class="choice"><input type="checkbox" id="f_technical"' +
          (i.show_technical ? ' checked' : '') + dis() + '>' +
          '<span class="choice-body"><strong>Technical subjects block</strong></span></label>') +
      '</div>' +

      fld('Message at the top of the form (optional)',
          '<input type="text" id="f_introh" placeholder="Heading" value="' +
          esc(i.intro_heading) + '"' + dis() + '>' +
          '<textarea id="f_introb" placeholder="Body" style="margin-top:.4rem"' + dis() + '>' +
          esc(i.intro_body) + '</textarea>') +

      fld('Scoring',
          '<label class="choice"><input type="checkbox" id="f_scoring"' +
          (i.scoring_enabled ? ' checked' : '') + dis() + '>' +
          '<span class="choice-body"><strong>Score and rank applications automatically</strong>' +
          '<span>Weighted average of the subject marks you set below.</span></span></label>' +
          '<label class="choice"><input type="checkbox" id="f_flag"' +
          (i.auto_flag_below ? ' checked' : '') + dis() + '>' +
          '<span class="choice-body"><strong>Flag applications below the minimums</strong>' +
          '<span>Flags are advisory. Nothing is auto-declined.</span></span></label>') +

      '<div class="btn-row">' +
      (isDraft ? '<button class="btn" id="saveBasics">Save</button>' : '') +
      (isDraft ? '' : '<button class="btn btn-ghost" id="saveDates">Save closing date</button>') +
      '<span class="spacer"></span>' +
      (isDraft ? '<button class="btn" id="publishBtn" style="background:var(--ok)">Publish intake</button>' : '') +
      (i.status === 'open' ? '<button class="btn btn-danger" id="closeBtn">Close intake</button>' : '') +
      '</div>' +
      '<div id="publishProblems"></div></div>' +

      tradesCard() + docsCard() + subjectsCard() + journeyCard();

    wireEditor();
    wireJourney();
  }

  function fld(label, inner) {
    return '<div class="field"><span class="field-label">' + esc(label) + '</span>' + inner + '</div>';
  }

  /* ----------------------------------------------------------- trades */
  function tradesCard() {
    return '<div class="card"><div class="card-head"><div class="eyebrow">Trades</div>' +
      '<h2>Which trades this intake accepts</h2>' +
      '<p>Switch a trade on, set how many positions there are, and optionally a minimum ' +
      'overall score. Applicants only see the ones switched on.</p></div>' +
      '<div style="overflow-x:auto"><table class="data"><thead><tr>' +
      '<th style="width:70px">On</th><th>Trade</th><th style="width:100px">Positions</th>' +
      '<th style="width:110px">Min score</th><th style="width:110px">Subjects</th><th></th>' +
      '</tr></thead><tbody>' +
      FS.trades.map(function (t) {
        var it = FS.itrades.filter(function (x) { return x.trade_id === t.id; })[0] || {};
        var n = FS.its.filter(function (x) { return x.trade_id === t.id; }).length;
        return '<tr data-trade="' + esc(t.id) + '">' +
          '<td><input type="checkbox" data-f="active"' + (it.active ? ' checked' : '') + dis() + '></td>' +
          '<td>' + esc(t.name) + '</td>' +
          '<td><input type="number" data-f="positions" min="0" max="99" style="padding:.3rem" value="' +
          (it.positions == null ? '' : esc(it.positions)) + '"' + dis() + '></td>' +
          '<td><input type="number" data-f="min_score" min="0" max="100" style="padding:.3rem" value="' +
          (it.min_score == null ? '' : esc(it.min_score)) + '"' + dis() + '></td>' +
          '<td>' + (n ? n + ' set' : '<span class="tag tag-under_review">none</span>') + '</td>' +
          '<td><button class="btn btn-ghost btn-sm" data-subjects="' + esc(t.id) + '">Subjects</button></td>' +
          '</tr>';
      }).join('') +
      '</tbody></table></div>' +
      (locked() ? '' : '<div class="btn-row"><button class="btn" id="saveTrades">Save trades</button></div>') +
      '</div>';
  }

  /* -------------------------------------------------------- documents */
  function docsCard() {
    return '<div class="card"><div class="card-head"><div class="eyebrow">Documents</div>' +
      '<h2>What applicants must upload</h2>' +
      '<p>The certified ID copy is always required — it is how identity gets verified. ' +
      'Everything else is yours to set.</p></div>' +
      '<div style="overflow-x:auto"><table class="data"><thead><tr>' +
      '<th style="width:70px">Show</th><th>Label and hint</th>' +
      '<th style="width:90px">Required</th><th style="width:90px">Max files</th>' +
      '</tr></thead><tbody>' +
      FS.idocs.map(function (d) {
        var fixed = d.doc_type === 'id_document';
        return '<tr data-doc="' + esc(d.id) + '">' +
          '<td><input type="checkbox" data-f="visible"' + (d.visible ? ' checked' : '') +
          (fixed ? ' disabled' : dis()) + '></td>' +
          '<td><input type="text" data-f="label" value="' + esc(d.label) + '"' + dis() + '>' +
          '<input type="text" data-f="hint" placeholder="Hint shown under the label" ' +
          'style="margin-top:.3rem;font-size:.88rem" value="' + esc(d.hint) + '"' + dis() + '></td>' +
          '<td><input type="checkbox" data-f="required"' + (d.required ? ' checked' : '') +
          (fixed ? ' disabled' : dis()) + '>' +
          (fixed ? '<br><span class="small muted">fixed</span>' : '') + '</td>' +
          '<td><input type="number" data-f="max_files" min="1" max="6" style="padding:.3rem" value="' +
          esc(d.max_files) + '"' + dis() + '></td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      (locked() ? '' : '<div class="btn-row"><button class="btn" id="saveDocs">Save documents</button></div>') +
      '</div>';
  }

  /* ------------------------------------------------- scoring explainer
     Placed where the weighting is actually set, not only in the static
     help page — the people who need this are looking at the grid when
     they need it, not reading documentation beforehand. A worked
     example with real arithmetic, so "weighted average" is something
     you can check rather than take on faith. */
  function howScoringWorks() {
    return '<details class="notice" style="margin-bottom:1rem" open>' +
      '<summary style="cursor:pointer;font-weight:600">How the score is worked out</summary>' +
      '<div style="margin-top:.6rem">' +

      '<p style="margin-bottom:.5rem">Score = the weighted average of the marks for every ' +
      'subject ticked below. A subject with weight <strong>3</strong> counts three times as ' +
      'much as one with weight <strong>1</strong>. Weight <strong>0</strong> captures the mark ' +
      'but leaves it out of the score entirely.</p>' +

      '<div style="overflow-x:auto"><table class="data" style="margin:.5rem 0">' +
      '<thead><tr><th>Subject</th><th class="col-num">Mark</th><th class="col-num">Weight</th>' +
      '<th class="col-num">Contributes</th></tr></thead><tbody>' +
      '<tr><td>Mathematics</td><td class="col-num">80%</td><td class="col-num">3</td>' +
      '<td class="col-num">80 &times; 3 = 240</td></tr>' +
      '<tr><td>Physical Science</td><td class="col-num">60%</td><td class="col-num">3</td>' +
      '<td class="col-num">60 &times; 3 = 180</td></tr>' +
      '<tr><td>Engineering Graphics</td><td class="col-num">70%</td><td class="col-num">2</td>' +
      '<td class="col-num">70 &times; 2 = 140</td></tr>' +
      '<tr><td>Life Orientation</td><td class="col-num">90%</td><td class="col-num">0</td>' +
      '<td class="col-num">captured, not scored</td></tr>' +
      '</tbody></table></div>' +

      '<p style="margin-bottom:.5rem"><strong>(240 + 180 + 140) &divide; (3 + 3 + 2) = 560 &divide; 8 ' +
      '= 70.00</strong> — that applicant\'s score for this trade, whatever their Life ' +
      'Orientation mark was.</p>' +

      '<p style="margin-bottom:.5rem"><strong>A required subject left blank scores zero, it is ' +
      'not skipped.</strong> If Physical Science were required above and the applicant never ' +
      'took it, the calculation still divides by its weight of 3 — 60 becomes 0, and the score ' +
      'drops to (240 + 0 + 140) &divide; 8 = 47.50. This is deliberate: leaving out a compulsory ' +
      'subject should cost an applicant, not quietly help them.</p>' +

      '<p style="margin-bottom:.5rem"><strong>Minimum mark</strong> flags an application if a ' +
      'subject falls below the number you set, and <strong>minimum score</strong> on the Trades ' +
      'panel above flags the overall total. Both are advisory — nothing is ever auto-declined. ' +
      'A reviewer sees the flag and decides.</p>' +

      '<p style="margin:0;color:var(--ink-soft)">The academic and technical NSC streams are ' +
      'mutually exclusive: an applicant is only ever scored against the subjects for the ' +
      'certificate they actually sat, never both. It is safe to mark the same subject required ' +
      'in both streams.</p>' +

      '</div></details>';
  }

  /* --------------------------------------------------- subjects grid */
  /* "What happens from here" — the steps an applicant sees after they
     submit. Deliberately editable AFTER publishing, unlike the rest of
     the form: it describes ACTOM's process rather than anything the
     applicant filled in, and if the process changes mid-intake the
     honest thing is to correct it. */
  function journeyCard() {
    var i = FS.intake || {};
    var steps = i.journey_steps || [];

    return '<div class="card" id="journeyCard"><div class="card-head">' +
      '<div class="eyebrow">After submitting</div>' +
      '<h2>What happens from here</h2>' +
      '<p>The steps an applicant sees on the confirmation screen once they have applied. ' +
      'The first is shown as the current one.</p></div>' +

      '<div class="notice">This stays editable after the intake is published, unlike the ' +
      'rest of the form \u2014 if the process changes partway through, correct it here rather ' +
      'than leaving applicants reading something that is no longer true.</div>' +

      '<div id="journeyRows">' + steps.map(journeyRow).join('') + '</div>' +

      '<div class="btn-row" style="margin-top:.6rem">' +
      '<button class="btn btn-ghost btn-sm" id="addStep">Add a step</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn" id="saveJourney">Save steps</button></div>' +
      '<div id="journeyProblem"></div></div>';
  }

  function journeyRow(st) {
    return '<div class="journey-row">' +
      '<input type="text" data-j="title" placeholder="Step title" value="' +
      esc(st && st.title) + '">' +
      '<textarea data-j="detail" rows="2" placeholder="What this means for the applicant">' +
      esc(st && st.detail) + '</textarea>' +
      '<button class="btn btn-ghost btn-sm" data-jremove="1" title="Remove this step">&times;</button>' +
      '</div>';
  }

  function wireJourney() {
    if (!$('journeyCard')) return;

    function bindRemoves() {
      $('journeyRows').querySelectorAll('[data-jremove]').forEach(function (b) {
        b.onclick = function () {
          if ($('journeyRows').querySelectorAll('.journey-row').length <= 1) {
            return alert('Keep at least one step \u2014 the applicant sees this straight after submitting.');
          }
          b.closest('.journey-row').remove();
        };
      });
    }
    bindRemoves();

    $('addStep').addEventListener('click', function () {
      $('journeyRows').insertAdjacentHTML('beforeend', journeyRow({ title: '', detail: '' }));
      bindRemoves();
    });

    $('saveJourney').addEventListener('click', function () {
      var steps = [];
      var blank = false;
      $('journeyRows').querySelectorAll('.journey-row').forEach(function (row) {
        var title = row.querySelector('[data-j="title"]').value.trim();
        var detail = row.querySelector('[data-j="detail"]').value.trim();
        if (!title) { blank = true; return; }
        steps.push({ title: title, detail: detail });
      });

      if (blank) {
        $('journeyProblem').innerHTML =
          '<div class="notice notice-err">Every step needs a title. Remove any blank rows.</div>';
        return;
      }

      sb.rpc('save_journey_steps', { p_intake: FS.intake.id, p_steps: steps })
        .then(function (r) {
          if (r.error) {
            $('journeyProblem').innerHTML =
              '<div class="notice notice-err">' + esc(r.error.message) + '</div>';
            return;
          }
          if (!r.data.ok) {
            $('journeyProblem').innerHTML =
              '<div class="notice notice-err">' + esc(r.data.reason) + '</div>';
            return;
          }
          $('journeyProblem').innerHTML = '';
          FS.intake.journey_steps = steps;
          toast(r.data.steps + ' step(s) saved');
        });
    });
  }

  function subjectsCard() {
    if (!FS.trade) {
      return '<div class="card"><div class="eyebrow">Subjects and scoring</div>' +
        '<p class="muted" style="margin-top:.6rem">Pick a trade above to set which subjects it asks ' +
        'for, the minimum marks, and how heavily each counts toward the ranking score.</p></div>';
    }
    var t = FS.trades.filter(function (x) { return x.id === FS.trade; })[0];
    var rows = FS.subjects.filter(function (s) { return s.stream !== 'qualification'; });

    return '<div class="card" id="subjectsCard"><div class="card-head">' +
      '<div class="eyebrow">Subjects and scoring</div>' +
      '<h2>' + esc(t ? t.name : '') + '</h2>' +
      '<p>Tick a subject to ask for it. Weight 0 means the mark is captured but ignored in scoring. ' +
      'A required subject left blank scores zero rather than being skipped.</p></div>' +

      howScoringWorks() +

      // The real editable grid gets its own id, distinct from the plain
      // demonstration table inside howScoringWorks() above — both now
      // live inside #subjectsCard, and a selector scoped only to that
      // container would catch the explainer's static rows too, which
      // have no [data-f="on"] checkbox and crash the moment anything
      // tries to read one.
      '<div style="overflow-x:auto"><table class="data" id="subjectsGrid"><thead><tr>' +
      '<th style="width:60px">Ask</th><th>Subject</th><th style="width:80px">Stream</th>' +
      '<th style="width:80px">Required</th><th style="width:90px">Min mark</th>' +
      '<th style="width:90px">Weight</th></tr></thead><tbody>' +
      rows.map(function (s) {
        var r = FS.its.filter(function (x) {
          return x.trade_id === FS.trade && x.subject_id === s.id && x.stream === s.stream;
        })[0];
        var on = !!r;
        return '<tr data-subject="' + esc(s.id) + '" data-stream="' + esc(s.stream) + '"' +
          (on ? '' : ' style="opacity:.55"') + '>' +
          '<td><input type="checkbox" data-f="on"' + (on ? ' checked' : '') + dis() + '></td>' +
          '<td>' + esc(s.name) + '</td>' +
          '<td class="small muted">' + esc(s.stream) + '</td>' +
          '<td><input type="checkbox" data-f="required"' +
          (r && r.required ? ' checked' : '') + dis() + '></td>' +
          '<td><input type="number" data-f="min_mark" min="0" max="100" style="padding:.3rem" value="' +
          (r && r.min_mark != null ? esc(r.min_mark) : '') + '"' + dis() + '></td>' +
          '<td><input type="number" data-f="weight" min="0" max="10" style="padding:.3rem" value="' +
          (r ? esc(r.weight) : '1') + '"' + dis() + '></td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div id="scorePreview" class="notice" style="margin-top:1rem"></div>' +
      (locked() ? '' : '<div class="btn-row"><button class="btn" id="saveSubjects">Save subjects</button>' +
        '<button class="btn btn-ghost" id="clearSubjects">Clear all</button></div>') +
      '</div>';
  }

  /* ------------------------------------------------------------ wiring */
  function wireEditor() {
    $('backList').addEventListener('click', loadIntakes);

    if ($('saveBasics')) $('saveBasics').addEventListener('click', saveBasics);
    if ($('saveDates')) $('saveDates').addEventListener('click', saveDates);
    if ($('publishBtn')) $('publishBtn').addEventListener('click', publish);
    if ($('closeBtn')) $('closeBtn').addEventListener('click', closeIntake);
    if ($('saveTrades')) $('saveTrades').addEventListener('click', saveTrades);
    if ($('saveDocs')) $('saveDocs').addEventListener('click', saveDocs);
    if ($('saveSubjects')) $('saveSubjects').addEventListener('click', saveSubjects);
    if ($('clearSubjects')) $('clearSubjects').addEventListener('click', function () {
      content.querySelectorAll('#subjectsGrid tbody tr').forEach(function (tr) {
        tr.querySelector('[data-f="on"]').checked = false;
        tr.style.opacity = '.55';
      });
      updatePreview();
    });

    content.querySelectorAll('[data-subjects]').forEach(function (b) {
      b.addEventListener('click', function () {
        FS.trade = b.dataset.subjects;
        renderEditor();
        var el = $('subjectsCard');
        if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });

    if ($('subjectsCard')) {
      $('subjectsCard').addEventListener('change', function (e) {
        var tr = e.target.closest('tr[data-subject]');
        if (tr && e.target.dataset.f === 'on') {
          tr.style.opacity = e.target.checked ? '1' : '.55';
        }
        updatePreview();
      });
      $('subjectsCard').addEventListener('input', updatePreview);
      updatePreview();
    }
  }

  // Live worked example, so the weighting is not abstract.
  function updatePreview() {
    var box = $('scorePreview');
    if (!box) return;
    var rows = [], reqCount = 0;
    content.querySelectorAll('#subjectsGrid tbody tr').forEach(function (tr) {
      if (!tr.querySelector('[data-f="on"]').checked) return;
      var w = parseInt(tr.querySelector('[data-f="weight"]').value, 10);
      if (isNaN(w)) w = 1;
      if (tr.querySelector('[data-f="required"]').checked) reqCount++;
      rows.push({ name: tr.cells[1].textContent, w: w });
    });

    if (!rows.length) {
      box.innerHTML = '<strong>No subjects selected</strong>' +
        'Applicants for this trade will not be asked for any marks, and cannot be scored.';
      return;
    }
    var total = rows.reduce(function (a, r) { return a + r.w; }, 0);
    var scored = rows.filter(function (r) { return r.w > 0; });
    var top = scored.slice().sort(function (a, b) { return b.w - a.w; }).slice(0, 3);

    // A worked example against the subjects actually ticked, not the
    // generic ones in the explainer above — this is what today's setup
    // will actually produce for a real applicant.
    var example = '';
    if (total > 0) {
      var mark = 70;
      var sumWeighted = scored.reduce(function (s, r) { return s + mark * r.w; }, 0);
      example = ' An applicant scoring ' + mark + '% in every ticked subject scores ' +
        (sumWeighted / total).toFixed(2) + ' overall with this exact setup.';
    }

    box.innerHTML = '<strong>' + rows.length + ' subject' + (rows.length === 1 ? '' : 's') +
      ' asked for, ' + reqCount + ' compulsory</strong>' +
      (total === 0
        ? 'Every weight is zero, so marks are captured but no score is produced.'
        : 'Score is the weighted average across ' + scored.length + ' subject' +
          (scored.length === 1 ? '' : 's') + '. ' +
          (top.length ? 'Heaviest: ' + top.map(function (r) {
            return esc(r.name) + ' (' + Math.round(r.w / total * 100) + '%)';
          }).join(', ') + '.' : '') + example);
  }

  /* ------------------------------------------------------------- saves */
  function saveBasics() {
    sb.from('intakes').update({
      name: $('f_name').value.trim(),
      consent_version: $('f_consent').value.trim(),
      opens_at: new Date($('f_opens').value).toISOString(),
      closes_at: new Date($('f_closes').value + 'T23:59:59').toISOString(),
      retention_months: parseInt($('f_retention').value, 10) || 12,
      max_upload_mb: parseInt($('f_upload').value, 10) || 8,
      show_further_study: $('f_further').checked,
      show_technical: $('f_technical').checked,
      intro_heading: $('f_introh').value.trim() || null,
      intro_body: $('f_introb').value.trim() || null,
      scoring_enabled: $('f_scoring').checked,
      auto_flag_below: $('f_flag').checked
    }).eq('id', FS.intake.id).then(function (r) {
      if (r.error) return alert(r.error.message);
      toast('Saved');
      openIntake(FS.intake.id);
    });
  }

  function saveDates() {
    sb.from('intakes').update({
      closes_at: new Date($('f_closes').value + 'T23:59:59').toISOString()
    }).eq('id', FS.intake.id).then(function (r) {
      if (r.error) return alert(r.error.message);
      toast('Closing date updated');
    });
  }

  function saveTrades() {
    var ops = [];
    content.querySelectorAll('tr[data-trade]').forEach(function (tr) {
      var id = tr.dataset.trade;
      var patch = {
        intake_id: FS.intake.id, trade_id: id,
        active: tr.querySelector('[data-f="active"]').checked,
        positions: parseInt(tr.querySelector('[data-f="positions"]').value, 10) || null,
        min_score: parseFloat(tr.querySelector('[data-f="min_score"]').value) || null
      };
      var existing = FS.itrades.filter(function (x) { return x.trade_id === id; })[0];
      ops.push(existing
        ? sb.from('intake_trades').update(patch).eq('intake_id', FS.intake.id).eq('trade_id', id)
        : sb.from('intake_trades').insert(patch));
    });
    Promise.all(ops).then(function (res) {
      var bad = res.filter(function (r) { return r && r.error; })[0];
      if (bad) return alert(bad.error.message);
      toast('Trades saved');
      openIntake(FS.intake.id);
    });
  }

  // Single source of truth for the bound, mirroring the CHECK on
  // intake_documents.max_files. Raising the ceiling means changing it
  // here, in the min/max on the input, and in the constraint.
  function clampMaxFiles(v) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return 1;
    return Math.min(Math.max(n, 1), 6);
  }

  function saveDocs() {
    var ops = [];
    content.querySelectorAll('tr[data-doc]').forEach(function (tr) {
      ops.push(sb.from('intake_documents').update({
        visible: tr.querySelector('[data-f="visible"]').checked,
        required: tr.querySelector('[data-f="required"]').checked,
        label: tr.querySelector('[data-f="label"]').value.trim(),
        hint: tr.querySelector('[data-f="hint"]').value.trim() || null,
        // Clamped rather than posted raw. The column is CHECK (1..6) and
        // a trigger clamps it too, but without this a typed 60 comes back
        // as a Postgres constraint message in an alert() box. `|| 1`
        // alone does not cover it: it catches NaN and 0, not -3 or 60.
        max_files: clampMaxFiles(tr.querySelector('[data-f="max_files"]').value)
      }).eq('id', tr.dataset.doc));
    });
    Promise.all(ops).then(function (res) {
      var bad = res.filter(function (r) { return r && r.error; })[0];
      if (bad) return alert(bad.error.message);
      toast('Documents saved');
      openIntake(FS.intake.id);
    });
  }

  function saveSubjects() {
    var rows = [];
    content.querySelectorAll('#subjectsGrid tbody tr').forEach(function (tr, idx) {
      if (!tr.querySelector('[data-f="on"]').checked) return;
      var min = tr.querySelector('[data-f="min_mark"]').value.trim();
      rows.push({
        subject_id: tr.dataset.subject,
        stream: tr.dataset.stream,
        required: tr.querySelector('[data-f="required"]').checked,
        min_mark: min === '' ? null : parseInt(min, 10),
        weight: parseInt(tr.querySelector('[data-f="weight"]').value, 10) || 0,
        sort_order: idx * 10
      });
    });
    sb.rpc('save_trade_subjects', {
      p_intake: FS.intake.id, p_trade: FS.trade, p_rows: rows
    }).then(function (r) {
      if (r.error) return alert(r.error.message);
      toast(r.data + ' subjects saved');
      openIntake(FS.intake.id);
    });
  }

  function publish() {
    var box = $('publishProblems');
    box.innerHTML = '';
    if (!confirm('Publish "' + FS.intake.name + '"?\n\n' +
                 'Applicants will be able to apply immediately, and the form will be frozen. ' +
                 'You will not be able to change subjects, trades, documents or scoring afterwards.')) return;

    sb.rpc('publish_intake', { p_intake: FS.intake.id }).then(function (r) {
      if (r.error) return alert(r.error.message);
      if (!r.data.ok) {
        box.innerHTML = '<div class="notice notice-err"><strong>Not ready to publish</strong>' +
          r.data.problems.map(esc).join('<br>') + '</div>';
        box.scrollIntoView({ block: 'center' });
        return;
      }
      toast('Published — the form is now live and locked');
      openIntake(FS.intake.id);
    });
  }

  function closeIntake() {
    if (!confirm('Close this intake? Applicants will no longer be able to submit. ' +
                 'Drafts in progress will be lost.')) return;
    sb.rpc('close_intake', { p_intake: FS.intake.id }).then(function (r) {
      if (r.error) return alert(r.error.message);
      toast('Intake closed');
      openIntake(FS.intake.id);
    });
  }
})();
