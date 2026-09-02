/* =====================================================================
   ACTOM Apprenticeship Portal — reviewer client

   Nothing in this file can read an ID number. The ciphertext column is
   not granted to any browser role; the only route to plaintext is
   public.reveal_id_number(), which demands a reason and writes an audit
   row before it returns.
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.ACTOM_CONFIG;
  var sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  var APP_COLS = [
    'id','reference','intake_id','trade_id','status','full_name','id_type',
    'id_number_last4','passport_country','date_of_birth','gender','citizenship',
    'is_minor','contact_number','email','address_line1','address_line2','suburb',
    'city','province','postal_code','country','ethnic_group','has_disability',
    'disability_types','disability_other','grade12_type','grade12_year',
    'highest_qualification','highest_qual_institution','highest_qual_year',
    'submitted_at','purge_after','legal_hold',
    'auto_score','auto_rank','auto_flags','meets_minimum','scored_at'
  ].join(',');

  var S = { me: null, trades: [], intakes: [], rows: [], tab: 'dash',
            filters: { status: 'submitted', trade: '', intake: '', q: '',
                       sort: 'submitted', topN: null },
            counts: {}, tab: 'dash' };

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  function toast(m) {
    var e = $('autosave'); e.textContent = m; e.classList.add('show');
    clearTimeout(e._t); e._t = setTimeout(function () { e.classList.remove('show'); }, 2000);
  }
  function tradeName(id) {
    var t = S.trades.filter(function (x) { return x.id === id; })[0];
    return t ? t.name : '—';
  }
  function statusTag(s) {
    return '<span class="tag tag-' + esc(s) + '">' + esc(String(s).replace('_', ' ')) + '</span>';
  }

  /* ========================================================= sign-in */
  $('entraBtn').addEventListener('click', function () {
    sb.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        scopes: 'email openid profile',
        // Origin + pathname only. window.location.href would carry any
        // existing query string or fragment back to Entra, and after a
        // failed attempt that fragment holds a full token payload —
        // Entra then rejects the retry with AADSTS90015 "query string
        // too long", leaving the reviewer permanently stuck with no
        // indication that clearing the address bar would fix it.
        redirectTo: window.location.origin + window.location.pathname
      }
    });
  });
  $('signOutBtn').addEventListener('click', function () {
    sb.auth.signOut().then(function () { location.reload(); });
  });

  if (window.ACTOM_CHANGELOG) {
    window.ACTOM_CHANGELOG.attach($('whatsNewBtn'), 'admin');
  }
  $('pendingOut').addEventListener('click', function () {
    sb.auth.signOut().then(function () { location.reload(); });
  });

  /* ============================================================ boot */
  sb.auth.getSession().then(function (r) {
    if (!r.data.session) { $('signin').classList.remove('hidden'); return; }
    var email = r.data.session.user.email;

    return sb.from('reviewer_profiles').select('*')
      .eq('user_id', r.data.session.user.id).maybeSingle()
      .then(function (p) {
        if (!p.data || !p.data.active) {
          $('pendingWho').textContent = email;
          $('pending').classList.remove('hidden');
          return;
        }
        S.me = p.data;
        $('portal').classList.remove('hidden');
        $('whoEmail').textContent = email;
        $('whoRole').textContent = p.data.role;
        return loadRefs().then(function () {
          $('loader').classList.add('hidden');
          $('content').classList.remove('hidden');
          wireDrawer();
          renderTabs();
          loadDashboard();
          refreshCounts();
        });
      });
  }).catch(function (e) {
    $('signin').classList.remove('hidden');
    $('signinError').textContent = 'Sign-in failed: ' + (e.message || e);
    $('signinError').classList.remove('hidden');
  });

  function loadRefs() {
    return Promise.all([
      sb.from('trades').select('*').order('sort_order'),
      sb.from('intakes').select('*').order('closes_at', { ascending: false })
    ]).then(function (r) {
      S.trades = r[0].data || [];
      S.intakes = r[1].data || [];
    });
  }

  /* ============================================================ tabs */
  /* ======================================================== navigation
     A slide-out drawer with icon rows and live counts, matching the
     ACTOM Sales CRM rail so the two tools feel like one estate.

     Counts are deliberately only on things that need someone to act:
     applications awaiting a first review, and reviewers waiting to be
     activated. A badge on everything is a badge on nothing. */

  var NAV = [
    { key: 'dash', label: 'Dashboard', icon:
      '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/>' +
      '<rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/>' +
      '<rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/>' +
      '<rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>' },
    { key: 'queue', label: 'Applications', icon:
      '<path d="M4 5h16M4 12h16M4 19h10"/>' },
    { key: 'register', label: 'Apprentices', icon:
      '<path d="M4.5 5.5A1.5 1.5 0 0 1 6 4h11a1.5 1.5 0 0 1 1.5 1.5V20l-3-1.6L12 20l-3.5-1.6L5 20V5.5Z"/>' +
      '<path d="M8.5 9h7M8.5 13h4"/>' },
    { key: 'audit', label: 'Access log', icon:
      '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>' },
    { key: 'formsetup', label: 'Form setup', icon:
      '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8.5 9.5h7M8.5 14h4"/>' },
    { key: 'people', label: 'Reviewers', icon:
      '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/>' +
      '<path d="M16 7.2a3 3 0 0 1 0 5.6M17.5 19a5.4 5.4 0 0 0-1.6-3.8"/>' },
    { key: 'help', label: 'Help &amp; guide', icon:
      '<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.4a2.3 2.3 0 0 1 4.3 1c0 1.6-2.1 1.9-2.1 3.2"/>' +
      '<circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>' }
  ];

  function allowed(key) {
    if (key === 'register')  return true;
    if (key === 'audit')     return ['admin','manager','information_officer'].indexOf(S.me.role) >= 0;
    if (key === 'formsetup') return ['admin','manager'].indexOf(S.me.role) >= 0;
    if (key === 'people')    return S.me.role === 'admin';
    return true;
  }

  function icon(paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
           'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }

  function navRowHtml(item, count, alert) {
    return '<button class="nav-link" data-tab="' + item.key + '"' +
      (S.tab === item.key ? ' aria-current="true"' : '') + '>' +
      icon(item.icon) + '<span class="lbl">' + item.label + '</span>' +
      (count != null ? '<span class="nav-count' + (alert ? ' is-alert' : '') + '">' +
        esc(count) + '</span>' : '') + '</button>';
  }

  function renderTabs() {
    var items = NAV.filter(function (i) { return allowed(i.key); });

    $('drawerNav').innerHTML = items.map(function (i) {
      if (i.key === 'help') return '<div class="drawer-sep"></div>' + navRowHtml(i, null);
      return navRowHtml(i, S.counts[i.key], i.key === 'people' && S.counts.people > 0);
    }).join('');

    // What's new lives at the foot of the rail, with its unseen dot.
    $('drawerFoot').innerHTML =
      '<button class="nav-link" id="whatsNewBtn">' +
      icon('<path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2' +
           'M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>') +
      '<span class="lbl">What&rsquo;s new</span></button>';

    if (window.ACTOM_CHANGELOG) window.ACTOM_CHANGELOG.attach($('whatsNewBtn'), 'admin');

    $('drawer').querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.tab === 'help') { closeDrawer(); S.tab = 'help'; renderTabs(); showHelp(); return; }
        S.tab = b.dataset.tab;
        closeDrawer();
        renderTabs();
        if (S.tab === 'dash')  loadDashboard();
        if (S.tab === 'queue') loadQueue();
        if (S.tab === 'register') loadRegister();
        if (S.tab === 'audit') loadAudit();
        if (S.tab === 'people') loadPeople();
        if (S.tab === 'formsetup') {
          window.ACTOM_FORMSETUP.init(sb, $('content'), toast);
          window.ACTOM_FORMSETUP.load();
        }
      });
    });
  }

  function openDrawer() {
    $('drawer').classList.add('is-open');
    $('drawerScrim').hidden = false;
    requestAnimationFrame(function () { $('drawerScrim').style.opacity = '1'; });
    $('navBtn').setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onDrawerKey);
  }
  function closeDrawer() {
    if (document.body.classList.contains('drawer-pinned')) return;
    $('drawer').classList.remove('is-open');
    $('drawerScrim').style.opacity = '0';
    $('drawerScrim').hidden = true;
    $('navBtn').setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onDrawerKey);
  }
  function onDrawerKey(ev) { if (ev.key === 'Escape') { closeDrawer(); $('navBtn').focus(); } }

  function wireDrawer() {
    $('navBtn').addEventListener('click', function () {
      $('drawer').classList.contains('is-open') ? closeDrawer() : openDrawer();
    });
    $('drawerScrim').addEventListener('click', closeDrawer);

    var pin = $('drawerPin');
    var pinned = false;
    try { pinned = localStorage.getItem('actom_drawer_pinned') === '1'; } catch (e) {}

    function applyPin(on) {
      document.body.classList.toggle('drawer-pinned', on);
      pin.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) { $('drawer').classList.add('is-open'); $('drawerScrim').hidden = true; }
      else { $('drawer').classList.remove('is-open'); }
      try { localStorage.setItem('actom_drawer_pinned', on ? '1' : '0'); } catch (e) {}
    }
    pin.addEventListener('click', function () {
      applyPin(!document.body.classList.contains('drawer-pinned'));
    });
    if (pinned && window.innerWidth >= 1100) applyPin(true);
  }

  // Counts for the rail. Cheap head-only queries, refreshed whenever a
  // decision is taken so the badge cannot go stale behind the reviewer.
  function refreshCounts() {
    return Promise.all([
      sb.from('applications').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
      sb.from('reviewer_profiles').select('user_id', { count: 'exact', head: true }).eq('active', false),
      sb.from('apprentices').select('id', { count: 'exact', head: true }).eq('status', 'active')
    ]).then(function (r) {
      S.counts.queue    = r[0] && r[0].count != null ? r[0].count : null;
      S.counts.people   = r[1] && r[1].count != null ? r[1].count : null;
      S.counts.register = r[2] && r[2].count != null ? r[2].count : null;
      renderTabs();
    }).catch(function () { /* counts are decoration; never block the console */ });
  }

  function showHelp() {
    $('content').innerHTML =
      '<div class="card"><div class="card-head"><div class="eyebrow">Help</div>' +
      '<h2>Reviewing applications</h2></div>' +
      '<p><strong>Applications</strong> lists everything submitted. Open one to see the ' +
      'marks, documents and score. Unlocking an ID number asks for a reason, and both the ' +
      'reason and your name are recorded.</p>' +
      '<p><strong>Scores</strong> are a weighted average of the subjects configured for that ' +
      'trade. Flags are advisory only — nothing is ever declined automatically, and every ' +
      'decision is made by a person.</p>' +
      '<p><strong>Form setup</strong> configures the next intake. Publishing freezes the form ' +
      'permanently; to change anything afterwards you clone the intake and publish the clone.</p>' +
      '<p><strong>Access log</strong> records every ID unlocked, document opened and list ' +
      'exported. It is the evidence that ACTOM handles applicant data properly under POPIA.</p>' +
      '<p class="small muted">Questions about the system itself: Group IT.</p></div>';
  }

  /* ========================================================= dashboard
     Aggregates only. This is the first screen a reviewer opens, often on
     a monitor other people can see, so nothing here identifies anyone.
     Every number links onward to the queue where the audit log applies. */

  function loadDashboard() {
    var intake = S.filters.intake ||
      (S.intakes.filter(function (i) { return i.status === 'open'; })[0] || {}).id ||
      (S.intakes[0] || {}).id;

    Promise.all([
      sb.from('applications')
        .select('id,trade_id,status,auto_score,meets_minimum,ethnic_group,has_disability,' +
                'gender,is_minor,submitted_at,intake_id,city,province')
        .neq('status', 'draft').limit(5000),
      sb.from('intake_trades').select('*')
    ]).then(function (r) {
      if (r[0].error) { $('content').innerHTML = errBox(r[0].error.message); return; }
      renderDashboard(r[0].data || [], r[1].data || [], intake);
    });
  }

  function renderDashboard(all, itrades, intakeId) {
    var intake = S.intakes.filter(function (i) { return i.id === intakeId; })[0] || {};
    var rows = all.filter(function (a) { return !intakeId || a.intake_id === intakeId; });

    var by = function (f) { return rows.filter(f).length; };
    var awaiting   = by(function (a) { return a.status === 'submitted'; });
    var shortlisted= by(function (a) { return a.status === 'shortlisted'; });
    var declined   = by(function (a) { return a.status === 'declined'; });
    var flagged    = by(function (a) { return a.meets_minimum === false; });
    var minors     = by(function (a) { return a.is_minor; });

    var scored = rows.filter(function (a) { return a.auto_score != null; });
    var avg = scored.length
      ? (scored.reduce(function (t, a) { return t + Number(a.auto_score); }, 0) / scored.length).toFixed(1)
      : null;

    var daysLeft = intake.closes_at
      ? Math.ceil((new Date(intake.closes_at) - new Date()) / 86400000) : null;

    // Per trade: applications against positions offered.
    var perTrade = itrades.filter(function (t) {
      return t.intake_id === intakeId && t.active;
    }).map(function (t) {
      var n = rows.filter(function (a) { return a.trade_id === t.trade_id; }).length;
      var q = rows.filter(function (a) {
        return a.trade_id === t.trade_id && a.meets_minimum !== false;
      }).length;
      return { name: tradeName(t.trade_id), n: n, qualified: q, positions: t.positions || 0 };
    }).sort(function (a, b) { return b.n - a.n; });

    var maxApps = Math.max.apply(null, perTrade.map(function (t) { return t.n; }).concat([1]));

    function equity(field, labels) {
      var counts = {};
      rows.forEach(function (a) {
        var k = a[field] || 'undisclosed';
        counts[k] = (counts[k] || 0) + 1;
      });
      var total = rows.length || 1;
      return Object.keys(labels).map(function (k) {
        var n = counts[k] || 0;
        return '<div class="eq-row"><span>' + esc(labels[k]) + '</span>' +
          '<span class="eq-bar"><i style="width:' + Math.round(n / total * 100) + '%"></i></span>' +
          '<span class="eq-num">' + n + '</span></div>';
      }).join('');
    }

    $('content').innerHTML =
      '<div class="card" style="margin-bottom:14px">' +
      '<div class="eyebrow">' + esc(intake.name || 'No intake selected') + '</div>' +
      '<h1 style="margin-bottom:2px">Apprentice intake at a glance</h1>' +
      '<p class="muted small" style="margin:0">' +
      (intake.status === 'open' && daysLeft != null
        ? (daysLeft > 0
            ? 'Open &middot; closes in <strong>' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') +
              '</strong>, on ' + new Date(intake.closes_at).toLocaleDateString('en-ZA',
                { day: 'numeric', month: 'long' })
            : 'Closing date has passed')
        : 'Status: ' + esc(intake.status || 'unknown')) + '</p></div>' +

      '<div class="stat-grid" style="margin-bottom:14px">' +
      '<div class="stat"><div class="lbl">Applications</div>' +
        '<div class="num">' + rows.length + '</div>' +
        '<div class="sub">' + minors + ' under 18</div></div>' +
      '<div class="stat' + (awaiting ? ' is-action' : '') + '" data-go="submitted">' +
        '<div class="lbl">Awaiting review</div><div class="num">' + awaiting + '</div>' +
        '<div class="sub">' + (awaiting ? 'Needs a first look' : 'All seen') + '</div></div>' +
      '<div class="stat" data-go="shortlisted"><div class="lbl">Shortlisted</div>' +
        '<div class="num">' + shortlisted + '</div>' +
        '<div class="sub">' + declined + ' declined</div></div>' +
      '<div class="stat"><div class="lbl">Average score</div>' +
        '<div class="num">' + (avg != null ? avg : '&mdash;') + '</div>' +
        '<div class="sub">' + flagged + ' below the minimums</div></div>' +
      '</div>' +

      '<div class="dash-cols">' +

      '<div class="card"><div class="card-head"><div class="eyebrow">By trade</div>' +
      '<h2>Applications against positions</h2>' +
      '<p>Qualified means the application met every configured minimum. ' +
      'Flags are advisory, so a low count here is a prompt to look, not a verdict.</p></div>' +
      (perTrade.length
        ? perTrade.map(function (t) {
            var thin = t.positions > 0 && t.qualified < t.positions;
            return '<div class="fill"><div class="fill-name">' + esc(t.name) +
              '<span>' + t.qualified + ' qualified' +
              (t.positions ? ' of ' + t.positions + ' position' + (t.positions === 1 ? '' : 's') : '') +
              '</span></div>' +
              '<span class="fill-bar"><i class="' + (thin ? 'is-thin' : '') +
              '" style="width:' + Math.round(t.n / maxApps * 100) + '%"></i></span>' +
              '<span class="fill-num">' + t.n + ' <span>app' + (t.n === 1 ? '' : 's') + '</span></span>' +
              '</div>';
          }).join('')
        : '<p class="muted small">No trades configured for this intake.</p>') +
      '</div>' +

      '<div class="card"><div class="card-head"><div class="eyebrow">Employment equity</div>' +
      '<h2>Applicant pool</h2>' +
      '<p>Aggregate figures for Employment Equity Act reporting. No individual is identified here.</p></div>' +
      '<h3 style="margin-top:4px">Population group</h3>' +
      equity('ethnic_group', { african: 'African', coloured: 'Coloured', indian: 'Indian',
                               white: 'White', other: 'Other', undisclosed: 'Not disclosed' }) +
      '<h3 style="margin-top:14px">Gender</h3>' +
      equity('gender', { female: 'Female', male: 'Male', other: 'Other', undisclosed: 'Not disclosed' }) +
      '<h3 style="margin-top:14px">Disability</h3>' +
      equity('has_disability', { yes: 'Declared', no: 'None declared', undisclosed: 'Not disclosed' }) +
      '<p class="dash-note">Applicants may decline to answer these questions, and doing so ' +
      'does not affect their application.</p>' +
      '</div>' +

      '</div>';

    // Stat cards jump into the queue, pre-filtered.
    $('content').querySelectorAll('[data-go]').forEach(function (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function () {
        S.filters.status = el.dataset.go;
        S.tab = 'queue';
        renderTabs();
        loadQueue();
      });
    });
  }

  /* =========================================================== queue */
  function loadQueue() {
    // A Top N request only means something sorted by score, whatever the
    // sort toggle was last set to — and the query must fetch enough rows
    // to actually contain the Nth one, not just the default page size.
    var byScore = S.filters.sort === 'score' || !!S.filters.topN;
    var limit = S.filters.topN ? Math.max(500, S.filters.topN) : 500;

    var q = sb.from('applications').select(APP_COLS).neq('status', 'draft')
              .order(byScore ? 'auto_score' : 'submitted_at',
                     { ascending: false }).limit(limit);
    if (S.filters.status) q = q.eq('status', S.filters.status);
    if (S.filters.trade) q = q.eq('trade_id', S.filters.trade);
    if (S.filters.intake) q = q.eq('intake_id', S.filters.intake);

    q.then(function (r) {
      if (r.error) { $('content').innerHTML = errBox(r.error.message); return; }
      S.rows = r.data || [];
      renderQueue();
    });
  }

  function errBox(m) {
    return '<div class="notice notice-err"><strong>Could not load</strong>' + esc(m) + '</div>';
  }

  function renderQueue() {
    var term = S.filters.q.toLowerCase();
    var matched = S.rows.filter(function (a) {
      if (!term) return true;
      return (a.full_name || '').toLowerCase().indexOf(term) >= 0 ||
             (a.reference || '').toLowerCase().indexOf(term) >= 0 ||
             (a.id_number_last4 || '').indexOf(term) >= 0 ||
             (a.contact_number || '').indexOf(term) >= 0;
    });

    // Top N is applied after search, on whatever is already sorted by
    // score from loadQueue(). Only applications WITH a score can sensibly
    // be ranked — an unscored one sitting first by accident of ordering
    // would be a confusing thing to hand to a shortlisting meeting.
    var rows = matched;
    var cutoffNote = '';
    if (S.filters.topN) {
      var scored = matched.filter(function (a) { return a.auto_score != null; });
      var unscored = matched.length - scored.length;
      rows = scored.slice(0, S.filters.topN);

      if (scored.length > rows.length) {
        var cutoffScore = rows.length ? Number(rows[rows.length - 1].auto_score) : null;
        var tiedBeyond = scored.slice(rows.length).filter(function (a) {
          return Number(a.auto_score) === cutoffScore;
        }).length;
        cutoffNote = ' &middot; cut-off score <strong>' + cutoffScore.toFixed(1) + '</strong>' +
          (tiedBeyond
            ? ' — <strong>' + tiedBeyond + '</strong> more applicant' +
              (tiedBeyond === 1 ? '' : 's') + ' also scored ' + cutoffScore.toFixed(1) +
              ' but fell just outside'
            : '');
      }
      if (unscored) {
        cutoffNote += ' &middot; ' + unscored + ' unscored application' +
          (unscored === 1 ? '' : 's') + ' excluded from the ranking';
      }
    }

    var counts = {};
    S.rows.forEach(function (a) { counts[a.status] = (counts[a.status] || 0) + 1; });

    $('content').innerHTML =
      '<div class="card">' +
      '<div class="filter-bar">' +
      '<div class="field"><label for="fStatus">Status</label>' + sel('fStatus',
        [['', 'All'], ['submitted', 'Submitted'], ['under_review', 'Under review'],
         ['shortlisted', 'Shortlisted'], ['declined', 'Declined'], ['withdrawn', 'Withdrawn']],
        S.filters.status) + '</div>' +
      '<div class="field"><label for="fTrade">Trade</label>' + sel('fTrade',
        [['', 'All trades']].concat(S.trades.map(function (t) { return [t.id, t.name]; })),
        S.filters.trade) + '</div>' +
      '<div class="field"><label for="fIntake">Intake</label>' + sel('fIntake',
        [['', 'All intakes']].concat(S.intakes.map(function (i) { return [i.id, i.name]; })),
        S.filters.intake) + '</div>' +
      '<div class="field"><label for="fQ">Search</label>' +
      '<input type="text" id="fQ" placeholder="Name, reference, last 4 of ID, or phone" ' +
      'value="' + esc(S.filters.q) + '"></div>' +
      '</div>' +

      '<div class="filter-actions">' +
      '<button class="btn btn-ghost btn-sm" id="exportBtn">Export shortlist CSV</button>' +
      (S.filters.topN
        ? '<button class="btn btn-ghost btn-sm" id="sortBtn" disabled title="Sorted by score while a Top N filter is on">Sort: highest score</button>'
        : '<button class="btn btn-ghost btn-sm" id="sortBtn">Sort: ' +
          (S.filters.sort === 'score' ? 'highest score' : 'most recent') + '</button>') +
      '<button class="btn btn-ghost btn-sm" id="rankBtn">Recalculate ranks</button>' +
      '<span class="spacer"></span>' +
      '<label class="small muted" for="fTopN" style="display:flex;align-items:center;gap:.4rem">' +
      'Top' +
      '<input type="number" id="fTopN" min="1" max="2000" placeholder="all" style="width:78px;padding:.3rem" ' +
      'value="' + (S.filters.topN || '') + '">' +
      'by score</label>' +
      (S.filters.topN
        ? '<button class="btn btn-ghost btn-sm" id="topNClear" title="Show every match again">&times; Clear</button>'
        : '<button class="btn btn-ghost btn-sm" id="topN100Btn">Top 100</button>') +
      '</div>' +

      '<div class="filter-summary" style="margin-top:.5rem">' +
      (S.filters.topN
        ? 'Showing top <strong>' + rows.length + '</strong> of ' + matched.length + ' by score' + cutoffNote
        : '<strong>' + rows.length + '</strong> shown' +
          (counts.submitted ? ' &middot; <strong>' + counts.submitted + '</strong> awaiting first review' : '') +
          (counts.shortlisted ? ' &middot; ' + counts.shortlisted + ' shortlisted' : '')) +
      '</div>' +
      (S.filters.topN
        ? '<p class="small muted" style="margin:.3rem 0 0">Ranked within the Status, Trade and ' +
          'Intake filters above. Choose one trade to get that trade\'s own top ' +
          S.filters.topN + ', rather than everyone mixed together.</p>'
        : '') +
      '</div>' +

      '<div class="card table-card">' +
      (rows.length === 0
        ? '<p class="center muted" style="padding:2.5rem">' +
          (S.filters.topN && matched.length
            ? 'No scored applications match these filters to rank.'
            : 'Nothing matches those filters. Widen the status or clear the search.') +
          '</p>'
        : '<div class="table-scroll"><table class="data"><thead><tr>' +
          '<th style="width:52px">Rank</th><th>Applicant</th><th>Trade</th>' +
          '<th>Grade 12</th><th>Location</th><th class="col-num">Score</th>' +
          '<th>Submitted</th><th>Status</th><th style="width:40px"></th>' +
          '</tr></thead><tbody>' +
          rows.map(function (a) {
            return '<tr data-open="' + esc(a.id) + '">' +
              '<td>' + (a.auto_rank
                ? '<span class="rank-chip' + (a.auto_rank <= 3 ? ' is-top' : '') + '">' +
                  esc(a.auto_rank) + '</span>'
                : '<span class="muted small">&mdash;</span>') + '</td>' +
              '<td><span class="cell-name">' + esc(a.full_name) +
                (a.is_minor ? ' <span class="tag tag-under_review">minor</span>' : '') + '</span>' +
                '<span class="cell-sub mono">' + esc(a.reference) +
                (a.id_number_last4 ? ' &middot; ID ••' + esc(a.id_number_last4) : '') + '</span></td>' +
              '<td>' + esc(tradeName(a.trade_id)) + '</td>' +
              '<td class="small">' + esc((a.grade12_type || '').toUpperCase().replace(/_/g, ' ')) +
                (a.grade12_year ? '<span class="cell-sub">' + esc(a.grade12_year) + '</span>' : '') + '</td>' +
              '<td class="small">' + esc(a.city || '—') +
                (a.province ? '<span class="cell-sub">' + esc(a.province) + '</span>' : '') + '</td>' +
              '<td class="col-num">' + scoreCell(a) + '</td>' +
              '<td class="small nowrap">' + (a.submitted_at
                ? new Date(a.submitted_at).toLocaleDateString('en-ZA') : '—') + '</td>' +
              '<td>' + statusTag(a.status) + '</td>' +
              '<td class="cell-go" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
              'stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>' +
              '</td></tr>';
          }).join('') + '</tbody></table></div>') +
      '</div>';

    $('fStatus').addEventListener('change', function () { S.filters.status = this.value; loadQueue(); });
    $('fTrade').addEventListener('change', function () { S.filters.trade = this.value; loadQueue(); });
    $('fIntake').addEventListener('change', function () { S.filters.intake = this.value; loadQueue(); });
    $('fQ').addEventListener('input', function () { S.filters.q = this.value; renderQueue(); $('fQ').focus(); });
    $('exportBtn').addEventListener('click', exportCsv);
    $('sortBtn').addEventListener('click', function () {
      S.filters.sort = S.filters.sort === 'score' ? 'submitted' : 'score';
      loadQueue();
    });
    $('rankBtn').addEventListener('click', function () {
      if (!S.filters.intake) {
        return alert('Choose an intake first — ranking is done within one intake and trade.');
      }
      sb.rpc('recalculate_ranks', { p_intake: S.filters.intake }).then(function (r) {
        if (r.error) return alert(r.error.message);
        toast(r.data + ' applications ranked');
        loadQueue();
      });
    });

    // Top N: a positive integer applies the filter; clearing the field
    // (or typing 0 / something invalid) switches it back off. Re-queries
    // rather than just re-rendering, because Top N forces score order
    // and may need more rows than the default page fetched.
    $('fTopN').addEventListener('change', function () {
      var n = parseInt(this.value, 10);
      S.filters.topN = (n > 0) ? n : null;
      loadQueue();
    });
    if ($('topN100Btn')) {
      $('topN100Btn').addEventListener('click', function () {
        S.filters.topN = 100;
        loadQueue();
      });
    }
    if ($('topNClear')) {
      $('topNClear').addEventListener('click', function () {
        S.filters.topN = null;
        loadQueue();
      });
    }

    // The row is the target; the Open button is an affordance for anyone
    // who expects one. Both resolve to the same id.
    $('content').querySelectorAll('tr[data-open]').forEach(function (tr) {
      tr.addEventListener('click', function () { openApplication(tr.dataset.open); });
    });
  }

  // Score, rank and any advisory flags. Flags never block anything.
  function scoreCell(a) {
    if (a.auto_score == null) return '<span class="muted small">—</span>';
    var flagged = a.meets_minimum === false;
    return '<strong style="color:' + (flagged ? 'var(--warn)' : 'var(--ok)') + '">' +
      Number(a.auto_score).toFixed(1) + '</strong>' +
      (a.auto_rank ? ' <span class="small muted">#' + a.auto_rank + '</span>' : '') +
      (flagged && a.auto_flags && a.auto_flags.length
        ? '<br><span class="tag tag-under_review" title="' + esc(a.auto_flags.join('; ')) + '">' +
          a.auto_flags.length + ' flag' + (a.auto_flags.length === 1 ? '' : 's') + '</span>'
        : '');
  }

  function sel(id, opts, current) {
    return '<select id="' + id + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(current) === String(o[0]) ? ' selected' : '') +
             '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }

  /* ========================================================== register
     The apprentice register. An entry here is an employment record, not
     an application, and it outlives the applicant retention period —
     which is why enrolment sets legal_hold on the source application. */

  function loadRegister() {
    S.regFilter = S.regFilter || 'active';
    sb.from('v_apprentice_register').select('*').order('start_date', { ascending: false })
      .then(function (r) {
        if (r.error) { $('content').innerHTML = errBox(r.error.message); return; }
        renderRegister(r.data || []);
      });
  }

  function renderRegister(all) {
    var rows = S.regFilter === 'all'
      ? all : all.filter(function (a) { return a.status === S.regFilter; });

    var n = function (st) { return all.filter(function (a) { return a.status === st; }).length; };

    $('content').innerHTML =
      '<div class="card"><div class="card-head"><div class="eyebrow">Register</div>' +
      '<h1>Apprentices</h1>' +
      '<p>Everyone taken on from an intake. These records are kept for the length of the ' +
      'contract and beyond — the applicant retention rules do not apply to them.</p></div>' +
      '<div class="btn-row" style="margin-top:0">' +
      [['active', 'Active', n('active')], ['completed', 'Completed', n('completed')],
       ['withdrawn', 'Withdrawn', n('withdrawn')], ['terminated', 'Terminated', n('terminated')],
       ['all', 'All', all.length]]
        .map(function (f) {
          return '<button class="btn ' + (S.regFilter === f[0] ? '' : 'btn-ghost') +
            ' btn-sm" data-reg="' + f[0] + '">' + f[1] + ' (' + f[2] + ')</button>';
        }).join('') +
      '<span class="spacer"></span>' +
      '<button class="btn btn-ghost btn-sm" id="regExport">Export register CSV</button>' +
      '</div></div>' +

      '<div class="card table-card">' +
      (rows.length === 0
        ? '<p class="center muted" style="padding:2.5rem">Nobody on the register with that status.</p>'
        : '<div class="table-scroll"><table class="data"><thead><tr>' +
          '<th>Apprentice</th><th>Trade</th><th>Started</th><th style="width:160px">Progress</th>' +
          '<th>Site</th><th>Supervisor</th><th>Status</th><th style="width:40px"></th>' +
          '</tr></thead><tbody>' +
          rows.map(function (a) {
            var pct = a.progress_pct == null ? null : Number(a.progress_pct);
            return '<tr data-appr="' + esc(a.id) + '">' +
              '<td><span class="cell-name">' + esc(a.full_name) + '</span>' +
              '<span class="cell-sub mono">' + esc(a.employee_number || a.reference || '') +
              '</span></td>' +
              '<td>' + esc(a.trade) + (a.division
                ? '<span class="cell-sub">' + esc(a.division) + '</span>' : '') + '</td>' +
              '<td class="small nowrap">' + (a.start_date
                ? new Date(a.start_date).toLocaleDateString('en-ZA') : '—') + '</td>' +
              '<td>' + (pct == null || a.status !== 'active'
                ? '<span class="muted small">—</span>'
                : '<span class="fill-bar" style="display:block"><i style="width:' + pct + '%"></i></span>' +
                  '<span class="cell-sub">' + pct + '% &middot; ' +
                  (a.days_remaining != null ? a.days_remaining + ' days left' : '') + '</span>') + '</td>' +
              '<td class="small">' + esc(a.site || '—') + '</td>' +
              '<td class="small">' + esc(a.supervisor || '—') + '</td>' +
              '<td>' + regStatusTag(a.status) + '</td>' +
              '<td class="cell-go" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
              'stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></td>' +
              '</tr>';
          }).join('') + '</tbody></table></div>') +
      '</div>';

    $('content').querySelectorAll('[data-reg]').forEach(function (b) {
      b.addEventListener('click', function () { S.regFilter = b.dataset.reg; renderRegister(all); });
    });
    $('content').querySelectorAll('tr[data-appr]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        openApprentice(all.filter(function (a) { return a.id === tr.dataset.appr; })[0]);
      });
    });
    $('regExport').addEventListener('click', function () { exportRegister(rows); });
  }

  function regStatusTag(s) {
    var map = { active: 'tag-shortlisted', completed: 'tag-submitted',
                withdrawn: 'tag-withdrawn', terminated: 'tag-declined',
                transferred: 'tag-under_review' };
    return '<span class="tag ' + (map[s] || '') + '">' + esc(s) + '</span>';
  }

  function openApprentice(a) {
    if (!a) return;
    $('content').innerHTML =
      '<div class="btn-row" style="margin-top:0">' +
      '<button class="btn btn-ghost btn-sm" id="regBack">Back to register</button>' +
      '<span class="spacer"></span><span class="mono" style="align-self:center">' +
      esc(a.employee_number || a.reference || '') + '</span></div>' +

      '<div class="split"><div>' +
      '<div class="card"><div class="card-head"><div class="eyebrow">Apprentice</div>' +
      '<h2>' + esc(a.full_name) + '</h2>' + regStatusTag(a.status) + '</div>' +
      '<dl class="kv">' +
      kv('Trade', a.trade) + kv('Intake', a.intake) +
      kv('Employee number', a.employee_number) +
      kv('SETA learner no.', a.seta_learner_number) +
      kv('Started', a.start_date) +
      kv('Expected end', a.expected_end_date) +
      kv('Contract signed', a.contract_signed_on) +
      kv('Site', a.site) + kv('Supervisor', a.supervisor) +
      kv('Mobile', a.contact_number) + kv('Email', a.email) +
      (a.ended_on ? kv('Ended', a.ended_on) + kv('Reason', a.end_reason) : '') +
      (a.trade_test_date ? kv('Trade test', a.trade_test_date +
        (a.trade_test_result ? ' — ' + a.trade_test_result : '')) : '') +
      '</dl></div></div>' +

      '<div><div class="card"><div class="card-head"><div class="eyebrow">Update</div>' +
      '<h2>Record a change</h2>' +
      '<p>Ending an apprenticeship needs both a date and a reason — the record stays on the ' +
      'register either way.</p></div>' +
      '<div class="grid grid-2">' +
      '<div class="field"><label for="uStatus">Status</label>' +
      sel('uStatus', [['active','Active'],['completed','Completed'],['withdrawn','Withdrawn'],
                      ['terminated','Terminated'],['transferred','Transferred']], a.status) + '</div>' +
      '<div class="field"><label for="uEnded">End date</label>' +
      '<input type="date" id="uEnded" value="' + esc(a.ended_on) + '"></div></div>' +
      '<div class="field"><label for="uReason">Reason</label>' +
      '<input type="text" id="uReason" value="' + esc(a.end_reason) + '"></div>' +
      '<div class="grid grid-2">' +
      '<div class="field"><label for="uTestDate">Trade test date</label>' +
      '<input type="date" id="uTestDate" value="' + esc(a.trade_test_date) + '"></div>' +
      '<div class="field"><label for="uTestResult">Result</label>' +
      sel('uTestResult', [['','—'],['pending','Pending'],['passed','Passed'],['failed','Failed']],
          a.trade_test_result || '') + '</div></div>' +
      '<div class="grid grid-2">' +
      '<div class="field"><label for="uSite">Site</label>' +
      '<input type="text" id="uSite" value="' + esc(a.site) + '"></div>' +
      '<div class="field"><label for="uSup">Supervisor</label>' +
      '<input type="text" id="uSup" value="' + esc(a.supervisor) + '"></div></div>' +
      '<div class="field"><label for="uNotes">Notes</label>' +
      '<textarea id="uNotes">' + esc(a.notes) + '</textarea></div>' +
      '<div class="btn-row"><button class="btn" id="uSave">Save changes</button></div>' +
      '<div id="uProblem"></div></div></div></div>';

    $('regBack').addEventListener('click', loadRegister);
    $('uSave').addEventListener('click', function () {
      sb.rpc('update_apprentice', {
        p_id: a.id,
        p_status: $('uStatus').value,
        p_ended_on: $('uEnded').value || null,
        p_end_reason: $('uReason').value.trim() || null,
        p_trade_test_date: $('uTestDate').value || null,
        p_trade_test_result: $('uTestResult').value || null,
        p_site: $('uSite').value.trim() || null,
        p_supervisor: $('uSup').value.trim() || null,
        p_notes: $('uNotes').value.trim() || null
      }).then(function (r) {
        if (r.error) return alert(r.error.message);
        if (!r.data.ok) {
          $('uProblem').innerHTML = '<div class="notice notice-err">' + esc(r.data.reason) + '</div>';
          return;
        }
        toast('Register updated');
        loadRegister();
        refreshCounts();
      });
    });
  }

  function exportRegister(rows) {
    if (!rows.length) return alert('Nothing to export.');
    if (!confirm('Export ' + rows.length + ' register entries? The file contains personal ' +
                 'information — store it on an ACTOM drive, not a personal device.')) return;
    var cols = ['full_name','employee_number','seta_learner_number','trade','division','intake',
                'start_date','expected_end_date','contract_signed_on','site','supervisor',
                'status','ended_on','end_reason','trade_test_date','trade_test_result',
                'contact_number','email'];
    var csv = [cols.join(',')].concat(rows.map(function (a) {
      return cols.map(function (c) {
        var v = a[c] == null ? '' : String(a[c]);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    })).join('\n');

    sb.rpc('log_pii_access', { p_application: null, p_action: 'export',
      p_detail: 'Apprentice register: ' + rows.length + ' entries' });

    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = 'actom-apprentice-register-' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    URL.revokeObjectURL(url);
    toast('Exported and logged');
  }

  /* ========================================================== detail */
  function openApplication(id) {
    Promise.all([
      sb.from('applications').select(APP_COLS).eq('id', id).single(),
      sb.from('application_subjects').select('*').eq('application_id', id),
      sb.from('application_documents').select('*').eq('application_id', id),
      sb.from('guardians').select('id,application_id,full_name,relationship,contact_number,email,id_number_last4')
        .eq('application_id', id).maybeSingle(),
      sb.from('consents').select('*').eq('application_id', id),
      sb.from('application_reviews').select('*').eq('application_id', id).order('created_at', { ascending: false })
    ]).then(function (r) {
      if (r[0].error) { $('content').innerHTML = errBox(r[0].error.message); return; }
      renderDetail(r[0].data, r[1].data || [], r[2].data || [], r[3].data, r[4].data || [], r[5].data || []);
      // Opening a record is itself an access event.
      sb.rpc('log_pii_access', { p_application: id, p_action: 'view', p_detail: 'Opened application detail' });
    });
  }

  function renderDetail(a, subjects, docs, guardian, consents, reviews) {
    var byStream = { academic: [], technical: [], qualification: [] };
    subjects.forEach(function (s) { if (byStream[s.stream]) byStream[s.stream].push(s); });

    var marksHtml = Object.keys(byStream).map(function (k) {
      if (!byStream[k].length) return '';
      return '<h3 style="margin-top:1.1rem;text-transform:capitalize">' + k + '</h3>' +
        '<div class="marks">' + byStream[k]
          .sort(function (x, y) { return x.subject_name.localeCompare(y.subject_name); })
          .map(function (s) {
            var flag = s.mark >= 60 ? 'var(--ok)' : (s.mark < 40 ? 'var(--err)' : 'var(--ink)');
            return '<div class="mark-row"><label>' + esc(s.subject_name) + '</label>' +
              '<strong style="text-align:center;color:' + flag + '">' + esc(s.mark) + '</strong></div>';
          }).join('') + '</div>';
    }).join('') || '<p class="muted small">No subject marks captured.</p>';

    $('content').innerHTML =
      '<div class="btn-row" style="margin-top:0"><button class="btn btn-ghost btn-sm" id="backBtn">Back to list</button>' +
      '<span class="spacer"></span><span class="mono" style="align-self:center">' + esc(a.reference) + '</span></div>' +

      '<div class="split">' +
      // ---- left column
      '<div>' +
      '<div class="card"><div class="card-head"><div class="eyebrow">Applicant</div>' +
      '<h2>' + esc(a.full_name) + '</h2>' + statusTag(a.status) +
      (a.is_minor ? ' <span class="tag tag-under_review">under 18</span>' : '') + '</div>' +
      '<dl class="kv">' +
      kv('Trade', tradeName(a.trade_id)) +
      kv('ID', '<span id="idBox">' + (a.id_type === 'passport' ? 'Passport' : 'SA ID') +
         ' ••••• ' + esc(a.id_number_last4 || '') +
         '<span class="kv-action"><button class="btn btn-ghost btn-sm" id="revealBtn">' +
         'Unlock</button></span></span>', true) +
      kv('Date of birth', a.date_of_birth || '—') +
      kv('Mobile', a.contact_number) +
      kv('Email', a.email) +
      kv('Address', [a.address_line1, a.address_line2, a.suburb, a.city, a.province, a.postal_code]
          .filter(Boolean).join(', ')) +
      kv('Population group', a.ethnic_group === 'undisclosed' ? 'Not disclosed' : (a.ethnic_group || '—')) +
      kv('Disability', a.has_disability === 'yes'
          ? esc((a.disability_types || []).join(', ') || 'Yes') : (a.has_disability || '—')) +
      (a.disability_other ? kv('Accommodation', a.disability_other) : '') +
      kv('Score', a.auto_score == null ? 'not scored'
          : Number(a.auto_score).toFixed(2) + (a.auto_rank ? '  (rank ' + a.auto_rank + ')' : '')) +
      kv('Submitted', a.submitted_at ? new Date(a.submitted_at).toLocaleString('en-ZA') : '—') +
      kv('Delete after', a.purge_after || '—') +
      '</dl></div>' +

      (guardian ? '<div class="card"><div class="eyebrow">Guardian</div><dl class="kv">' +
        kv('Name', guardian.full_name) + kv('Relationship', guardian.relationship) +
        kv('Contact', guardian.contact_number) + kv('Email', guardian.email) +
        '</dl></div>' : '') +

      (a.auto_flags && a.auto_flags.length
        ? '<div class="card"><div class="eyebrow">Advisory flags</div>' +
          '<div class="notice notice-warn" style="margin-top:.6rem"><strong>' +
          'Below the configured minimums</strong>' +
          a.auto_flags.map(esc).join('<br>') +
          '<br><br>These are advisory. Nothing has been declined automatically.</div></div>'
        : '') +

      '<div class="card"><div class="eyebrow">Consent on record</div>' +
      (consents.length ? '<dl class="kv">' + consents.map(function (c) {
        return kv(c.audience, new Date(c.granted_at).toLocaleString('en-ZA'));
      }).join('') + '</dl>' : '<p class="muted small">None recorded.</p>') + '</div>' +
      '</div>' +

      // ---- right column
      '<div>' +
      '<div class="card"><div class="card-head"><div class="eyebrow">Education</div>' +
      '<h2>' + esc((a.grade12_type || '—').toUpperCase().replace(/_/g, ' ')) +
      (a.grade12_year ? ' &middot; ' + esc(a.grade12_year) : '') + '</h2>' +
      (a.highest_qualification
        ? '<p>' + esc(a.highest_qualification) +
          (a.highest_qual_institution ? ' — ' + esc(a.highest_qual_institution) : '') +
          (a.highest_qual_year ? ' (' + esc(a.highest_qual_year) + ')' : '') + '</p>'
        : '') + '</div>' + marksHtml + '</div>' +

      '<div class="card"><div class="eyebrow">Documents</div>' +
      (docs.length ? '<ul class="file-list">' + docs.map(function (d) {
        return '<li class="file-item"><span class="name">' + esc(d.original_filename) +
          '<br><span class="meta">' + esc(d.doc_type.replace(/_/g, ' ')) + '</span></span>' +
          '<span class="meta">' + Math.round(d.size_bytes / 1024) + ' KB</span>' +
          '<button class="btn btn-ghost btn-sm" data-file="' + esc(d.id) + '" ' +
          'data-path="' + esc(d.storage_path) + '">Open</button></li>';
      }).join('') + '</ul>' : '<p class="muted small">No documents uploaded.</p>') + '</div>' +

      '<div class="card"><div class="eyebrow">Decision</div>' +
      '<div class="field"><label for="notes">Notes</label>' +
      '<textarea id="notes" placeholder="Why this decision? Kept against your name."></textarea></div>' +
      '<div class="btn-row" style="margin-top:.4rem">' +
      (a.status === 'enrolled'
        ? '<button class="btn btn-ghost" id="viewApprBtn">View register entry</button>'
        : '<button class="btn" data-set="shortlisted">Shortlist</button>' +
          '<button class="btn btn-ghost" data-set="under_review">Mark under review</button>' +
          '<button class="btn btn-danger" id="declineBtn">Not selected</button>' +
          (a.status === 'shortlisted' && ['admin','manager'].indexOf(S.me.role) >= 0
            ? '<button class="btn" id="enrolBtn" style="background:linear-gradient(135deg,#2bab84,var(--ok))">' +
              'Enrol as apprentice</button>' : '')) +
      '</div>' +
      (a.status === 'shortlisted' && ['admin','manager'].indexOf(S.me.role) < 0
        ? '<p class="small muted" style="margin-top:.6rem">A manager or administrator enrols.</p>' : '') +
      (reviews.length ? '<h3 style="margin-top:1.2rem">History</h3><table class="data"><tbody>' +
        reviews.map(function (v) {
          return '<tr><td class="small">' + new Date(v.created_at).toLocaleString('en-ZA') + '</td>' +
            '<td>' + esc(v.decision || '') + '</td><td class="small">' + esc(v.notes || '') + '</td></tr>';
        }).join('') + '</tbody></table>' : '') +
      '</div>' +
      '</div></div>';

    $('backBtn').addEventListener('click', function () { renderQueue(); });

    $('revealBtn').addEventListener('click', function () {
      var reason = prompt('Why do you need this ID number? This is recorded against your name.');
      if (!reason || reason.trim().length < 5) {
        return alert('A reason of at least five characters is required.');
      }
      sb.rpc('reveal_id_number', { p_application: a.id, p_reason: reason.trim() })
        .then(function (r) {
          if (r.error) return alert(r.error.message);
          $('idBox').innerHTML = '<span class="mono">' + esc(r.data) + '</span>' +
            ' <span class="tag tag-under_review">logged</span>';
        });
    });

    $('content').querySelectorAll('[data-file]').forEach(function (b) {
      b.addEventListener('click', function () {
        sb.storage.from('applicant-documents').createSignedUrl(b.dataset.path, CFG.SIGNED_URL_TTL || 60)
          .then(function (r) {
            if (r.error) return alert('Could not open that file: ' + r.error.message);
            sb.rpc('log_pii_access', {
              p_application: a.id, p_action: 'download_document',
              p_detail: b.dataset.path
            });
            window.open(r.data.signedUrl, '_blank', 'noopener');
          });
      });
    });

    if ($('enrolBtn')) $('enrolBtn').addEventListener('click', function () { enrolDialog(a); });
    if ($('declineBtn')) $('declineBtn').addEventListener('click', function () { declineDialog(a); });
    if ($('viewApprBtn')) $('viewApprBtn').addEventListener('click', function () {
      S.tab = 'register'; renderTabs(); loadRegister();
    });

    $('content').querySelectorAll('[data-set]').forEach(function (b) {
      b.addEventListener('click', function () {
        var status = b.dataset.set;
        var notes = $('notes').value.trim();
        // Changing a decision that has already been recorded. The
        // database refuses this without a reason; ask here so the
        // reviewer finds out before losing what they typed, not after.
        // Declining itself no longer goes through this shared button —
        // see declineDialog() — so this guard now only covers moving a
        // previously-declined application back to shortlisted, or the
        // reverse, via the plain Shortlist/Under review buttons.
        if ((a.status === 'shortlisted' || a.status === 'declined') && a.status !== status && !notes) {
          return alert('This application was already ' + a.status +
            '. Record a reason in the notes before changing that decision — ' +
            'the change is kept in the audit trail.');
        }
        sb.rpc('set_application_status', {
          p_application: a.id, p_status: status, p_notes: notes || null
        }).then(function (r) {
          if (r.error) return alert(r.error.message);
          toast('Saved as ' + status.replace('_', ' '));
          openApplication(a.id);
          refreshCounts();
        });
      });
    });
  }

  /* Key/value row.
     Escapes by DEFAULT. Markup must be opted into with the third
     argument, and only for strings this file builds itself.

     This previously sniffed the value for '<span' or '<button' and
     rendered it raw if found — which meant an applicant typing
     "<img src=x onerror=...>" into their address field got script
     execution inside a signed-in reviewer's session. Never infer intent
     from the content of untrusted data. */
  function kv(k, v, isHtml) {
    if (isHtml === true) {
      return '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>';
    }
    return '<dt>' + esc(k) + '</dt><dd>' + esc(v == null || v === '' ? '—' : v) + '</dd>';
  }

  /* Not-selected dialog. Same weight as enrolDialog: a deliberate action
     with its own fields, not a quick click among the plain status
     buttons. The reason is a controlled category rather than free text
     alone, so ACTOM can eventually answer "why do people not make it
     into a trade" instead of reading through a pile of notes by hand. */
  var DECLINE_REASONS = [
    ['', 'Choose a reason…'],
    ['below_minimum',    'Did not meet the minimum subject or mark requirements'],
    ['position_filled',  'Position filled by a stronger candidate'],
    ['failed_assessment','Did not pass the interview or aptitude assessment'],
    ['incomplete_docs',  'Documents incomplete, unverifiable, or could not be cleared'],
    ['unreachable',      'Could not be reached, or withdrew informally'],
    ['other',            'Other']
  ];

  function declineDialog(a) {
    var back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML =
      '<div class="modal"><div class="modal-head"><div>' +
      '<div class="eyebrow">Decision</div><h2>Mark ' + esc(a.full_name) + ' as not selected</h2></div>' +
      '<span style="flex:1"></span><button class="modal-close" aria-label="Close">&times;</button></div>' +

      '<div class="notice"><strong>This is recorded permanently.</strong>' +
      'Reversing it later needs a reason too — the same rule that already applies to ' +
      'any change once a decision has been made.</div>' +

      '<div class="field"><label for="dReason">Reason <span class="req">*</span></label>' +
      sel('dReason', DECLINE_REASONS, '') + '</div>' +

      '<div class="field"><label for="dDetail">Detail</label>' +
      '<textarea id="dDetail" placeholder="Add detail — required if you chose Other"></textarea></div>' +

      '<div id="dProblem"></div>' +
      '<div class="btn-row"><button class="btn btn-ghost" id="dCancel">Cancel</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-danger" id="dConfirm">Confirm — not selected</button></div></div>';

    function close() { back.remove(); }
    back.addEventListener('click', function (ev) {
      if (ev.target === back || ev.target.classList.contains('modal-close')) close();
    });
    document.body.appendChild(back);
    back.querySelector('#dCancel').addEventListener('click', close);

    back.querySelector('#dConfirm').addEventListener('click', function () {
      var btn = this;
      var category = back.querySelector('#dReason').value;
      var detail = back.querySelector('#dDetail').value.trim();

      if (!category) {
        back.querySelector('#dProblem').innerHTML =
          '<div class="notice notice-err">Choose a reason.</div>';
        return;
      }
      if (category === 'other' && !detail) {
        back.querySelector('#dProblem').innerHTML =
          '<div class="notice notice-err">Add a short explanation when the reason is Other.</div>';
        return;
      }

      btn.disabled = true; btn.textContent = 'Saving…';
      sb.rpc('decline_applicant', {
        p_application: a.id, p_category: category, p_detail: detail || null
      }).then(function (r) {
        btn.disabled = false; btn.textContent = 'Confirm — not selected';
        if (r.error) {
          back.querySelector('#dProblem').innerHTML =
            '<div class="notice notice-err">' + esc(r.error.message) + '</div>';
          return;
        }
        close();
        toast('Marked as not selected');
        openApplication(a.id);
        refreshCounts();
      });
    });
  }

  /* Enrolment dialog. Deliberately asks for the contract details up
     front: an entry created with only a name is a register nobody
     trusts, and the missing fields never get filled in later. */
  function enrolDialog(a) {
    var today = new Date().toISOString().slice(0, 10);
    var back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML =
      '<div class="modal"><div class="modal-head"><div>' +
      '<div class="eyebrow">Enrolment</div><h2>Enrol ' + esc(a.full_name) + '</h2></div>' +
      '<span style="flex:1"></span><button class="modal-close" aria-label="Close">&times;</button></div>' +

      '<div class="notice"><strong>This is a lasting change</strong>' +
      'The application becomes an employment record and is placed on legal hold, so the ' +
      'applicant retention rules stop applying to it. Only an administrator can undo it.</div>' +

      '<div class="grid grid-2">' +
      '<div class="field"><label for="eStart">Start date <span class="req">*</span></label>' +
      '<input type="date" id="eStart" value="' + today + '"></div>' +
      '<div class="field"><label for="eEnd">Expected end</label>' +
      '<input type="date" id="eEnd" placeholder="Defaults to three years"></div></div>' +

      '<div class="grid grid-2">' +
      '<div class="field"><label for="eEmp">Employee number</label>' +
      '<input type="text" id="eEmp"></div>' +
      '<div class="field"><label for="eSeta">SETA learner number</label>' +
      '<input type="text" id="eSeta"></div></div>' +

      '<div class="grid grid-2">' +
      '<div class="field"><label for="eSite">Site</label><input type="text" id="eSite"></div>' +
      '<div class="field"><label for="eSup">Supervising artisan</label>' +
      '<input type="text" id="eSup"></div></div>' +

      '<div class="field"><label for="eSigned">Contract signed on</label>' +
      '<input type="date" id="eSigned"></div>' +
      '<div class="field"><label for="eNotes">Notes</label><textarea id="eNotes"></textarea></div>' +

      '<div id="eProblem"></div>' +
      '<div class="btn-row"><button class="btn btn-ghost" id="eCancel">Cancel</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn" id="eConfirm">Enrol</button></div></div>';

    function close() { back.remove(); }
    back.addEventListener('click', function (ev) {
      if (ev.target === back || ev.target.classList.contains('modal-close')) close();
    });
    document.body.appendChild(back);
    back.querySelector('#eCancel').addEventListener('click', close);

    back.querySelector('#eConfirm').addEventListener('click', function () {
      var btn = this;
      if (!back.querySelector('#eStart').value) {
        back.querySelector('#eProblem').innerHTML =
          '<div class="notice notice-err">A start date is required.</div>';
        return;
      }
      btn.disabled = true; btn.textContent = 'Enrolling…';
      sb.rpc('enrol_applicant', {
        p_application: a.id,
        p_start_date: back.querySelector('#eStart').value,
        p_employee_number: back.querySelector('#eEmp').value.trim() || null,
        p_seta_number: back.querySelector('#eSeta').value.trim() || null,
        p_site: back.querySelector('#eSite').value.trim() || null,
        p_supervisor: back.querySelector('#eSup').value.trim() || null,
        p_contract_signed: back.querySelector('#eSigned').value || null,
        p_expected_end: back.querySelector('#eEnd').value || null,
        p_notes: back.querySelector('#eNotes').value.trim() || null
      }).then(function (r) {
        btn.disabled = false; btn.textContent = 'Enrol';
        if (r.error) {
          back.querySelector('#eProblem').innerHTML =
            '<div class="notice notice-err">' + esc(r.error.message) + '</div>';
          return;
        }
        if (!r.data.ok) {
          back.querySelector('#eProblem').innerHTML =
            '<div class="notice notice-err">' + esc(r.data.reason) + '</div>';
          return;
        }
        close();
        toast('Enrolled — now on the register');
        S.tab = 'register'; renderTabs(); loadRegister(); refreshCounts();
      });
    });
  }

  /* ========================================================== export */
  function exportCsv() {
    var rows = S.rows;
    if (!rows.length) return alert('Nothing to export with the current filters.');
    if (!confirm('Export ' + rows.length + ' records? This is logged, and the file will contain ' +
                 'personal information. Store it on an ACTOM drive, not a personal device.')) return;

    // Deliberately excludes ID numbers. Last four digits only.
    var cols = ['reference', 'full_name', 'id_number_last4', 'contact_number', 'email',
                'city', 'province', 'ethnic_group', 'has_disability', 'grade12_type',
                'highest_qualification', 'auto_score', 'auto_rank', 'meets_minimum',
                'status', 'submitted_at'];
    var csv = ['trade,' + cols.join(',')].concat(rows.map(function (a) {
      return [tradeName(a.trade_id)].concat(cols.map(function (c) {
        var v = a[c] == null ? '' : String(a[c]);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      })).join(',');
    })).join('\n');

    sb.rpc('log_pii_access', {
      p_application: null, p_action: 'export',
      p_detail: rows.length + ' records exported, filters: ' + JSON.stringify(S.filters)
    });

    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = 'actom-applications-' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    URL.revokeObjectURL(url);
    toast('Exported and logged');
  }

  /* =========================================================== audit */
  function loadAudit() {
    sb.from('pii_access_log').select('*').order('occurred_at', { ascending: false }).limit(500)
      .then(function (r) {
        if (r.error) { $('content').innerHTML = errBox(r.error.message); return; }
        $('content').innerHTML =
          '<div class="card"><div class="card-head"><div class="eyebrow">POPIA section 19</div>' +
          '<h2>Access log</h2><p>Every time an ID number is unlocked, a document opened or a ' +
          'list exported. Retained for three years, then aged out automatically.</p></div>' +
          '<div style="overflow-x:auto"><table class="data"><thead><tr>' +
          '<th>When</th><th>Who</th><th>Action</th><th>Application</th><th>Reason or detail</th>' +
          '</tr></thead><tbody>' +
          (r.data || []).map(function (l) {
            return '<tr><td class="small nowrap">' +
              new Date(l.occurred_at).toLocaleString('en-ZA') + '</td>' +
              '<td class="small">' + esc(l.actor_email) + '</td>' +
              '<td><span class="tag">' + esc(l.action) + '</span></td>' +
              '<td class="small mono">' + esc((l.application_id || '').slice(0, 8)) + '</td>' +
              '<td class="small">' + esc(l.detail) + '</td></tr>';
          }).join('') + '</tbody></table></div></div>';
      });
  }

  /* ========================================================= people */
  function loadPeople() {
    Promise.all([
      sb.from('reviewer_profiles').select('*').order('email'),
      sb.from('reviewer_trades').select('*')
    ]).then(function (r) {
      if (r[0].error) { $('content').innerHTML = errBox(r[0].error.message); return; }
      var scopes = {};
      (r[1].data || []).forEach(function (t) {
        (scopes[t.user_id] = scopes[t.user_id] || []).push(tradeName(t.trade_id));
      });

      $('content').innerHTML =
        '<div class="card"><div class="card-head"><div class="eyebrow">Access control</div>' +
        '<h2>Reviewers</h2><p>New ACTOM sign-ins land here inactive. Activate deliberately, ' +
        'and remove access when someone changes role.</p></div>' +
        '<div style="overflow-x:auto"><table class="data"><thead><tr>' +
        '<th>Email</th><th>Role</th><th>Trades</th><th>Active</th><th></th></tr></thead><tbody>' +
        (r[0].data || []).map(function (p) {
          return '<tr><td>' + esc(p.email) + '</td>' +
            '<td>' + sel('role_' + p.user_id,
              [['reviewer', 'Reviewer'], ['manager', 'Manager'],
               ['information_officer', 'Information Officer'], ['admin', 'Admin']], p.role) + '</td>' +
            '<td class="small">' + esc((scopes[p.user_id] || ['All trades']).join(', ')) + '</td>' +
            '<td>' + (p.active ? '<span class="tag tag-shortlisted">active</span>'
                               : '<span class="tag">inactive</span>') + '</td>' +
            '<td><button class="btn btn-ghost btn-sm" data-toggle="' + esc(p.user_id) + '" ' +
            'data-now="' + p.active + '">' + (p.active ? 'Deactivate' : 'Activate') + '</button></td></tr>';
        }).join('') + '</tbody></table></div></div>';

      $('content').querySelectorAll('[data-toggle]').forEach(function (b) {
        b.addEventListener('click', function () {
          sb.from('reviewer_profiles').update({ active: b.dataset.now !== 'true' })
            .eq('user_id', b.dataset.toggle)
            .then(function () { toast('Updated'); loadPeople(); });
        });
      });
      $('content').querySelectorAll('[id^="role_"]').forEach(function (s) {
        s.addEventListener('change', function () {
          sb.from('reviewer_profiles').update({ role: s.value })
            .eq('user_id', s.id.slice(5))
            .then(function () { toast('Role updated'); });
        });
      });
    });
  }
})();
