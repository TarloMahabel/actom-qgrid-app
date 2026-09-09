/* =====================================================================
   ACTOM Grid — assisted drafting, browser side.

   A plain script. No modules, no imports, no build step: script-src is
   'self' and nothing on the shop floor loads code from the internet.

   NAMESPACE. Everything hangs off window.Assist. Nothing here declares a
   bare top-level name — a `const supabase` in app.js once collided with
   the global the vendored client declares, and the whole file silently
   failed to parse. One global, named after the feature.

   TWO TIERS, and the reason for both.

     INSTANT, offline, on every keystroke. A curated list of corrections,
     below. It is a list and not a dictionary on purpose: flagging every
     word an English dictionary does not know would underline busbar,
     escutcheon, spouts, genset and half the vocabulary of the job, and a
     spell checker that is wrong about the words you use most is one you
     switch off in a week. This tier only ever fires on a spelling it is
     certain about.

     CONSIDERED, server-side, when the field loses focus. Sends the text
     to /api/assist. Costs a round trip and a fraction of a penny, so it
     happens once when the inspector moves on, never while they type.

   WHAT THIS WILL NOT DO. It never tells anyone whether something passes,
   fails, conforms, or should be accepted. That boundary is enforced on
   the server in netlify/functions/lib/guard.cjs, where a user cannot
   reach it. This file is the presentation of a suggestion and nothing
   more — every suggestion arrives with an id, and taking it or leaving it
   is recorded against that id.

   Edit HERE, then run ./shared/sync.sh.
   ===================================================================== */
(function () {
  'use strict';

  /* -------------------------------------------------------------------
     The instant tier.

     Additions welcome; the bar is that the left-hand side must be a
     misspelling with no legitimate reading in this context. "Lugs" is not
     a misspelling of "lags". "Ernest" is not a misspelling of "earnest"
     when someone is called Ernest.
     ------------------------------------------------------------------- */
  var FIXES = {
    // switchgear vocabulary
    busbarr: 'busbar', bussbar: 'busbar', 'bus-bar': 'busbar', bubar: 'busbar',
    shuter: 'shutter', shutterd: 'shuttered', shuttter: 'shutter',
    spout: 'spout', spputs: 'spouts', sprouts: 'spouts',
    escutcheon: 'escutcheon', escutcheun: 'escutcheon', escutchion: 'escutcheon',
    cubical: 'cubicle', cubicel: 'cubicle',
    isolater: 'isolator', isolatir: 'isolator',
    contacter: 'contactor', contacor: 'contactor',
    earthhing: 'earthing', earting: 'earthing', eathing: 'earthing',
    insualtion: 'insulation', insulaton: 'insulation', inuslation: 'insulation',
    creapage: 'creepage', creepge: 'creepage',
    clearence: 'clearance', clerance: 'clearance',
    torqued: 'torqued', torqe: 'torque', torqu: 'torque', tourque: 'torque',
    ferule: 'ferrule', ferrul: 'ferrule',
    gland: 'gland', glnad: 'gland',
    terminaton: 'termination', termination: 'termination', terminatoin: 'termination',
    interlok: 'interlock', interlcok: 'interlock',
    racing: 'racking', rackin: 'racking',
    flashove: 'flashover', flasover: 'flashover',
    bushinh: 'bushing', bushng: 'bushing',
    enclosuer: 'enclosure', enclousre: 'enclosure',
    // ordinary words that turn up in fault notes
    recieved: 'received', recieve: 'receive',
    seperate: 'separate', seperated: 'separated', seperation: 'separation',
    occured: 'occurred', occuring: 'occurring',
    accomodate: 'accommodate',
    definately: 'definitely',
    maintainance: 'maintenance', maintenence: 'maintenance',
    allignment: 'alignment', alignmnet: 'alignment', aligment: 'alignment',
    tighten: 'tighten', tightend: 'tightened', tigthened: 'tightened',
    loosend: 'loosened', loosend_: 'loosened',
    damge: 'damage', damgaed: 'damaged', damamge: 'damage',
    missaligned: 'misaligned', mislaigned: 'misaligned',
    guage: 'gauge', guages: 'gauges',
    lenght: 'length', hieght: 'height', widht: 'width',
    diamter: 'diameter', diametre: 'diameter',
    tempreature: 'temperature', temprature: 'temperature',
    resistence: 'resistance', resistanc: 'resistance',
    curcuit: 'circuit', circut: 'circuit', ciruit: 'circuit',
    volatge: 'voltage', voltag: 'voltage',
    conector: 'connector', conection: 'connection', conected: 'connected',
    instaled: 'installed', instalation: 'installation',
    replacment: 'replacement', replacd: 'replaced',
    aparent: 'apparent', visable: 'visible',
    thier: 'their', teh: 'the', adn: 'and', nto: 'not', taht: 'that',
    wich: 'which', wtih: 'with', reuqired: 'required', requird: 'required'
  };
  /* Entries whose key equals their value are there to protect a correct
     spelling from a future careless addition. Drop them from the lookup. */
  var LOOKUP = {};
  for (var k in FIXES) if (Object.prototype.hasOwnProperty.call(FIXES, k) && k !== FIXES[k]) LOOKUP[k] = FIXES[k];

  var state = {
    enabled: false,
    bar: null,
    field: null,       // the element the bar belongs to
    current: null,     // { id, intent, suggestion }
    lastSent: '',
    pending: 0,
    debounce: null,
    failures: 0        // consecutive server failures; stop pestering
  };

  function client() { return window.GRID && window.GRID.supabase; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------------
     The bar. Lives in the shell, never inside #page.

     The same reasoning as the photo pickers: the application re-renders
     #page on realtime events and background reloads, and a suggestion
     rendered inside it would be destroyed mid-read, taking the id with it
     and leaving an audit row nobody ever answered.
     ------------------------------------------------------------------ */
  function bar() {
    if (state.bar) return state.bar;
    var el = document.getElementById('assistBar');
    if (!el) return null;
    el.addEventListener('click', function (e) {
      var act = e.target.closest('[data-assist-act]');
      if (!act) return;
      e.preventDefault();
      if (act.dataset.assistAct === 'take') take(act.dataset.assistValue);
      else dismiss();
    });
    state.bar = el;
    return el;
  }

  function hide() {
    var el = bar();
    if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
    state.current = null;
    state.field = null;
  }

  /* Fixed to the viewport, not the document.
     Every field that uses this sits inside a modal, and a modal body scrolls
     independently of the page — so document coordinates put the bar somewhere
     the field no longer is. Viewport coordinates are right for both, and the
     bar is dismissed on any scroll rather than chased, which is why there is
     a capturing scroll listener in init.
     It also has to stay on screen: anchoring to the left edge of a field on
     the right-hand side of a two-column dialog pushed the bar off the page,
     where it was still focusable but invisible. */
  function show(field, html) {
    var el = bar();
    if (!el) return;
    state.field = field;
    el.innerHTML = html;
    el.classList.remove('hidden');
    el.style.top = '-9999px';          // measure before placing
    var r = field.getBoundingClientRect();
    var room = Math.min(560, Math.max(260, window.innerWidth - 24));
    el.style.minWidth = Math.max(260, Math.min(r.width, room)) + 'px';
    var w = el.offsetWidth || 260, h = el.offsetHeight || 44;
    /* Below the field if it fits, above if it does not, and never off the
       top — a suggestion an inspector cannot see is worse than none, because
       the audit row says one was offered. */
    var top = (window.innerHeight - r.bottom > h + 14) ? r.bottom + 6
            : Math.max(8, r.top - h - 6);
    el.style.top = Math.min(top, Math.max(8, window.innerHeight - h - 8)) + 'px';
    el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  }

  function chip(label, value, note) {
    return '<button type="button" class="btn sm pri" data-assist-act="take" ' +
           'data-assist-value="' + esc(value) + '">' + esc(label) + '</button>' +
           (note ? '<span class="cnt" style="margin-left:8px">' + esc(note) + '</span>' : '');
  }

  function offer(field, html) {
    show(field, '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' + html +
      '<button type="button" class="btn sm" data-assist-act="drop" style="margin-left:auto">Dismiss</button></div>');
  }

  /* ------------------------------------------------------------------
     Taking or leaving a suggestion. Both are recorded.
     ------------------------------------------------------------------ */
  function answer(accepted) {
    var id = state.current && state.current.id;
    if (id == null) return;
    var c = client();
    if (!c) return;
    /* accepted_at is set by the database trigger; sending a client clock
       into an audit trail is how records end up dated from a tablet whose
       time was wrong. The column is in the value only because the check
       constraint pairs them. */
    c.from('ai_suggestions').update({ accepted: accepted, accepted_at: new Date().toISOString() })
      .eq('id', id).then(function () { }, function () { });
  }

  function take(value) {
    var f = state.field;
    if (f) {
      f.value = value;
      /* A `change` event, bubbling, because that is what the application
         listens for. Setting .value alone changes what is on screen and
         nothing in the database — which is the worst of both. */
      f.dispatchEvent(new Event('input', { bubbles: true }));
      f.dispatchEvent(new Event('change', { bubbles: true }));
    }
    answer(true);
    hide();
  }

  function dismiss() { answer(false); hide(); }

  /* ------------------------------------------------------------------
     Tier one. No network, no cost, no id — nothing is recorded, because
     nothing was suggested by the model. This is a lookup table.
     ------------------------------------------------------------------ */
  function instant(text) {
    var out = [];
    var seen = {};
    var m = String(text || '').match(/[\p{L}][\p{L}'’-]*/gu) || [];
    for (var i = 0; i < m.length; i++) {
      var w = m[i], lower = w.toLowerCase();
      if (!LOOKUP[lower] || seen[lower]) continue;
      seen[lower] = 1;
      var to = LOOKUP[lower];
      /* Preserve the shape the inspector typed. */
      if (w[0] === w[0].toUpperCase() && w.slice(1) === w.slice(1).toLowerCase()) {
        to = to[0].toUpperCase() + to.slice(1);
      } else if (w === w.toUpperCase() && w.length > 1) {
        to = to.toUpperCase();
      }
      out.push({ from: w, to: to });
    }
    return out;
  }

  function applyCorrections(text, corrections) {
    var out = String(text);
    for (var i = 0; i < corrections.length; i++) {
      var c = corrections[i];
      out = out.replace(new RegExp('(^|[^\\p{L}])' + c.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}])', 'gu'),
                        function (_, pre) { return pre + c.to; });
    }
    return out;
  }

  /* ------------------------------------------------------------------
     Tier two.
     ------------------------------------------------------------------ */
  async function ask(intent, payload) {
    if (!state.enabled) return null;
    if (state.failures >= 3) return null;
    var c = client();
    if (!c) return null;
    var sess = await c.auth.getSession();
    var token = sess && sess.data && sess.data.session && sess.data.session.access_token;
    if (!token) return null;

    state.pending++;
    try {
      var res = await fetch('/api/assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify(Object.assign({ intent: intent }, payload))
      });
      if (res.status === 403) { state.enabled = false; return null; }
      if (!res.ok) { state.failures++; return null; }
      state.failures = 0;
      var data = await res.json();
      /* A withheld suggestion is not an error and is not shown. The
         server has already recorded that the boundary fired. */
      if (!data || data.withheld || !data.suggestion) return null;
      return data;
    } catch (e) {
      state.failures++;
      return null;
    } finally { state.pending--; }
  }

  /* ------------------------------------------------------------------
     Field wiring. A field opts in with data-assist="spell" and so on.
     Delegated, so it survives every re-render.
     ------------------------------------------------------------------ */
  /* A field may ask for more than one: data-assist="spell defect_code".
     They run in order and the first that has something to offer wins the
     bar — two suggestions stacked under one input is a field an inspector
     cannot see. */
  function intentsOf(el) {
    var v = el && el.dataset && el.dataset.assist;
    return v ? String(v).trim().split(/\s+/) : [];
  }
  function intentOf(el) { return intentsOf(el)[0] || null; }

  function onInput(e) {
    var el = e.target;
    if (intentOf(el) !== 'spell' || !el.value) return;
    clearTimeout(state.debounce);
    state.debounce = setTimeout(function () {
      var fixes = instant(el.value);
      if (!fixes.length) { if (state.field === el && !state.current) hide(); return; }
      var fixed = applyCorrections(el.value, fixes);
      state.current = null;   // nothing to record: this tier is a lookup
      offer(el, '<span class="cnt">Spelling</span>' +
        chip(fixes.map(function (f) { return f.from + ' → ' + f.to; }).join(', '), fixed));
    }, 260);
  }

  async function onLeave(e) {
    var el = e.target;
    var wanted = intentsOf(el);
    if (!wanted.length || !state.enabled) return;
    var text = String(el.value || '').trim();
    if (text.length < 4 || text === state.lastSent) return;
    state.lastSent = text;

    if (wanted.indexOf('spell') > -1) {
      var d = await ask('spell', {
        text: text,
        context_type: el.dataset.assistContext || null,
        context_id: el.dataset.assistId || null
      });
      if (d && d.suggestion.corrections.length && document.body.contains(el)) {
        var fixed = applyCorrections(el.value, d.suggestion.corrections);
        if (fixed !== el.value) {
          state.current = d;
          offer(el, '<span class="cnt">Spelling</span>' +
            chip(d.suggestion.corrections.map(function (f) { return f.from + ' → ' + f.to; }).join(', '), fixed));
          return;
        }
      }
    }

    if (wanted.indexOf('defect_code') > -1) {
      var codes = (window.Assist.codes || []).map(function (c) { return { code: c.code, description: c.description }; });
      if (!codes.length) return;
      var r = await ask('defect_code', {
        text: text, codes: codes,
        context_type: el.dataset.assistContext || null,
        context_id: el.dataset.assistId || null
      });
      if (!r || !r.suggestion.suggestions.length || !document.body.contains(el)) return;
      state.current = r;
      var s = r.suggestion.suggestions[0];
      offer(el, '<span class="cnt">Defect code — a suggestion, not a decision</span>' +
        chip(s.code, s.code, s.why));
      return;
    }
  }

  /* ------------------------------------------------------------------
     The intents the application calls directly, rather than by field.
     Each returns the raw payload plus its id, so whatever puts it on
     screen can record the answer.
     ------------------------------------------------------------------ */
  async function draftNcr(o) { return ask('ncr_draft', o); }
  async function similarFaults(o) { return ask('similar_faults', o); }
  async function explainCheck(o) { return ask('explain_check', o); }
  function recordAnswer(id, accepted) { state.current = { id: id }; answer(accepted); state.current = null; }

  function init(opts) {
    opts = opts || {};
    state.enabled = !!opts.enabled;
    window.Assist.codes = opts.codes || [];
    if (window.Assist.wired) return;
    window.Assist.wired = true;
    /* Always wired, even when the division has it switched off: the
       instant tier costs nothing, needs no server and no key, and is
       useful on its own. Only the network tier is gated. */
    document.addEventListener('input', onInput);
    document.addEventListener('focusout', function (e) { onLeave(e).catch(function () { }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
    /* Capturing, so it fires for a scroll inside a modal body as well as the
       page. Dismissing leaves the audit row unanswered, which is a state the
       register models deliberately — accepted is null means nobody said. */
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
  }

  window.Assist = {
    init: init,
    instant: instant,
    applyCorrections: applyCorrections,
    draftNcr: draftNcr,
    similarFaults: similarFaults,
    explainCheck: explainCheck,
    recordAnswer: recordAnswer,
    hide: hide,
    codes: [],
    wired: false
  };
})();
