/* =====================================================================
   ACTOM Apprenticeship Portal — applicant client

   Security posture of this file:
     - It holds no secrets. The anon key is public by design.
     - It never writes an ID number to a table. Identity goes through
       app.set_identity(), which encrypts server-side.
     - It never constructs a public file URL. Uploads land in a private
       bucket; reads use short-lived signed URLs.
     - Every validation here is a courtesy to the applicant. The real
       enforcement is in RLS and app.submit_application().
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.ACTOM_CONFIG;
  var sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  /* ------------------------------------------------------------- state */
  var S = {
    session: null,
    intake: null,
    trades: [],
    subjects: { academic: [], technical: [], qualification: [] },
    consent: { applicant: null, guardian: null },
    cfg: null,          // get_form_config() result for the chosen trade
    app: null,          // the applications row
    marks: {},          // { stream: { subjectName: mark } }
    docs: [],
    guardian: null,
    step: 0,
    steps: []
  };

  // Enumerated because SELECT on applications is granted column by column.
  // Asking for '*' would request id_number_enc and be refused.
  var APP_COLS = [
    'id','reference','applicant_user_id','intake_id','trade_id','status','full_name',
    'id_type','id_number_last4','passport_country','date_of_birth','gender','citizenship',
    'is_minor','contact_number','email','address_line1','address_line2','suburb','city',
    'province','postal_code','country','ethnic_group','has_disability','disability_types',
    'disability_other','grade12_type','grade12_year','highest_qualification',
    'highest_qual_institution','highest_qual_year','submitted_at','created_at',
    'updated_at','purge_after','legal_hold'
  ].join(',');
  var GUARDIAN_COLS =
    'id,application_id,full_name,relationship,contact_number,email,id_number_last4,created_at';

  var $ = function (id) { return document.getElementById(id); };
  /* The steps shown after submitting. Configured per intake in the
     reviewer console, because ACTOM's process changes between years.
     Falls back to the standard sequence if an intake somehow has none —
     an applicant should never be shown an empty "what happens next". */
  /* An application that has been declined or withdrawn is finished. The
     forward roadmap is not just irrelevant then — it is misleading, and
     reading "that is the hard part done" above a path to qualifying is a
     poor way to learn you were unsuccessful. */
  function isClosedOutcome(status) {
    return status === 'declined' || status === 'withdrawn';
  }

  function outcomeCard(a) {
    var first = esc((a.full_name || '').split(' ')[0]);
    var ref = '<p class="mono" style="font-size:1.6rem;letter-spacing:.06em;color:var(--blue)">' +
      esc(a.reference) + '</p>';

    if (a.status === 'declined') {
      return '<div class="card center" style="border-top:4px solid var(--err)">' +
        '<div class="eyebrow" style="color:var(--err)">Not successful this time</div>' +
        '<h1>Thank you for applying, ' + first + '</h1>' +
        '<p>Your application for this intake was not successful. We know that is ' +
        'disappointing, and we are grateful you took the time to apply.</p>' +
        ref +
        '<p class="small muted">Applied ' +
        new Date(a.submitted_at).toLocaleString('en-ZA') + '</p>' +
        '</div>' +

        '<div class="card"><h2>What you can do next</h2>' +
        '<p><strong>You are welcome to apply again.</strong> ACTOM runs an intake most years, ' +
        'and applying again is encouraged \u2014 a great many apprentices were not taken on the ' +
        'first time they applied.</p>' +
        '<p>If you would like to know more about the decision, email ' +
        '<a href="mailto:' + CFG.SUPPORT_EMAIL + '">' + CFG.SUPPORT_EMAIL + '</a> ' +
        'and quote your reference number above.</p>' +
        '<p class="small muted" style="margin-bottom:0">Improving your Mathematics and ' +
        'Physical Science marks, or completing an N-certificate at a TVET college, will ' +
        'strengthen a future application.</p></div>';
    }

    if (a.status === 'withdrawn') {
      return '<div class="card center">' +
        '<div class="eyebrow">Withdrawn</div>' +
        '<h1>Your application has been withdrawn</h1>' +
        '<p>It will not be considered for this intake. If that was a mistake, contact us ' +
        'at <a href="mailto:' + CFG.SUPPORT_EMAIL + '">' + CFG.SUPPORT_EMAIL + '</a> ' +
        'as soon as you can \u2014 before the intake closes, we may be able to help.</p>' +
        ref + '</div>';
    }

    return '<div class="card center">' +
      '<div class="eyebrow">Application ' + esc(a.status).replace('_', ' ') + '</div>' +
      '<h1>You have applied, ' + first + '</h1>' +
      '<p>That is the hard part done. Keep this reference and quote it in any email or call ' +
      'about your application.</p>' + ref +
      '<p class="small muted">Submitted ' +
      new Date(a.submitted_at).toLocaleString('en-ZA') + '</p></div>';
  }

  function journeyCard() {
    return '<div class="card"><h2>What happens from here</h2>' +
      '<ul class="journey">' + journeyHtml() + '</ul>' +
      '<p class="small muted" style="margin-top:1rem">We contact everyone either way, so there ' +
      'is no need to follow up. We keep your application on file for 12 months after the intake ' +
      'closes in case a suitable position opens sooner, then it is deleted automatically.</p></div>';
  }

  function journeyHtml() {
    var steps = (S.intake && S.intake.journey_steps) || null;

    if (!steps || !steps.length) {
      steps = [
        { title: 'Application received', detail: 'Nothing more is needed from you right now.' },
        { title: 'Screening', detail: 'After the intake closes, we check every application against the requirements for your trade.' },
        { title: 'Aptitude assessment', detail: 'If you are shortlisted we phone you on the number you gave us.' },
        { title: 'Interview and medical', detail: 'A conversation about the work, and a fitness-for-duty check.' },
        { title: 'Contract of apprenticeship', detail: 'Signed and registered with the SETA. You start earning.' }
      ];
    }

    return steps.map(function (st, idx) {
      return '<li' + (idx === 0 ? ' class="is-now"' : '') + '>' +
        '<strong>' + esc(st.title) + '</strong>' +
        (st.detail ? '<span>' + esc(st.detail) + '</span>' : '') + '</li>';
    }).join('');
  }

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  function toast(msg) {
    var el = $('autosave');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }

  /* ======================================================== 1. Sign-in */

  function showSigninError(msg) {
    var el = $('signinError');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  $('sendCodeBtn').addEventListener('click', function () {
    var email = $('emailInput').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
      return showSigninError('That does not look like an email address. Check for a typo and try again.');
    }
    $('signinError').classList.add('hidden');
    this.disabled = true;
    this.textContent = 'Sending…';
    var btn = this;

    sb.auth.signInWithOtp({
      email: email,
      options: { shouldCreateUser: true }
    }).then(function (r) {
      btn.disabled = false;
      btn.textContent = 'Send my code';
      if (r.error) {
        return showSigninError(
          r.error.status === 429
            ? 'Too many codes requested. Wait a minute, then try again.'
            : 'We could not send the code. Check the address and try again.');
      }
      $('sentTo').textContent = email;
      $('stepEmail').classList.add('hidden');
      $('stepCode').classList.remove('hidden');
      $('codeInput').focus();
    });
  });

  $('backToEmail').addEventListener('click', function () {
    $('stepCode').classList.add('hidden');
    $('stepEmail').classList.remove('hidden');
    $('signinError').classList.add('hidden');
  });

  $('verifyBtn').addEventListener('click', function () {
    var code = $('codeInput').value.replace(/\D/g, '');
    if (code.length !== 6) return showSigninError('Enter the six digits from the email.');
    this.disabled = true;
    this.textContent = 'Checking…';
    var btn = this;

    sb.auth.verifyOtp({
      email: $('sentTo').textContent, token: code, type: 'email'
    }).then(function (r) {
      btn.disabled = false;
      btn.textContent = 'Verify and continue';
      if (r.error) return showSigninError('That code is wrong or has expired. Request a new one.');
      boot();
    });
  });

  $('codeInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('verifyBtn').click();
  });
  $('emailInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('sendCodeBtn').click();
  });

  $('signOutBtn').addEventListener('click', function () {
    sb.auth.signOut().then(function () { location.reload(); });
  });


  $('privacyLink').addEventListener('click', function (e) {
    e.preventDefault();
    sb.from('consent_versions').select('body').eq('audience', 'applicant')
      .eq('active', true).limit(1).single()
      .then(function (r) {
        alert(r.data ? r.data.body : 'The privacy notice is not available right now.');
      });
  });

  /* ========================================================== 2. Boot */

  function boot() {
    sb.auth.getSession().then(function (r) {
      if (!r.data.session) { $('signin').classList.remove('hidden'); return; }
      S.session = r.data.session;
      $('signin').classList.add('hidden');
      $('portal').classList.remove('hidden');
      $('whoEmail').textContent = S.session.user.email;
      return loadEverything();
    }).then(function () {
      if (!S.session) return;
      $('loader').classList.add('hidden');
      $('content').classList.remove('hidden');
      buildSteps();
      render();
    }).catch(function (err) {
      $('loader').classList.add('hidden');
      $('content').classList.remove('hidden');
      $('content').innerHTML =
        '<div class="notice notice-err"><strong>We could not load your application.</strong>' +
        esc(err.message || err) + ' Refresh the page, or email ' + CFG.SUPPORT_EMAIL + '.</div>';
    });
  }

  // One parallel wave. Never a chain of sequential awaits.
  function loadEverything() {
    return Promise.all([
      sb.from('intakes').select('*').eq('status', 'open')
        .lte('opens_at', new Date().toISOString())
        .gte('closes_at', new Date().toISOString()).limit(1),
      sb.from('consent_versions').select('*').eq('active', true)
    ]).then(function (res) {
      res.forEach(function (r) { if (r.error) throw r.error; });
      S.intake = res[0].data[0] || null;
      (res[1].data || []).forEach(function (c) { S.consent[c.audience] = c; });

      if (!S.intake) return;
      return sb.rpc('start_application', { p_intake: S.intake.id });
    }).then(function (r) {
      if (!S.intake) return;
      if (r.error) throw r.error;
      return loadApplication(r.data);
    }).then(function () {
      if (!S.intake) return;
      return loadConfig();
    });
  }

  // The form shapes itself from the published intake config. Called
  // again whenever the trade changes, because the subject list and its
  // requirements are per-trade.
  function loadConfig() {
    return sb.rpc('get_form_config', {
      p_intake: S.intake.id,
      p_trade: S.app ? S.app.trade_id : null
    }).then(function (r) {
      if (r.error) throw r.error;
      if (!r.data || !r.data.open) { S.intake = null; return; }
      S.cfg = r.data;
      S.trades = r.data.trades || [];
      S.subjects = { academic: [], technical: [], qualification: [] };
      (r.data.subjects || []).forEach(function (x) {
        if (S.subjects[x.stream]) S.subjects[x.stream].push(x);
      });
      if (r.data.intake && r.data.intake.max_upload_mb) {
        CFG.MAX_UPLOAD_BYTES = r.data.intake.max_upload_mb * 1024 * 1024;
      }
    });
  }

  function loadApplication(id) {
    return Promise.all([
      sb.from('applications').select(APP_COLS).eq('id', id).single(),
      sb.from('application_subjects').select('*').eq('application_id', id),
      sb.from('application_documents').select('*').eq('application_id', id).order('uploaded_at'),
      sb.from('guardians').select(GUARDIAN_COLS).eq('application_id', id).maybeSingle()
    ]).then(function (res) {
      if (res[0].error) throw res[0].error;
      S.app = res[0].data;
      S.marks = { academic: {}, technical: {}, qualification: {} };
      (res[1].data || []).forEach(function (m) { S.marks[m.stream][m.subject_name] = m.mark; });
      S.docs = res[2].data || [];
      S.guardian = res[3].data || null;
    });
  }

  /* ==================================================== 3. Step model */

  function buildSteps() {
    var ic = (S.cfg && S.cfg.intake) || {};
    S.steps = [
      { key: 'identity',  label: 'ID',      title: 'Who you are' },
      { key: 'contact',   label: 'Contact', title: 'How we reach you' },
      { key: 'trade',     label: 'Trade',   title: 'The trade you want' },
      { key: 'equity',    label: 'Equity',  title: 'Employment equity' },
      { key: 'school',    label: 'School',  title: 'Grade 12 results' }
    ];
    if (ic.show_further_study !== false) {
      S.steps.push({ key: 'further', label: 'Study', title: 'Further qualifications' });
    }
    S.steps.push({ key: 'documents', label: 'Docs', title: 'Your documents' });
    if (S.app && S.app.is_minor) {
      S.steps.push({ key: 'guardian', label: 'Guardian', title: 'Parent or guardian consent' });
    }
    S.steps.push({ key: 'review', label: 'Submit', title: 'Check and submit' });
  }

  function go(n) {
    S.step = Math.max(0, Math.min(S.steps.length - 1, n));
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* -------------------------------------- the transmission-line marker */
  function progressSvg() {
    var n = S.steps.length, gap = 100, pad = 34;
    var w = pad * 2 + gap * (n - 1);
    var out = '<svg viewBox="0 0 ' + w + ' 76" preserveAspectRatio="xMidYMid meet" aria-hidden="true">';

    for (var i = 0; i < n - 1; i++) {
      var x1 = pad + gap * i, x2 = x1 + gap;
      var live = i < S.step;
      out += '<path class="conductor' + (live ? ' is-live is-pulsing' : '') +
             '" d="M' + x1 + ' 22 Q' + ((x1 + x2) / 2) + ' 40 ' + x2 + ' 22"/>';
    }
    for (var j = 0; j < n; j++) {
      var x = pad + gap * j;
      var cls = j < S.step ? ' is-done' : (j === S.step ? ' is-current' : '');
      out += '<path class="pylon-mast' + cls + '" d="M' + x + ' 22 L' + x + ' 54 M' +
             (x - 8) + ' 54 L' + (x + 8) + ' 54 M' + (x - 6) + ' 38 L' + (x + 6) + ' 38"/>';
      out += '<circle class="pylon-node' + cls + '" cx="' + x + '" cy="22" r="6"/>';
      out += '<text class="pylon-label' + (j === S.step ? ' is-current' : '') +
             '" x="' + x + '" y="70" text-anchor="middle">' + esc(S.steps[j].label) + '</text>';
    }
    return out + '</svg>';
  }

  function shell(bodyHtml) {
    var st = S.steps[S.step];
    var pct = Math.round(((S.step + 1) / S.steps.length) * 100);

    // The pylon SVG on a wide screen, a plain bar on a phone — nine
    // pylons will not fit across 360px and the labels become unreadable.
    // CSS decides which is shown; both carry the same information.
    return '<div class="line-progress">' + progressSvg() +
           '<div class="line-progress-bar" role="progressbar" aria-valuenow="' + (S.step + 1) +
           '" aria-valuemin="1" aria-valuemax="' + S.steps.length +
           '" aria-label="Application progress"><i style="width:' + pct + '%"></i></div>' +
           '<div class="step-caption"><span>Step ' + (S.step + 1) + ' of ' + S.steps.length +
           ' &middot; ' + esc(st.title) + '</span>' +
           (S.app && S.app.reference ? '<span class="mono">' + esc(S.app.reference) + '</span>' : '') +
           '</div></div>' + bodyHtml;
  }

  function navRow(opts) {
    opts = opts || {};
    return '<div class="btn-row">' +
      (S.step > 0 ? '<button class="btn btn-ghost" data-nav="back">Back</button>' : '') +
      '<span class="spacer"></span>' +
      (opts.nextLabel === null ? '' :
        '<button class="btn" data-nav="next">' + esc(opts.nextLabel || 'Save and continue') + '</button>') +
      '</div>';
  }

  /* ======================================================== 4. Render */

  function render() {
    if (!S.intake) {
      $('content').innerHTML =
        '<div class="card"><h1>Applications are closed</h1>' +
        '<p>There is no intake open at the moment. Watch the ACTOM careers page for the next one, ' +
        'or email <a href="mailto:' + CFG.SUPPORT_EMAIL + '">' + CFG.SUPPORT_EMAIL + '</a> to ask when it opens.</p></div>';
      return;
    }

    // Configured intro copy, shown once on the first step.
    var ic = (S.cfg && S.cfg.intake) || {};
    if (S.app && S.app.status !== 'draft') return renderSubmitted();

    var body = {
      identity: stepIdentity, contact: stepContact, trade: stepTrade,
      equity: stepEquity, school: stepSchool, further: stepFurther,
      documents: stepDocuments, guardian: stepGuardian, review: stepReview
    }[S.steps[S.step].key]();

    if (S.step === 0 && (ic.intro_heading || ic.intro_body)) {
      body = '<div class="notice"><strong>' + esc(ic.intro_heading || '') + '</strong>' +
             esc(ic.intro_body || '') + '</div>' + body;
    }
    $('content').innerHTML = shell(body);
    wireNav();
    var hook = {
      identity: wireIdentity, contact: wireSimple, trade: wireSimple,
      equity: wireEquity, school: wireSchool, further: wireFurther,
      documents: wireDocuments, guardian: wireGuardian, review: wireReview
    }[S.steps[S.step].key];
    if (hook) hook();
  }

  function wireNav() {
    Array.prototype.forEach.call($('content').querySelectorAll('[data-nav]'), function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.nav === 'back') return go(S.step - 1);
        var fn = $('content')._onNext;
        if (fn) fn(); else go(S.step + 1);
      });
    });
  }

  function fieldError(name, msg) {
    var el = $('content').querySelector('[data-err="' + name + '"]');
    if (el) el.textContent = msg || '';
    var input = $('content').querySelector('[name="' + name + '"]');
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function val(name) {
    var el = $('content').querySelector('[name="' + name + '"]');
    return el ? el.value.trim() : '';
  }

  /* ---------------------------------------------------- step: identity */
  function stepIdentity() {
    var a = S.app;
    return '<div class="card">' +
      '<div class="card-head"><div class="eyebrow">Step 1</div><h1>Who you are</h1>' +
      '<p>Give your name exactly as it appears on your ID document. We check the two against each other.</p></div>' +

      '<div class="notice"><strong>Your ID number is encrypted</strong>' +
      'It is stored scrambled and can only be unlocked by trained ACTOM staff who need it to verify ' +
      'your application. Every time someone unlocks it we record who, when and why.</div>' +

      '<div class="field"><label for="fullName">Full name and surname <span class="req">*</span></label>' +
      '<input type="text" id="fullName" name="fullName" autocomplete="name" ' +
      'value="' + esc(a.full_name) + '">' +
      '<div class="field-error" data-err="fullName"></div></div>' +

      '<div class="field"><span class="field-label">Identity document <span class="req">*</span></span>' +
      '<label class="choice"><input type="radio" name="idType" value="sa_id"' +
      (a.id_type !== 'passport' ? ' checked' : '') + '>' +
      '<span class="choice-body"><strong>South African ID</strong><span>13-digit ID number</span></span></label>' +
      '<label class="choice"><input type="radio" name="idType" value="passport"' +
      (a.id_type === 'passport' ? ' checked' : '') + '>' +
      '<span class="choice-body"><strong>Passport</strong><span>Non-citizens with a valid work permit</span></span></label></div>' +

      '<div class="field"><label for="idNumber">' +
      '<span id="idLabel">ID number</span> <span class="req">*</span></label>' +
      '<input type="text" id="idNumber" name="idNumber" inputmode="numeric" maxlength="20" ' +
      'autocomplete="off" placeholder="' + (a.id_number_last4 ? '•••••••••' + esc(a.id_number_last4) : '') + '">' +
      '<div class="hint" id="idHint">' +
      (a.id_number_last4 ? 'On file, ending ' + esc(a.id_number_last4) +
        '. Leave blank to keep it, or type it again to replace it.' : '') + '</div>' +
      '<div class="field-error" data-err="idNumber"></div></div>' +

      '<div id="passportExtra" class="' + (a.id_type === 'passport' ? '' : 'hidden') + '">' +
      '<div class="grid grid-2">' +
      '<div class="field"><label for="passportCountry">Country of issue</label>' +
      '<input type="text" id="passportCountry" name="passportCountry" value="' + esc(a.passport_country) + '"></div>' +
      '<div class="field"><label for="dob">Date of birth</label>' +
      '<input type="date" id="dob" name="dob" value="' + esc(a.date_of_birth) + '"></div>' +
      '</div></div>' +

      navRow() + '</div>';
  }

  function wireIdentity() {
    var radios = $('content').querySelectorAll('[name="idType"]');
    function sync() {
      var isPassport = $('content').querySelector('[name="idType"]:checked').value === 'passport';
      $('passportExtra').classList.toggle('hidden', !isPassport);
      $('idLabel').textContent = isPassport ? 'Passport number' : 'ID number';
    }
    Array.prototype.forEach.call(radios, function (r) { r.addEventListener('change', sync); });

    $('content')._onNext = function () {
      var name = val('fullName');
      var idType = $('content').querySelector('[name="idType"]:checked').value;
      var idNum = val('idNumber');
      var ok = true;

      fieldError('fullName', ''); fieldError('idNumber', '');
      if (name.length < 3) { fieldError('fullName', 'Enter your full name and surname.'); ok = false; }
      if (!idNum && !S.app.id_number_enc) {
        fieldError('idNumber', 'Enter your ' + (idType === 'sa_id' ? 'ID' : 'passport') + ' number.');
        ok = false;
      }
      if (!ok) return;

      // Nothing new to send — just update the name and move on.
      if (!idNum) {
        return saveApp({ full_name: name }).then(function () { go(S.step + 1); });
      }

      sb.rpc('set_identity', {
        p_application: S.app.id, p_id_type: idType, p_id_number: idNum,
        p_full_name: name, p_passport_country: val('passportCountry') || null,
        p_dob: val('dob') || null, p_gender: null
      }).then(function (r) {
        if (r.error) return fieldError('idNumber', r.error.message);
        if (!r.data.valid) return fieldError('idNumber', r.data.reason);
        return loadApplication(S.app.id).then(function () {
          buildSteps();
          toast('Saved');
          if (S.app.is_minor) {
            alert('You are under 18, so we also need consent from a parent or guardian. ' +
                  'We have added a step for that near the end.');
          }
          go(S.step + 1);
        });
      });
    };
  }

  /* ----------------------------------------------------- step: contact */
  function stepContact() {
    var a = S.app;
    return '<div class="card">' +
      '<div class="card-head"><div class="eyebrow">Step 2</div><h1>How we reach you</h1>' +
      '<p>Use a number and address that will still work in six months. Shortlisting calls go out by phone.</p></div>' +
      '<div class="grid grid-2">' +
      '<div class="field"><label for="contact_number">Mobile number <span class="req">*</span></label>' +
      '<input type="tel" id="contact_number" name="contact_number" inputmode="tel" autocomplete="tel" ' +
      'value="' + esc(a.contact_number) + '" placeholder="082 000 0000">' +
      '<div class="field-error" data-err="contact_number"></div></div>' +
      '<div class="field"><label for="emailRO">Email address</label>' +
      '<input type="email" id="emailRO" value="' + esc(a.email) + '" disabled></div>' +
      '</div>' +
      '<div class="field"><label for="address_line1">Street address <span class="req">*</span></label>' +
      '<input type="text" id="address_line1" name="address_line1" autocomplete="address-line1" ' +
      'value="' + esc(a.address_line1) + '"><div class="field-error" data-err="address_line1"></div></div>' +
      '<div class="field"><label for="address_line2">Address line 2</label>' +
      '<input type="text" id="address_line2" name="address_line2" value="' + esc(a.address_line2) + '"></div>' +
      '<div class="grid grid-2">' +
      '<div class="field"><label for="suburb">Suburb</label>' +
      '<input type="text" id="suburb" name="suburb" value="' + esc(a.suburb) + '"></div>' +
      '<div class="field"><label for="city">City or town <span class="req">*</span></label>' +
      '<input type="text" id="city" name="city" value="' + esc(a.city) + '">' +
      '<div class="field-error" data-err="city"></div></div>' +
      '</div>' +
      '<div class="grid grid-3">' +
      '<div class="field"><label for="province">Province</label>' + provinceSelect(a.province) + '</div>' +
      '<div class="field"><label for="postal_code">Postal code</label>' +
      '<input type="text" id="postal_code" name="postal_code" inputmode="numeric" maxlength="4" ' +
      'value="' + esc(a.postal_code) + '"></div>' +
      '<div class="field"><label for="country">Country</label>' +
      '<input type="text" id="country" name="country" value="' + esc(a.country || 'South Africa') + '"></div>' +
      '</div>' + navRow() + '</div>';
  }

  function provinceSelect(v) {
    var list = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
                'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape'];
    return '<select id="province" name="province"><option value="">Select…</option>' +
      list.map(function (p) {
        return '<option' + (v === p ? ' selected' : '') + '>' + p + '</option>';
      }).join('') + '</select>';
  }

  function wireSimple() {
    // Trade is chosen from cards rather than a dropdown; keep the hidden
    // input in step so the shared save path is unchanged.
    var cards = $('content').querySelectorAll('[data-trade]');
    Array.prototype.forEach.call(cards, function (c) {
      c.addEventListener('click', function () {
        Array.prototype.forEach.call(cards, function (o) {
          o.classList.remove('is-picked');
          o.setAttribute('aria-pressed', 'false');
        });
        c.classList.add('is-picked');
        c.setAttribute('aria-pressed', 'true');
        $('trade_id').value = c.dataset.trade;
        fieldError('trade_id', '');
      });
    });

    $('content')._onNext = function () {
      var key = S.steps[S.step].key;
      var patch = {}, ok = true;

      if (key === 'contact') {
        ['contact_number', 'address_line1', 'address_line2', 'suburb', 'city',
         'province', 'postal_code', 'country'].forEach(function (f) { patch[f] = val(f) || null; });
        fieldError('contact_number', ''); fieldError('address_line1', ''); fieldError('city', '');
        if (!/^0\d{9}$|^\+?\d{9,15}$/.test((patch.contact_number || '').replace(/[\s-]/g, ''))) {
          fieldError('contact_number', 'Enter a valid mobile number, for example 082 000 0000.'); ok = false;
        }
        if (!patch.address_line1) { fieldError('address_line1', 'We need a street address.'); ok = false; }
        if (!patch.city) { fieldError('city', 'Enter your city or town.'); ok = false; }
      }

      if (key === 'trade') {
        patch.trade_id = val('trade_id') || null;
        fieldError('trade_id', '');
        if (!patch.trade_id) { fieldError('trade_id', 'Choose the trade you are applying for.'); ok = false; }
      }

      if (!ok) return;
      saveApp(patch).then(function () {
        // Subjects and their requirements differ per trade, so refresh
        // the config before rendering the marks steps.
        if (key === 'trade') return loadConfig().then(function () { buildSteps(); });
      }).then(function () { go(S.step + 1); });
    };
  }

  /* ------------------------------------------------------- step: trade */
  // What each trade actually involves, in plain terms. Most applicants are
  // choosing from a school-leaver's understanding of these words, and a
  // wrong choice costs them the intake — they get one application.
  var TRADE_BLURBS = {
    ELEC: 'Install, test and maintain electrical systems — from distribution boards to industrial installations. Fault-finding on live plant is a big part of the job.',
    MILL: 'The all-rounder: mechanical and electrical. Millwrights keep rotating machines and production plant running, and are among the most sought-after artisans in the country.',
    FITT: 'Machine and assemble precision components on lathes, mills and grinders, then fit them into working assemblies. Exact work to fine tolerances.',
    BOIL: 'Cut, shape and weld heavy steel plate into tanks, structures and pressure equipment. Reading drawings and getting steel to match them.',
    WELD: 'Join metal to a standard that holds under load and inspection. Coded welding is a qualification that travels anywhere in the world.',
    TRWD: 'Build the windings at the heart of power transformers. Meticulous, methodical work on equipment that runs for decades.',
    INST: 'Calibrate and maintain the instruments and control systems that measure and protect plant. Where electrical work meets electronics.',
    DIES: 'Strip, diagnose and rebuild diesel engines and generator sets — the standby power that keeps sites running when the grid does not.',
    RIGG: 'Move and position heavy plant safely: lifting plans, slinging, and getting equipment exactly where it belongs without hurting anyone.',
    TOOL: 'Make the jigs, dies and tooling that production depends on. The most precise of the machining trades.',
    PLAT: 'Develop flat patterns from drawings and form them into finished steelwork. Geometry you can hold in your hands.'
  };

  function stepTrade() {
    var picked = S.trades.filter(function (t) { return t.id === S.app.trade_id; })[0];

    var cards = S.trades.map(function (t) {
      var code = (t.code || '').toUpperCase();
      var blurb = TRADE_BLURBS[code] || t.notes || '';
      return '<button type="button" class="trade-card' +
        (S.app.trade_id === t.id ? ' is-picked' : '') + '" data-trade="' + esc(t.id) + '" ' +
        'aria-pressed="' + (S.app.trade_id === t.id ? 'true' : 'false') + '">' +
        '<h4>' + esc(t.name) + '</h4>' +
        (blurb ? '<p>' + esc(blurb) + '</p>' : '') +
        (t.positions ? '<span class="tc-posts">' + esc(t.positions) +
           ' position' + (t.positions === 1 ? '' : 's') + ' this intake</span>' : '') +
        '</button>';
    }).join('');

    return '<div class="card">' +
      '<div class="card-head"><div class="eyebrow">Step 3</div><h1>Choose your trade</h1>' +
      '<p>This is the decision that shapes the next three years, so take a minute over it. ' +
      'You apply for one trade per intake, and the rest of the form changes to suit your choice.</p></div>' +

      '<div class="notice"><strong>Not sure which one?</strong>' +
      'Pick the trade whose work you would actually want to do all day. We assess you on your ' +
      'subjects and your aptitude, not on having decided years ago.</div>' +

      '<div class="trade-grid">' + cards + '</div>' +
      '<input type="hidden" id="trade_id" name="trade_id" value="' + esc(S.app.trade_id) + '">' +
      '<div class="field-error" data-err="trade_id" style="margin-top:.7rem"></div>' +
      (picked && picked.notes
        ? '<div class="notice" style="margin-top:1rem"><strong>' + esc(picked.name) +
          '</strong>' + esc(picked.notes) + '</div>' : '') +
      navRow() + '</div>';
  }

  /* ------------------------------------------------------ step: equity */
  function stepEquity() {
    var a = S.app;
    var races = [['african', 'African'], ['coloured', 'Coloured'], ['indian', 'Indian'],
                 ['white', 'White'], ['other', 'Other'], ['undisclosed', 'Prefer not to say']];
    var disTypes = ['Sight', 'Hearing', 'Communication or speech', 'Physical or mobility',
                    'Intellectual', 'Emotional or psychosocial', 'Multiple', 'Other'];
    var chosen = a.disability_types || [];

    return '<div class="card">' +
      '<div class="card-head"><div class="eyebrow">Step 4</div><h1>Employment equity</h1>' +
      '<p>ACTOM reports these figures to the Department of Employment and Labour under the Employment Equity Act.</p></div>' +

      '<div class="notice notice-warn"><strong>You may skip both questions</strong>' +
      'Race and disability are special personal information under section 26 of POPIA. ' +
      '"Prefer not to say" is a complete answer and does not count against your application.</div>' +

      '<div class="field"><span class="field-label">Population group</span>' +
      races.map(function (r) {
        return '<label class="choice"><input type="radio" name="ethnic_group" value="' + r[0] + '"' +
          (a.ethnic_group === r[0] ? ' checked' : '') + '>' +
          '<span class="choice-body"><strong>' + r[1] + '</strong></span></label>';
      }).join('') + '</div>' +

      '<div class="field"><span class="field-label">Do you have a disability?</span>' +
      [['no', 'No'], ['yes', 'Yes'], ['undisclosed', 'Prefer not to say']].map(function (d) {
        return '<label class="choice"><input type="radio" name="has_disability" value="' + d[0] + '"' +
          (a.has_disability === d[0] ? ' checked' : '') + '>' +
          '<span class="choice-body"><strong>' + d[1] + '</strong></span></label>';
      }).join('') + '</div>' +

      '<div id="disDetail" class="field ' + (a.has_disability === 'yes' ? '' : 'hidden') + '">' +
      '<span class="field-label">Type of disability</span>' +
      '<p class="hint">This helps us arrange reasonable accommodation for assessments and site work.</p>' +
      disTypes.map(function (d) {
        return '<label class="choice"><input type="checkbox" name="dis" value="' + esc(d) + '"' +
          (chosen.indexOf(d) >= 0 ? ' checked' : '') + '>' +
          '<span class="choice-body"><strong>' + esc(d) + '</strong></span></label>';
      }).join('') +
      '<div class="field" style="margin-top:.6rem"><label for="disability_other">Anything we should know to accommodate you</label>' +
      '<textarea id="disability_other" name="disability_other">' + esc(a.disability_other) + '</textarea></div></div>' +

      navRow() + '</div>';
  }

  function wireEquity() {
    Array.prototype.forEach.call($('content').querySelectorAll('[name="has_disability"]'), function (r) {
      r.addEventListener('change', function () {
        $('disDetail').classList.toggle('hidden', r.value !== 'yes' || !r.checked);
      });
    });
    $('content')._onNext = function () {
      var race = $('content').querySelector('[name="ethnic_group"]:checked');
      var dis = $('content').querySelector('[name="has_disability"]:checked');
      var types = Array.prototype.map.call(
        $('content').querySelectorAll('[name="dis"]:checked'), function (c) { return c.value; });
      saveApp({
        ethnic_group: race ? race.value : 'undisclosed',
        has_disability: dis ? dis.value : 'undisclosed',
        disability_types: (dis && dis.value === 'yes') ? types : [],
        disability_other: (dis && dis.value === 'yes') ? (val('disability_other') || null) : null
      }).then(function () { go(S.step + 1); });
    };
  }

  /* ------------------------------------------------------ step: school */
  function stepSchool() {
    var a = S.app;
    var ic = (S.cfg && S.cfg.intake) || {};
    var types = [
      ['nsc', 'National Senior Certificate (matric)'],
      ['nsc_technical', 'NSC — Technical'],
      ['ncv_l4', 'NC(V) Level 4'],
      ['senior_certificate', 'Senior Certificate'],
      ['amended_senior_certificate', 'Amended Senior Certificate'],
      ['none', 'I have not completed Grade 12']
    ];
    return '<div class="card">' +
      '<div class="card-head"><div class="eyebrow">Step 5</div><h1>Grade 12 results</h1>' +
      '<p>Enter the percentage for every subject you took. Leave the rest blank.</p></div>' +

      '<div class="grid grid-2">' +
      '<div class="field"><label for="grade12_type">Certificate type <span class="req">*</span></label>' +
      '<select id="grade12_type" name="grade12_type"><option value="">Select…</option>' +
      types.map(function (t) {
        return '<option value="' + t[0] + '"' + (a.grade12_type === t[0] ? ' selected' : '') +
          '>' + t[1] + '</option>';
      }).join('') + '</select><div class="field-error" data-err="grade12_type"></div></div>' +
      '<div class="field"><label for="grade12_year">Year completed</label>' +
      '<input type="number" id="grade12_year" name="grade12_year" min="1980" max="2030" ' +
      'value="' + esc(a.grade12_year) + '"></div></div>' +

      '<div id="marksBlock"></div>' +
      '<div class="field-error" data-err="marks"></div>' +
      navRow() + '</div>';
  }

  // Mirrors public.school_stream() in the database. A learner writes
  // either the academic NSC or the technical one, never both, so only
  // the matching block is ever shown.
  function schoolStream(grade12Type) {
    return { nsc_technical: 'technical', ncv_l4: 'technical',
             nsc: 'academic', senior_certificate: 'academic',
             amended_senior_certificate: 'academic' }[grade12Type] || null;
  }

  function marksTable(stream) {
    var list = S.subjects[stream] || [];
    if (!list.length) {
      return '<p class="muted small">No subjects are set for this trade.</p>';
    }
    return '<div class="marks" data-stream="' + stream + '">' +
      list.map(function (s, i) {
        var v = S.marks[stream] && S.marks[stream][s.name];
        var id = 'm_' + stream + '_' + i;
        var note = [];
        if (s.min_mark != null) note.push('at least ' + s.min_mark + '%');
        if (s.weight >= 3) note.push('counts heavily');
        return '<div class="mark-row"><label for="' + id + '">' + esc(s.name) +
          (s.required ? ' <span class="req">*</span>' : '') +
          (note.length ? '<br><span class="meta" style="font-size:.78rem;color:var(--ink-faint)">' +
            esc(note.join(' &middot; ')).replace('&amp;middot;', '&middot;') + '</span>' : '') +
          '</label>' +
          '<input type="number" id="' + id + '" min="0" max="100" ' +
          'inputmode="numeric" data-subject="' + esc(s.name) + '" ' +
          (s.required ? 'data-required="1" ' : '') +
          'value="' + (v == null ? '' : esc(v)) + '" placeholder="%"></div>';
      }).join('') + '</div>';
  }

  function collectMarks(stream) {
    var rows = [];
    var box = $('content').querySelector('[data-stream="' + stream + '"]');
    if (!box) return rows;
    Array.prototype.forEach.call(box.querySelectorAll('input[data-subject]'), function (i) {
      var v = i.value.trim();
      if (v === '') return;
      var n = parseInt(v, 10);
      if (isNaN(n) || n < 0 || n > 100) return;
      rows.push({ application_id: S.app.id, stream: stream, subject_name: i.dataset.subject, mark: n });
    });
    return rows;
  }

  function renderMarksBlock() {
    var box = $('marksBlock');
    if (!box) return;
    var stream = schoolStream(val('grade12_type'));

    if (!stream) {
      box.innerHTML = '<p class="muted small" style="margin-top:1.2rem">' +
        'Choose your certificate type above and the right subject list will appear.</p>';
      return;
    }
    if (stream === 'technical' && (S.cfg && S.cfg.intake &&
        S.cfg.intake.show_technical === false)) {
      box.innerHTML = '';
      return;
    }
    if (!S.subjects[stream] || !S.subjects[stream].length) {
      box.innerHTML = '<p class="muted small" style="margin-top:1.2rem">' +
        'No subjects are set for this trade.</p>';
      return;
    }

    box.innerHTML =
      '<h3 style="margin-top:1.4rem">' +
      (stream === 'technical' ? 'Technical subjects' : 'Academic subjects') + '</h3>' +
      '<p class="hint">These are the subjects for the certificate you selected. ' +
      'Enter a percentage for each one you took, and leave the rest blank.</p>' +
      marksTable(stream);
  }

  function wireSchool() {
    renderMarksBlock();

    // Changing the certificate type changes which subjects apply. The
    // database clears the other stream on save; this keeps the form in
    // step so the applicant is never shown marks that will be discarded.
    $('grade12_type').addEventListener('change', function () {
      var keep = schoolStream(this.value);
      ['academic', 'technical'].forEach(function (st) {
        if (st !== keep) S.marks[st] = {};
      });
      renderMarksBlock();
    });

    $('content')._onNext = function () {
      fieldError('grade12_type', '');
      if (!val('grade12_type')) {
        return fieldError('grade12_type', 'Tell us which certificate you have.');
      }
      var active = schoolStream(val('grade12_type'));
      var rows = active ? collectMarks(active) : [];

      // The database re-checks this at submission; catching it here saves
      // the applicant a wasted trip to the last step.
      var missing = [];
      [active].filter(Boolean).forEach(function (stream) {
        var box = $('content').querySelector('[data-stream="' + stream + '"]');
        if (!box) return;
        Array.prototype.forEach.call(box.querySelectorAll('input[data-required]'), function (i) {
          if (!i.value.trim()) missing.push(i.dataset.subject);
        });
      });
      var mErr = $('content').querySelector('[data-err="marks"]');
      if (mErr) mErr.textContent = '';
      if (missing.length) {
        mErr.textContent = 'This trade requires a mark for: ' + missing.join(', ') +
          '. Enter 0 if you did not take the subject.';
        mErr.scrollIntoView({ block: 'center' });
        return;
      }

      Promise.all([
        saveApp({
          grade12_type: val('grade12_type'),
          grade12_year: val('grade12_year') ? parseInt(val('grade12_year'), 10) : null
        }),
        replaceMarks(['academic', 'technical'], rows)
      ]).then(function () { go(S.step + 1); });
    };
  }

  /* ----------------------------------------------------- step: further */
  function stepFurther() {
    var a = S.app;
    return '<div class="card">' +
      '<div class="card-head"><div class="eyebrow">Step 6</div><h1>Further qualifications</h1>' +
      '<p>N-certificates, NC(V), a TVET diploma, or a completed learnership. Skip this step if Grade 12 is your highest.</p></div>' +
      '<div class="grid grid-2">' +
      '<div class="field"><label for="highest_qualification">Highest qualification</label>' +
      '<input type="text" id="highest_qualification" name="highest_qualification" ' +
      'placeholder="e.g. N3 Electrical Engineering" value="' + esc(a.highest_qualification) + '"></div>' +
      '<div class="field"><label for="highest_qual_year">Year completed</label>' +
      '<input type="number" id="highest_qual_year" name="highest_qual_year" min="1980" max="2030" ' +
      'value="' + esc(a.highest_qual_year) + '"></div></div>' +
      '<div class="field"><label for="highest_qual_institution">Institution</label>' +
      '<input type="text" id="highest_qual_institution" name="highest_qual_institution" ' +
      'value="' + esc(a.highest_qual_institution) + '"></div>' +
      (S.subjects.qualification.length
        ? '<h3 style="margin-top:1.4rem">Subjects and marks</h3>' + marksTable('qualification') : '') +
      navRow() + '</div>';
  }

  function wireFurther() {
    $('content')._onNext = function () {
      Promise.all([
        saveApp({
          highest_qualification: val('highest_qualification') || null,
          highest_qual_institution: val('highest_qual_institution') || null,
          highest_qual_year: val('highest_qual_year') ? parseInt(val('highest_qual_year'), 10) : null
        }),
        replaceMarks(['qualification'], collectMarks('qualification'))
      ]).then(function () { go(S.step + 1); });
    };
  }

  /* --------------------------------------------------- step: documents */
  // Configured per intake. The fallback only applies if config failed to
  // load; the ID document is enforced as required by the database either way.
  function docTypes() {
    var d = (S.cfg && S.cfg.documents) || [];
    if (d.length) {
      return d.map(function (x) {
        return { key: x.doc_type, label: x.label, hint: x.hint || '',
                 required: x.required, max: x.max_files || 1 };
      });
    }
    return [{ key: 'id_document', label: 'Certified copy of your ID', required: true, max: 1,
              hint: 'Certified within the last three months.' }];
  }

  function stepDocuments() {
    return '<div class="card">' +
      '<div class="card-head"><div class="eyebrow">Step 7</div><h1>Your documents</h1>' +
      '<p>PDF, JPG, PNG or HEIC. Up to 8 MB each. Photos taken on a phone are fine as long as the text is readable.</p></div>' +
      '<div class="notice"><strong>Where your files go</strong>' +
      'Into private ACTOM storage. They are never given a public web address, and only reviewers ' +
      'working on your trade can open them.</div>' +
      docTypes().map(function (d) {
        var mine = S.docs.filter(function (x) { return x.doc_type === d.key; });
        return '<div class="field"><span class="field-label">' + esc(d.label) +
          (d.required ? ' <span class="req">*</span>' : '') + '</span>' +
          '<p class="hint">' + esc(d.hint) +
          (d.hint ? ' ' : '') + esc(slotHint(d.max)) + '</p>' +
          '<div class="drop" data-doctype="' + d.key + '" data-max="' + d.max + '">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-pick="' + d.key + '">Choose a file</button>' +
          '<p>or drag it here</p>' +
          '<input type="file" class="hidden" data-input="' + d.key + '" ' +
          'accept=".pdf,.jpg,.jpeg,.png"></div>' +
          '<ul class="file-list" data-list="' + d.key + '">' + mine.map(fileItem).join('') + '</ul>' +
          '<div class="field-error" data-err="doc_' + d.key + '"></div></div>';
      }).join('') +
      navRow() + '</div>';
  }

  // The limit comes from the intake config, so it has to be stated
  // rather than hard-coded into the copy. Being told "you can add three"
  // up front beats discovering it by being refused on the fourth.
  function slotHint(max) {
    return max > 1 ? 'You can add up to ' + max + ' files here.'
                   : 'One file only.';
  }

  /* Reflect a full slot in the control itself. The count is enforced in
     the database either way; this is so a full slot looks full instead
     of offering a button that only produces an error. Called after every
     add and remove, because those patch the list in place rather than
     re-rendering the step. */
  function refreshSlot(docType) {
    var drop = $('content').querySelector('[data-doctype="' + docType + '"]');
    if (!drop) return;

    var max  = parseInt(drop.dataset.max, 10) || 1;
    var used = S.docs.filter(function (d) { return d.doc_type === docType; }).length;
    var full = used >= max;

    // Never fight the uploading state — setUploadBusy owns the control
    // while a request is in flight and releases it afterwards.
    if (uploading[docType]) return;

    var btn   = drop.querySelector('[data-pick="' + docType + '"]');
    var prompt = drop.querySelector('p');

    // The hidden <input> is deliberately NOT disabled here. Its disabled
    // flag means one thing only — an upload is in flight — and
    // setUploadBusy owns it. Overloading it with "slot is full" makes
    // "did the busy lock release?" unanswerable. A full slot is closed by
    // disabling the button and by pointer-events:none on .drop.is-full,
    // which also stops a drag-and-drop, and handleUpload re-checks the
    // count regardless.
    drop.classList.toggle('is-full', full);
    if (btn) {
      btn.disabled = full;
      btn.textContent = full
        ? (max > 1 ? 'All ' + max + ' files added' : 'File added')
        : (used ? 'Add another file' : 'Choose a file');
    }
    if (prompt) {
      prompt.textContent = full
        ? 'Remove one to replace it.'
        : 'or drag it here';
    }
  }

  function fileItem(doc) {
    return '<li class="file-item" data-doc="' + esc(doc.id) + '">' +
      '<span class="name">' + esc(doc.original_filename) + '</span>' +
      '<span class="meta">' + Math.round(doc.size_bytes / 1024) + ' KB</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-remove="' + esc(doc.id) + '">Remove</button></li>';
  }

  function wireDocuments() {
    var root = $('content');

    // #content itself survives every innerHTML assignment — only its
    // children are replaced. A listener added here on each render
    // therefore accumulates, and the handler fires once per visit to
    // this step. Bind the delegated listener exactly once.
    if (!root._docsDelegated) {
      root._docsDelegated = true;
      root.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || !t.dataset) return;
        if (t.dataset.remove) { removeDoc(t.dataset.remove); return; }
        if (t.dataset.pick) {
          var input = root.querySelector('[data-input="' + t.dataset.pick + '"]');
          if (input) input.click();
        }
      });
      root.addEventListener('change', function (ev) {
        var i = ev.target;
        if (!i || !i.dataset || !i.dataset.input) return;
        var file = i.files && i.files[0];
        i.value = '';                       // cleared first, so a repeat
        if (file) handleUpload(i.dataset.input, file);   // pick of the same
      });                                                 // file still fires
    }

    docTypes().forEach(function (d) { refreshSlot(d.key); });

    root.querySelectorAll('.drop').forEach(function (d) {
      ['dragenter', 'dragover'].forEach(function (e) {
        d.addEventListener(e, function (ev) { ev.preventDefault(); d.classList.add('is-over'); });
      });
      ['dragleave', 'drop'].forEach(function (e) {
        d.addEventListener(e, function (ev) { ev.preventDefault(); d.classList.remove('is-over'); });
      });
      d.addEventListener('drop', function (ev) {
        if (ev.dataTransfer.files[0]) handleUpload(d.dataset.doctype, ev.dataTransfer.files[0]);
      });
    });

    root._onNext = function () {
      var blocked = null;
      docTypes().forEach(function (d) {
        var el = root.querySelector('[data-err="doc_' + d.key + '"]');
        if (el) el.textContent = '';
        if (!d.required) return;
        if (S.docs.some(function (x) { return x.doc_type === d.key; })) return;
        if (el) {
          el.textContent = 'This document is required before you can submit.';
          if (!blocked) blocked = el;
        }
      });
      if (blocked) { blocked.scrollIntoView({ block: 'center' }); return; }
      go(S.step + 1);
    };
  }

  // Signature check. The bucket enforces MIME type server-side too; this
  // just catches a renamed file before the applicant wastes their data.
  function sniff(buf) {
    var b = new Uint8Array(buf);
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    // Still detected, deliberately: an iPhone photo is the most likely
    // rejected upload, and "that is a HEIC, here is how to fix it" is far
    // more use to an applicant than a generic refusal.
    var ftyp = String.fromCharCode.apply(null, b.subarray(4, 12));
    if (/^ftyp(heic|heix|hevc|mif1|msf1)/.test(ftyp)) return 'image/heic';
    return null;
  }

  var uploading = {};   // doc_type -> true while a request is in flight

  /* The count is enforced in the database, so its message is what comes
     back when the browser check is bypassed or when the intake config
     changed mid-session. Raw Postgres text is no use to a 19-year-old on
     a phone, so the two cases that are actually reachable get real
     wording and everything else falls back to the generic line. */
  function uploadErrorText(e) {
    var msg = (e && e.message) ? String(e.message) : '';

    if (/Upload limit reached/i.test(msg)) {
      return 'You have already added the maximum number of files here. ' +
             'Remove one before adding another.';
    }
    if (/is not accepted for this intake/i.test(msg)) {
      return 'This document is no longer being collected for this intake. ' +
             'Refresh the page to see the current list.';
    }
    // Storage refused it. The row-level security message is the same one
    // a full slot produces at the bucket, so it is worded for that.
    if (/row-level security|violates.*policy/i.test(msg)) {
      return 'Storage refused that file. This usually means the slot is ' +
             'full or your application is no longer a draft. Refresh the ' +
             'page, and contact ' + CFG.SUPPORT_EMAIL + ' if it continues.';
    }
    return 'The upload did not go through: ' + (msg || 'unknown error') +
           '. Please try again.';
  }

  /* Visible waiting state while a file is going up. Uploads run over a
     phone connection and an 8 MB photo is not instant — without this the
     applicant sees nothing happen and taps again, which is how duplicate
     uploads start. The control is disabled rather than just relabelled,
     so a second attempt cannot be queued behind the first. */
  function setUploadBusy(docType, busy, filename) {
    var drop = $('content').querySelector('[data-doctype="' + docType + '"]');
    if (!drop) return;

    var btn = drop.querySelector('[data-pick="' + docType + '"]');
    var input = drop.querySelector('[data-input="' + docType + '"]');

    drop.classList.toggle('is-busy', !!busy);
    drop.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (input) input.disabled = !!busy;

    if (btn) {
      btn.disabled = !!busy;
      if (busy) {
        btn.dataset.label = btn.dataset.label || btn.textContent;
        btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Uploading\u2026';
      } else if (btn.dataset.label) {
        btn.textContent = btn.dataset.label;
      }
    }

    // Announced for anyone using a screen reader, who gets no benefit
    // from a spinner.
    var live = drop.querySelector('.upload-status');
    if (!live) {
      live = document.createElement('p');
      live.className = 'upload-status small muted';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      drop.appendChild(live);
    }
    live.textContent = busy
      ? 'Uploading ' + (filename || 'your file') + '. Please wait \u2014 do not close this page.'
      : '';
  }


  function handleUpload(docType, file) {
    var cfg = docTypes().filter(function (d) { return d.key === docType; })[0];
    var existing = S.docs.filter(function (d) { return d.doc_type === docType; });
    var errEl = $('content').querySelector('[data-err="doc_' + docType + '"]');
    if (errEl) errEl.textContent = '';

    if (!cfg) {
      console.error('No configuration for document type', docType);
      if (errEl) errEl.textContent = 'This upload is not configured. Contact ' + CFG.SUPPORT_EMAIL + '.';
      return;
    }

    // A second file chosen while the first is still uploading would create
    // two rows for a single-file slot, because S.docs has not been updated
    // yet and the max check below would still pass.
    if (uploading[docType]) {
      if (errEl) errEl.textContent = 'Still uploading the last file. Give it a moment.';
      return;
    }

    if (existing.length >= cfg.max) {
      errEl.textContent = 'You can upload ' + cfg.max + ' file' + (cfg.max > 1 ? 's' : '') +
        ' here. Remove one first.';
      return;
    }
    if (file.size > CFG.MAX_UPLOAD_BYTES) {
      errEl.textContent = 'That file is ' + Math.round(file.size / 1048576) +
        ' MB. The limit is ' + Math.round(CFG.MAX_UPLOAD_BYTES / 1048576) +
        ' MB — try photographing the page again at a lower resolution.';
      return;
    }
    if (file.size === 0) { errEl.textContent = 'That file is empty.'; return; }

    if (!file.slice || !file.slice(0, 1).arrayBuffer) {
      if (errEl) errEl.textContent =
        'This browser cannot read the file for checking. Try Chrome, Edge or Safari.';
      return;
    }

    // Claim the slot NOW, before any async work. Reading and SHA-256
    // hashing a multi-megabyte photo takes seconds on a phone, and the
    // guard above is useless if it is only armed after that: the
    // applicant sees nothing happen, taps again, and both uploads run.
    uploading[docType] = true;
    setUploadBusy(docType, true, file.name);

    // Every path out of here must release it, or the slot stays locked
    // and the applicant cannot retry.
    function release() {
      uploading[docType] = false;
      setUploadBusy(docType, false);
      refreshSlot(docType);     // after, so the busy state is cleared first
    }

    file.slice(0, 32).arrayBuffer().then(function (head) {
      var real = sniff(head);
      if (real === 'image/heic') {
        errEl.innerHTML = 'That is an iPhone HEIC photo, which we cannot accept. ' +
          'On your iPhone go to <strong>Settings &rarr; Camera &rarr; Formats</strong> and ' +
          'choose <strong>Most Compatible</strong>, then take the photo again \u2014 or email ' +
          'the photo to yourself, which converts it to JPG.';
        release();
        return null;
      }
      if (!real || !CFG.ACCEPTED_TYPES[real]) {
        errEl.textContent = 'We can only accept PDF, JPG or PNG files. ' +
          'Renaming a file does not change what is inside it.';
        release();
        return null;
      }
      return file.arrayBuffer().then(function (buf) {
        return crypto.subtle.digest('SHA-256', buf).then(function (h) {
          var hex = Array.prototype.map.call(new Uint8Array(h), function (x) {
            return x.toString(16).padStart(2, '0');
          }).join('');
          var ext = CFG.ACCEPTED_TYPES[real][0];
          var path = S.app.id + '/' + docType + '/' + crypto.randomUUID() + '.' + ext;

          var li = document.createElement('li');
          li.className = 'file-item is-uploading';
          li.innerHTML = '<span class="name">' + esc(file.name) + '</span>' +
                         '<span class="meta"><span class="spinner" aria-hidden="true"></span>' +
                         'Uploading\u2026</span>';
          $('content').querySelector('[data-list="' + docType + '"]').appendChild(li);

          // Tracks whether the bytes made it into the bucket, so the
          // failure path knows whether there is anything to clean up.
          var stored = false;

          return sb.storage.from('applicant-documents')
            .upload(path, file, { contentType: real, upsert: false })
            .then(function (up) {
              if (up.error) throw up.error;
              stored = true;
              return sb.from('application_documents').insert({
                application_id: S.app.id, doc_type: docType, storage_path: path,
                original_filename: file.name.slice(0, 180), mime_type: real,
                size_bytes: file.size, sha256: hex
              }).select().single();
            })
            .then(function (ins) {
              if (ins.error) throw ins.error;
              S.docs.push(ins.data);
              li.outerHTML = fileItem(ins.data);
              toast('Uploaded');
            })
            .catch(function (e) {
              li.remove();

              // The object goes up before the catalogue row. If the row
              // failed, the bytes are already in the bucket with nothing
              // pointing at them — they count against the storage
              // ceiling but no reviewer will ever see them. Left behind,
              // enough of them would consume the slot for a REQUIRED
              // document and leave an application that cannot be
              // submitted at all. Best effort: if this delete also
              // fails, migration 015 part 6 sweeps the remainder.
              if (stored) {
                sb.storage.from('applicant-documents').remove([path])
                  .catch(function (ce) { console.error('Orphan left in storage', path, ce); });
              }

              if (errEl) errEl.textContent = uploadErrorText(e);
              console.error('Upload failed', e);
            })
            .then(release);
        });
      });
    }).catch(function (e) {
      // Reading or hashing the file failed — a corrupt file, or memory
      // pressure on a cheap phone. Without this the slot stays locked
      // and the applicant cannot retry at all.
      release();
      if (errEl) {
        errEl.textContent = 'We could not read that file. Try choosing it again, ' +
          'or use a different one.';
      }
      console.error('Could not read the file', e);
    });
  }

  function removeDoc(id) {
    var doc = S.docs.filter(function (d) { return d.id === id; })[0];
    if (!doc) return;
    if (!confirm('Remove ' + doc.original_filename + '?')) return;
    sb.storage.from('applicant-documents').remove([doc.storage_path])
      .then(function () { return sb.from('application_documents').delete().eq('id', id); })
      .then(function () {
        S.docs = S.docs.filter(function (d) { return d.id !== id; });
        var li = $('content').querySelector('[data-doc="' + id + '"]');
        if (li) li.remove();
        refreshSlot(doc.doc_type);   // re-enables a slot that was full
        toast('Removed');
      });
  }

  /* ---------------------------------------------------- step: guardian */
  function stepGuardian() {
    var g = S.guardian || {};
    return '<div class="card">' +
      '<div class="card-head"><div class="eyebrow">Step 8</div><h1>Parent or guardian consent</h1>' +
      '<p>You are under 18, so section 35 of POPIA requires a parent or legal guardian to consent before we may process your information.</p></div>' +
      '<div class="grid grid-2">' +
      '<div class="field"><label for="g_name">Full name <span class="req">*</span></label>' +
      '<input type="text" id="g_name" name="g_name" value="' + esc(g.full_name) + '">' +
      '<div class="field-error" data-err="g_name"></div></div>' +
      '<div class="field"><label for="g_rel">Relationship to you <span class="req">*</span></label>' +
      '<input type="text" id="g_rel" name="g_rel" placeholder="Mother, father, legal guardian" ' +
      'value="' + esc(g.relationship) + '"><div class="field-error" data-err="g_rel"></div></div>' +
      '</div>' +
      '<div class="grid grid-2">' +
      '<div class="field"><label for="g_contact">Contact number <span class="req">*</span></label>' +
      '<input type="tel" id="g_contact" name="g_contact" value="' + esc(g.contact_number) + '">' +
      '<div class="field-error" data-err="g_contact"></div></div>' +
      '<div class="field"><label for="g_email">Email address</label>' +
      '<input type="email" id="g_email" name="g_email" value="' + esc(g.email) + '"></div>' +
      '</div>' +
      '<div class="field"><label for="g_id">Their ID number</label>' +
      '<input type="text" id="g_id" name="g_id" inputmode="numeric" maxlength="13" ' +
      'placeholder="' + (g.id_number_last4 ? '•••••••••' + esc(g.id_number_last4) : '') + '">' +
      '<div class="hint">Encrypted the same way as yours.</div></div>' +

      '<h3 style="margin-top:1.4rem">Guardian declaration</h3>' +
      '<div style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:4px;padding:.9rem;font-size:.9rem;white-space:pre-wrap">' +
      esc(S.consent.guardian ? S.consent.guardian.body : '') + '</div>' +
      '<label class="choice" style="margin-top:.8rem"><input type="checkbox" id="g_consent">' +
      '<span class="choice-body"><strong>My parent or guardian has read this and consents</strong>' +
      '<span>They should complete this section themselves.</span></span></label>' +
      '<div class="field-error" data-err="g_consent"></div>' +
      navRow() + '</div>';
  }

  function wireGuardian() {
    $('content')._onNext = function () {
      var ok = true;
      ['g_name', 'g_rel', 'g_contact'].forEach(function (f) {
        fieldError(f, '');
        if (!val(f)) { fieldError(f, 'This is required.'); ok = false; }
      });
      var el = $('content').querySelector('[data-err="g_consent"]');
      el.textContent = '';
      if (!$('g_consent').checked) {
        el.textContent = 'We cannot continue without guardian consent.'; ok = false;
      }
      if (!ok) return;

      sb.rpc('set_guardian', {
        p_application: S.app.id, p_full_name: val('g_name'), p_relationship: val('g_rel'),
        p_contact: val('g_contact'), p_email: val('g_email') || null, p_id_number: val('g_id') || null
      }).then(function (r) {
        if (r.error) throw r.error;
        return sb.rpc('record_consent', {
          p_application: S.app.id, p_version: S.consent.guardian.version,
          p_audience: 'guardian', p_user_agent: navigator.userAgent
        });
      }).then(function () { toast('Consent recorded'); go(S.step + 1); })
        .catch(function (e) { alert('We could not save that: ' + e.message); });
    };
  }

  /* ------------------------------------------------------ step: review */
  function stepReview() {
    var a = S.app;
    var trade = S.trades.filter(function (t) { return t.id === a.trade_id; })[0];
    var count = function (s) { return Object.keys(S.marks[s] || {}).length; };

    return '<div class="card">' +
      '<div class="card-head"><div class="eyebrow">Last step</div><h1>Check and submit</h1>' +
      '<p>Once you submit you cannot edit this application. Read it over first.</p></div>' +
      '<dl class="kv">' +
      row('Name', a.full_name) +
      row('ID', a.id_number_last4 ? '•••••••••' + a.id_number_last4 : '—') +
      row('Mobile', a.contact_number) +
      row('Address', [a.address_line1, a.suburb, a.city, a.province, a.postal_code]
            .filter(Boolean).join(', ')) +
      row('Trade', trade ? trade.name : '—') +
      row('Grade 12', a.grade12_type || '—') +
      row('Subjects captured', count('academic') + count('technical') + count('qualification')) +
      row('Documents', S.docs.length) +
      '</dl>' +

      '<h3 style="margin-top:1.5rem">Privacy notice and declaration</h3>' +
      '<div style="max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:4px;padding:.9rem;font-size:.9rem;white-space:pre-wrap">' +
      esc(S.consent.applicant ? S.consent.applicant.body : '') + '</div>' +
      '<label class="choice" style="margin-top:.8rem"><input type="checkbox" id="a_consent">' +
      '<span class="choice-body"><strong>I have read this and I agree</strong>' +
      '<span>The information I have given is true and complete.</span></span></label>' +
      '<div class="field-error" data-err="a_consent"></div>' +
      '<div id="submitProblems"></div>' +
      navRow({ nextLabel: 'Submit my application' }) + '</div>';
  }

  function row(k, v) {
    return '<dt>' + esc(k) + '</dt><dd>' + esc(v == null || v === '' ? '—' : v) + '</dd>';
  }

  function wireReview() {
    $('content')._onNext = function () {
      var el = $('content').querySelector('[data-err="a_consent"]');
      el.textContent = '';
      if (!$('a_consent').checked) {
        el.textContent = 'Tick the box to confirm you agree before submitting.';
        return;
      }
      var btn = $('content').querySelector('[data-nav="next"]');
      btn.disabled = true; btn.textContent = 'Submitting…';

      sb.rpc('record_consent', {
        p_application: S.app.id, p_version: S.consent.applicant.version,
        p_audience: 'applicant', p_user_agent: navigator.userAgent
      }).then(function () {
        return sb.rpc('submit_application', { p_application: S.app.id });
      }).then(function (r) {
        btn.disabled = false; btn.textContent = 'Submit my application';
        if (r.error) throw r.error;
        if (!r.data.ok) {
          $('submitProblems').innerHTML =
            '<div class="notice notice-err"><strong>Not quite ready</strong>Still missing: ' +
            esc(r.data.missing.join(', ')) + '. Step back and fill those in.</div>';
          return;
        }
        return loadApplication(S.app.id).then(renderSubmitted);
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = 'Submit my application';
        $('submitProblems').innerHTML =
          '<div class="notice notice-err"><strong>Submission failed</strong>' + esc(e.message) + '</div>';
      });
    };
  }

  /* ---------------------------------------------------- after submission */
  function renderSubmitted() {
    var a = S.app;
    $('content').innerHTML =
      outcomeCard(a) +
      (isClosedOutcome(a.status) ? '' : journeyCard()) +

      '<div class="card"><h2>Your information</h2>' +
      '<p class="small">POPIA gives you the right to see what we hold about you, to have it corrected, ' +
      'and to have it deleted.</p>' +
      '<div class="btn-row"><button class="btn btn-ghost btn-sm" id="exportBtn">Download my information</button>' +
      // Nothing left to withdraw once the application is closed.
      (isClosedOutcome(a.status) ? '' :
        '<button class="btn btn-ghost btn-sm" id="withdrawBtn" style="color:var(--err)">Withdraw my application</button>') +
      '</div>' +
      '<p class="small muted" style="margin-top:.8rem">For corrections, email ' +
      '<a href="mailto:' + CFG.PRIVACY_EMAIL + '">' + CFG.PRIVACY_EMAIL + '</a> with your reference number.</p></div>';

    $('exportBtn').addEventListener('click', function () {
      sb.rpc('my_data_export').then(function (r) {
        var blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'actom-application-' + (a.reference || 'draft') + '.json';
        link.click();
        URL.revokeObjectURL(url);
      });
    });

    if ($('withdrawBtn')) $('withdrawBtn').addEventListener('click', function () {
      if (!confirm('Withdraw this application? We will delete it within 30 days and you cannot undo this.')) return;
      sb.rpc('withdraw_application', { p_application: a.id, p_reason: 'Withdrawn by applicant' })
        .then(function () { return loadApplication(a.id); })
        .then(renderSubmitted);
    });
  }

  /* ==================================================== 5. Data layer */

  function saveApp(patch) {
    return sb.from('applications').update(patch).eq('id', S.app.id).select('id').single()
      .then(function (r) {
        if (r.error) throw r.error;
        Object.keys(patch).forEach(function (k) { S.app[k] = patch[k]; });
        toast('Saved');
      });
  }

  // Marks are replaced wholesale per stream so a cleared field actually
  // clears, rather than leaving a stale row behind.
  function replaceMarks(streams, rows) {
    return sb.from('application_subjects').delete()
      .eq('application_id', S.app.id).in('stream', streams)
      .then(function () {
        if (!rows.length) return { error: null };
        return sb.from('application_subjects').insert(rows);
      })
      .then(function (r) {
        if (r && r.error) throw r.error;
        streams.forEach(function (s) { S.marks[s] = {}; });
        rows.forEach(function (row) { S.marks[row.stream][row.subject_name] = row.mark; });
      });
  }

  /* ------------------------------------------------------------- start */
  sb.auth.getSession().then(function (r) {
    if (r.data.session) { boot(); }
    else { $('signin').classList.remove('hidden'); }
  });
})();
