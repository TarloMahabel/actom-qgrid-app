/* =====================================================================
   DEMO ONLY — in-memory stand-in for @supabase/supabase-js

   This file exposes the same surface the real client does, so app.js and
   admin.js run completely unmodified. Nothing leaves the browser: data
   lives in localStorage under 'actom_demo_db' and resets from the
   "Reset demo" button in the banner.

   Do NOT deploy this file. The production build uses vendor/supabase.js.
   ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------- polyfills
     file:// pages are not a secure context, so crypto.subtle and
     crypto.randomUUID may be missing. app.js needs both. The digest
     below is a stand-in, not a real SHA-256 — it exists so the upload
     path runs, and it never reaches a production build. */
  if (!window.crypto) window.crypto = {};
  if (!crypto.randomUUID) {
    crypto.randomUUID = function () {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    };
  }
  if (!crypto.subtle || !crypto.subtle.digest) {
    crypto.subtle = crypto.subtle || {};
    crypto.subtle.digest = function (_alg, buf) {
      var b = new Uint8Array(buf), out = new Uint8Array(32), h = 2166136261;
      for (var i = 0; i < b.length; i++) { h ^= b[i]; h = (h * 16777619) >>> 0; }
      for (var j = 0; j < 32; j++) { h = (h * 16777619 + j) >>> 0; out[j] = h & 0xff; }
      return Promise.resolve(out.buffer);
    };
  }

  var KEY = 'actom_demo_db', SKEY = 'actom_demo_session';

  // Chrome blocks localStorage on file:// URLs. Fall back to memory so the
  // demo still runs when someone double-clicks index.html.
  var LS = (function () {
    try {
      window.localStorage.setItem('__probe', '1');
      window.localStorage.removeItem('__probe');
      return window.localStorage;
    } catch (e) {
      var mem = {};
      return {
        getItem: function (k) { return k in mem ? mem[k] : null; },
        setItem: function (k, v) { mem[k] = String(v); },
        removeItem: function (k) { delete mem[k]; }
      };
    }
  })();
  var files = {};   // storage_path -> blob URL, for files uploaded this session

  /* ---------------------------------------------------------- helpers */
  function uuid() { return crypto.randomUUID(); }
  function now() { return new Date().toISOString(); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function userIdFor(email) {
    var h = 0;
    for (var i = 0; i < email.length; i++) { h = (h * 31 + email.charCodeAt(i)) >>> 0; }
    return 'demo-' + h.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000000'.slice(8);
  }

  /* ------------------------------------------------------------- seed */
  function seed() {
    var intakeId = uuid();
    var closes = new Date(); closes.setMonth(closes.getMonth() + 2);
    var opens = new Date(); opens.setMonth(opens.getMonth() - 1);

    var trades = [
      ['ELEC', 'Electrician', 'Electrical Products', 10],
      ['MILL', 'Millwright', 'Electrical Machines', 20],
      ['FITT', 'Fitter and Turner', 'Electrical Machines', 30],
      ['BOIL', 'Boilermaker', 'Power Systems', 40],
      ['WELD', 'Welder', 'Power Systems', 50],
      ['TRWD', 'Transformer Winder', 'Power Transformers', 60],
      ['INST', 'Instrument Mechanician', 'Protection and Control', 70],
      ['DIES', 'Diesel Mechanic', 'Static Power', 80],
      ['RIGG', 'Rigger', 'Power Systems', 90],
      ['TOOL', 'Toolmaker', 'Electrical Machines', 100],
      ['PLAT', 'Plater', 'Power Systems', 110]
    ].map(function (t) {
      return { id: uuid(), code: t[0], name: t[1], division: t[2], sort_order: t[3], active: true, stream: 'both' };
    });

    var academic = ['Mathematics', 'Mathematical Literacy', 'Physical Science', 'Life Science',
      'Life Orientation', 'Home Language', 'First Additional Language', 'Agricultural Science',
      'Geography', 'History', 'Religious Studies', 'Business Studies', 'Accounting', 'Economics',
      'Computer Applications Technology', 'Information Technology', 'Design', 'Tourism', 'Consumer Studies'];
    var technical = ['Technical Mathematics', 'Technical Science', 'Engineering Graphics and Design',
      'Technical Drawing', 'Mechanical Drawing', 'Electrical Technology', 'Mechanical Technology',
      'Civil Technology', 'Mechanical Welding', 'Fitting and Machining Theory', 'Trade Theory',
      'Agricultural Management', 'Life Orientation', 'Home Language', 'First Additional Language', 'Design'];
    var qualification = ['Mathematics', 'Engineering Science', 'Engineering Drawing',
      'Engineering Graphics and Design', 'Engineering Fundamentals', 'Engineering Systems',
      'Engineering Technology', 'Electrical Principles and Practice', 'Electrical Systems and Construction',
      'Electrical Workmanship', 'Industrial Electronics', 'Digital Electronics', 'Logic Systems',
      'Electrotechnics', 'Computer Principles', 'Workshop Practice', 'Material Technology',
      'Fitting and Turning', 'Fitting and Machining', 'Mechanotechnics', 'Mechanical Draughting',
      'Engineering Fabrication', 'Welding', 'Strength of Materials and Structures', 'Power Machines',
      'Fluid Mechanics', 'Diesel Trade Theory', 'Trade Theory', 'Supervisory Management',
      'Life Orientation', 'Language'];

    var subjects = [];
    [['academic', academic], ['technical', technical], ['qualification', qualification]]
      .forEach(function (pair) {
        pair[1].forEach(function (n, i) {
          subjects.push({ id: uuid(), stream: pair[0], name: n, sort_order: (i + 1) * 10, active: true });
        });
      });

    var db = {
      intakes: [{
        id: intakeId, name: '2027 Apprenticeship Intake',
        opens_at: opens.toISOString(), closes_at: closes.toISOString(),
        status: 'open', retention_months: 12, created_at: now(),
        published_at: opens.toISOString(), published_by: null, closed_at: null,
        show_further_study: true, show_technical: true,
        intro_heading: null, intro_body: null, closed_message: null,
        consent_version: '2026.1', max_upload_mb: 8,
        scoring_enabled: true, auto_flag_below: true
      }, {
        id: 'draft-intake-0000-4000-8000-000000000001',
        name: '2028 Apprenticeship Intake (draft)',
        opens_at: new Date(Date.now() + 200 * 864e5).toISOString(),
        closes_at: new Date(Date.now() + 260 * 864e5).toISOString(),
        status: 'draft', retention_months: 12, created_at: now(),
        published_at: null, published_by: null, closed_at: null,
        show_further_study: true, show_technical: true,
        intro_heading: null, intro_body: null, closed_message: null,
        consent_version: '2026.1', max_upload_mb: 8,
        scoring_enabled: true, auto_flag_below: true
      }],
      trades: trades,
      subjects: subjects,
      intake_trades: [],
      consent_versions: [
        { id: uuid(), version: '2026.1', audience: 'applicant', active: true, body: APPLICANT_CONSENT },
        { id: uuid(), version: '2026.1', audience: 'guardian', active: true, body: GUARDIAN_CONSENT }
      ],
      intake_trade_subjects: [], intake_documents: [],
      apprentices: [],
      applications: [], application_subjects: [], application_documents: [],
      guardians: [], consents: [], application_reviews: [],
      reviewer_profiles: [], reviewer_trades: [],
      pii_access_log: [], application_events: [],
      _seq: 400
    };

    // A populated review queue, so the reviewer side is not empty.
    var people = [
      ['Thandeka Mokoena', 'MILL', 'african', 'nsc_technical', 'submitted', true],
      ['Sipho Ndlovu', 'ELEC', 'african', 'nsc', 'submitted', false],
      ['Chantelle Adams', 'INST', 'coloured', 'nsc', 'under_review', false],
      ['Kagiso Molefe', 'BOIL', 'african', 'ncv_l4', 'submitted', false],
      ['Riaan van Wyk', 'FITT', 'white', 'nsc_technical', 'shortlisted', false],
      ['Precious Dube', 'TRWD', 'african', 'nsc', 'submitted', false],
      ['Yusuf Patel', 'DIES', 'indian', 'nsc_technical', 'under_review', false],
      ['Lerato Sithole', 'WELD', 'african', 'nsc', 'declined', false],
      ['Bongani Zulu', 'RIGG', 'african', 'senior_certificate', 'submitted', true],
      ['Michelle Fourie', 'TOOL', 'white', 'nsc', 'submitted', false],
      ['Andile Khumalo', 'ELEC', 'african', 'nsc_technical', 'shortlisted', false],
      ['Nadia Isaacs', 'PLAT', 'coloured', 'undisclosed', 'submitted', false]
    ];
    var cities = [['Benoni', 'Gauteng'], ['Vereeniging', 'Gauteng'], ['Boksburg', 'Gauteng'],
                  ['Springs', 'Gauteng'], ['Alberton', 'Gauteng'], ['Germiston', 'Gauteng']];

    people.forEach(function (p, i) {
      var trade = trades.filter(function (t) { return t.code === p[1]; })[0];
      var city = cities[i % cities.length];
      var sub = new Date(Date.now() - (i * 36 + 4) * 3600 * 1000);
      var appId = uuid();
      db._seq++;
      db.applications.push({
        id: appId, reference: 'ACT-APP-2026-' + String(db._seq).padStart(6, '0'),
        applicant_user_id: uuid(), intake_id: intakeId, trade_id: trade.id,
        status: p[4], full_name: p[0], id_type: 'sa_id',
        id_number_plain: ['9803122081084', '0111046042086', '1007225013089', '0902182071081'][i % 4],
        id_number_last4: ['1084', '2086', '3089', '1081'][i % 4],
        date_of_birth: p[5] ? '2009-02-18' : '1998-03-12',
        gender: i % 2 ? 'male' : 'female', citizenship: 'sa_citizen', is_minor: p[5],
        contact_number: '08' + (2 + i % 4) + ' ' + (300 + i) + ' ' + (1000 + i * 37),
        email: p[0].toLowerCase().replace(/[^a-z]/g, '.') + '@example.com',
        address_line1: (12 + i) + ' Voortrekker Road', address_line2: null,
        suburb: 'Central', city: city[0], province: city[1],
        postal_code: String(1500 + i), country: 'South Africa',
        ethnic_group: p[2], has_disability: i === 6 ? 'yes' : (p[2] === 'undisclosed' ? 'undisclosed' : 'no'),
        disability_types: i === 6 ? ['Hearing'] : [],
        disability_other: i === 6 ? 'Needs written instructions during assessments.' : null,
        grade12_type: p[3], grade12_year: 2025 - (i % 3),
        highest_qualification: i % 3 === 0 ? 'N3 Electrical Engineering' : null,
        highest_qual_institution: i % 3 === 0 ? 'Ekurhuleni East TVET College' : null,
        highest_qual_year: i % 3 === 0 ? 2025 : null,
        submitted_at: sub.toISOString(), created_at: sub.toISOString(), updated_at: sub.toISOString(),
        purge_after: new Date(closes.getTime() + 365 * 864e5).toISOString().slice(0, 10),
        legal_hold: false
      });

      var pool = p[3].indexOf('technical') >= 0 ? technical : academic;
      pool.slice(0, 6).forEach(function (s) {
        db.application_subjects.push({
          id: uuid(), application_id: appId,
          stream: p[3].indexOf('technical') >= 0 ? 'technical' : 'academic',
          subject_name: s, mark: 45 + ((i * 7 + s.length * 3) % 40), created_at: now()
        });
      });

      [['id_document', 'ID-certified.pdf'], ['matric_certificate', 'matric-results.jpg']]
        .forEach(function (d) {
          db.application_documents.push({
            id: uuid(), application_id: appId, doc_type: d[0],
            storage_path: appId + '/' + d[0] + '/' + uuid() + '.pdf',
            original_filename: d[1], mime_type: 'application/pdf',
            size_bytes: 180000 + i * 4200, sha256: null,
            scan_status: 'clean', uploaded_at: sub.toISOString()
          });
        });

      db.consents.push({
        id: uuid(), application_id: appId, consent_version_id: db.consent_versions[0].id,
        audience: 'applicant', body_sha256: 'demo', granted_at: sub.toISOString(),
        granted_ip: null, user_agent: 'demo'
      });
      if (p[5]) {
        db.guardians.push({
          id: uuid(), application_id: appId, full_name: 'Nomsa ' + p[0].split(' ')[1],
          relationship: 'Mother', contact_number: '083 221 4419',
          email: 'guardian@example.com', id_number_last4: '0447', created_at: sub.toISOString()
        });
        db.consents.push({
          id: uuid(), application_id: appId, consent_version_id: db.consent_versions[1].id,
          audience: 'guardian', body_sha256: 'demo', granted_at: sub.toISOString(),
          granted_ip: null, user_agent: 'demo'
        });
      }
    });

    // Form config for every intake in the demo.
    var DOCS = [
      ['id_document', 'Certified copy of your ID', 'Certified within the last three months.', true, 1, 10],
      ['matric_certificate', 'Grade 12 certificate or statement of results',
       'If you are still waiting for results, upload your latest school report.', false, 1, 20],
      ['qualification', 'Further qualification certificates',
       'N-certificates, diplomas, trade test results.', false, 4, 30],
      ['other', 'Other supporting documents',
       'Proof of residence, a reference letter, a CV.', false, 2, 40]
    ];
    var HEAVY = ['Mathematics', 'Technical Mathematics', 'Physical Science', 'Technical Science'];
    var MEDIUM = ['Engineering Graphics and Design', 'Mechanical Technology',
                  'Electrical Technology', 'Technical Drawing'];
    var INCLUDE = HEAVY.concat(MEDIUM).concat(
      ['Mathematical Literacy', 'Life Science', 'Life Orientation',
       'Home Language', 'First Additional Language',
       'Fitting and Machining Theory', 'Trade Theory']);

    db.intakes.forEach(function (intk) {
      trades.forEach(function (t, ti) {
        db.intake_trades.push({
          intake_id: intk.id, trade_id: t.id, active: true, positions: 2 + (ti % 4),
          label_override: null, sort_order: t.sort_order, min_score: null, notes: null
        });
      });
      DOCS.forEach(function (d) {
        db.intake_documents.push({
          id: uuid(), intake_id: intk.id, doc_type: d[0], label: d[1], hint: d[2],
          required: d[3], max_files: d[4], visible: true, sort_order: d[5]
        });
      });
      trades.forEach(function (t) {
        if (intk.status !== 'open') return;   // draft starts empty on purpose
        subjects.filter(function (s) {
          return s.stream !== 'qualification' && INCLUDE.indexOf(s.name) >= 0;
        }).forEach(function (s) {
          db.intake_trade_subjects.push({
            id: uuid(), intake_id: intk.id, trade_id: t.id, subject_id: s.id,
            stream: s.stream,
            required: HEAVY.indexOf(s.name) >= 0,
            min_mark: HEAVY.indexOf(s.name) >= 0 ? 40 : null,
            weight: HEAVY.indexOf(s.name) >= 0 ? 3
                  : (MEDIUM.indexOf(s.name) >= 0 ? 2
                  : (s.name === 'Life Orientation' ? 0 : 1)),
            sort_order: s.sort_order
          });
        });
      });
    });

    ['p.naidoo@actom.co.za', 's.dlamini@actom.co.za'].forEach(function (e, i) {
      db.reviewer_profiles.push({
        user_id: userIdFor(e), email: e,
        full_name: e.split('@')[0].replace('.', ' '),
        role: i === 0 ? 'admin' : 'reviewer', active: true,
        division: 'Group IT', created_at: now()
      });
    });

    [['reveal_id', 'Verifying ID against certified copy before SETA registration', 0],
     ['download_document', 'applications/…/id_document/8f2c.pdf', 0],
     ['view', 'Opened application detail', 0],
     ['export', '143 records exported, filters: shortlisted / Millwright', 1],
     ['view', 'Opened application detail', 1]
    ].forEach(function (l, i) {
      db.pii_access_log.push({
        id: i + 1, actor_id: db.reviewer_profiles[l[2]].user_id,
        actor_email: db.reviewer_profiles[l[2]].email,
        application_id: db.applications[i % db.applications.length].id,
        action: l[0], detail: l[1],
        occurred_at: new Date(Date.now() - (i + 1) * 5400000).toISOString()
      });
    });

    return db;
  }

  var APPLICANT_CONSENT =
'ACTOM (Pty) Ltd collects the information in this form to assess your application for an apprenticeship or learnership, to verify your identity and qualifications, and to meet our reporting duties under the Employment Equity Act 55 of 1998 and the Skills Development Act 97 of 1998.\n\n' +
'Some of what we ask for is special personal information under section 26 of the Protection of Personal Information Act 4 of 2013, specifically your race or ethnic group and whether you have a disability. You may answer "prefer not to say" to both. Doing so will not affect your application.\n\n' +
'Your identity number is encrypted while we hold it. Only trained ACTOM staff who need it to verify your application can view it, and every time it is viewed we record who did so and why.\n\n' +
'We keep your application for 12 months after this intake closes so that we can consider you for later positions. After that we delete it, along with your uploaded documents.\n\n' +
'You may ask to see, correct or delete what we hold about you at any time by writing to the ACTOM Information Officer at informationofficer@actom.co.za. You may also lodge a complaint with the Information Regulator of South Africa.\n\n' +
'By ticking the box below you confirm that the information you have given is true and complete, and that you agree to ACTOM processing it for the purposes set out above.\n\n' +
'[DEMO BUILD — this wording has not been legally reviewed.]';

  var GUARDIAN_CONSENT =
'This applicant is under 18 years of age. Under section 35 of the Protection of Personal Information Act 4 of 2013, ACTOM (Pty) Ltd may not process a child\'s personal information without the consent of a competent person.\n\n' +
'By completing this section you confirm that you are the parent or legal guardian of the applicant, that you have read the applicant privacy notice, and that you consent to ACTOM collecting and processing the applicant\'s personal information, including their identity number, race or ethnic group and disability status, for the purpose of assessing their application for an apprenticeship or learnership.\n\n' +
'You may withdraw this consent at any time by writing to informationofficer@actom.co.za. Withdrawing consent will end the application.\n\n' +
'[DEMO BUILD — this wording has not been legally reviewed.]';

  /* ------------------------------------------------------------- store */
  var DB;
  try { DB = JSON.parse(LS.getItem(KEY)); } catch (e) { DB = null; }
  if (!DB || !DB.trades || !DB.intake_trade_subjects) { DB = seed(); save(); }
  function save() { try { LS.setItem(KEY, JSON.stringify(DB)); } catch (e) {} }

  // Give the seeded queue realistic scores so the ranking view has data.
  if (!DB._scored) {
    DB.applications.forEach(function (a) { if (a.status !== 'draft') scoreApplication(a.id); });
    DB._scored = true;
    save();
  }

  var SESSION = null;
  try { SESSION = JSON.parse(LS.getItem(SKEY)); } catch (e) {}

  /* ----------------------------------------------------- query builder */
  function Q(table) {
    this.table = table; this.mode = 'select'; this.filters = [];
    this.returning = false; this._single = null; this._order = null; this._limit = null;
    this.payload = null;
  }
  Q.prototype.select = function (cols, opts) {
    if (this.mode === 'select') {
      this.cols = cols;
      // { count: 'exact', head: true } asks for a row count and no rows.
      if (opts && opts.count) { this.countMode = true; this.headOnly = !!opts.head; }
    } else { this.returning = true; }
    return this;
  };
  Q.prototype.insert = function (rows) {
    this.mode = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this;
  };
  Q.prototype.update = function (patch) { this.mode = 'update'; this.payload = patch; return this; };
  Q.prototype.upsert = function (row) { this.mode = 'insert'; this.payload = [row]; return this; };
  Q.prototype.delete = function () { this.mode = 'delete'; return this; };
  ['eq', 'neq', 'lte', 'gte', 'lt', 'gt'].forEach(function (op) {
    Q.prototype[op] = function (col, v) { this.filters.push([op, col, v]); return this; };
  });
  Q.prototype.in = function (col, arr) { this.filters.push(['in', col, arr]); return this; };
  Q.prototype.order = function (col, opts) {
    this._order = { col: col, asc: !opts || opts.ascending !== false }; return this;
  };
  Q.prototype.limit = function (n) { this._limit = n; return this; };
  Q.prototype.single = function () { this._single = 'strict'; return this; };
  Q.prototype.maybeSingle = function () { this._single = 'maybe'; return this; };

  function match(row, filters) {
    return filters.every(function (f) {
      var v = row[f[1]];
      switch (f[0]) {
        case 'eq': return String(v) === String(f[2]);
        case 'neq': return String(v) !== String(f[2]);
        case 'lte': return v <= f[2];
        case 'gte': return v >= f[2];
        case 'lt': return v < f[2];
        case 'gt': return v > f[2];
        case 'in': return f[2].indexOf(v) >= 0;
      }
      return true;
    });
  }

  // Mirrors the column-level grants: the browser must never see these.
  var HIDDEN = ['id_number_plain', 'id_number_hash', 'id_number_enc'];
  function strip(row) {
    var o = clone(row);
    HIDDEN.forEach(function (h) { delete o[h]; });
    return o;
  }

  Q.prototype.then = function (resolve, reject) {
    var self = this;
    return new Promise(function (res) {
      var t = DB[self.table] || (DB[self.table] = []);
      var out, hit;

      var CONFIG_TABLES = ['intake_trades', 'intake_trade_subjects', 'intake_documents'];
      if (CONFIG_TABLES.indexOf(self.table) >= 0 && self.mode !== 'select') {
        var target = null;
        if (self.mode === 'insert' && self.payload[0]) target = self.payload[0].intake_id;
        if (!target) {
          var f = self.filters.filter(function (x) { return x[1] === 'intake_id'; })[0];
          if (f) target = f[2];
        }
        if (!target && self.mode !== 'insert') {
          var row0 = t.filter(function (r) { return match(r, self.filters); })[0];
          if (row0) target = row0.intake_id;
        }
        try { requireEditable(target); }
        catch (e) {
          return setTimeout(function () { res({ data: null, error: { message: e.message } }); }, 40);
        }
      }
      if (self.table === 'intakes' && self.mode === 'update') {
        var itg = DB.intakes.filter(function (r) { return match(r, self.filters); })[0];
        if (itg && itg.status !== 'draft') {
          var allowed = ['closes_at', 'closed_message'];
          var illegal = Object.keys(self.payload).filter(function (k) {
            return allowed.indexOf(k) < 0 && String(self.payload[k]) !== String(itg[k]);
          });
          if (illegal.length) {
            return setTimeout(function () {
              res({ data: null, error: { message: 'This intake has been published. Only the ' +
                'closing date and closing message can still be changed.' } });
            }, 40);
          }
        }
      }

      // v_apprentice_register is a view: resolve it before the normal path.
      if (self.table === 'v_apprentice_register' && self.mode === 'select') {
        var reg = (DB.apprentices || []).map(function (ap) {
          var tr = DB.trades.filter(function (t) { return t.id === ap.trade_id; })[0] || {};
          var ik = DB.intakes.filter(function (i) { return i.id === ap.intake_id; })[0] || {};
          var app = DB.applications.filter(function (x) { return x.id === ap.application_id; })[0] || {};
          var pct = null, days = null;
          if (ap.start_date && ap.expected_end_date) {
            var s0 = new Date(ap.start_date), e0 = new Date(ap.expected_end_date), nowd = new Date();
            pct = Math.max(0, Math.min(100, Math.round((nowd - s0) / (e0 - s0) * 100)));
            days = Math.max(0, Math.round((e0 - nowd) / 86400000));
          }
          var o = clone(ap);
          o.trade = tr.name; o.division = tr.division; o.intake = ik.name;
          o.reference = app.reference; o.contact_number = app.contact_number; o.email = app.email;
          o.progress_pct = pct; o.days_remaining = ap.status === 'active' ? days : null;
          return o;
        });
        var hit2 = reg.filter(function (r) { return match(r, self.filters); });
        return setTimeout(function () { res({ data: hit2, error: null }); }, 60);
      }

      if (self.mode === 'insert') {
        out = self.payload.map(function (r) {
          var row = clone(r);
          if (!row.id) row.id = uuid();
          if (!row.created_at) row.created_at = now();
          if (self.table === 'application_documents' && !row.uploaded_at) row.uploaded_at = now();
          t.push(row);
          return strip(row);
        });
      } else if (self.mode === 'update') {
        out = [];
        t.forEach(function (r) {
          if (!match(r, self.filters)) return;
          Object.keys(self.payload).forEach(function (k) { r[k] = self.payload[k]; });
          r.updated_at = now();
          out.push(strip(r));
        });
      } else if (self.mode === 'delete') {
        out = [];
        DB[self.table] = t.filter(function (r) {
          if (match(r, self.filters)) { out.push(strip(r)); return false; }
          return true;
        });
      } else {
        hit = t.filter(function (r) { return match(r, self.filters); });
        if (self._order) {
          var o = self._order;
          hit = hit.slice().sort(function (a, b) {
            var x = a[o.col], y = b[o.col];
            if (x === y) return 0;
            return (x > y ? 1 : -1) * (o.asc ? 1 : -1);
          });
        }
        if (self._limit != null) hit = hit.slice(0, self._limit);
        out = hit.map(strip);
      }

      save();

      var result;
      if (self.countMode) {
        result = { data: self.headOnly ? null : out, count: out.length, error: null };
      } else if (self._single === 'strict') {
        result = out.length
          ? { data: out[0], error: null }
          : { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
      } else if (self._single === 'maybe') {
        result = { data: out[0] || null, error: null };
      } else {
        result = { data: out, error: null };
      }
      setTimeout(function () { res(result); }, 60);   // a touch of latency, so loaders show
    }).then(resolve, reject);
  };
  Q.prototype.catch = function (f) { return this.then(null, f); };

  /* -------------------------------------------------------- SA ID check */
  function validateSaId(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (d.length !== 13) return { valid: false, reason: 'An SA ID number must be 13 digits.' };
    var sum = 0, parity = 0;
    for (var i = 12; i >= 0; i--) {
      var n = +d[i];
      if (parity === 1) { n *= 2; if (n > 9) n -= 9; }
      sum += n; parity = 1 - parity;
    }
    if (sum % 10 !== 0) {
      return { valid: false, reason: 'That ID number failed its checksum. Please re-check the digits.' };
    }
    var yy = +d.slice(0, 2), mm = +d.slice(2, 4), dd = +d.slice(4, 6);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
      return { valid: false, reason: 'The date of birth inside that ID number is not valid.' };
    }
    var century = yy > (new Date().getFullYear() % 100) ? 1900 : 2000;
    var dob = new Date(Date.UTC(century + yy, mm - 1, dd));
    var cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 18);
    return {
      valid: true,
      date_of_birth: dob.toISOString().slice(0, 10),
      gender: +d[6] < 5 ? 'female' : 'male',
      citizenship: d[10] === '0' ? 'sa_citizen' : (d[10] === '1' ? 'permanent_resident' : 'other'),
      is_minor: dob > cutoff,
      last4: d.slice(-4)
    };
  }

  /* ---------------------------------------------------------------- RPC */
  function findApp(id) {
    return DB.applications.filter(function (a) { return a.id === id; })[0];
  }
  function me() { return SESSION ? SESSION.user : null; }
  function isReviewer() {
    if (!SESSION) return null;
    return DB.reviewer_profiles.filter(function (p) {
      return p.user_id === SESSION.user.id && p.active;
    })[0];
  }

  // Mirrors the database triggers: config on a published intake is frozen.
  function requireEditable(intakeId) {
    var i = DB.intakes.filter(function (x) { return x.id === intakeId; })[0];
    if (!i || i.status !== 'draft') {
      throw new Error('This intake has been published. Its form can no longer be changed. ' +
                      'Clone it to start a new intake.');
    }
  }

  function schoolStream(t) {
    return { nsc_technical:'technical', ncv_l4:'technical', nsc:'academic',
             senior_certificate:'academic', amended_senior_certificate:'academic' }[t] || null;
  }

  function scoreApplication(appId) {
    var a = DB.applications.filter(function (x) { return x.id === appId; })[0];
    if (!a || !a.trade_id) return;
    var intk = DB.intakes.filter(function (x) { return x.id === a.intake_id; })[0];
    if (!intk || !intk.scoring_enabled) return;

    var weighted = 0, weightTotal = 0, flags = [], meets = true;
    var stream = schoolStream(a.grade12_type);
    DB.intake_trade_subjects.filter(function (r) {
      return r.intake_id === a.intake_id && r.trade_id === a.trade_id &&
             (r.stream === 'qualification' || !stream || r.stream === stream);
    }).forEach(function (r) {
      var sub = DB.subjects.filter(function (s) { return s.id === r.subject_id; })[0] || {};
      var row = DB.application_subjects.filter(function (m) {
        return m.application_id === appId && m.stream === r.stream && m.subject_name === sub.name;
      })[0];

      if (!row || row.mark == null) {
        if (r.required) {
          flags.push(sub.name + ' not supplied');
          meets = false;
          if (r.weight > 0) weightTotal += r.weight;
        }
        return;
      }
      if (r.min_mark != null && row.mark < r.min_mark) {
        flags.push(sub.name + ' ' + row.mark + '%, below the ' + r.min_mark + '% minimum');
        meets = false;
      }
      if (r.weight > 0) { weighted += row.mark * r.weight; weightTotal += r.weight; }
    });

    var score = weightTotal > 0 ? Math.round((weighted / weightTotal) * 100) / 100 : null;
    var it = DB.intake_trades.filter(function (t) {
      return t.intake_id === a.intake_id && t.trade_id === a.trade_id;
    })[0];
    if (it && it.min_score != null && score != null && score < it.min_score) {
      flags.push('Overall score ' + score + ', below the ' + it.min_score + ' minimum');
      meets = false;
    }

    a.auto_score = score;
    a.auto_flags = intk.auto_flag_below ? flags : [];
    a.meets_minimum = meets;
    a.scored_at = now();
  }

  var RPC = {
    start_application: function (p) {
      var intake = DB.intakes.filter(function (i) { return i.id === p.p_intake; })[0];
      if (!intake || intake.status !== 'open') throw new Error('This intake is not currently open for applications.');
      var existing = DB.applications.filter(function (a) {
        return a.applicant_user_id === me().id && a.intake_id === p.p_intake;
      })[0];
      if (existing) return existing.id;
      var row = {
        id: uuid(), reference: null, applicant_user_id: me().id, intake_id: p.p_intake,
        trade_id: null, status: 'draft', full_name: null, id_type: null,
        id_number_plain: null, id_number_last4: null, date_of_birth: null, gender: null,
        citizenship: null, is_minor: false, contact_number: null, email: me().email,
        address_line1: null, address_line2: null, suburb: null, city: null, province: null,
        postal_code: null, country: 'South Africa', ethnic_group: null, has_disability: null,
        disability_types: [], disability_other: null, grade12_type: null, grade12_year: null,
        highest_qualification: null, highest_qual_institution: null, highest_qual_year: null,
        submitted_at: null, created_at: now(), updated_at: now(),
        purge_after: null, legal_hold: false
      };
      DB.applications.push(row);
      DB.application_events.push({ id: Date.now(), application_id: row.id, actor_id: me().id,
        event: 'created', to_status: 'draft', occurred_at: now() });
      return row.id;
    },

    set_identity: function (p) {
      var a = findApp(p.p_application);
      if (!a) throw new Error('Application not found.');
      if (a.status !== 'draft') throw new Error('This application has already been submitted and can no longer be edited.');
      a.full_name = p.p_full_name;

      if (p.p_id_type === 'sa_id') {
        var v = validateSaId(p.p_id_number);
        if (!v.valid) return v;
        a.id_type = 'sa_id';
        a.id_number_plain = String(p.p_id_number).replace(/\D/g, '');
        a.id_number_last4 = v.last4;
        a.date_of_birth = v.date_of_birth;
        a.gender = v.gender;
        a.citizenship = v.citizenship;
        a.is_minor = v.is_minor;
        a.passport_country = null;
        return v;
      }
      var clean = String(p.p_id_number || '').trim();
      if (clean.length < 5) return { valid: false, reason: 'Please enter your passport number.' };
      var cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 18);
      a.id_type = 'passport';
      a.id_number_plain = clean;
      a.id_number_last4 = clean.slice(-4);
      a.passport_country = p.p_passport_country;
      a.date_of_birth = p.p_dob;
      a.gender = p.p_gender;
      a.citizenship = 'other';
      a.is_minor = !!(p.p_dob && new Date(p.p_dob) > cutoff);
      return { valid: true, is_minor: a.is_minor };
    },

    set_guardian: function (p) {
      var a = findApp(p.p_application);
      if (!a || a.status !== 'draft') throw new Error('Application not found.');
      var g = DB.guardians.filter(function (x) { return x.application_id === p.p_application; })[0];
      if (!g) { g = { id: uuid(), application_id: p.p_application, created_at: now() }; DB.guardians.push(g); }
      g.full_name = p.p_full_name; g.relationship = p.p_relationship;
      g.contact_number = p.p_contact; g.email = p.p_email;
      g.id_number_last4 = String(p.p_id_number || '').replace(/\D/g, '').slice(-4) || null;
      return null;
    },

    record_consent: function (p) {
      var v = DB.consent_versions.filter(function (c) {
        return c.version === p.p_version && c.audience === p.p_audience && c.active;
      })[0];
      if (!v) throw new Error('Consent wording not found.');
      DB.consents.push({
        id: uuid(), application_id: p.p_application, consent_version_id: v.id,
        audience: p.p_audience, body_sha256: 'demo', granted_at: now(),
        granted_ip: null, user_agent: String(p.p_user_agent || '').slice(0, 400)
      });
      return null;
    },

    submit_application: function (p) {
      var a = findApp(p.p_application);
      if (!a) throw new Error('Application not found.');
      if (a.status !== 'draft') return { ok: true, reference: a.reference, already: true };

      var missing = [];
      if (!a.full_name) missing.push('full name');
      if (!a.id_number_plain) missing.push('ID or passport number');
      if (!a.trade_id) missing.push('trade');
      if (!a.contact_number) missing.push('contact number');
      if (!a.address_line1) missing.push('address');
      if (!a.grade12_type) missing.push('Grade 12 details');
      if (!DB.application_documents.some(function (d) {
        return d.application_id === a.id && d.doc_type === 'id_document';
      })) missing.push('ID document upload');
      if (!DB.consents.some(function (c) {
        return c.application_id === a.id && c.audience === 'applicant';
      })) missing.push('consent');
      if (a.is_minor && !DB.consents.some(function (c) {
        return c.application_id === a.id && c.audience === 'guardian';
      })) missing.push('parent or guardian consent');

      if (missing.length) return { ok: false, missing: missing };

      var intake = DB.intakes.filter(function (i) { return i.id === a.intake_id; })[0];
      DB._seq++;
      a.reference = 'ACT-APP-' + new Date().getFullYear() + '-' + String(DB._seq).padStart(6, '0');
      a.status = 'submitted';
      a.submitted_at = now();
      a.purge_after = new Date(new Date(intake.closes_at).getTime() +
                               intake.retention_months * 30 * 864e5).toISOString().slice(0, 10);
      DB.application_events.push({ id: Date.now(), application_id: a.id, actor_id: me().id,
        event: 'submitted', from_status: 'draft', to_status: 'submitted', occurred_at: now() });
      scoreApplication(a.id);
      return { ok: true, reference: a.reference };
    },

    my_data_export: function () {
      return DB.applications.filter(function (a) { return a.applicant_user_id === me().id; })
        .map(function (a) {
          var o = strip(a);
          o.id_number = '**** **** ' + (a.id_number_last4 || '');
          o.subjects = DB.application_subjects.filter(function (s) { return s.application_id === a.id; })
            .map(function (s) { return { stream: s.stream, subject_name: s.subject_name, mark: s.mark }; });
          o.documents = DB.application_documents.filter(function (d) { return d.application_id === a.id; })
            .map(function (d) { return { type: d.doc_type, filename: d.original_filename, uploaded_at: d.uploaded_at }; });
          o.consents = DB.consents.filter(function (c) { return c.application_id === a.id; })
            .map(function (c) { return { audience: c.audience, granted_at: c.granted_at }; });
          return o;
        });
    },

    withdraw_application: function (p) {
      var a = findApp(p.p_application);
      if (!a || ['draft', 'submitted', 'under_review'].indexOf(a.status) < 0) {
        throw new Error('Application not found or can no longer be withdrawn.');
      }
      a.status = 'withdrawn';
      a.purge_after = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
      return null;
    },

    reveal_id_number: function (p) {
      var r = isReviewer();
      if (!r) throw new Error('Not authorised.');
      if (!p.p_reason || p.p_reason.trim().length < 5) {
        throw new Error('A reason is required before an ID number can be revealed.');
      }
      var a = findApp(p.p_application);
      DB.pii_access_log.push({
        id: DB.pii_access_log.length + 1, actor_id: r.user_id, actor_email: r.email,
        application_id: p.p_application, action: 'reveal_id',
        detail: p.p_reason.trim(), occurred_at: now()
      });
      return a ? a.id_number_plain : null;
    },

    log_pii_access: function (p) {
      var r = isReviewer();
      if (!r) throw new Error('Not authorised.');
      DB.pii_access_log.push({
        id: DB.pii_access_log.length + 1, actor_id: r.user_id, actor_email: r.email,
        application_id: p.p_application, action: p.p_action,
        detail: p.p_detail, occurred_at: now()
      });
      return null;
    },

    get_form_config: function (p) {
      var i = DB.intakes.filter(function (x) { return x.id === p.p_intake && x.status === 'open'; })[0];
      if (!i) return { open: false };
      return {
        open: true,
        intake: {
          id: i.id, name: i.name, closes_at: i.closes_at,
          show_further_study: i.show_further_study, show_technical: i.show_technical,
          intro_heading: i.intro_heading, intro_body: i.intro_body,
          consent_version: i.consent_version, max_upload_mb: i.max_upload_mb
        },
        trades: DB.intake_trades.filter(function (t) {
          return t.intake_id === p.p_intake && t.active;
        }).map(function (t) {
          var tr = DB.trades.filter(function (x) { return x.id === t.trade_id; })[0] || {};
          return { id: t.trade_id, name: t.label_override || tr.name,
                   division: tr.division, notes: t.notes };
        }).sort(function (a, b) { return a.name.localeCompare(b.name); }),
        documents: DB.intake_documents.filter(function (d) {
          return d.intake_id === p.p_intake && d.visible;
        }).sort(function (a, b) { return a.sort_order - b.sort_order; })
          .map(function (d) {
            return { doc_type: d.doc_type, label: d.label, hint: d.hint,
                     required: d.required, max_files: d.max_files };
          }),
        subjects: DB.intake_trade_subjects.filter(function (x) {
          return x.intake_id === p.p_intake && (!p.p_trade || x.trade_id === p.p_trade);
        }).map(function (x) {
          var sub = DB.subjects.filter(function (s) { return s.id === x.subject_id; })[0] || {};
          return { stream: x.stream, name: sub.name, required: x.required,
                   min_mark: x.min_mark, weight: x.weight, sort_order: x.sort_order };
        }).sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); })
      };
    },

    save_trade_subjects: function (p) {
      requireEditable(p.p_intake);
      DB.intake_trade_subjects = DB.intake_trade_subjects.filter(function (x) {
        return !(x.intake_id === p.p_intake && x.trade_id === p.p_trade);
      });
      (p.p_rows || []).forEach(function (r) {
        DB.intake_trade_subjects.push({
          id: uuid(), intake_id: p.p_intake, trade_id: p.p_trade,
          subject_id: r.subject_id, stream: r.stream, required: !!r.required,
          min_mark: r.min_mark == null ? null : +r.min_mark,
          weight: r.weight == null ? 1 : +r.weight,
          sort_order: r.sort_order == null ? 100 : +r.sort_order
        });
      });
      return (p.p_rows || []).length;
    },

    publish_intake: function (p) {
      var i = DB.intakes.filter(function (x) { return x.id === p.p_intake; })[0];
      if (!i) throw new Error('Intake not found.');
      if (i.status !== 'draft') {
        return { ok: false, problems: ['This intake has already been published.'] };
      }
      var problems = [];
      var activeTrades = DB.intake_trades.filter(function (t) {
        return t.intake_id === p.p_intake && t.active;
      });
      if (!activeTrades.length) problems.push('No trades are switched on.');
      if (!DB.intake_documents.some(function (d) {
        return d.intake_id === p.p_intake && d.doc_type === 'id_document';
      })) problems.push('The ID document requirement is missing.');
      if (new Date(i.closes_at) <= new Date()) problems.push('The closing date is in the past.');
      if (new Date(i.closes_at) <= new Date(i.opens_at)) {
        problems.push('The closing date is not after the opening date.');
      }
      if (i.scoring_enabled && activeTrades.some(function (t) {
        return !DB.intake_trade_subjects.some(function (x) {
          return x.intake_id === p.p_intake && x.trade_id === t.trade_id;
        });
      })) problems.push('Scoring is on, but one or more active trades have no subjects set.');

      if (problems.length) return { ok: false, problems: problems };
      i.status = 'open';
      i.published_at = now();
      return { ok: true };
    },

    close_intake: function (p) {
      var i = DB.intakes.filter(function (x) { return x.id === p.p_intake; })[0];
      if (i && i.status === 'open') { i.status = 'closed'; i.closed_at = now(); }
      return null;
    },

    clone_intake: function (p) {
      var src = DB.intakes.filter(function (x) { return x.id === p.p_intake; })[0];
      if (!src) throw new Error('Intake not found.');
      var id = uuid();
      var copy = clone(src);
      copy.id = id; copy.name = p.p_name; copy.status = 'draft';
      copy.published_at = null; copy.closed_at = null;
      copy.opens_at = now();
      copy.closes_at = new Date(Date.now() + 60 * 864e5).toISOString();
      copy.created_at = now();
      DB.intakes.unshift(copy);
      ['intake_trades', 'intake_trade_subjects', 'intake_documents'].forEach(function (tbl) {
        DB[tbl].filter(function (r) { return r.intake_id === p.p_intake; })
          .forEach(function (r) {
            var c = clone(r); c.intake_id = id;
            if (c.id) c.id = uuid();
            DB[tbl].push(c);
          });
      });
      return id;
    },

    recalculate_ranks: function (p) {
      var rows = DB.applications.filter(function (a) {
        return a.intake_id === p.p_intake && a.status !== 'draft';
      });
      var groups = {};
      rows.forEach(function (a) {
        (groups[a.trade_id] = groups[a.trade_id] || []).push(a);
      });
      Object.keys(groups).forEach(function (k) {
        groups[k].sort(function (x, y) {
          if (x.meets_minimum !== y.meets_minimum) return x.meets_minimum ? -1 : 1;
          if ((y.auto_score || 0) !== (x.auto_score || 0)) {
            return (y.auto_score || 0) - (x.auto_score || 0);
          }
          return String(x.submitted_at).localeCompare(String(y.submitted_at));
        }).forEach(function (a, idx) { a.auto_rank = idx + 1; });
      });
      return rows.length;
    },

    enrol_applicant: function (p) {
      var a = DB.applications.filter(function (x) { return x.id === p.p_application; })[0];
      if (!a) throw new Error('Application not found.');
      DB.apprentices = DB.apprentices || [];
      if (DB.apprentices.some(function (x) { return x.application_id === a.id; })) {
        return { ok: false, reason: 'This applicant is already on the register.' };
      }
      if (a.status !== 'shortlisted') {
        return { ok: false, reason: 'Only a shortlisted applicant can be enrolled. This one is ' +
                 a.status + '.' };
      }
      if (!p.p_start_date) return { ok: false, reason: 'A start date is required.' };

      var end = p.p_expected_end;
      if (!end) {
        var d = new Date(p.p_start_date); d.setFullYear(d.getFullYear() + 3);
        end = d.toISOString().slice(0, 10);
      }
      var id = uuid();
      DB.apprentices.push({
        id: id, application_id: a.id, intake_id: a.intake_id, trade_id: a.trade_id,
        full_name: a.full_name, employee_number: p.p_employee_number,
        seta_learner_number: p.p_seta_number, start_date: p.p_start_date,
        expected_end_date: end, contract_signed_on: p.p_contract_signed,
        site: p.p_site, supervisor: p.p_supervisor, notes: p.p_notes,
        status: 'active', enrolled_at: now()
      });
      a.status = 'enrolled'; a.legal_hold = true; a.purge_after = null;
      return { ok: true, apprentice_id: id, expected_end: end };
    },

    update_apprentice: function (p) {
      var r = (DB.apprentices || []).filter(function (x) { return x.id === p.p_id; })[0];
      if (!r) throw new Error('Not on the register.');
      if (p.p_status && ['active','completed'].indexOf(p.p_status) < 0) {
        if (!p.p_ended_on || !p.p_end_reason) {
          return { ok: false, reason: 'Ending an apprenticeship needs both a date and a reason.' };
        }
      }
      ['status','ended_on','end_reason','trade_test_date','trade_test_result',
       'site','supervisor','notes','employee_number'].forEach(function (f) {
        var v = p['p_' + f];
        if (v != null && v !== '') r[f] = v;
      });
      return { ok: true };
    },

    set_application_status: function (p) {
      var r = isReviewer();
      if (!r) throw new Error('Not authorised.');
      var a = findApp(p.p_application);
      var from = a.status;
      a.status = p.p_status;
      DB.application_reviews.push({
        id: uuid(), application_id: a.id, reviewer_id: r.user_id,
        decision: p.p_status === 'shortlisted' ? 'shortlist'
                : (p.p_status === 'declined' ? 'decline' : 'hold'),
        notes: p.p_notes, created_at: now()
      });
      DB.application_events.push({ id: Date.now(), application_id: a.id, actor_id: r.user_id,
        event: 'status_change', from_status: from, to_status: p.p_status, occurred_at: now() });
      return null;
    }
  };

  /* ------------------------------------------------------------ client */
  function createClient() {
    return {
      from: function (t) { return new Q(t); },

      rpc: function (name, params) {
        return new Promise(function (res) {
          setTimeout(function () {
            if (!RPC[name]) return res({ data: null, error: { message: 'Unknown function ' + name } });
            try {
              var data = RPC[name](params || {});
              save();
              res({ data: data, error: null });
            } catch (e) {
              res({ data: null, error: { message: e.message } });
            }
          }, 70);
        });
      },

      auth: {
        getSession: function () {
          return Promise.resolve({ data: { session: SESSION }, error: null });
        },
        signInWithOtp: function (o) {
          window.__demoPendingEmail = o.email;
          return Promise.resolve({ data: {}, error: null });
        },
        verifyOtp: function (o) {
          if (!/^\d{6}$/.test(String(o.token))) {
            return Promise.resolve({ data: null, error: { message: 'Invalid code' } });
          }
          SESSION = { user: { id: userIdFor(o.email), email: o.email } };
          LS.setItem(SKEY, JSON.stringify(SESSION));
          return Promise.resolve({ data: { session: SESSION }, error: null });
        },
        signInWithOAuth: function () {
          var email = window.__demoReviewer || 'p.naidoo@actom.co.za';
          SESSION = { user: { id: userIdFor(email), email: email } };
          LS.setItem(SKEY, JSON.stringify(SESSION));
          setTimeout(function () { location.reload(); }, 120);
          return Promise.resolve({ data: {}, error: null });
        },
        signOut: function () {
          SESSION = null;
          LS.removeItem(SKEY);
          return Promise.resolve({ error: null });
        }
      },

      storage: {
        from: function () {
          return {
            upload: function (path, file) {
              files[path] = URL.createObjectURL(file);
              return Promise.resolve({ data: { path: path }, error: null });
            },
            remove: function (paths) {
              paths.forEach(function (p) { delete files[p]; });
              return Promise.resolve({ data: [], error: null });
            },
            createSignedUrl: function (path) {
              if (files[path]) return Promise.resolve({ data: { signedUrl: files[path] }, error: null });
              var html = '<html><body style="font-family:system-ui;padding:3rem;text-align:center;' +
                'color:#0E1F2E"><h1 style="font-weight:600">Demo document</h1>' +
                '<p>This is seeded sample data, so there is no real file behind it.</p>' +
                '<p style="color:#7A8B9A;font-family:monospace;font-size:.85rem">' + path + '</p>' +
                '<p style="color:#7A8B9A">In the live system this opens a signed URL that expires ' +
                'after 60 seconds, and the access is written to the log.</p></body></html>';
              return Promise.resolve({
                data: { signedUrl: URL.createObjectURL(new Blob([html], { type: 'text/html' })) },
                error: null
              });
            }
          };
        }
      }
    };
  }

  window.supabase = { createClient: createClient };
  window.__actomDemoReset = function () {
    localStorage.removeItem(KEY);
    LS.removeItem(SKEY);
    location.reload();
  };

  /* ------------------------------------------------------------- banner */
  function banner() {
    var isAdmin = /admin/.test(location.pathname) || !!document.getElementById('entraBtn');
    var bar = document.createElement('div');
    bar.setAttribute('role', 'note');
    bar.style.cssText = 'position:sticky;top:0;z-index:100;background:#B87514;color:#fff;' +
      'font:500 13px/1.4 Barlow,system-ui,sans-serif;padding:8px 14px;display:flex;' +
      'gap:14px;align-items:center;flex-wrap:wrap';
    bar.innerHTML =
      '<strong style="font-weight:600">Demo build</strong>' +
      '<span style="flex:1;min-width:220px">No backend. Data stays in this browser. ' +
      (isAdmin ? 'Sign-in is stubbed &mdash; the button just logs you in as an admin reviewer.'
               : 'Any email works; <strong>any six digits</strong> is a valid code.') +
      '</span>' +
      '<span style="opacity:.85">' + (isAdmin
        ? 'Applicant app runs separately on :8080'
        : 'Reviewer console runs separately on :8081') + '</span>' +
      '<button onclick="window.__actomDemoReset()" style="background:transparent;border:1px solid ' +
      'rgba(255,255,255,.5);color:#fff;border-radius:4px;padding:3px 10px;cursor:pointer;' +
      'font:600 12px Barlow,system-ui,sans-serif">Reset demo</button>';
    document.body.insertBefore(bar, document.body.firstChild);

    if (!isAdmin) {
      var hint = document.createElement('div');
      hint.style.cssText = 'background:#EEF4F9;border-left:3px solid #0063AF;padding:.7rem 1rem;' +
        'font:400 13px/1.5 Barlow,system-ui,sans-serif;color:#0E1F2E;max-width:900px;' +
        'margin:0 auto 0;border-radius:0 4px 4px 0';
      hint.innerHTML = '<strong style="display:block;font-weight:600">Test ID numbers</strong>' +
        '<span style="font-family:ui-monospace,monospace">9803122081084</span> adult &middot; ' +
        '<span style="font-family:ui-monospace,monospace">1007225013089</span> under 18, ' +
        'triggers the guardian step &middot; ' +
        '<span style="font-family:ui-monospace,monospace">1234567890123</span> fails the checksum';
      var sc = document.querySelector('.signin-card');
      if (sc) sc.appendChild(hint);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', banner);
  } else { banner(); }
})();
